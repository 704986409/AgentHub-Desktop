import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubLifecycle } from '../src/main/agenthub/AgentHubLifecycle';
import { AgentHubReviewDecision } from '../src/main/agenthub/AgentHubReviewDecision';
import {
  lifecycleReviewEntryForTask,
  type PlanTaskRuntimeDto
} from '../src/shared/agenthubLifecycle';
import { reduceAuthoritativeReviews } from '../src/renderer/src/stores/agentHubReviewSessionStore';

const TIMEOUT = 8_000;
const HEX64 = 'a'.repeat(64);
const OID40 = 'b'.repeat(40);
const HANDLE_A = 'c'.repeat(64);
const HANDLE_B = 'd'.repeat(64);

function validReviewReady(taskId: string, handle: string): Record<string, unknown> {
  return {
    outcome: 'review-ready',
    reviewHandle: handle,
    reviewBundleSha256: handle,
    taskId,
    assignmentId: `asg-${taskId}`,
    agentId: 'agent-1',
    providerId: 'fake',
    workerResult: { summary: 'done', blockers: [], questions: [], risks: [], notes: [] },
    source: {
      branchName: `agenthub/${taskId}`,
      baseCommit: OID40,
      headCommit: OID40,
      changedPaths: [],
      changeSetSha256: HEX64
    },
    buildTest: { build: 'not-run', test: 'passed', outcome: 'passed', commands: [] },
    evidenceSha256: HEX64
  };
}

function lifecycleReview(runtimeTaskId: string, handle: string, planTaskId: string): Record<string, unknown> {
  return {
    planId: 'plan-1',
    planVersion: 1,
    planTaskId,
    runtimeTaskId,
    assignmentId: `asg-${runtimeTaskId}`,
    agentId: 'agent-1',
    review: validReviewReady(runtimeTaskId, handle)
  };
}

function envelope(data: unknown): string {
  return JSON.stringify({ ok: true, requestId: 'r1', data });
}

function task(
  planTaskId: string,
  title: string,
  runtimeTaskId: string | null,
  runtimeState: PlanTaskRuntimeDto['runtimeState'],
  dependencyState: PlanTaskRuntimeDto['dependencyState'],
  blockedBy: string[] = []
): Record<string, unknown> {
  return {
    planTaskId,
    clientId: planTaskId,
    parentPlanTaskId: null,
    title,
    description: null,
    acceptanceCriteria: ['done'],
    requiredCapabilities: [],
    requiredSpecialties: [],
    complexity: 'SIMPLE',
    risk: 'LOW',
    planId: 'plan-1',
    planVersion: 1,
    runtimeTaskId,
    assignmentId: runtimeTaskId ? `asg-${runtimeTaskId}` : null,
    agentId: runtimeTaskId ? 'agent-1' : null,
    dependencyState,
    blockedBy,
    runtimeState
  };
}

function planDto(
  state: string,
  tasks: Array<Record<string, unknown>>,
  reviewing: number,
  completed: number,
  blocked: number
): Record<string, unknown> {
  const started = state === 'EXECUTING' || state === 'REVIEWING' || state === 'COMPLETED';
  return {
    planId: 'plan-1',
    intakeId: 'intake-1',
    projectId: 'proj-1',
    leadAgentId: 'lead-1',
    currentVersion: 1,
    state,
    current: {
      planId: 'plan-1',
      version: 1,
      proposalHash: HEX64,
      leadAgentId: 'lead-1',
      summary: 'Ship A then B',
      tasks: tasks.map((item) => ({
        planTaskId: item.planTaskId,
        clientId: item.clientId,
        parentPlanTaskId: null,
        title: item.title,
        description: null,
        acceptanceCriteria: ['done'],
        requiredCapabilities: [],
        requiredSpecialties: [],
        complexity: 'SIMPLE',
        risk: 'LOW'
      })),
      dependencies: [{ prerequisitePlanTaskId: 'pt-a', dependentPlanTaskId: 'pt-b' }],
      createdAt: '2026-09-20T00:00:00.000Z'
    },
    tasks,
    dependencies: [{ prerequisitePlanTaskId: 'pt-a', dependentPlanTaskId: 'pt-b' }],
    decisions: state === 'WAITING_APPROVAL' ? [] : [{
      decisionId: 'dec-1',
      planId: 'plan-1',
      planVersion: 1,
      proposalHash: HEX64,
      decision: 'APPROVE',
      actorId: 'human-boss',
      summary: '',
      decidedAt: '2026-09-20T00:00:00.000Z'
    }],
    aggregate: {
      total: 2,
      pending: blocked,
      blocked,
      eligible: reviewing > 0 ? 0 : (state === 'COMPLETED' ? 0 : 1),
      running: 0,
      reviewing,
      completed,
      failed: 0,
      state
    },
    startedVersion: started ? 1 : null,
    startedAt: started ? '2026-09-20T00:00:00.000Z' : null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    completedAt: state === 'COMPLETED' ? '2026-09-20T00:00:00.000Z' : null
  };
}

