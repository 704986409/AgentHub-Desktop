import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canCreateLifecycleIntake,
  lifecycleLeadNotice,
  nextProjectBoundLeadId,
  projectBoundLeadAgents,
  selectedLeadIsProjectBound
} from '../src/shared/agenthubTypes';

type Agent = { agentId: string; name: string; projectId: string | null };

const agents: Agent[] = [
  { agentId: 'A1', name: 'A1', projectId: 'A' },
  { agentId: 'A2', name: 'A2', projectId: 'A' },
  { agentId: 'B1', name: 'B1', projectId: 'B' },
  { agentId: 'U1', name: 'U1', projectId: null }
];

function ids(projectId: string): string[] {
  return projectBoundLeadAgents(agents, projectId).map((agent) => agent.agentId);
}

function clickCreateIntake(input: {
  projectId: string;
  leadAgentId: string;
  goal: string;
}): { calls: number; payload: { projectId: string; leadAgentId: string } | null } {
  let calls = 0;
  let payload: { projectId: string; leadAgentId: string } | null = null;
  const hasProject = input.projectId === 'A' || input.projectId === 'B';
  if (!hasProject) return { calls, payload };
  if (!selectedLeadIsProjectBound(agents, input.projectId, input.leadAgentId)) return { calls, payload };
  calls += 1;
  payload = { projectId: input.projectId, leadAgentId: input.leadAgentId };
  return { calls, payload };
}

describe('Desktop V0.8.10I lifecycle project lead', () => {
  test('I-T1 Project A options are only A1 and A2', () => {
    assert.deepEqual(ids('A'), ['A1', 'A2']);
  });

  test('I-T2 Project B options are only B1', () => {
    assert.deepEqual(ids('B'), ['B1']);
  });

  test('I-T3 switching from Project A lead A2 selects B1', () => {
    const stale = 'A2';
    const next = nextProjectBoundLeadId(projectBoundLeadAgents(agents, 'B'), stale);
    assert.notEqual(next, 'A2');
    assert.equal(next, 'B1');
  });

  test('I-T4 a null-project agent is never a lead option', () => {
    assert.equal(ids('A').includes('U1'), false);
    assert.equal(ids('B').includes('U1'), false);
    assert.equal(ids('').includes('U1'), false);
  });

  test('I-T5 another project agent is excluded', () => {
    assert.equal(ids('A').includes('B1'), false);
    assert.equal(selectedLeadIsProjectBound(agents, 'A', 'B1'), false);
  });

  test('I-T6 no project-bound agent disables Create Intake', () => {
    const unbound = agents.filter((agent) => agent.projectId !== 'A');
    assert.equal(projectBoundLeadAgents(unbound, 'A').length, 0);
    assert.equal(lifecycleLeadNotice({
      projectCount: 1,
      agentCount: unbound.length,
      boundLeadCount: 0,
      goal: 'Ship it'
    }), 'unbound');
    assert.equal(canCreateLifecycleIntake({
      mutationsUsable: true,
      status: 'idle',
      hasAuthoritativeProject: true,
      selectedLeadIsProjectBound: false,
      goal: 'Ship it'
    }), false);
  });

  test('I-T7 mismatched lead sends zero mutations', () => {
    const result = clickCreateIntake({ projectId: 'A', leadAgentId: 'B1', goal: 'Ship it' });
    assert.equal(result.calls, 0);
    assert.equal(result.payload, null);
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/renderer/src/components/AgentHubLifecycleWorkspace.tsx'),
      'utf8'
    );
    const click = source.slice(source.indexOf('selectedLeadIsProjectBound: selectedLeadIsProjectBound'), source.indexOf('Create Intake'));
    assert.match(click, /if \(!selectedLeadIsProjectBound\(agents, projectId, leadAgentId\)\) return;/);
    assert.ok(click.indexOf('if (!selectedLeadIsProjectBound') < click.indexOf('void runMutation'));
  });

  test('I-T8 a project-bound lead submits once', () => {
    assert.equal(canCreateLifecycleIntake({
      mutationsUsable: true,
      status: 'idle',
      hasAuthoritativeProject: true,
      selectedLeadIsProjectBound: selectedLeadIsProjectBound(agents, 'A', 'A1'),
      goal: 'Ship it'
    }), true);
    const result = clickCreateIntake({ projectId: 'A', leadAgentId: 'A1', goal: 'Ship it' });
    assert.equal(result.calls, 1);
    assert.deepEqual(result.payload, { projectId: 'A', leadAgentId: 'A1' });
  });

  test('I-T9 snapshot membership change invalidates the selected lead', () => {
    const before = [{ agentId: 'A1', projectId: 'A' }, { agentId: 'A2', projectId: 'A' }];
    assert.equal(nextProjectBoundLeadId(projectBoundLeadAgents(before, 'A'), 'A1'), 'A1');
    const unboundA1 = [{ agentId: 'A1', projectId: null }, { agentId: 'A2', projectId: 'A' }];
    assert.equal(nextProjectBoundLeadId(projectBoundLeadAgents(unboundA1, 'A'), 'A1'), 'A2');
    const onlyUnbound = [{ agentId: 'A1', projectId: null }];
    assert.equal(nextProjectBoundLeadId(projectBoundLeadAgents(onlyUnbound, 'A'), 'A1'), '');
    assert.equal(canCreateLifecycleIntake({
      mutationsUsable: true,
      status: 'idle',
      hasAuthoritativeProject: true,
      selectedLeadIsProjectBound: selectedLeadIsProjectBound(onlyUnbound, 'A', 'A1'),
      goal: 'Ship it'
    }), false);
  });

  test('I-T10 unbound lead outranks the blank-goal notice', () => {
    assert.equal(lifecycleLeadNotice({
      projectCount: 1,
      agentCount: 2,
      boundLeadCount: 0,
      goal: ''
    }), 'unbound');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/renderer/src/components/AgentHubLifecycleWorkspace.tsx'),
      'utf8'
    );
    assert.match(source, /No Agent is assigned to this Project\./);
    assert.match(source, /projectLeadAgents\.map/);
    assert.equal(source.includes('agents[0].agentId'), false);
  });
});
