import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  applyPresentationOnlyOfficeTheme,
  LEGACY_RUNTIME_ACTION_POLICY
} from '../src/renderer/src/components/runtimeActionSemantics';

const TIMEOUT = 5000;
const ROOT = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function rendererFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...rendererFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('AgentHub Desktop V0.8.9E — Legacy Runtime Action Semantic Closure', () => {
  test('AgentDetail and Fullscreen Kill share one fail-closed policy with zero local archive', { timeout: TIMEOUT }, () => {
    const detail = read('src/renderer/src/components/AgentDetailPanel.tsx');
    const fullscreen = read('src/renderer/src/components/FullscreenTerminal.tsx');

    assert.equal(LEGACY_RUNTIME_ACTION_POLICY.terminateAgent.available, false);
    for (const source of [detail, fullscreen]) {
      assert.match(source, /LEGACY_RUNTIME_ACTION_POLICY\.terminateAgent\.reason/);
      assert.doesNotMatch(source, /\barchiveAgent\s*\(/);
      assert.doesNotMatch(source, /\bdisposeTerminal\s*\(/);
      assert.doesNotMatch(source, /\bonKill\b/);
      assert.match(source, /variant="destructive"\s+size="sm"\s+disabled/);
    }
  });

  test('Restart and provider/model switching are fail-closed instead of local runtime fabrication', { timeout: TIMEOUT }, () => {
    const source = read('src/renderer/src/components/CommandCenterPanel.tsx');
    const start = source.indexOf('function FloorTab');
    const end = source.indexOf('function ArchivedSection');
    assert.ok(start >= 0 && end > start);
    const floorTab = source.slice(start, end);

    for (const forbidden of [
      'restartWithModel',
      'acquireTerminal(',
      'disposeTerminal(',
      'resetTerminal(',
      'updateAgent(',
      "action: 'model updated'",
      'switched to'
    ]) {
      assert.equal(floorTab.includes(forbidden), false, `FloorTab must not contain '${forbidden}'`);
    }
    assert.match(floorTab, /LEGACY_RUNTIME_ACTION_POLICY\.restartAgent\.reason/);
    assert.match(floorTab, /LEGACY_RUNTIME_ACTION_POLICY\.switchRuntime\.reason/);
    assert.match(floorTab, /value="current"\s+disabled/);
  });

  test('Theme apply is presentation-only and preserves authoritative roster state', { timeout: TIMEOUT }, async () => {
    const source = read('src/renderer/src/components/OfficeThemePicker.tsx');
    const forbiddenCalls = [
      'archiveAgent',
      'removeAgent',
      'disableAgent',
      'deleteAgent',
      'kill',
      'restart',
      'spawn',
      'disposeTerminal',
      'resetTerminal'
    ];
    for (const name of forbiddenCalls) {
      assert.doesNotMatch(source, new RegExp(`\\b${name}\\s*\\(`));
    }
    assert.match(source, /applyPresentationOnlyOfficeTheme/);

    const roster = [
      { id: 'agent-1', status: 'BUSY', enabled: true },
      { id: 'agent-2', status: 'IDLE', enabled: true }
    ];
    const before = structuredClone(roster);
    let persistedTheme = '';
    let renderedTheme = '';
    await applyPresentationOnlyOfficeTheme('brooklyn99', {
      updateConfig: async (patch) => { persistedTheme = patch.officeTheme; },
      setOfficeTheme: (theme) => { renderedTheme = theme; }
    });

    assert.deepEqual(roster, before);
    assert.equal(persistedTheme, 'brooklyn99');
    assert.equal(renderedTheme, 'brooklyn99');
  });

  test('dead PTY observation cannot promote local state or claim auto-revive success', { timeout: TIMEOUT }, () => {
    const source = read('src/renderer/src/hooks/useHive.ts');
    assert.doesNotMatch(source, /\bonPowerResume\b/);
    assert.doesNotMatch(source, /\bresetTerminal\s*\(/);
    assert.doesNotMatch(source, /restored after sleep/);
    assert.doesNotMatch(source, /\breviving\b/);
    assert.match(source, /Renderer-side auto-revive is intentionally disabled/);
  });

  test('Primary preload retains zero generic PTY lifecycle authority and no aliases', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const forbiddenMethods = [
      'spawnPty',
      'spawnDeveloperTerminal',
      'writePty',
      'resizePty',
      'redrawPty',
      'killPty',
      'listPtys',
      'terminatePty',
      'stopPty',
      'closePty',
      'restartPty',
      'killProcess',
      'spawnProcess',
      'listProcesses',
      'getPtys',
      'getTerminalSessions'
    ];
    for (const method of forbiddenMethods) {
      assert.equal(new RegExp(`\\b${method}\\s*:`).test(preload), false, `${method} must not be exposed`);
    }

    const files = rendererFiles(path.join(ROOT, 'src/renderer/src'));
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const method of forbiddenMethods) {
        assert.equal(
          source.includes(`window.cth.${method}`),
          false,
          `${path.relative(ROOT, file)} must not call window.cth.${method}`
        );
      }
    }
  });

  test('presentation terminal helpers have no unverified runtime-action callsites', { timeout: TIMEOUT }, () => {
    const files = rendererFiles(path.join(ROOT, 'src/renderer/src'));
    const terminalPool = path.normalize(path.join(ROOT, 'src/renderer/src/components/terminalPool.ts'));
    for (const file of files) {
      if (path.normalize(file) === terminalPool) continue;
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\bdisposeTerminal\s*\(/, `${path.relative(ROOT, file)} calls disposeTerminal`);
      assert.doesNotMatch(source, /\bresetTerminal\s*\(/, `${path.relative(ROOT, file)} calls resetTerminal`);
    }

    const pool = fs.readFileSync(terminalPool, 'utf8');
    assert.match(pool, /Presentation-only reset of a pooled xterm/);
    assert.match(pool, /Presentation-only cleanup for a pooled xterm/);
  });

  test('remaining archiveAgent call is gated by Main-confirmed archived event', { timeout: TIMEOUT }, () => {
    const hive = read('src/renderer/src/hooks/useHive.ts');
    const calls = [...hive.matchAll(/archiveAgent\s*\(/g)];
    assert.equal(calls.length, 1);
    const callIndex = calls[0].index ?? -1;
    const context = hive.slice(Math.max(0, callIndex - 180), callIndex + 120);
    assert.match(context, /onHiveAgentArchived/);
  });
});
