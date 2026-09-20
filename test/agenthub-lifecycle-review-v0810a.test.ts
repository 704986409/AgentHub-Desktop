import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentHubValidationError } from '../src/shared/agenthubTypes';
import {
  isLifecycleCompatibleBackendVersion,
  lifecycleReviewEntryForTask,
  snapshotLifecycleReviewDto,
  snapshotLifecycleReviewList,
  type LifecycleReviewDto,
  type PlanTaskRuntimeDto
} from '../src/shared/agenthubLifecycle';
import { captureReviewReadyDto } from '../src/renderer/src/stores/agentHubReviewSessionStore';

const TIMEOUT = 8_000;
const ROOT = path.resolve(__dirname, '..');
const HEX64 = 'a'.repeat(64);
const OID40 = 'b'.repeat(40);
const HANDLE_A = 'c'.repeat(64);
const HANDLE_B = 'd'.repeat(64);

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
    buildTest: {
      build: 'not-run',
      test: 'passed',
      outcome: 'passed',
      commands: []
    },
    evidenceSha256: HEX64,
    ...overrides
  };
}

function validLifecycleReview(
  runtimeTaskId: string,
  handle: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    planId: 'plan-1',
    planVersion: 1,
    planTaskId: runtimeTaskId === 'task-b' ? 'pt-b' : 'pt-a',
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

describe('AgentHub Desktop V0.8.10A lifecycle review contract', () => {
  test('1. exact compatible Backend version is 0.7.3E', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3E'), true);
  });

  test('2. older Backend fail closed', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3D'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3C'), false);
  });

  test('3. lifecycle review DTO valid', { timeout: TIMEOUT }, () => {
    const dto = snapshotLifecycleReviewDto(validLifecycleReview('task-1', HANDLE_A));
    assert.equal(dto.runtimeTaskId, 'task-1');
    assert.equal(dto.review.reviewHandle, HANDLE_A);
    assert.equal(dto.review.reviewHandle, dto.review.reviewBundleSha256);
  });

  test('4. invalid reviewHandle reject', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotLifecycleReviewDto(validLifecycleReview('task-1', HANDLE_A, {
        review: validReviewReady('task-1', 'not-a-hash')
      })),
      AgentHubValidationError
    );
  });

  test('5. invalid sha reject', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotLifecycleReviewDto(validLifecycleReview('task-1', HANDLE_A, {
        review: validReviewReady('task-1', HANDLE_A, { evidenceSha256: 'ZZ' + 'a'.repeat(62) })
      })),
      AgentHubValidationError
    );
  });

  test('6. unknown key reject', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotLifecycleReviewDto({ ...validLifecycleReview('task-1', HANDLE_A), extra: true }),
      AgentHubValidationError
    );
  });

  test('7. NUL reject', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotLifecycleReviewDto(validLifecycleReview('task-1', HANDLE_A, { planId: 'plan\0x' })),
      AgentHubValidationError
    );
  });

  test('8. malformed nested review reject', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotLifecycleReviewDto(validLifecycleReview('task-1', HANDLE_A, { review: { outcome: 'review-ready' } })),
      AgentHubValidationError
    );
  });

  test('15-16. Review A opens A and Review B opens B', { timeout: TIMEOUT }, () => {
    const reviews = snapshotLifecycleReviewList([
      validLifecycleReview('task-a', HANDLE_A, { planTaskId: 'pt-a' }),
      validLifecycleReview('task-b', HANDLE_B, { planTaskId: 'pt-b' })
    ]);
    const taskA = reviewingTask('task-a', 'Task A', 'pt-a');
    const taskB = reviewingTask('task-b', 'Task B', 'pt-b');
    const entryA = lifecycleReviewEntryForTask(taskA, reviews, 'plan-1');
    const entryB = lifecycleReviewEntryForTask(taskB, reviews, 'plan-1');
    assert.equal(entryA.kind, 'review');
    assert.equal(entryB.kind, 'review');
    if (entryA.kind === 'review' && entryB.kind === 'review') {
      assert.equal(entryA.runtimeTaskId, 'task-a');
      assert.equal(entryB.runtimeTaskId, 'task-b');
      assert.notEqual(entryA.runtimeTaskId, entryB.runtimeTaskId);
    }
  });

  test('17. lifecycle workspace no longer guesses with parameterless openReviewModal()', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.equal(workspace.includes('openReviewModal()'), false);
    assert.match(workspace, /openReviewModal\(entry\.runtimeTaskId\)/);
  });

  test('18. selected Plan does not show another Plan review', { timeout: TIMEOUT }, () => {
    const other: LifecycleReviewDto = snapshotLifecycleReviewDto(
      validLifecycleReview('task-a', HANDLE_A, { planId: 'plan-other', planTaskId: 'pt-a' })
    );
    const entry = lifecycleReviewEntryForTask(reviewingTask('task-a', 'Task A', 'pt-a'), [other], 'plan-1');
    assert.equal(entry.kind, 'syncing');
  });

  test('19. standalone old review is not opened for a missing lifecycle review', { timeout: TIMEOUT }, () => {
    const standalone = captureReviewReadyDto(
      {},
      snapshotLifecycleReviewDto(validLifecycleReview('standalone', HANDLE_B, {
        planId: 'plan-x',
        planTaskId: 'pt-x',
        runtimeTaskId: 'standalone',
        assignmentId: 'asg-standalone',
        review: validReviewReady('standalone', HANDLE_B)
      })).review,
      true,
      null
    );
    assert.equal(Object.keys(standalone)[0], 'standalone');
    const entry = lifecycleReviewEntryForTask(
      reviewingTask('task-a', 'Task A', 'pt-a'),
      [],
      'plan-1'
    );
    assert.equal(entry.kind, 'syncing');
    if (entry.kind === 'review') {
      assert.notEqual(entry.runtimeTaskId, 'standalone');
    }
  });
});
