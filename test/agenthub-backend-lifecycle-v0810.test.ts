import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AgentHubLifecycle } from '../src/main/agenthub/AgentHubLifecycle';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';
import { AGENTHUB_IPC_CHANNELS } from '../src/main/agenthub/AgentHubIpc';
import { snapshotState, AgentHubValidationError } from '../src/shared/agenthubTypes';
import {
  HUMAN_BOSS_ACTOR_ID,
  isLifecycleCompatibleBackendVersion,
  snapshotIntakeDto,
  snapshotPlanDto,
  snapshotPlanVersionDto,
  snapshotPlanTaskRuntimeDto,
  snapshotPlanDependencyDto,
  snapshotPlanAggregateDto,
  type CreateIntakeInputDto,
  type CreatePlanInputDto,
  type PlanDecisionInputDto,
  type StartPlanInputDto
} from '../src/shared/agenthubLifecycle';
import { projectAgentHubOffice } from '../src/renderer/src/scene/office/agentHubOfficeProjection';
import { HUMAN_BOSS_PRESENCE, composeOfficeActors } from '../src/shared/officeActors';

const TIMEOUT = 8_000;
const ROOT = path.resolve(__dirname, '..');
const HASH = 'ab'.repeat(32);
const HASH2 = 'cd'.repeat(32);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function validIntake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intakeId: 'intake-1',
    projectId: 'proj-1',
    createdBy: HUMAN_BOSS_ACTOR_ID,
    goal: 'Ship lifecycle',
    leadAgentId: 'lead-1',
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides
  };
}

function validTaskDef(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planTaskId: 'pt-1',
    clientId: 't1',
    parentPlanTaskId: null,
    title: 'Do work',
    description: null,
    acceptanceCriteria: ['done'],
    requiredCapabilities: ['code'],
    requiredSpecialties: [],
    complexity: 'MEDIUM',
    risk: 'LOW',
    ...overrides
  };
}

function validRuntimeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...validTaskDef(),
    planId: 'plan-1',
    planVersion: 1,
    runtimeTaskId: null,
    assignmentId: null,
    agentId: null,
    dependencyState: 'ELIGIBLE',
    blockedBy: [],
    runtimeState: 'PENDING',
    ...overrides
  };
}

function validVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planId: 'plan-1',
    version: 1,
    proposalHash: HASH,
    leadAgentId: 'lead-1',
    summary: 'First proposal',
    tasks: [validTaskDef()],
    dependencies: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides
  };
}

function validAggregate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total: 1,
    pending: 1,
    blocked: 0,
    eligible: 1,
    running: 0,
    reviewing: 0,
    completed: 0,
    failed: 0,
    state: 'WAITING_APPROVAL',
    ...overrides
  };
}

function validPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const current = (overrides.current as Record<string, unknown> | undefined) ?? validVersion();
  return {
    planId: 'plan-1',
    intakeId: 'intake-1',
    projectId: 'proj-1',
    leadAgentId: 'lead-1',
    currentVersion: 1,
    state: 'WAITING_APPROVAL',
    current,
    tasks: [validRuntimeTask()],
    dependencies: [],
    decisions: [],
    aggregate: validAggregate(),
    startedVersion: null,
    startedAt: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    completedAt: null,
    ...overrides,
    current
  };
}

function emptyState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projects: [],
    agents: [],
    tasks: [],
    assignments: [],
    intakes: [],
    plans: [],
    planTasks: [],
    planDependencies: [],
    ...overrides
  };
}

function intakeInput(): CreateIntakeInputDto {
  return {
    projectId: 'proj-1',
    createdBy: HUMAN_BOSS_ACTOR_ID,
    goal: 'Ship lifecycle',
    leadAgentId: 'lead-1'
  };
}

function planInput(): CreatePlanInputDto {
  return {
    intakeId: 'intake-1',
    leadAgentId: 'lead-1',
    summary: 'First proposal',
    tasks: [{
      clientId: 't1',
      parentClientId: null,
      title: 'Do work',
      description: null,
      acceptanceCriteria: ['done'],
      requiredCapabilities: ['code'],
      requiredSpecialties: [],
      complexity: 'MEDIUM',
      risk: 'LOW'
    }],
    dependencies: []
  };
}

