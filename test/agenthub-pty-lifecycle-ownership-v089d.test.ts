import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  terminalSessions,
  sessionForSender,
  handleDeveloperTerminalWrite,
  handleDeveloperTerminalResize,
  handleDeveloperTerminalClose,
  removeSessionByPtyId,
  type TerminalSession
} from '../src/main/terminalSession';

const TIMEOUT = 5000;
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function getAllFiles(dir: string, ext: string[]): string[] {
  const result: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...getAllFiles(full, ext));
    } else if (ext.some((e) => entry.name.endsWith(e))) {
      result.push(full);
    }
  }
  return result;
}

describe('AgentHub Desktop V0.8.9D — PTY Lifecycle & Ownership Closure', () => {
  beforeEach(() => {
    terminalSessions.clear();
  });

  test('P0 24: Primary preload PTY lifecycle denylist', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');

    // Denylist: strictly NO PTY lifecycle / write / enumeration methods
    const forbiddenMethods = [
      'spawnPty',
      'spawnDeveloperTerminal',
      'resizePty',
      'redrawPty',
      'killPty',
      'listPtys',
      'writePty'
    ];

    for (const method of forbiddenMethods) {
      assert.equal(
        new RegExp(`\\b${method}\\s*:`).test(preload),
        false,
        `src/preload/index.ts must not expose method '${method}:'`
      );
    }

    // Must strictly expose openDeveloperTerminal intent
    assert.match(
      preload,
      /openDeveloperTerminal:\s*\(/,
      'src/preload/index.ts must expose openDeveloperTerminal intent'
    );
  });

  test('P0 25: Primary terminal intent contains no identity and returns no runtime metadata', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const openIndex = preload.indexOf('openDeveloperTerminal:');
    assert.notEqual(openIndex, -1, 'openDeveloperTerminal must be present');
    const block = preload.slice(openIndex, openIndex + 600);

    // Sanitized options must only contain cwd, cols, rows
    assert.match(block, /cwd:\s*typeof\s*opts\?\.cwd/);
    assert.match(block, /cols:\s*typeof\s*opts\?\.cols/);
    assert.match(block, /rows:\s*typeof\s*opts\?\.rows/);

    // Forbidden keys in sanitized payload
    const forbiddenIdentityKeys = ['id', 'ptyId', 'command', 'args', 'provider', 'model', 'pid', 'ownerId'];
    for (const key of forbiddenIdentityKeys) {
      assert.equal(
        new RegExp(`\\b${key}:\\s*opts`).test(block),
        false,
        `openDeveloperTerminal must not accept/forward identity key '${key}'`
      );
    }
  });

  test('P0 26: Generic lifecycle IPC handlers removed from Main', { timeout: TIMEOUT }, () => {
    const main = read('src/main/index.ts');

    // Generic Renderer-facing PTY lifecycle IPC channels must be removed
    const removedChannels = [
      "ipcMain.handle('pty:resize'",
      "ipcMain.handle('pty:redraw'",
      "ipcMain.handle('pty:kill'",
      "ipcMain.handle('pty:list'",
      "ipcMain.handle('pty:write'"
    ];

    for (const ch of removedChannels) {
      assert.equal(
        main.includes(ch),
        false,
        `Main must not register generic channel: ${ch}`
      );
    }
  });

  test('P0 27: Dedicated Terminal resize is sender-bound', { timeout: TIMEOUT }, () => {
    terminalSessions.set(101, { ptyId: 'term_pty_101', ownerWebContentsId: 101, cwd: '/test/cwd/1' });
    terminalSessions.set(102, { ptyId: 'term_pty_102', ownerWebContentsId: 102, cwd: '/test/cwd/2' });

    let resizedPtyId = '';
    let resizedCols = 0;
    let resizedRows = 0;
    const fakeResizer = (id: string, c: number, r: number) => {
      resizedPtyId = id;
      resizedCols = c;
      resizedRows = r;
      return { ok: true };
    };

    // Terminal sender 101 resizes
    const res = handleDeveloperTerminalResize(101, 120, 35, fakeResizer);
    assert.deepEqual(res, { ok: true });
    assert.equal(resizedPtyId, 'term_pty_101', 'Must resize own PTY for sender 101');
    assert.equal(resizedCols, 120);
    assert.equal(resizedRows, 35);

    // Invalid dimension values rejected
    assert.equal(handleDeveloperTerminalResize(101, 'bad' as unknown as number, 35, fakeResizer).ok, false);
    assert.equal(handleDeveloperTerminalResize(101, 120, null as unknown as number, fakeResizer).ok, false);
  });

  test('P0 28: Dedicated Terminal close is sender-bound', { timeout: TIMEOUT }, () => {
    terminalSessions.set(201, { ptyId: 'term_pty_201', ownerWebContentsId: 201, cwd: '/test/cwd/201' });
    terminalSessions.set(202, { ptyId: 'term_pty_202', ownerWebContentsId: 202, cwd: '/test/cwd/202' });

    const killedIds: string[] = [];
    const fakeKiller = (id: string) => {
      killedIds.push(id);
    };

    const res = handleDeveloperTerminalClose(201, fakeKiller);
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(killedIds, ['term_pty_201'], 'Must kill sender 201 own PTY only');
    assert.equal(sessionForSender(201), null, 'Session 201 must be removed');
    assert.notEqual(sessionForSender(202), null, 'Session 202 must remain untouched');
  });

  test('P0 29: Primary sender cannot close Dedicated Terminal PTY', { timeout: TIMEOUT }, () => {
    // Dedicated terminal session exists for sender 300
    terminalSessions.set(300, { ptyId: 'term_pty_300', ownerWebContentsId: 300, cwd: '/test/cwd/300' });

    let killCallCount = 0;
    const fakeKiller = () => {
      killCallCount++;
    };

    // Primary window webContents ID is 1 (not in terminalSessions)
    const primarySenderId = 1;
    const res = handleDeveloperTerminalClose(primarySenderId, fakeKiller);

    assert.equal(res.ok, false);
    assert.equal(res.error, 'UNAUTHORIZED_TERMINAL_SENDER');
    assert.equal(killCallCount, 0, 'Kill must not be invoked for unauthorized sender');
    assert.notEqual(sessionForSender(300), null, 'Dedicated terminal session 300 remains safe');
  });

  test('P0 30: Primary sender cannot resize Dedicated Terminal PTY', { timeout: TIMEOUT }, () => {
    terminalSessions.set(400, { ptyId: 'term_pty_400', ownerWebContentsId: 400, cwd: '/test/cwd/400' });

    let resizeCallCount = 0;
    const fakeResizer = () => {
      resizeCallCount++;
      return { ok: true };
    };

    const primarySenderId = 1;
    const res = handleDeveloperTerminalResize(primarySenderId, 100, 30, fakeResizer);

    assert.equal(res.ok, false);
    assert.equal(res.error, 'UNAUTHORIZED_TERMINAL_SENDER');
    assert.equal(resizeCallCount, 0, 'Resize must not be invoked for unauthorized sender');
  });

  test('P0 31: Primary cannot enumerate PTY IDs', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');

    const forbiddenEnumerationApis = [
      'listPtys',
      'getPtys',
      'getTerminalSessions',
      'getProcessSessions',
      'enumeratePtys',
      'enumerateTerminals'
    ];

    for (const api of forbiddenEnumerationApis) {
      assert.equal(
        new RegExp(`\\b${api}\\s*:`).test(preload),
        false,
        `Primary preload must not expose enumeration API '${api}'`
      );
    }
  });

  test('P0 32: No legacy UI callsites in Primary Renderer', { timeout: TIMEOUT }, () => {
    const rendererFiles = getAllFiles(path.join(ROOT, 'src/renderer/src'), ['.ts', '.tsx']);

    const forbiddenCalls = [
      'window.cth.spawnPty',
      'window.cth.spawnDeveloperTerminal',
      'window.cth.resizePty',
      'window.cth.redrawPty',
      'window.cth.killPty',
      'window.cth.listPtys',
      'window.cth.writePty'
    ];

    for (const file of rendererFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const call of forbiddenCalls) {
        assert.equal(
          content.includes(call),
          false,
          `File ${path.relative(ROOT, file)} must not contain legacy call '${call}'`
        );
      }
    }
  });

  test('P0 35: Dedicated Terminal preload allowlist is strict', { timeout: TIMEOUT }, () => {
    const terminalPreload = read('src/preload/terminal.ts');

    // Strictly allowed in Dedicated Terminal
    const allowed = ['write', 'resize', 'close', 'onData', 'onExit'];
    for (const m of allowed) {
      assert.match(terminalPreload, new RegExp(`\\b${m}\\s*:`));
    }

    // Forbidden in Dedicated Terminal
    const forbidden = [
      'list',
      'spawn',
      'killById',
      'resizeById',
      'redrawById',
      'attach',
      'switchSession',
      'window.agentHub'
    ];
    for (const f of forbidden) {
      assert.equal(
        new RegExp(`\\b${f}\\b`).test(terminalPreload),
        false,
        `Dedicated terminal preload must not contain '${f}'`
      );
    }

  });

  test('P0 36: Natural exit session lifecycle cleanup removes mapping', { timeout: TIMEOUT }, () => {
    terminalSessions.set(501, { ptyId: 'term_pty_501', ownerWebContentsId: 501, cwd: '/test/cwd/501' });
    terminalSessions.set(502, { ptyId: 'term_pty_502', ownerWebContentsId: 502, cwd: '/test/cwd/502' });

    assert.equal(sessionForSender(501)?.ptyId, 'term_pty_501');
    assert.equal(sessionForSender(502)?.ptyId, 'term_pty_502');

    // Simulate natural exit of PTY term_pty_501
    const cleaned = removeSessionByPtyId('term_pty_501');
    assert.equal(cleaned, true, 'removeSessionByPtyId must return true when session found');
    assert.equal(sessionForSender(501), null, 'Sender 501 session must be cleaned up on natural exit');
    assert.notEqual(sessionForSender(502), null, 'Sender 502 session remains intact');

    // Calling removeSessionByPtyId again is idempotent
    const reCleaned = removeSessionByPtyId('term_pty_501');
    assert.equal(reCleaned, false, 'Idempotent call returns false');
  });
});
