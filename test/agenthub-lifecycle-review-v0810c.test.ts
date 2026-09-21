import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentHubValidationError } from '../src/shared/agenthubTypes';
import {
  HUMAN_BOSS_CREATED_BY,
  isLifecycleCompatibleBackendVersion,
  isPlanReviewReconciliationError,
  lifecycleReviewEntryForTask,
  snapshotLifecycleReviewDto,
  snapshotLifecycleReviewList,
  type PlanTaskRuntimeDto
} from '../src/shared/agenthubLifecycle';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';

const TIMEOUT = 8_000;
const SMOKE_TIMEOUT = 60_000;
const ROOT = path.resolve(__dirname, '..');
const BACKEND_PRODUCTION = 'd3ec66605d469e5328caff2317a8605a69419b7c';
const BACKEND_DOCS = 'f071225d3f7238752dbef9b8f8bbbfddf8a1bb04';
const BACKEND_TAG_OBJECT = 'f8b61537b4e74c2eb9349e87e86e4aa8a51df77a';
const HEX64 = 'a'.repeat(64);
const OID40 = 'b'.repeat(40);
const HANDLE_A = 'c'.repeat(64);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function validReviewReady(taskId: string, handle: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    evidenceSha256: HEX64,
    ...overrides
  };
}

function validLifecycleReview(runtimeTaskId: string, handle: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planId: 'plan-1',
    planVersion: 1,
    planTaskId: 'pt-a',
    runtimeTaskId,
    assignmentId: `asg-${runtimeTaskId}`,
    agentId: 'agent-1',
    review: validReviewReady(runtimeTaskId, handle),
    ...overrides
  };
}

function reviewingTask(runtimeTaskId: string, title: string, planTaskId: string): PlanTaskRuntimeDto {
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
    assignmentId: `asg-${runtimeTaskId}`,
    agentId: 'agent-1',
    dependencyState: 'ELIGIBLE',
    blockedBy: [],
    runtimeState: 'REVIEWING'
  };
}

