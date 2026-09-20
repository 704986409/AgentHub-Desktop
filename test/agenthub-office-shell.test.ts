import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveAgentHubOfficeShellState,
  type AgentHubOfficeShellState
} from '../src/renderer/src/scene/office/agentHubOfficeShell';
import type { AgentDto, AgentHubStateSnapshot } from '../src/shared/agenthubTypes';

describe('AgentHub Office Shell Authority', () => {
  const baseAgent: AgentDto = {
    agentId: 'agent-1',
    projectId: 'proj-1',
    name: 'Ada Lovelace',
    providerId: 'claude',
    modelId: 'claude-sonnet-4',
    position: 'engineer',
    status: 'IDLE',
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

  test('snapshot with 5 AgentHub Agents yields populated state regardless of legacy roster count', { timeout: 5000 }, () => {
    const agents: AgentDto[] = Array.from({ length: 5 }, (_, i) => ({
      ...baseAgent,
      agentId: `agent-${i + 1}`,
      name: `Agent ${i + 1}`
    }));

    const snapshot: AgentHubStateSnapshot = {
      agents,
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const shellState = deriveAgentHubOfficeShellState(snapshot);
    assert.deepEqual(shellState, { kind: 'populated', count: 5 });
  });

  test('snapshot with 0 AgentHub Agents yields empty state regardless of legacy roster count', { timeout: 5000 }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const shellState = deriveAgentHubOfficeShellState(snapshot);
    assert.deepEqual(shellState, { kind: 'empty' });
  });

  test('snapshot null yields unavailable state and never falls back to legacy roster', { timeout: 5000 }, () => {
    const shellState = deriveAgentHubOfficeShellState(null);
    assert.deepEqual(shellState, { kind: 'unavailable' });
  });

  test('legacy god booting state cannot alter AgentHub shell state', { timeout: 5000 }, () => {
    // deriveAgentHubOfficeShellState accepts only snapshot, isolating shell state from legacy godStatus
    const snapshotWithAgents: AgentHubStateSnapshot = {
      agents: [baseAgent],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };
    const stateWithAgents = deriveAgentHubOfficeShellState(snapshotWithAgents);
    assert.equal(stateWithAgents.kind, 'populated');

    const emptySnapshot: AgentHubStateSnapshot = {
      agents: [],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };
    const stateEmpty = deriveAgentHubOfficeShellState(emptySnapshot);
    assert.equal(stateEmpty.kind, 'empty');

    const nullState = deriveAgentHubOfficeShellState(null);
    assert.equal(nullState.kind, 'unavailable');
  });

  test('deriveAgentHubOfficeShellState rejects corrupted/non-array agents', { timeout: 5000 }, () => {
    const corruptedSnapshot = {
      agents: null as any,
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };
    assert.deepEqual(deriveAgentHubOfficeShellState(corruptedSnapshot as any), { kind: 'unavailable' });
  });

  test('architecture guard: App.tsx canvas area is not governed by agentCount or godStatus booting overlay', { timeout: 5000 }, () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/App.tsx'),
      'utf-8'
    );

    // Verify agentCount is not defined or used to control canvas overlays
    assert.ok(
      !appSource.includes('agentCount === 0'),
      'App.tsx must not use agentCount === 0 to control canvas overlay'
    );
    assert.ok(
      !appSource.includes("godStatus === 'booting' && <MichaelBooting"),
      'App.tsx must not overlay MichaelBooting over the office canvas'
    );
    assert.ok(
      !appSource.includes('const agentCount ='),
      'App.tsx must not derive legacy agentCount'
    );

    // Verify AgentHub Office shell state is integrated
    assert.ok(
      appSource.includes('deriveAgentHubOfficeShellState'),
      'App.tsx must use deriveAgentHubOfficeShellState'
    );
    assert.ok(
      appSource.includes("hubOfficeShellState.kind === 'empty'"),
      'App.tsx must handle hubOfficeShellState empty'
    );
    assert.ok(
      appSource.includes("hubOfficeShellState.kind === 'unavailable'"),
      'App.tsx must handle hubOfficeShellState unavailable'
    );
    assert.ok(
      appSource.includes('NO AGENTHUB AGENTS'),
      'App.tsx must display NO AGENTHUB AGENTS for empty state'
    );
    assert.ok(
      appSource.includes('AGENTHUB STATE UNAVAILABLE'),
      'App.tsx must display AGENTHUB STATE UNAVAILABLE for unavailable state'
    );
  });

  test('empty state does not launch legacy AddAgentModal as AgentHub creation', { timeout: 5000 }, () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/App.tsx'),
      'utf-8'
    );

    // Extract the section for empty AgentHub state
    const emptyStateIndex = appSource.indexOf("hubOfficeShellState.kind === 'empty'");
    assert.ok(emptyStateIndex !== -1, 'hubOfficeShellState empty block must exist');

    const unavailableIndex = appSource.indexOf("hubOfficeShellState.kind === 'unavailable'");
    assert.ok(unavailableIndex > emptyStateIndex, 'unavailable block must follow empty block');

    const emptyBlock = appSource.slice(emptyStateIndex, unavailableIndex);
    assert.ok(
      !emptyBlock.includes('setAddAgentOpen'),
      'AgentHub empty state overlay must not invoke setAddAgentOpen'
    );
    assert.ok(
      !emptyBlock.includes('AddAgentModal'),
      'AgentHub empty state overlay must not reference AddAgentModal'
    );
  });
});
