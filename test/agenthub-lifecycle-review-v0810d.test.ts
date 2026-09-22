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
const SMOKE_TIMEOUT = 90_000;
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

describe('AgentHub Desktop V0.8.10D backend 0.7.3K compatibility', () => {
  test('D1-D5. exact 0.7.3K gate; older and future versions fail closed', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C'), true);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), false);
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

  test('D6. UI supported version text is 0.7.3K', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /Lifecycle unavailable\. Backend upgrade required\./);
    assert.match(workspace, /Supported: 0\.7\.4C\./);
    assert.match(workspace, /This is not an empty plan list/);
    assert.equal(workspace.includes('Supported: 0.7.3F.'), false);
  });

  test('D7. Review DTO parser remains strict', { timeout: TIMEOUT }, () => {
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

  test('D8. runtimeTaskId matching remains exact with negative fallback test', { timeout: TIMEOUT }, () => {
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

  test('D9-D10. review reconciliation disables mutations; no fake Review fallback', { timeout: TIMEOUT }, () => {
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

  test('D11. Desktop production code contains no recovery authority', { timeout: TIMEOUT }, () => {
    const prohibited = [
      'Retry Dispatcher',
      'Resume Assignment',
      'retryDispatch',
      'resumeAssignment',
      'recoverAssignment',
      'recoverRuntimeTask'
    ];
    const files = [
      'src/renderer/src/components/AgentHubLifecycleWorkspace.tsx',
      'src/shared/agenthubLifecycle.ts',
      'src/main/agenthub/AgentHubConnection.ts',
      'src/main/agenthub/AgentHubRestClient.ts'
    ];
    for (const file of files) {
      const content = read(file);
      for (const term of prohibited) {
        assert.equal(content.includes(term), false, `${file} must not contain prohibited recovery term: ${term}`);
      }
    }
  });

  test('real Backend 0.7.3K authoritative REVIEWING + Review mapping', { timeout: SMOKE_TIMEOUT }, async (t) => {
    if (process.env.AGENTHUB_REAL_BACKEND_SMOKE !== '1') {
      t.skip('Set AGENTHUB_REAL_BACKEND_SMOKE=1 to start sealed Backend 0.7.3K');
      return;
    }

    const backendRoot = process.env.AGENTHUB_BACKEND_ROOT ?? 'g:\\Code\\AgentHub';
    const backendIndexJs = path.join(backendRoot, 'dist', 'index.js');
    const reviewTransitionsJs = path.join(backendRoot, 'dist', 'lifecycle', 'review-transition-coordinator.js');
    assert.equal(fs.existsSync(backendIndexJs), true, `missing ${backendIndexJs}`);
    assert.equal(fs.existsSync(reviewTransitionsJs), true, `missing ${reviewTransitionsJs}`);

    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: backendRoot, encoding: 'utf8' }).trim();
    assert.equal(git(['rev-parse', '0.7.3K']), BACKEND_TAG_OBJECT);
    assert.equal(git(['rev-parse', '0.7.3K^{}']), BACKEND_DOCS);
    assert.equal(git(['merge-base', '--is-ancestor', BACKEND_PRODUCTION, 'HEAD']).length, 0);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-desktop-0810d-'));
    const repoRoot = path.join(tempDir, 'repo');
    const dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    execFileSync('git', ['init', repoRoot], { stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'AgentHub Tests'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'agenthub@example.invalid'], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# V0.8.10D Smoke\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' });
    execFileSync('git', ['branch', '-M', 'main'], { cwd: repoRoot });

    const backend = (await import(pathToFileURL(backendIndexJs).href)) as any;
    const { ReviewTransitionCoordinator } = (await import(pathToFileURL(reviewTransitionsJs).href)) as any;

    const capabilities = Object.freeze({
      outputProtocols: Object.freeze(['worker-result'] as const),
      sessionContinuation: true
    });

    const workerResult = {
      protocolVersion: 1,
      outcome: 'COMPLETED',
      summary: 'done',
      changedFiles: [],
      checks: [],
      blockers: [],
      questions: [],
      risks: [],
      notes: []
    };

    class FakeSession {
      public readonly providerId = 'fake';
      public readonly capabilities = capabilities;
      public sessionId = 'fake-session-1';
      public started = false;
      public active = false;
      public start(): Promise<void> {
        this.started = true;
        return Promise.resolve();
      }
      public runTurn(request: { protocol: string }): Promise<unknown> {
        this.active = request.protocol === 'worker-result';
        this.active = false;
        return Promise.resolve({
          providerId: 'fake',
          sessionId: this.sessionId,
          durationMs: 5,
          protocol: 'worker-result',
          protocolValid: true,
          workerResult
        });
      }
      public shutdown(): Promise<void> {
        this.started = false;
        this.active = false;
        return Promise.resolve();
      }
    }

    class FakeProvider {
      public readonly id = 'fake';
      public readonly capabilities = capabilities;
      public createSession(): FakeSession {
        return new FakeSession();
      }
    }

    const database = new backend.Database(path.join(dataDir, 'agenthub.db'));
    database.initialize();
    const eventBus = new backend.EventBus();
    const projectRepository = new backend.SqliteProjectRepository(database);
    const agentRepository = new backend.SqliteAgentRepository(database);
    const taskRepository = new backend.SqliteTaskRepository(database);
    const assignmentRepository = new backend.SqliteAssignmentRepository(database);
    const events = new backend.EventStore(new backend.SqliteEventRepository(database), eventBus);
    const profiles = new backend.AgentProfileManager({ agentsDirectory: path.join(dataDir, 'agents') });
    const agents = new backend.AgentRegistry(agentRepository, profiles, eventBus);
    const tasks = new backend.TaskManager(taskRepository, new backend.TaskStateMachine(), eventBus);
    const assignments = new backend.AssignmentManager(
      assignmentRepository,
      tasks,
      agents,
      (agentId: string) => agents.calculateProfileHash(agentId),
      eventBus
    );

    const providerFactory = new backend.AgentProviderFactory();
    providerFactory.register(new FakeProvider());
    const providerCatalog = new backend.ProviderCatalogService({ providerFactory });
    const pool = new backend.AgentPool({ providerFactory, eventBus });

    const scheduler = new backend.AgentScheduler({
      taskManager: tasks,
      agentRegistry: agents,
      providerFactory,
      agentPool: pool,
      assignmentManager: assignments
    });

    const planLifecycle = new backend.PlanLifecycleService(
      projectRepository,
      agents,
      eventBus,
      database,
      tasks,
      assignmentRepository
    );
    const agentManagement = new backend.AgentManagementService({
      agentRegistry: agents,
      agentPool: pool,
      providerFactory,
      projects: projectRepository,
      assignments: assignmentRepository,
      tasks,
      eventBus,
      isProviderUsable: (id: string) => providerFactory.has(id),
      isLifecycleReferenced: (agentId: string) => planLifecycle.isLeadReferenced(agentId)
    });

    const worktrees = await backend.GitWorktreeManager.open({ repositoryRoot: repoRoot });
    const dispatcher = new backend.AssignmentDispatcher({
      taskManager: tasks,
      agentRegistry: agents,
      assignmentManager: assignments,
      agentPool: pool,
      worktreeManager: worktrees
    });

    const reviews = new backend.ReviewHandleStore(database);
    const reviewTransitions = new ReviewTransitionCoordinator({
      database,
      reviews,
      planLifecycle,
      tasks
    });

    const lifecycle = new backend.TaskLifecycleOrchestrator({
      taskManager: tasks,
      agentRegistry: agents,
      assignmentManager: assignments,
      agentPool: pool,
      worktreeManager: worktrees,
      reviewTransitions
    });

    const assignmentRecovery = new backend.PlanExecutionRecoveryService({
      database,
      planLifecycle,
      tasks,
      assignments,
      agentPool: pool,
      eventBus,
      reviews
    });

    const targetBranch = 'main';
    const buildTestPlan = Object.freeze({
      commands: Object.freeze([
        {
          id: 'node-runtime-check',
          phase: 'test' as const,
          executable: process.execPath,
          args: Object.freeze(['-e', 'process.exit(0)']),
          timeoutMs: 30_000
        }
      ])
    });

    const planExecution = new backend.PlanExecutionCoordinator({
      planLifecycle,
      tasks,
      scheduler,
      dispatcher,
      taskLifecycle: lifecycle,
      targetBranch,
      buildTestPlan,
      eventBus,
      reviewTransitions,
      assignmentRecovery
    });

    const planRecovery = new backend.PlanRecoveryCoordinator({
      planLifecycle,
      planExecution,
      reviewTransitions,
      eventBus
    });

    backend.recoverLifecycleAfterStartup({ reviewTransitions, recovery: planRecovery });

    const application = Object.freeze({
      projects: projectRepository,
      agents,
      agentManagement,
      tasks,
      assignments,
      assignmentQueries: assignmentRepository,
      events,
      eventBus,
      scheduler,
      dispatcher,
      lifecycle,
      planLifecycle,
      planExecution,
      reviews,
      reviewTransitions,
      buildTestPlan,
      targetBranch,
      providerCatalog
    });

    const server = new backend.AgentHubHttpServer({
      application,
      database,
      host: '127.0.0.1',
      port: 0
    });

    const address = await server.start();
    const baseUrl = `http://${address.host}:${String(address.port)}`;
    const rest = new AgentHubRestClient({ baseUrl, timeoutMs: 30_000 });
    const connection = new AgentHubConnection({ baseUrl, timeoutMs: 30_000, helloTimeoutMs: 5_000 });

    try {
      const emptyHealth = await rest.health();
      assert.equal(emptyHealth.status, 'ok');
      assert.equal(emptyHealth.version, '0.7.3K');
      assert.equal(isLifecycleCompatibleBackendVersion(emptyHealth.version), false);

      const emptyState = await rest.state();
      assert.equal(emptyState.intakes.length, 0);
      assert.equal(emptyState.plans.length, 0);
      assert.equal(emptyState.planTasks.length, 0);

      const emptyReviews = await rest.lifecycleReviews();
      assert.equal(emptyReviews.length, 0);

      const project = projectRepository.create({ name: 'V0.8.10D Project' });
      const workerAgent = agentManagement.createAgent({
        projectId: project.id,
        name: 'Worker',
        providerId: 'fake',
        modelId: 'm',
        position: 'Developer',
        allowedComplexities: ['SIMPLE', 'MEDIUM', 'COMPLEX'],
        allowedRiskLevels: ['LOW', 'MEDIUM', 'HIGH'],
        capabilities: ['worker-result'],
        specialties: ['general'],
        authority: 'STANDARD',
        routingPriority: 10,
        enabled: true
      });

      const intake = await rest.createIntake(
        {
          projectId: project.id,
          createdBy: HUMAN_BOSS_CREATED_BY,
          goal: 'V0810D Smoke Closure',
          leadAgentId: workerAgent.id
        },
        'idem-intake-0810d'
      );

      const plan = await rest.createPlan(
        {
          intakeId: intake.intakeId,
          leadAgentId: workerAgent.id,
          summary: 'V0810D Smoke Plan',
          tasks: [
            {
              clientId: 'pt-d1',
              parentClientId: null,
              title: 'V0810D Smoke Task',
              description: 'Deterministic fake execution',
              acceptanceCriteria: ['pass'],
              requiredCapabilities: [],
              requiredSpecialties: [],
              complexity: 'SIMPLE',
              risk: 'LOW'
            }
          ],
          dependencies: []
        },
        'idem-plan-0810d'
      );

      const approved = await rest.approvePlan(
        plan.planId,
        {
          planVersion: 1,
          proposalHash: plan.current.proposalHash,
          actorId: 'human',
          summary: 'Approved plan'
        },
        'idem-approve-0810d'
      );
      assert.equal(approved.state, 'APPROVED');

      const started = await rest.startPlan(
        plan.planId,
        {
          planVersion: 1,
          proposalHash: plan.current.proposalHash
        },
        'idem-start-0810d'
      );
      assert.equal(started.state, 'REVIEWING');

      const populated = await rest.state();
      const reviewingTasks = populated.planTasks.filter((item) => item.runtimeState === 'REVIEWING');
      assert.equal(reviewingTasks.length, 1, 'Smoke must produce exactly one REVIEWING Task');
      const reviewingTask = reviewingTasks[0];
      assert.ok(reviewingTask);
      assert.ok(typeof reviewingTask.runtimeTaskId === 'string' && reviewingTask.runtimeTaskId.length > 0);
      assert.ok(typeof reviewingTask.assignmentId === 'string' && reviewingTask.assignmentId.length > 0);
      assert.equal(reviewingTask.agentId, workerAgent.id);
      assert.equal(reviewingTask.planId, plan.planId);
      assert.equal(reviewingTask.planVersion, 1);
      assert.equal(reviewingTask.clientId, 'pt-d1');

      const reviews = await rest.lifecycleReviews();
      assert.ok(Array.isArray(reviews));
      assert.ok(reviews.length >= 1, 'GET /api/v1/reviews must return at least one authoritative Review');

      const authoritativeReview = reviews.find((item) => item.runtimeTaskId === reviewingTask.runtimeTaskId);
      assert.ok(authoritativeReview, 'Must find Review by exact runtimeTaskId match');

      assert.equal(authoritativeReview.planId, reviewingTask.planId);
      assert.equal(authoritativeReview.planVersion, reviewingTask.planVersion);
      assert.equal(authoritativeReview.planTaskId, reviewingTask.planTaskId);
      assert.equal(authoritativeReview.runtimeTaskId, reviewingTask.runtimeTaskId);
      assert.equal(authoritativeReview.assignmentId, reviewingTask.assignmentId);
      assert.equal(authoritativeReview.agentId, reviewingTask.agentId);
      assert.equal(authoritativeReview.review.taskId, reviewingTask.runtimeTaskId);

      const entry = lifecycleReviewEntryForTask(reviewingTask, reviews, plan.planId);
      assert.equal(entry.kind, 'review', 'Desktop mapping must be review; syncing or none is failure');
      if (entry.kind === 'review') {
        assert.equal(entry.runtimeTaskId, reviewingTask.runtimeTaskId);
        assert.equal(entry.planTaskId, reviewingTask.planTaskId);
      }

      const negativeTask: PlanTaskRuntimeDto = {
        ...reviewingTask,
        runtimeTaskId: 'negative-mismatched-runtime-id'
      };
      const negativeEntry = lifecycleReviewEntryForTask(negativeTask, reviews, plan.planId);
      assert.notEqual(negativeEntry.kind, 'review', 'Mismatched runtimeTaskId must not match Review');

      await connection.start();
      const deadline = Date.now() + 8_000;
      let desktop = connection.getState();
      while (Date.now() < deadline && desktop.snapshot === null) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        desktop = connection.getState();
      }

      assert.equal(desktop.health?.version, '0.7.3K');
      assert.equal(isLifecycleCompatibleBackendVersion(desktop.health?.version ?? ''), false);
      assert.ok(desktop.snapshot !== null);
      assert.equal(desktop.lifecycleReviews, null);
      assert.ok(
        desktop.connection === 'connected' ||
          desktop.connection === 'degraded' ||
          desktop.connection === 'connecting'
      );

      const connReviewingTasks = desktop.snapshot.planTasks.filter((item) => item.runtimeState === 'REVIEWING');
      assert.equal(connReviewingTasks.length, 1);
      assert.equal(connReviewingTasks[0].runtimeTaskId, reviewingTask.runtimeTaskId);
    } finally {
      connection.stop();
      await server.stop();
      await planRecovery.stop();
      await pool.shutdownAll();
      events.close();
      database.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
