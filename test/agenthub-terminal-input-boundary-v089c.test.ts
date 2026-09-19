import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  terminalSessions,
  sessionForSender,
  handleDeveloperTerminalWrite,
  handleDeveloperTerminalResize,
  handleDeveloperTerminalClose
} from '../src/main/terminalSession';
import {
  AGENTHUB_EXECUTION_PRELOAD_KEYS,
  FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS
} from '../src/shared/munderAuthority';

const TIMEOUT = 5000;
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('AgentHub Desktop V0.8.9C — Trusted Terminal Input Boundary Closure', () => {
  test('P0 25.1: Primary preload has no writePty or arbitrary terminal input APIs', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');

    const forbiddenPreloadMethods = [
      'writePty',
      'terminalWrite',
      'sendToPty',
      'typeToPty',
      'writeAgent',
      'steerByPty',
      'sendTerminalInput'
    ];

    for (const method of forbiddenPreloadMethods) {
      assert.equal(
        new RegExp(`\\b${method}\\s*:`).test(preload),
        false,
        `src/preload/index.ts must not expose method '${method}'`
      );
    }

    // Verify openDeveloperTerminal is exposed instead, taking only layout/cwd intent
    assert.match(
      preload,
      /openDeveloperTerminal:\s*\(/,
      'src/preload/index.ts must expose openDeveloperTerminal intent'
    );
  });

  test('P0 25.2: Dedicated terminal preload is separate and exposes only narrow allowlist', { timeout: TIMEOUT }, () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'src/preload/terminal.ts')), true, 'terminal preload must exist');
    const terminalPreload = read('src/preload/terminal.ts');

    // Must expose window.developerTerminal
    assert.match(terminalPreload, /contextBridge\.exposeInMainWorld\(\s*['"]developerTerminal['"]/);

    // Only allowlisted methods
    const allowed = ['write', 'resize', 'close', 'onData', 'onExit'];
    for (const key of allowed) {
      assert.match(
        terminalPreload,
        new RegExp(`\\b${key}\\s*:`),
        `terminal preload must expose '${key}'`
      );
    }

    // Forbidden capabilities
    const forbiddenCapabilities = [
      'agentHub',
      'window.agentHub',
      'cth',
      'window.cth',
      'spawn',
      'exec',
      'fs',
      'git',
      'provider',
      'createTask',
      'executeTask',
      'reviewDecision',
      'createAgent',
      'updateAgent'
    ];

    for (const cap of forbiddenCapabilities) {
      assert.equal(
        new RegExp(`['"]${cap}['"]`).test(terminalPreload),
        false,
        `Dedicated terminal preload must not expose or mention capability '${cap}'`
      );
    }
  });

  test('P0 25.3: developer-terminal:write IPC is sender-bound and rejects renderer ptyId', { timeout: TIMEOUT }, () => {
    const main = read('src/main/index.ts');

    // Legacy generic pty:write must NOT be registered
    assert.equal(
      main.includes("ipcMain.handle('pty:write'"),
      false,
      "Legacy 'pty:write' IPC handler must be completely removed"
    );

    // developer-terminal:write must be registered with evt.sender.id lookup
    assert.match(
      main,
      /ipcMain\.handle\(\s*['"]developer-terminal:write['"],\s*\(evt,\s*data:\s*string\)/,
      "developer-terminal:write must take evt and data only (no renderer ptyId)"
    );

    const termSession = read('src/main/terminalSession.ts');

    // Static verify sessionForSender uses sender.id
    assert.match(
      termSession,
      /function sessionForSender\(\s*senderId:\s*number\)/,
      'sessionForSender must look up by numeric senderId'
    );
    assert.match(
      main,
      /\bsessionForSender\b/,
      'main must re-export or use sessionForSender'
    );
  });

  test('P0 25.4: Unauthorized Primary sender rejected with 0 PTY writes', { timeout: TIMEOUT }, () => {
    const unauthorizedSenderId = 999999;
    // Ensure no session exists for this sender
    terminalSessions.delete(unauthorizedSenderId);

    let ptyWriteCallCount = 0;
    const mockWriter = () => {
      ptyWriteCallCount++;
      return { ok: true };
    };

    const res = handleDeveloperTerminalWrite(
      unauthorizedSenderId,
      'claude\r',
      mockWriter
    );

    assert.equal(res.ok, false);
    assert.equal(res.error, 'UNAUTHORIZED_TERMINAL_SENDER');
    assert.equal(
      ptyWriteCallCount,
      0,
      'PTY write count must be strictly 0 for unauthorized sender'
    );
  });

  test('P0 25.5: Terminal owner can write to its own session only', { timeout: TIMEOUT }, () => {
    const senderA = 10001;
    const senderB = 10002;

    terminalSessions.set(senderA, {
      ptyId: 'term-pty-A',
      ownerWebContentsId: senderA,
      cwd: 'G:/Code/ProjectA'
    });

    terminalSessions.set(senderB, {
      ptyId: 'term-pty-B',
      ownerWebContentsId: senderB,
      cwd: 'G:/Code/ProjectB'
    });

    try {
      const writtenTarget: string[] = [];
      const writtenData: string[] = [];

      const mockWriter = (id: string, data: string) => {
        writtenTarget.push(id);
        writtenData.push(data);
        return { ok: true };
      };

      const res = handleDeveloperTerminalWrite(senderA, 'ls -la\r', mockWriter);
      assert.equal(res.ok, true);
      assert.deepEqual(writtenTarget, ['term-pty-A']);
      assert.deepEqual(writtenData, ['ls -la\r']);

      // Sender A cannot address term-pty-B because write API does not accept ptyId
      assert.equal(sessionForSender(senderA)?.ptyId, 'term-pty-A');
    } finally {
      terminalSessions.delete(senderA);
      terminalSessions.delete(senderB);
    }
  });

  test('P0 25.6: Stale sender rejected after session close and map is cleaned', { timeout: TIMEOUT }, () => {
    const senderId = 20001;
    terminalSessions.set(senderId, {
      ptyId: 'term-pty-closing',
      ownerWebContentsId: senderId,
      cwd: 'G:/Code/Project'
    });

    let killedPtyId: string | null = null;
    const mockKiller = (id: string) => {
      killedPtyId = id;
    };

    const closeRes = handleDeveloperTerminalClose(senderId, mockKiller);
    assert.equal(closeRes.ok, true);
    assert.equal(killedPtyId, 'term-pty-closing');
    assert.equal(terminalSessions.has(senderId), false, 'Session mapping must be deleted upon close');

    // Immediate write attempt after close
    let writeCalls = 0;
    const writeRes = handleDeveloperTerminalWrite(senderId, 'echo after close\r', () => {
      writeCalls++;
      return { ok: true };
    });

    assert.equal(writeRes.ok, false);
    assert.equal(writeRes.error, 'UNAUTHORIZED_TERMINAL_SENDER');
    assert.equal(writeCalls, 0, 'Stale closed sender must result in 0 PTY write calls');
  });

  test('P0 25.7: No alternative Primary -> PTY arbitrary text paths', { timeout: TIMEOUT }, () => {
    const main = read('src/main/index.ts');

    // Match all ptyManager.write occurrences in main
    const matches = [...main.matchAll(/ptyManager\.write\(([^)]*)\)/g)];
    // In src/main/index.ts:
    // 1. handleDeveloperTerminalWrite (Dedicated Terminal session input)
    // 2. nudgeWorker text (fixed system nudge: inboxNudgeText)
    // 3. nudgeWorker enter (fixed '\r')
    assert.equal(
      matches.length <= 3,
      true,
      `ptyManager.write should only appear at audited locations, found: ${matches.length}`
    );

    // Verify nudgeWorker writes only fixed system text and carriage return
    assert.match(main, /ptyManager\.write\(ptyId,\s*inboxNudgeText\(ids\)\)/);
    assert.match(main, /ptyManager\.write\(ptyId,\s*'\\r'\)/);

    // Verify forbidden authority keys include writePty
    assert.equal(FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS.includes('writePty'), true);
    assert.equal(FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS.includes('sendToPty'), true);
    assert.equal(FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS.includes('terminalWrite'), true);
  });

  test('P0 25.8: Regression verification across V0.8.9B and V0.8.9A boundaries', { timeout: TIMEOUT }, () => {
    // DeveloperTerminalSpawnOptions has no command/args
    const preload = read('src/preload/index.ts');
    const spawnOptsIndex = preload.indexOf('export interface DeveloperTerminalSpawnOptions');
    const spawnOptsBlock = preload.slice(spawnOptsIndex, spawnOptsIndex + 300);
    assert.equal(/\bcommand\b\??:/.test(spawnOptsBlock), false);
    assert.equal(/\bargs\b\??:/.test(spawnOptsBlock), false);

    // Main selects OS default shell
    const main = read('src/main/index.ts');
    assert.match(main, /process\.env\.ComSpec \|\| 'powershell\.exe'/);
    assert.match(main, /process\.env\.SHELL \|\| '\/bin\/bash'/);

    // Legacy provider launch severed in UI
    const addAgent = read('src/renderer/src/components/AddAgentModal.tsx');
    assert.equal(addAgent.includes('tokenizeCommand'), false);
    assert.equal(addAgent.includes('spawnPty'), false);

    const center = read('src/renderer/src/components/CommandCenterPanel.tsx');
    assert.equal(center.includes('tokenizeCommand'), false);
    assert.equal(center.includes('spawnPty'), false);

    const hive = read('src/renderer/src/hooks/useHive.ts');
    assert.equal(hive.includes('window.cth.writePty'), false);

    // Official AgentHub provider execution remains Backend only
    assert.deepEqual(AGENTHUB_EXECUTION_PRELOAD_KEYS, ['executeTask']);
  });
});