describe('AgentHub Desktop V0.8.10C backend 0.7.3K compatibility', () => {
  test('C1-C5. exact 0.7.3K gate; older and future versions fail closed', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), true);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3J'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3I'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3H'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3G'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3F'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3E'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3D'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3L'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.8.0'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3'), false);
  });

  test('C6. UI supported version text is 0.7.3K', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /Lifecycle unavailable\. Backend upgrade required\./);
    assert.match(workspace, /Supported: 0\.7\.3K\./);
    assert.match(workspace, /This is not an empty plan list/);
    assert.equal(workspace.includes('Supported: 0.7.3F.'), false);
  });

  test('C7. Review DTO parser remains strict', { timeout: TIMEOUT }, () => {
    const lifecycle = read('src/shared/agenthubLifecycle.ts');
    assert.match(lifecycle, /export function snapshotLifecycleReviewDto/);
    assert.match(lifecycle, /rejectUnexpectedKeys\(raw, LIFECYCLE_REVIEW_DTO_KEYS/);
    const dto = snapshotLifecycleReviewDto(validLifecycleReview('task-1', HANDLE_A));
    assert.equal(dto.runtimeTaskId, 'task-1');
    assert.throws(
      () => snapshotLifecycleReviewDto({ ...validLifecycleReview('task-1', HANDLE_A), extra: true }),
      AgentHubValidationError
    );
  });

  test('C8. runtimeTaskId matching remains exact', { timeout: TIMEOUT }, () => {
    const reviews = snapshotLifecycleReviewList([
      validLifecycleReview('task-a', HANDLE_A, { planTaskId: 'pt-a' })
    ]);
    const match = lifecycleReviewEntryForTask(reviewingTask('task-a', 'Task A', 'pt-a'), reviews, 'plan-1');
    const titleGuess = lifecycleReviewEntryForTask(reviewingTask('task-b', 'Task A', 'pt-a'), reviews, 'plan-1');
    assert.equal(match.kind, 'review');
    if (match.kind === 'review') {
      assert.equal(match.runtimeTaskId, 'task-a');
    }
    assert.equal(titleGuess.kind, 'syncing');
  });

  test('C9-C10. review reconciliation disables mutations; no fake Review fallback', { timeout: TIMEOUT }, () => {
    assert.equal(isPlanReviewReconciliationError('AGENTHUB_API_PLAN_REVIEW_RECONCILIATION_REQUIRED'), true);
    assert.equal(isPlanReviewReconciliationError('PLAN_REVIEW_RECONCILIATION_REQUIRED'), true);
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /Backend review reconciliation required/);
    assert.match(workspace, /mutationsUsable = lifecycleCompatible && !reviewReconciliationRequired/);
    assert.match(workspace, /snapshot && !reviewReconciliationRequired/);
    assert.equal(workspace.includes('openReviewModal()'), false);
    assert.equal(workspace.includes('fabricateReview'), false);
    assert.equal(workspace.includes('Retry Dispatcher'), false);
    assert.equal(workspace.includes('Resume Assignment'), false);
    assert.equal(read('src/shared/agenthubLifecycle.ts').includes('startsWith('), false);
  });

  test('real Backend 0.7.3K health/state/review smoke', { timeout: SMOKE_TIMEOUT }, async (t) => {
    if (process.env.AGENTHUB_REAL_BACKEND_SMOKE !== '1') {
      t.skip('Set AGENTHUB_REAL_BACKEND_SMOKE=1 to start sealed Backend 0.7.3K');
      return;
    }

    const backendRoot = process.env.AGENTHUB_BACKEND_ROOT ?? 'D:\\Code\\AgentHub';
    const applicationJs = path.join(backendRoot, 'dist', 'application', 'index.js');
    const apiJs = path.join(backendRoot, 'dist', 'api', 'index.js');
    assert.equal(fs.existsSync(applicationJs), true, `missing ${applicationJs}`);
    assert.equal(fs.existsSync(apiJs), true, `missing ${apiJs}`);

    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: backendRoot, encoding: 'utf8' }).trim();
    assert.equal(git(['rev-parse', '0.7.3K']), BACKEND_TAG_OBJECT);
    assert.equal(git(['rev-parse', '0.7.3K^{}']), BACKEND_DOCS);
    assert.equal(git(['merge-base', '--is-ancestor', BACKEND_PRODUCTION, 'HEAD']).length, 0);

    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-desktop-0810c-'));
    const applicationMod = await import(pathToFileURL(applicationJs).href) as {
      createLocalAgentHubApplication: (options: {
        readonly repositoryRoot: string;
        readonly dataDirectory: string;
      }) => Promise<{
        readonly application: {
          readonly projects: { create: (input: { name: string }) => { id: string } };
          readonly agents: {
            createAgent: (input: {
              readonly projectId: string;
              readonly name: string;
              readonly provider: string;
              readonly model: string;
              readonly position: string;
            }) => { id: string };
          };
        };
        readonly database: unknown;
        close(): Promise<void>;
      }>;
    };
    const apiMod = await import(pathToFileURL(apiJs).href) as {
      AgentHubHttpServer: new (options: {
        readonly application: unknown;
        readonly database: unknown;
        readonly host: string;
        readonly port: number;
      }) => {
        start(): Promise<{ host: string; port: number }>;
        stop(): Promise<void>;
      };
    };

    const owned = await applicationMod.createLocalAgentHubApplication({
      repositoryRoot: backendRoot,
      dataDirectory
    });
    const project = owned.application.projects.create({ name: 'V0810C Smoke' });
    const lead = owned.application.agents.createAgent({
      projectId: project.id,
      name: 'Lead',
      provider: 'codex',
      model: 'm',
      position: 'Lead'
    });
    const server = new apiMod.AgentHubHttpServer({
      application: owned.application,
      database: owned.database,
      host: '127.0.0.1',
      port: 0
    });
    const address = await server.start();
    const baseUrl = `http://${address.host}:${String(address.port)}`;
    const rest = new AgentHubRestClient({ baseUrl, timeoutMs: 8_000 });
    const connection = new AgentHubConnection({ baseUrl, timeoutMs: 8_000, helloTimeoutMs: 2_000 });

    try {
      const emptyHealth = await rest.health();
      assert.equal(emptyHealth.status, 'ok');
      assert.equal(emptyHealth.version, '0.7.3K');
      assert.equal(isLifecycleCompatibleBackendVersion(emptyHealth.version), true);

      const emptyState = await rest.state();
      assert.equal(emptyState.intakes.length, 0);
      assert.equal(emptyState.plans.length, 0);
      assert.equal(emptyState.planTasks.length, 0);

      const emptyReviews = await rest.lifecycleReviews();
      assert.equal(emptyReviews.length, 0);

      const task = await rest.createTask({
        projectId: project.id,
        title: 'Standalone smoke task',
        description: null,
        requiredCapabilities: [],
        requiredSpecialties: [],
        acceptanceCriteria: ['done'],
        complexity: 'SIMPLE',
        risk: 'LOW'
      }, 'idem-task-0810c');

      const intake = await rest.createIntake({
        projectId: project.id,
        createdBy: HUMAN_BOSS_CREATED_BY,
        goal: 'Compatibility smoke',
        leadAgentId: lead.id
      }, 'idem-intake-0810c');

      const plan = await rest.createPlan({
        intakeId: intake.intakeId,
        leadAgentId: lead.id,
        summary: 'Smoke plan',
        tasks: [{
          clientId: 'pt-a',
          parentClientId: null,
          title: 'Smoke task',
          description: null,
          acceptanceCriteria: ['done'],
          requiredCapabilities: [],
          requiredSpecialties: [],
          complexity: 'SIMPLE',
          risk: 'LOW'
        }],
        dependencies: []
      }, 'idem-plan-0810c');

      const populated = await rest.state();
      assert.equal(populated.intakes.some((item) => item.intakeId === intake.intakeId), true);
      assert.equal(populated.plans.some((item) => item.planId === plan.planId), true);
      assert.equal(populated.planTasks.some((item) => item.clientId === 'pt-a' && item.title === 'Smoke task'), true);
      assert.equal(populated.tasks.some((item) => item.taskId === task.taskId), true);
      assert.ok(Array.isArray(populated.assignments));

      const reviews = await rest.lifecycleReviews();
      assert.ok(Array.isArray(reviews));
      for (const task of populated.planTasks.filter((item) => item.runtimeState === 'REVIEWING')) {
        const entry = lifecycleReviewEntryForTask(task, reviews, plan.planId);
        if (entry.kind === 'review') {
          assert.equal(entry.runtimeTaskId, task.runtimeTaskId);
        } else {
          assert.equal(entry.kind === 'syncing' || entry.kind === 'none', true);
        }
      }

      await connection.start();
      const deadline = Date.now() + 8_000;
      let desktop = connection.getState();
      while (Date.now() < deadline && desktop.snapshot === null) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        desktop = connection.getState();
      }
      assert.equal(desktop.health?.version, '0.7.3K');
      assert.equal(isLifecycleCompatibleBackendVersion(desktop.health?.version ?? ''), true);
      assert.ok(desktop.snapshot !== null);
      assert.ok(desktop.connection === 'connected' || desktop.connection === 'degraded' || desktop.connection === 'connecting');
      assert.equal(desktop.lifecycleReviews === null || Array.isArray(desktop.lifecycleReviews), true);
      if (Array.isArray(desktop.lifecycleReviews)) {
        assert.equal(desktop.lifecycleReviews.every((item) => typeof item.runtimeTaskId === 'string'), true);
      }
    } finally {
      connection.stop();
      await server.stop();
      await owned.close();
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