function decisionInput(overrides: Partial<PlanDecisionInputDto> = {}): PlanDecisionInputDto {
  return {
    planVersion: 1,
    proposalHash: HASH,
    actorId: HUMAN_BOSS_ACTOR_ID,
    summary: 'Looks good',
    ...overrides
  };
}

function startInput(overrides: Partial<StartPlanInputDto> = {}): StartPlanInputDto {
  return { planVersion: 1, proposalHash: HASH, ...overrides };
}

function mockConnection(options: {
  snapshot?: Record<string, unknown> | null;
  rest?: Record<string, unknown>;
  sync?: () => Promise<{ disposition: string; snapshot: unknown }>;
}): AgentHubConnection {
  const snapshot = options.snapshot === undefined ? emptyState({ plans: [validPlan()] }) : options.snapshot;
  const rest = {
    createIntake: async () => validIntake(),
    createPlan: async () => validPlan(),
    createPlanRevision: async () => validPlan({ currentVersion: 2, current: validVersion({ version: 2, proposalHash: HASH2 }) }),
    approvePlan: async () => validPlan({ state: 'APPROVED', aggregate: validAggregate({ state: 'APPROVED' }) }),
    requestPlanChanges: async () => validPlan({ state: 'CHANGES_REQUESTED' }),
    rejectPlan: async () => validPlan({ state: 'REJECTED' }),
    startPlan: async () => validPlan({ state: 'EXECUTING' }),
    ...(options.rest ?? {})
  };
  return {
    getState: () => ({
      connection: 'connected',
      health: { status: 'ok', version: '0.7.4C' },
      snapshot,
      lifecycleReviews: null,
      lastSyncAt: null,
      lastEventAt: null,
      lastError: null
    }),
    restClient: rest,
    syncAuthoritativeState: options.sync ?? (async () => ({ disposition: 'committed', snapshot }))
  } as unknown as AgentHubConnection;
}