function snapshotState(plan: Record<string, unknown>): Record<string, unknown> {
  return {
    projects: [],
    agents: [],
    tasks: [],
    assignments: [],
    intakes: [{
      intakeId: 'intake-1',
      projectId: 'proj-1',
      createdBy: 'human-boss',
      goal: 'Ship A then B',
      leadAgentId: 'lead-1',
      createdAt: '2026-09-20T00:00:00.000Z'
    }],
    plans: [plan],
    planTasks: plan.tasks,
    planDependencies: [{ prerequisitePlanTaskId: 'pt-a', dependentPlanTaskId: 'pt-b' }]
  };
}

function reviewingTaskLike(runtimeTaskId: string): PlanTaskRuntimeDto {
  return {
    planTaskId: runtimeTaskId === 'task-a' ? 'pt-a' : 'pt-b',
    clientId: 'c',
    parentPlanTaskId: null,
    title: runtimeTaskId,
    description: null,
    acceptanceCriteria: ['done'],
    requiredCapabilities: [],
    requiredSpecialties: [],
    complexity: 'SIMPLE',
    risk: 'LOW',
    planId: 'plan-1',
    planVersion: 1,
    runtimeTaskId,
    assignmentId: `asg-${runtimeTaskId}`,
    agentId: 'agent-1',
    dependencyState: 'ELIGIBLE',
    blockedBy: [],
    runtimeState: 'REVIEWING'
  };
}

async function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

const startTasks = [
  task('pt-a', 'Task A', 'task-a', 'REVIEWING', 'ELIGIBLE'),
  task('pt-b', 'Task B', 'task-b', 'BLOCKED', 'BLOCKED', ['pt-a'])
];
const afterATasks = [
  task('pt-a', 'Task A', 'task-a', 'COMPLETED', 'SATISFIED'),
  task('pt-b', 'Task B', 'task-b', 'REVIEWING', 'ELIGIBLE')
];
const doneTasks = [
  task('pt-a', 'Task A', 'task-a', 'COMPLETED', 'SATISFIED'),
  task('pt-b', 'Task B', 'task-b', 'COMPLETED', 'SATISFIED')
];

