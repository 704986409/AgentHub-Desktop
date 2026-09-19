import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  HUMAN_BOSS_PRESENCE,
  agentPresenceFromDto,
  composeOfficeActors,
  isHumanPresence,
  legacyIsGodToPresentationRole
} from '../src/shared/officeActors';
import {
  AGENTHUB_EXECUTION_PRELOAD_KEYS,
  FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS,
  classifyLegacyMunderSymbol
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

describe('AgentHub Desktop V0.8.9A — Munder Authority Closure', () => {
  test('P0: Renderer-visible pty:spawn handler NEVER calls spawnAgentCore', { timeout: TIMEOUT }, () => {
    const main = read('src/main/index.ts');
    const ptyHandleStart = main.indexOf("ipcMain.handle('pty:spawn'");
    assert.notEqual(ptyHandleStart, -1, "ipcMain.handle('pty:spawn') must exist");

    // Extract the handler block
    const ptyHandleBlock = main.slice(ptyHandleStart, ptyHandleStart + 600);
    const handlerEndIndex = ptyHandleBlock.indexOf('});');
    const handlerBody = ptyHandleBlock.slice(0, handlerEndIndex);

    // Hard boundary: handler body must NOT call spawnAgentCore
    assert.equal(
      handlerBody.includes('spawnAgentCore('),
      false,
      'Renderer-visible pty:spawn must NEVER call spawnAgentCore'
    );

    // Hard boundary: handler body must call spawnDeveloperTerminalCore
    assert.match(
      handlerBody,
      /spawnDeveloperTerminalCore\(/,
      'pty:spawn must call spawnDeveloperTerminalCore'
    );
  });

  test('P0: Preload PTY spawn types/options strictly forbid legacy agent/runtime authority fields', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');

    // Extract DeveloperTerminalSpawnOptions and SpawnPtyOptions block
    const optionsStartIndex = preload.indexOf('export interface DeveloperTerminalSpawnOptions');
    assert.notEqual(optionsStartIndex, -1, 'DeveloperTerminalSpawnOptions must be defined in preload');
    const optionsBlock = preload.slice(optionsStartIndex, optionsStartIndex + 500);

    const forbiddenFields = [
      'provider',
      'hive',
      'isolate',
      'resume',
      'requireResume',
      'resumeSessionId',
      'executionIntent',
      'agenthubTaskId',
      'agenthubAgentId',
      'noAutoInstall'
    ];

    for (const field of forbiddenFields) {
      assert.equal(
        new RegExp(`\\b${field}\\b\\s*\\??:`).test(optionsBlock),
        false,
        `Preload PTY spawn options must not expose authority field '${field}'`
      );
    }
  });

  test('P0: Marker omission bypass attempt cannot reach spawnAgentCore or provider execution', { timeout: TIMEOUT }, () => {
    // A simulated attacker in Renderer sends no agenthub markers, only legacy command
    const bypassPayload = {
      id: 'pty-bypass-1',
      cwd: '/tmp',
      command: 'claude',
      purpose: 'legacy-munder-compat'
    };

    const main = read('src/main/index.ts');
    const ptyHandleStart = main.indexOf("ipcMain.handle('pty:spawn'");
    const ptyHandleBlock = main.slice(ptyHandleStart, ptyHandleStart + 500);
    const handlerEndIndex = ptyHandleBlock.indexOf('});');
    const handlerBody = ptyHandleBlock.slice(0, handlerEndIndex);

    // Even if markers are omitted or purpose is legacy-munder-compat,
    // the handler routes strictly to spawnDeveloperTerminalCore, never spawnAgentCore
    assert.equal(handlerBody.includes('spawnAgentCore'), false);
    assert.equal(handlerBody.includes('spawnDeveloperTerminalCore'), true);

    // spawnDeveloperTerminalCore itself does not infer provider, attach AgentProvider, or provision Hive
    const devTerminalFuncStart = main.indexOf('function spawnDeveloperTerminalCore');
    const devTerminalFuncBlock = main.slice(devTerminalFuncStart, devTerminalFuncStart + 1500);
    assert.equal(devTerminalFuncBlock.includes('inferAgentProvider'), false);
    assert.equal(devTerminalFuncBlock.includes('hiveRegistry'), false);
    assert.equal(devTerminalFuncBlock.includes('gitWorktree'), false);
    assert.equal(devTerminalFuncBlock.includes('autoInstall'), false);
  });

  test('P0: Official AgentHub executeTask remains the sole provider execution path on preload', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const agentHubBlock = preload.slice(preload.indexOf('const agentHubApi'));

    // AgentHub preload surface must NOT contain any pty or generic spawn
    assert.equal(agentHubBlock.includes('spawnPty'), false);
    assert.equal(agentHubBlock.includes('spawnDeveloperTerminal'), false);
    assert.equal(agentHubBlock.includes('workerLaunch'), false);
    assert.equal(agentHubBlock.includes('wake'), false);
    assert.equal(agentHubBlock.includes('hire'), false);
    assert.equal(agentHubBlock.includes('godCommand'), false);

    // executeTask is strictly present
    assert.equal(AGENTHUB_EXECUTION_PRELOAD_KEYS.includes('executeTask'), true);
    assert.match(agentHubBlock, /executeTask:\s*\(request:\s*ExecuteTaskRequestDto\)/);

    // Legacy forbidden keys
    for (const key of FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS) {
      assert.equal(
        new RegExp(`^\\s+${key}\\s*:`, 'm').test(agentHubBlock),
        false,
        `Forbidden key '${key}' detected in agentHub API`
      );
    }
  });

  test('P0: spawnAgentCore is Main-internal only and not exposed to Renderer', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    assert.equal(preload.includes('spawnAgentCore'), false, 'spawnAgentCore must not be in preload');

    const main = read('src/main/index.ts');
    // Verify no ipcMain.handle exposes spawnAgentCore
    const allIpcHandles = main.match(/ipcMain\.handle\([^)]+\)/g) ?? [];
    for (const handle of allIpcHandles) {
      assert.equal(
        handle.includes('spawnAgentCore'),
        false,
        `IPC handle exposes spawnAgentCore: ${handle}`
      );
    }
  });

  test('Human Presence remains presentation-only without agent identity', { timeout: TIMEOUT }, () => {
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

  test('Office projection remains read-only visual projection', { timeout: TIMEOUT }, () => {
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