describe('AgentHub Desktop V0.8.10 backend lifecycle', () => {
  test('1. Backend sealed health compatibility passes', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C'), true);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3F'), false);
  });

  test('2. older Backend lifecycle compatibility gate blocks lifecycle UI', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3E'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3D'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3C'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.2E'), false);
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /Lifecycle unavailable\. Backend upgrade required\./);
    assert.match(workspace, /This is not an empty plan list/);
    assert.equal(workspace.includes('No plans exist because version is old'), false);
  });

  test('3. malformed health fails closed', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion(''), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.8.0'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3d'), false);
  });

  test('4. strict /state parser accepts exact lifecycle state', { timeout: TIMEOUT }, () => {
    const snapshot = snapshotState(emptyState({
      intakes: [validIntake()],
      plans: [validPlan()],
      planTasks: [validRuntimeTask()],
      planDependencies: []
    }));
    assert.equal(snapshot.intakes.length, 1);
    assert.equal(snapshot.plans[0]?.state, 'WAITING_APPROVAL');
    assert.equal(snapshot.planTasks[0]?.dependencyState, 'ELIGIBLE');
  });

  test('5. strict /state parser rejects malformed Intake', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotState(emptyState({ intakes: [{ ...validIntake(), goal: 1 }] })),
      AgentHubValidationError
    );
    assert.throws(() => snapshotIntakeDto({ ...validIntake(), intakeId: '' }), AgentHubValidationError);
    assert.throws(() => snapshotIntakeDto({ ...validIntake(), createdBy: undefined }), AgentHubValidationError);
  });

  test('6. strict /state parser rejects malformed Plan', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotState(emptyState({ plans: [{ ...validPlan(), state: 'DRAFT' }] })),
      AgentHubValidationError
    );
    assert.throws(() => snapshotPlanDto({ ...validPlan(), planId: '' }), AgentHubValidationError);
  });

  test('7. strict /state parser rejects malformed PlanVersion', { timeout: TIMEOUT }, () => {
    assert.throws(() => snapshotPlanVersionDto({ ...validVersion(), proposalHash: 'short' }), AgentHubValidationError);
    assert.throws(() => snapshotPlanVersionDto({ ...validVersion(), version: 0 }), AgentHubValidationError);
  });

  test('8. strict /state parser rejects malformed PlanTask state', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotPlanTaskRuntimeDto({ ...validRuntimeTask(), runtimeState: 'QUEUED' }),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotPlanTaskRuntimeDto({ ...validRuntimeTask(), dependencyState: 'READY' }),
      AgentHubValidationError
    );
  });

  test('9. strict /state parser rejects malformed dependency', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotPlanDependencyDto({ planTaskId: 'a', dependsOnPlanTaskId: 'b' }),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotPlanDependencyDto({ prerequisitePlanTaskId: 'a' }),
      AgentHubValidationError
    );
  });

  test('10. strict /state parser rejects malformed aggregate', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotPlanAggregateDto({ ...validAggregate(), total: -1 }),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotPlanAggregateDto({ ...validAggregate(), state: 'ACTIVE' }),
      AgentHubValidationError
    );
  });

  test('11. createIntake uses narrow Main IPC', { timeout: TIMEOUT }, () => {
    assert.equal(AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_INTAKE, 'agenthub:lifecycle:create-intake');
    const preload = read('src/preload/index.ts');
    assert.match(preload, /createIntake:[\s\S]*agenthub:lifecycle:create-intake/);
  });

  test('12. createPlan uses narrow Main IPC', { timeout: TIMEOUT }, () => {
    assert.equal(AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_PLAN, 'agenthub:lifecycle:create-plan');
    const preload = read('src/preload/index.ts');
    assert.match(preload, /createPlan:[\s\S]*agenthub:lifecycle:create-plan/);
  });

  test('13-15. approve/reject/request-changes bind exact planVersion + proposalHash', { timeout: TIMEOUT }, async () => {
    const seen: PlanDecisionInputDto[] = [];
    const lifecycle = new AgentHubLifecycle(mockConnection({
      rest: {
        approvePlan: async (_id: string, input: PlanDecisionInputDto) => {
          seen.push(input);
          return validPlan({ state: 'APPROVED' });
        },
        rejectPlan: async (_id: string, input: PlanDecisionInputDto) => {
          seen.push(input);
          return validPlan({ state: 'REJECTED' });
        },
        requestPlanChanges: async (_id: string, input: PlanDecisionInputDto) => {
          seen.push(input);
          return validPlan({ state: 'CHANGES_REQUESTED' });
        }
      }
    }));
    const input = decisionInput();
    const approve = await lifecycle.approve({ mutationId: 'mut-approve', planId: 'plan-1', input });
    const reject = await lifecycle.reject({ mutationId: 'mut-reject', planId: 'plan-1', input });
    const changes = await lifecycle.requestChanges({ mutationId: 'mut-changes', planId: 'plan-1', input });
    assert.equal(approve.status, 'applied');
    assert.equal(reject.status, 'applied');
    assert.equal(changes.status, 'applied');
    assert.equal(seen.length, 3);
    for (const item of seen) {
      assert.equal(item.planVersion, 1);
      assert.equal(item.proposalHash, HASH);
    }
  });

  test('16. createRevision does not mutate old version locally', { timeout: TIMEOUT }, async () => {
    const held = validPlan();
    const lifecycle = new AgentHubLifecycle(mockConnection({
      snapshot: emptyState({ plans: [held] }),
      rest: {
        createPlanRevision: async () => validPlan({
          currentVersion: 2,
          current: validVersion({ version: 2, proposalHash: HASH2 }),
          state: 'WAITING_APPROVAL'
        })
      }
    }));
    const result = await lifecycle.createRevision({
      mutationId: 'mut-rev',
      planId: 'plan-1',
      input: { basedOnVersion: 1, leadAgentId: 'lead-1', summary: 'Revise', tasks: planInput().tasks, dependencies: [] }
    });
    assert.equal(result.status, 'applied');
    assert.equal(held.currentVersion, 1);
    assert.equal((held.current as { proposalHash: string }).proposalHash, HASH);
    assert.equal('plan' in result, false);
  });

  test('17. start is one narrow Backend intent', { timeout: TIMEOUT }, async () => {
    let starts = 0;
    const lifecycle = new AgentHubLifecycle(mockConnection({
      snapshot: emptyState({ plans: [validPlan({ state: 'APPROVED', aggregate: validAggregate({ state: 'APPROVED' }) })] }),
      rest: {
        startPlan: async (_id: string, input: StartPlanInputDto) => {
          starts += 1;
          assert.equal(input.planVersion, 1);
          assert.equal(input.proposalHash, HASH);
          return validPlan({ state: 'EXECUTING' });
        }
      }
    }));
    const result = await lifecycle.start({ mutationId: 'mut-start', planId: 'plan-1', input: startInput() });
    assert.equal(result.status, 'applied');
    assert.equal(starts, 1);
    assert.equal(AGENTHUB_IPC_CHANNELS.LIFECYCLE_START, 'agenthub:lifecycle:start');
  });

  test('18. every lifecycle mutation resyncs authoritative /state', { timeout: TIMEOUT }, async () => {
    let syncs = 0;
    const lifecycle = new AgentHubLifecycle(mockConnection({
      rest: { createIntake: async () => validIntake() },
      sync: async () => {
        syncs += 1;
        return { disposition: 'committed', snapshot: emptyState({ intakes: [validIntake()] }) };
      }
    }));
    await lifecycle.createIntake({ mutationId: 'mut-in', input: intakeInput() });
    assert.equal(syncs, 1);
  });

  test('19. mutation response is not final Renderer truth', { timeout: TIMEOUT }, async () => {
    const lifecycle = new AgentHubLifecycle(mockConnection({}));
    const result = await lifecycle.createPlan({ mutationId: 'mut-plan', input: planInput() });
    assert.equal(result.status, 'applied');
    assert.equal('plan' in result, false);
    assert.equal('payload' in result, false);
  });

  test('20. timeout/ambiguity triggers resync', { timeout: TIMEOUT }, async () => {
    let syncs = 0;
    const { AgentHubContractError } = await import('../src/main/agenthub/AgentHubRestClient');
    const timed = new AgentHubLifecycle(mockConnection({
      rest: {
        createIntake: async () => {
          throw new AgentHubContractError('TIMEOUT', 'Request timed out', { phase: 'transport', requestDispatched: true });
        }
      },
      sync: async () => {
        syncs += 1;
        return { disposition: 'committed', snapshot: emptyState() };
      }
    }));
    const result = await timed.createIntake({ mutationId: 'mut-timeout', input: intakeInput() });
    assert.equal(result.status, 'ambiguous');
    assert.ok(syncs >= 1);
  });

  test('21. stale approval cannot approve current newer Plan', { timeout: TIMEOUT }, async () => {
    const lifecycle = new AgentHubLifecycle(mockConnection({
      snapshot: emptyState({
        plans: [validPlan({ currentVersion: 2, current: validVersion({ version: 2, proposalHash: HASH2 }) })]
      }),
      rest: {
        approvePlan: async () => {
          throw new Error('should not POST stale approval');
        }
      }
    }));
    const result = await lifecycle.approve({
      mutationId: 'mut-stale',
      planId: 'plan-1',
      input: decisionInput({ planVersion: 1, proposalHash: HASH })
    });
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.error.code, 'STALE_PLAN_DECISION');
    }
  });

  test('22. double click does not create duplicate local truth', { timeout: TIMEOUT }, async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const lifecycle = new AgentHubLifecycle(mockConnection({
      rest: {
        createIntake: async () => {
          calls += 1;
          await gate;
          return validIntake();
        }
      }
    }));
    const first = lifecycle.createIntake({ mutationId: 'mut-dup', input: intakeInput() });
    const second = lifecycle.createIntake({ mutationId: 'mut-dup', input: intakeInput() });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  });

  test('23. dependency eligibility is not computed by Renderer', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /task\.dependencyState/);
    assert.equal(workspace.includes('computeEligibility'), false);
    assert.equal(workspace.includes('deriveEligibility'), false);
  });

  test('24. suspended state is not mapped to FAILED', { timeout: TIMEOUT }, () => {
    const paused = snapshotPlanTaskRuntimeDto(validRuntimeTask({ runtimeState: 'PAUSED', dependencyState: 'ELIGIBLE' }));
    const waiting = snapshotPlanTaskRuntimeDto(validRuntimeTask({ runtimeState: 'WAITING_INPUT' }));
    assert.equal(paused.runtimeState, 'PAUSED');
    assert.equal(waiting.runtimeState, 'WAITING_INPUT');
    assert.notEqual(paused.runtimeState, 'FAILED');
  });

  test('25. review pending does not locally unlock dependent task', { timeout: TIMEOUT }, () => {
    const blocked = snapshotPlanTaskRuntimeDto(validRuntimeTask({
      planTaskId: 'pt-2',
      clientId: 't2',
      dependencyState: 'BLOCKED',
      blockedBy: ['pt-1'],
      runtimeState: 'BLOCKED'
    }));
    assert.equal(blocked.dependencyState, 'BLOCKED');
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(workspace.includes('dependencyState = \'ELIGIBLE\''), false);
  });

  test('26. aggregate is Backend-owned', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /selectedPlan\.aggregate/);
    assert.equal(workspace.includes('completed = tasks.filter'), false);
  });

  test('27. final completion is Backend-owned', { timeout: TIMEOUT }, () => {
    const plan = snapshotPlanDto(validPlan({
      state: 'EXECUTING',
      aggregate: validAggregate({ completed: 1, total: 1, pending: 0, state: 'EXECUTING' }),
      tasks: [validRuntimeTask({ runtimeState: 'COMPLETED', dependencyState: 'SATISFIED' })]
    }));
    assert.equal(plan.state, 'EXECUTING');
    assert.notEqual(plan.state, 'COMPLETED');
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /selectedPlan\.state/);
    assert.equal(workspace.includes('setCompleted'), false);
  });

  test('28. realtime lifecycle event only invalidates/resyncs', { timeout: TIMEOUT }, () => {
    const connection = read('src/main/agenthub/AgentHubConnection.ts');
    assert.match(connection, /this\.#realtimeClient\.on\('event'/);
    assert.match(connection, /this\.#scheduleResync\(RESYNC_DEBOUNCE_MS, gen\)/);
    assert.equal(connection.includes('PlanCompleted'), false);
    assert.equal(connection.includes('plan.state ='), false);
  });

  test('29. out-of-order resync cannot overwrite newer state', { timeout: TIMEOUT }, () => {
    const connection = read('src/main/agenthub/AgentHubConnection.ts');
    assert.match(connection, /superseded-uncommitted/);
    assert.match(connection, /sequence < this\.#latestCommittedSequence/);
  });

  test('30. no raw fetch exposed to Renderer', { timeout: TIMEOUT }, () => {
    const preload = read('src/preload/index.ts');
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(preload.includes('fetch:'), false);
    assert.equal(workspace.includes('fetch('), false);
    assert.equal(workspace.includes('ipcRenderer'), false);
  });

  test('31. no generic IPC HTTP path exposed', { timeout: TIMEOUT }, () => {
    const ipc = read('src/main/agenthub/AgentHubIpc.ts');
    const preload = read('src/preload/index.ts');
    assert.equal(ipc.includes('agenthub:http'), false);
    assert.equal(ipc.includes('agenthub:fetch'), false);
    assert.equal(preload.includes('agenthub:http'), false);
    assert.equal(Object.values(AGENTHUB_IPC_CHANNELS).some((value) => value.includes('http') || value.includes('fetch')), false);
  });

  test('32. no generic shell/exec/spawn exposed', { timeout: TIMEOUT }, () => {
    const scoped = [
      'src/main/agenthub/AgentHubLifecycle.ts',
      'src/renderer/src/components/AgentHubLifecycleWorkspace.tsx',
      'src/shared/agenthubLifecycle.ts'
    ].map(read).join('\n');
    assert.equal(scoped.includes('child_process'), false);
    assert.equal(scoped.includes('execFile'), false);
    assert.equal(scoped.includes('shell:'), false);
  });

  test('33. no provider CLI spawned by lifecycle flow', { timeout: TIMEOUT }, () => {
    const scoped = read('src/main/agenthub/AgentHubLifecycle.ts') + read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(scoped.includes('providerCommand'), false);
    assert.equal(scoped.includes('claude.exe'), false);
    assert.equal(scoped.includes('spawn('), false);
  });

  test('34. no Primary PTY lifecycle added', { timeout: TIMEOUT }, () => {
    const scoped = read('src/main/agenthub/AgentHubLifecycle.ts') + read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(/\bpty\b|GOD_PTY|node-pty|createPty/i.test(scoped), false);
  });

  test('35. no legacy delivery queue reintroduced', { timeout: TIMEOUT }, () => {
    const scoped = read('src/main/agenthub/AgentHubLifecycle.ts') + read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(scoped.includes('enqueueMessage'), false);
    assert.equal(scoped.includes('messageQueues'), false);
  });

  test('36. Michael remains PresentationActor only', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(workspace.toLowerCase().includes('michael'), false);
    assert.match(read('src/shared/officeActors.ts'), /presentationRole: 'human'/);
  });

  test('37. Human Boss remains human presence', { timeout: TIMEOUT }, () => {
    assert.equal(HUMAN_BOSS_PRESENCE.kind, 'human');
    assert.equal(HUMAN_BOSS_ACTOR_ID, 'human-boss');
    const actors = composeOfficeActors([]);
    assert.equal(actors[0]?.kind, 'human');
  });

  test('38. lifecycle Lead comes from Backend Agent DTO', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /projectLeadAgents\.map\(\(agent\) =>/);
    assert.match(workspace, /agent\.agentId/);
    assert.equal(workspace.includes('fakeLead'), false);
  });

  test('39. Office lifecycle integration is read-only if touched', { timeout: TIMEOUT }, () => {
    const office = read('src/renderer/src/scene/office/agentHubOfficeProjection.ts');
    assert.equal(office.includes('createPlan'), false);
    assert.equal(office.includes('approvePlan'), false);
    const snapshot = snapshotState(emptyState({
      agents: [{
        agentId: 'lead-1',
        projectId: 'proj-1',
        name: 'Ada',
        providerId: 'claude',
        modelId: 'claude-sonnet-4',
        position: 'lead',
        status: 'IDLE',
        allowedComplexities: ['MEDIUM'],
        allowedRiskLevels: ['LOW'],
        capabilities: ['code'],
        specialties: [],
        authority: 'standard',
        routingPriority: 1,
        enabled: true,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z'
      }],
      plans: [validPlan()],
      planTasks: [validRuntimeTask({ runtimeTaskId: 'task-should-not-become-office-task' })]
    }));
    const projection = projectAgentHubOffice(snapshot);
    assert.equal(projection.agents[0]?.currentTaskId, null);
  });

  test('40. no fake “Lead generated plan” path exists', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(/lead generated plan/i.test(workspace), false);
    assert.equal(workspace.includes('autonomous planner'), false);
    assert.match(workspace, /Human Boss decides/);
  });

  test('existing review decision transport remains the only review action path', { timeout: TIMEOUT }, () => {
    const ipc = read('src/main/agenthub/AgentHubIpc.ts');
    assert.match(ipc, /REVIEW_DECISION: 'agenthub:reviewDecision'/);
    assert.equal(ipc.includes('agenthub:lifecycle:review'), false);
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /openReviewModal\(/);
    assert.equal(workspace.includes('openReviewModal()'), false);
  });

  test('old 4-field /state fails closed instead of synthesizing empty lifecycle', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotState({ projects: [], agents: [], tasks: [], assignments: [] }),
      /intakes/
    );
  });
});

describe('AgentHub Desktop V0.8.10 lifecycle HTTP client', () => {
  test('createIntake posts allowlisted /api/v1/intakes and resyncs', { timeout: TIMEOUT }, async () => {
    const posts: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.4C' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 's', data: emptyState({ intakes: [validIntake()] }) }));
        return;
      }
      if (req.method === 'POST') {
        posts.push(req.url ?? '');
        assert.ok(req.headers['idempotency-key']);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'm', data: validIntake() }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    const created = await client.createIntake(intakeInput(), 'desktop-lifecycle:createIntake:mut-http');
    assert.equal(created.intakeId, 'intake-1');
    assert.deepEqual(posts, ['/api/v1/intakes']);
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });
});
