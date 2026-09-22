import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentHubValidationError } from '../src/shared/agenthubTypes';
import {
  isLifecycleCompatibleBackendVersion,
  isPlanReviewReconciliationError,
  lifecycleReviewEntryForTask,
  snapshotLifecycleReviewDto,
  snapshotLifecycleReviewList,
  type PlanTaskRuntimeDto
} from '../src/shared/agenthubLifecycle';

const TIMEOUT = 8_000;
const ROOT = path.resolve(__dirname, '..');
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

  test('C6. UI supported version text is 0.7.3K', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /Lifecycle unavailable\. Backend upgrade required\./);
    assert.match(workspace, /Supported: 0\.7\.4C\./);
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

  test('historical V0.8.10C smoke superseded by V0.8.10D authoritative review closure', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C'), true);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), false);
  });
});
