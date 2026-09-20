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
  AGENTHUB_PTY_EXECUTION_ERROR,
  FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS,
  classifyLegacyMunderSymbol,
  rejectAgentHubPtyExecution
} from '../src/shared/munderAuthority';
import { projectAgentHubOffice } from '../src/renderer/src/scene/office/agentHubOfficeProjection';
import type { AgentDto, AgentHubStateSnapshot } from '../src/shared/agenthubTypes';

const TIMEOUT = 5_000;
const ROOT = path.resolve(__dirname, '..');

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
  authority: 'standard',
  routingPriority: 10,
  enabled: true,
  createdAt: '2026-09-18T10:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z'
};

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('V0.8.9 Munder authority reduction', () => {
  test('renderer AgentHub API cannot execute providers via PTY or generic launch', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const agentHubBlock = preload.slice(preload.indexOf('const agentHubApi'));
    assert.equal(agentHubBlock.includes('spawnPty'), false);
    assert.equal(agentHubBlock.includes('workerLaunch'), false);
    assert.equal(agentHubBlock.includes('claude execution'), false);
    for (const key of FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS) {
      assert.equal(
        new RegExp(`^\\s+${key}\\s*:`, 'm').test(preload.slice(preload.indexOf('const api ='))),
        false,
        `legacy authority key still exposed: ${key}`
      );
    }
    assert.equal(AGENTHUB_EXECUTION_PRELOAD_KEYS.includes('executeTask'), true);
    assert.match(preload, /executeTask: \(request: ExecuteTaskRequestDto\)/);
  });

  test('legacy workerLaunch/wake/hire/godCommand/generic exec channels are absent from preload API', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const api = preload.slice(preload.indexOf('const api ='), preload.indexOf('export interface AgentHubPreloadApi'));
    assert.equal(api.includes('workerLaunch:'), false);
    assert.equal(/\bwake:\s/.test(api), false);
    assert.equal(api.includes('godCommand:'), false);
    assert.equal(api.includes('exec:'), false);
    assert.equal(/\bhire:\s/.test(api), false);
    assert.equal(api.includes('ipcRenderer.invoke(\'exec\''), false);
    assert.equal(api.includes('ipcRenderer.invoke(\'spawn\''), false);
  });

  test('PTY spawn rejects AgentHub provider execution intent', { timeout: TIMEOUT }, () => {
    assert.deepEqual(rejectAgentHubPtyExecution({ purpose: 'legacy-munder-compat' }), { ok: true });
    assert.deepEqual(rejectAgentHubPtyExecution({
      purpose: 'agenthub-execution',
      command: 'claude'
    }), { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR });
    assert.deepEqual(rejectAgentHubPtyExecution({
      executionIntent: 'agenthub-provider',
      command: 'agy'
    }), { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR });
    assert.deepEqual(rejectAgentHubPtyExecution({
      agenthubTaskId: 'task-1',
      command: 'cursor'
    }), { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR });
    const main = read('src/main/index.ts');
    assert.equal(main.includes('rejectAgentHubPtyExecution(opts)'), true);
    const preload = read('src/preload/index.ts');
    assert.equal(preload.includes('rejectAgentHubPtyExecution(opts)'), true);
  });

  test('Human Presence does not require agentId/providerId/modelId', { timeout: TIMEOUT }, () => {
    const human = HUMAN_BOSS_PRESENCE;
    assert.equal(human.kind, 'human');
    assert.equal(human.presentationRole, 'human');
    assert.equal('agentId' in human, false);
    assert.equal('providerId' in human, false);
    assert.equal('modelId' in human, false);
    assert.equal(isHumanPresence(human), true);
  });

  test('Lead Agent presence requires authoritative Agent DTO fields', { timeout: TIMEOUT }, () => {
    const lead = agentPresenceFromDto(baseAgent);
    assert.equal(lead.kind, 'agent');
    assert.equal(lead.agentId, 'lead-1');
    assert.equal(lead.providerId, 'claude');
    assert.equal(lead.modelId, 'claude-sonnet-4');
    assert.equal(lead.status, 'BUSY');
    assert.equal(isHumanPresence(lead), false);
  });

  test('Office BUSY is visual only and does not mutate Backend', { timeout: TIMEOUT }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [baseAgent],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };
    const projection = projectAgentHubOffice(snapshot);
    assert.equal(projection.agents[0]?.visualStatus, 'working');
    assert.equal(projection.agents[0]?.backendStatus, 'BUSY');
    assert.equal(projection.human.kind, 'human');
    assert.equal(projection.actors[0]?.kind, 'human');
    assert.equal(snapshot.agents[0]?.status, 'BUSY');

    const floor = read('src/renderer/src/scene/office/OfficeFloor.tsx');
    const projectionSrc = read('src/renderer/src/scene/office/agentHubOfficeProjection.ts');
    for (const forbidden of ['executeTask', 'createAgent', 'updateAgent', 'enableAgent', 'disableAgent', 'deleteAgent']) {
      assert.equal(floor.includes(forbidden), false, `OfficeFloor mutates via ${forbidden}`);
      assert.equal(projectionSrc.includes(forbidden), false, `projection mutates via ${forbidden}`);
    }
  });

  test('legacy isGod never maps to Human Boss or Lead Agent', { timeout: TIMEOUT }, () => {
    assert.equal(legacyIsGodToPresentationRole(true), 'legacy-visual-primary');
    assert.equal(legacyIsGodToPresentationRole(false), 'legacy-visual-agent');
    const actors = composeOfficeActors([baseAgent]);
    assert.equal(actors.some((a) => a.kind === 'human' && a.presentationId === 'human-boss'), true);
    assert.equal(classifyLegacyMunderSymbol('isGod'), 'PRESENTATION ONLY');
    assert.equal(classifyLegacyMunderSymbol('workerLaunch'), 'DISABLE');
  });
});
