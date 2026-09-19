import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  HUMAN_BOSS_PRESENCE,
  agentPresenceFromDto,
  isHumanPresence,
  legacyIsGodToPresentationRole
} from '../src/shared/officeActors';
import {
  AGENTHUB_EXECUTION_PRELOAD_KEYS,
  FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS
} from '../src/shared/munderAuthority';
import { projectAgentHubOffice } from '../src/renderer/src/scene/office/agentHubOfficeProjection';
import type { AgentDto, AgentHubStateSnapshot } from '../src/shared/agenthubTypes';

const TIMEOUT = 5000;
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const baseAgent: AgentDto = {
  agentId: 'lead-1',
  projectId: 'proj-1',
  name: 'Lead Ada',
  providerId: 'claude',
  modelId: 'claude-sonnet-4',
  position: 'lead',
  status: 'BUSY',
  allowedComplexities: ['MEDIUM'],
  allowedRiskLevels: ['LOW'],
  capabilities: ['code'],
  specialties: ['compiler'],
  authority: 'STANDARD',
  routingPriority: 10,
  enabled: true,
  createdAt: '2026-09-18T10:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z'
};

describe('AgentHub Desktop V0.8.9B — Renderer Provider Capability Closure', () => {
  test('P0 23.1: DeveloperTerminalSpawnOptions contains no command or args in preload or main', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const main = read('src/main/index.ts');

    for (const [sourceName, source] of [['preload', preload], ['main', main]]) {
      const start = source.indexOf('export interface DeveloperTerminalSpawnOptions');
      assert.notEqual(start, -1, `DeveloperTerminalSpawnOptions must exist in ${sourceName}`);
      const block = source.slice(start, start + 350);

      const forbiddenFields = [
        'command',
        'args',
        'provider',
        'model',
        'hive',
        'resume',
        'requireResume',
        'resumeSessionId',
        'isolate',
        'executionIntent',
        'agenthubTaskId',
        'agenthubAgentId',
        'noAutoInstall'
      ];

      for (const field of forbiddenFields) {
        assert.equal(
          new RegExp(`\\b${field}\\b\\s*\\??:`).test(block),
          false,
          `${sourceName} DeveloperTerminalSpawnOptions must not expose field '${field}'`
        );
      }
    }
  });

  test('P0 23.2: spawnDeveloperTerminalCore selects OS shell and does not read opts.command or opts.args', { timeout: TIMEOUT }, () => {
    const main = read('src/main/index.ts');
    const start = main.indexOf('export async function spawnDeveloperTerminalCore');
    assert.notEqual(start, -1, 'spawnDeveloperTerminalCore must exist in main');
    const block = main.slice(start, start + 1200);

    // Shell selection asserts
    assert.match(block, /process\.platform === 'win32'/);
    assert.match(block, /process\.env\.ComSpec \|\| 'powershell\.exe'/);
    assert.match(block, /process\.env\.SHELL \|\| '\/bin\/bash'/);

    // Does NOT read opts.command or opts.args
    assert.equal(block.includes('opts.command'), false, 'spawnDeveloperTerminalCore must not read opts.command');
    assert.equal(block.includes('opts.args'), false, 'spawnDeveloperTerminalCore must not read opts.args');

    // Hard-pins command to defaultShell and args to empty array
    assert.match(block, /const command = defaultShell;/);
    assert.match(block, /args:\s*\[\]/);
  });

  test('P0 23.3: Injected command and args in IPC payload are sanitized away before spawn', { timeout: TIMEOUT }, () => {
    const main = read('src/main/index.ts');
    const ptyHandleStart = main.indexOf("ipcMain.handle('pty:spawn'");
    assert.notEqual(ptyHandleStart, -1, "ipcMain.handle('pty:spawn') must exist");
    const ptyHandleBlock = main.slice(ptyHandleStart, ptyHandleStart + 600);

    // Handler passes sanitized literal or extracts strictly id, cwd, cols, rows
    assert.match(ptyHandleBlock, /spawnDeveloperTerminalCore\(\s*\{\s*id:\s*opts\.id,\s*cwd:\s*opts\.cwd/);
    assert.equal(ptyHandleBlock.includes('opts.command'), false);
    assert.equal(ptyHandleBlock.includes('opts.args'), false);
  });

  test('P0 23.4: AddAgentModal.tsx has no provider CLI launch and no executable spawn path', { timeout: TIMEOUT }, () => {
    const modal = read('src/renderer/src/components/AddAgentModal.tsx');

    // No terminal or pty spawn calls
    assert.equal(modal.includes('window.cth.spawnPty'), false);
    assert.equal(modal.includes('window.cth.spawnDeveloperTerminal'), false);

    // No tokenizeCommand import or invocation
    assert.equal(modal.includes('tokenizeCommand'), false);

    // Submitting fails closed with explicit message
    assert.match(
      modal,
      /Legacy Munder agent launch is disabled in AgentHub mode\. Create and execute Agents through AgentHub Agent Management \/ Backend\./
    );
  });

  test('P0 23.5: CommandCenterPanel, useHive, and useRestoreTeam have no provider CLI launch', { timeout: TIMEOUT }, () => {
    const panel = read('src/renderer/src/components/CommandCenterPanel.tsx');
    const hive = read('src/renderer/src/hooks/useHive.ts');
    const restoreExists = fs.existsSync(path.join(ROOT, 'src/renderer/src/hooks/useRestoreTeam.ts'));
    const restore = restoreExists ? read('src/renderer/src/hooks/useRestoreTeam.ts') : '';

    for (const [name, content] of [
      ['CommandCenterPanel.tsx', panel],
      ['useHive.ts', hive],
      ['useRestoreTeam.ts', restore]
    ]) {
      assert.equal(content.includes('window.cth.spawnPty'), false, `${name} must not call window.cth.spawnPty`);
      assert.equal(content.includes('window.cth.spawnDeveloperTerminal'), false, `${name} must not call window.cth.spawnDeveloperTerminal`);
      assert.equal(content.includes('tokenizeCommand'), false, `${name} must not call or import tokenizeCommand`);
    }
  });

  test('P0 23.6: Official AgentHub executeTask remains unique official execution path', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const agentHubBlock = preload.slice(preload.indexOf('const agentHubApi'));

    // Official executeTask exists
    assert.equal(AGENTHUB_EXECUTION_PRELOAD_KEYS.includes('executeTask'), true);
    assert.match(agentHubBlock, /executeTask:\s*\(request:\s*ExecuteTaskRequestDto\)/);

    // Forbidden authority keys absent
    for (const key of FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS) {
      assert.equal(
        new RegExp(`^\\s+${key}\\s*:`, 'm').test(agentHubBlock),
        false,
        `Forbidden key '${key}' detected in agentHub API`
      );
    }
  });

  test('Human Presence regression: non-agent and presentation role preserved', { timeout: TIMEOUT }, () => {
    const human = HUMAN_BOSS_PRESENCE;
    assert.equal(human.kind, 'human');
    assert.equal(human.presentationRole, 'human');
    assert.equal('agentId' in human, false);
    assert.equal('providerId' in human, false);
    assert.equal('modelId' in human, false);
    assert.equal(isHumanPresence(human), true);

    const lead = agentPresenceFromDto(baseAgent);
    assert.equal(lead.kind, 'agent');
    assert.equal(lead.agentId, 'lead-1');
    assert.equal(lead.providerId, 'claude');
    assert.equal(isHumanPresence(lead), false);

    assert.equal(legacyIsGodToPresentationRole(true), 'legacy-visual-primary');
    assert.equal(legacyIsGodToPresentationRole(false), 'legacy-visual-agent');
  });

  test('Office projection regression: read-only visual projection without mutations', { timeout: TIMEOUT }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [baseAgent],
      projects: [],
      assignments: [],
      tasks: []
    };
    const projection = projectAgentHubOffice(snapshot);
    assert.equal(projection.agents[0]?.visualStatus, 'working');
    assert.equal(projection.agents[0]?.backendStatus, 'BUSY');
    assert.equal(projection.human.kind, 'human');

    const floor = read('src/renderer/src/scene/office/OfficeFloor.tsx');
    const projectionSrc = read('src/renderer/src/scene/office/agentHubOfficeProjection.ts');
    for (const forbidden of ['executeTask', 'createAgent', 'updateAgent', 'enableAgent', 'disableAgent', 'deleteAgent']) {
      assert.equal(floor.includes(forbidden), false, `OfficeFloor mutates via ${forbidden}`);
      assert.equal(projectionSrc.includes(forbidden), false, `projection mutates via ${forbidden}`);
    }
  });
});