describe('AgentHub Desktop V0.8.10A lifecycle review recovery', () => {
  test('9-14. /state + /reviews hydrate, recover, hide inoperable review, then clear stale records', { timeout: TIMEOUT }, async () => {
    let phase: 'a-reviewing' | 'accepted' = 'a-reviewing';
    const { server, baseUrl } = await listen((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope({ status: 'ok', version: '0.7.3F' }));
        return;
      }
      if (req.url === '/api/v1/state') {
        const current = phase === 'a-reviewing'
          ? planDto('REVIEWING', startTasks, 1, 0, 1)
          : planDto('EXECUTING', afterATasks, 1, 1, 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(snapshotState(current)));
        return;
      }
      if (req.url === '/api/v1/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(phase === 'a-reviewing'
          ? [lifecycleReview('task-a', HANDLE_A, 'pt-a')]
          : [lifecycleReview('task-b', HANDLE_B, 'pt-b')]));
        return;
      }
      res.writeHead(404).end();
    });

    try {
      const connection = new AgentHubConnection({
        restClient: new AgentHubRestClient({ baseUrl }),
        timeoutMs: 2000
      });
      const first = await connection.syncAuthoritativeState();
      assert.equal(first.disposition, 'committed');
      assert.equal(first.lifecycleReviews?.[0]?.review.reviewHandle, HANDLE_A);
      assert.equal(lifecycleReviewEntryForTask(reviewingTaskLike('task-a'), [], 'plan-1').kind, 'syncing');
      assert.equal(
        lifecycleReviewEntryForTask(reviewingTaskLike('task-a'), first.lifecycleReviews ?? [], 'plan-1').kind,
        'review'
      );
      let store = reduceAuthoritativeReviews({}, first.lifecycleReviews ?? [], first.snapshot?.planTasks ?? []);
      assert.equal(store['task-a']?.review.reviewHandle, HANDLE_A);

      phase = 'accepted';
      const second = await connection.syncAuthoritativeState();
      store = reduceAuthoritativeReviews(store, second.lifecycleReviews ?? [], second.snapshot?.planTasks ?? []);
      assert.equal(store['task-a'], undefined);
      assert.equal(store['task-b']?.review.reviewHandle, HANDLE_B);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  test('full fake-backend lifecycle never invents Backend review identity', { timeout: TIMEOUT }, async () => {
    let phase: 'start' | 'after-a' | 'done' = 'start';
    const seenHandles: string[] = [];
    const { server, baseUrl } = await listen((req, res) => {
      const url = req.url ?? '';
      if (url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope({ status: 'ok', version: '0.7.3F' }));
        return;
      }
      if (url === '/api/v1/state') {
        const current = phase === 'start'
          ? planDto('REVIEWING', startTasks, 1, 0, 1)
          : phase === 'after-a'
            ? planDto('REVIEWING', afterATasks, 1, 1, 0)
            : planDto('COMPLETED', doneTasks, 0, 2, 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(snapshotState(current)));
        return;
      }
      if (url === '/api/v1/reviews') {
        const reviews = phase === 'start'
          ? [lifecycleReview('task-a', HANDLE_A, 'pt-a')]
          : phase === 'after-a'
            ? [lifecycleReview('task-b', HANDLE_B, 'pt-b')]
            : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(reviews));
        return;
      }
      if (url === '/api/v1/intakes' && req.method === 'POST') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(envelope({
          intakeId: 'intake-1',
          projectId: 'proj-1',
          createdBy: 'human-boss',
          goal: 'Ship A then B',
          leadAgentId: 'lead-1',
          createdAt: '2026-09-20T00:00:00.000Z'
        }));
        return;
      }
      if (url === '/api/v1/plans' && req.method === 'POST') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(envelope(planDto('WAITING_APPROVAL', [
          task('pt-a', 'Task A', null, 'PENDING', 'ELIGIBLE'),
          task('pt-b', 'Task B', null, 'PENDING', 'BLOCKED', ['pt-a'])
        ], 0, 0, 1)));
        return;
      }
      if (url === '/api/v1/plans/plan-1/approve' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(planDto('APPROVED', [
          task('pt-a', 'Task A', null, 'PENDING', 'ELIGIBLE'),
          task('pt-b', 'Task B', null, 'PENDING', 'BLOCKED', ['pt-a'])
        ], 0, 0, 1)));
        return;
      }
      if (url === '/api/v1/plans/plan-1/start' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(planDto('REVIEWING', startTasks, 1, 0, 1)));
        return;
      }
      const reviewMatch = /^\/api\/v1\/reviews\/([^/]+)\/decision$/.exec(url);
      if (reviewMatch && req.method === 'POST') {
        seenHandles.push(decodeURIComponent(reviewMatch[1] ?? ''));
        const taskId = phase === 'start' ? 'task-a' : 'task-b';
        phase = phase === 'start' ? 'after-a' : 'done';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope({
          outcome: 'completed-no-change',
          taskId,
          lifecycleSha256: HEX64,
          reviewEvidenceSha256: HEX64
        }));
        return;
      }
      res.writeHead(404).end();
    });

    try {
      const connection = new AgentHubConnection({
        restClient: new AgentHubRestClient({ baseUrl }),
        timeoutMs: 2000
      });
      const lifecycle = new AgentHubLifecycle(connection);
      const reviews = new AgentHubReviewDecision(connection);

      assert.equal((await lifecycle.createIntake({
        mutationId: 'mut-intake',
        input: { projectId: 'proj-1', createdBy: 'human-boss', goal: 'Ship A then B', leadAgentId: 'lead-1' }
      })).status, 'applied');
      assert.equal((await lifecycle.createPlan({
        mutationId: 'mut-plan',
        input: {
          intakeId: 'intake-1',
          leadAgentId: 'lead-1',
          summary: 'Ship A then B',
          tasks: [
            { clientId: 'pt-a', parentClientId: null, title: 'Task A', description: null, acceptanceCriteria: ['done'], requiredCapabilities: [], requiredSpecialties: [], complexity: 'SIMPLE', risk: 'LOW' },
            { clientId: 'pt-b', parentClientId: null, title: 'Task B', description: null, acceptanceCriteria: ['done'], requiredCapabilities: [], requiredSpecialties: [], complexity: 'SIMPLE', risk: 'LOW' }
          ],
          dependencies: [{ prerequisiteClientId: 'pt-a', dependentClientId: 'pt-b' }]
        }
      })).status, 'applied');
      assert.equal((await lifecycle.approve({
        mutationId: 'mut-approve',
        planId: 'plan-1',
        input: { planVersion: 1, proposalHash: HEX64, actorId: 'human-boss', summary: '' }
      })).status, 'applied');
      assert.equal((await lifecycle.start({
        mutationId: 'mut-start',
        planId: 'plan-1',
        input: { planVersion: 1, proposalHash: HEX64 }
      })).status, 'applied');

      let sync = await connection.syncAuthoritativeState();
      assert.equal(sync.lifecycleReviews?.[0]?.review.reviewHandle, HANDLE_A);
      assert.equal(sync.lifecycleReviews?.[0]?.runtimeTaskId, 'task-a');
      assert.equal(sync.snapshot?.plans[0]?.state, 'REVIEWING');

      const acceptA = await reviews.reviewDecision({
        decisionId: 'dec-a',
        reviewHandle: HANDLE_A,
        input: { verdict: 'ACCEPT', summary: 'ok', findings: [], allowNoChangeCompletion: true }
      });
      assert.equal(acceptA.status, 'applied');

      sync = await connection.syncAuthoritativeState();
      assert.equal(sync.snapshot?.planTasks.find((item) => item.planTaskId === 'pt-a')?.runtimeState, 'COMPLETED');
      assert.equal(sync.snapshot?.planTasks.find((item) => item.planTaskId === 'pt-b')?.runtimeState, 'REVIEWING');
      assert.equal(sync.lifecycleReviews?.[0]?.review.reviewHandle, HANDLE_B);

      const acceptB = await reviews.reviewDecision({
        decisionId: 'dec-b',
        reviewHandle: HANDLE_B,
        input: { verdict: 'ACCEPT', summary: 'ok', findings: [], allowNoChangeCompletion: true }
      });
      assert.equal(acceptB.status, 'applied');
      sync = await connection.syncAuthoritativeState();
      assert.equal(sync.snapshot?.plans[0]?.state, 'COMPLETED');
      assert.equal(sync.lifecycleReviews?.length, 0);
      assert.deepEqual(seenHandles, [HANDLE_A, HANDLE_B]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
