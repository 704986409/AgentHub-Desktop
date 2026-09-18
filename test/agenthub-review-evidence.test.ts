import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  captureReviewReadyResult,
  useAgentHubReviewSessionStore,
  type AgentHubReviewSessionRecord
} from '../src/renderer/src/stores/agentHubReviewSessionStore';
import {
  formatDisplayPreview,
  formatExitCode,
  formatCommittedPatch
} from '../src/renderer/src/components/agentHubReviewPresentation';
import type {
  ExecuteReviewReadyDto,
  TaskExecutionResult
} from '../src/shared/agenthubTypes';

describe('AgentHub Review Evidence Read-Only', () => {
  const sampleReviewReadyDto: ExecuteReviewReadyDto = {
    outcome: 'review-ready',
    reviewHandle: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    reviewBundleSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    taskId: 'task-100',
    assignmentId: 'asg-200',
    agentId: 'agent-300',
    providerId: 'claude',
    workerResult: {
      summary: 'Completed compiler optimization pass',
      blockers: [],
      questions: [],
      risks: ['Cache invalidation edge case'],
      notes: ['Refactored hot loop']
    },
    source: {
      branchName: 'task/compiler-opt',
      baseCommit: '1111111111111111111111111111111111111111',
      headCommit: '2222222222222222222222222222222222222222',
      changedPaths: ['src/compiler/opt.ts', 'test/compiler/opt.test.ts'],
      changeSetSha256: '3333333333333333333333333333333333333333333333333333333333333333',
      committedPatch: 'diff --git a/src/opt.ts b/src/opt.ts\n+optimized()'
    },
    buildTest: {
      build: 'passed',
      test: 'passed',
      outcome: 'passed',
      commands: [
        {
          id: 'cmd-build',
          phase: 'build',
          outcome: 'passed',
          exitCode: 0,
          stdoutPreview: 'Build succeeded in 1.2s',
          stderrPreview: ''
        },
        {
          id: 'cmd-test',
          phase: 'test',
          outcome: 'passed',
          exitCode: 0,
          stdoutPreview: 'All 42 tests passed',
          stderrPreview: ''
        }
      ]
    },
    evidenceSha256: '4444444444444444444444444444444444444444444444444444444444444444'
  };

  test('capture gate: executed + review-ready is captured into session store', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};
    const executedResult: TaskExecutionResult = {
      status: 'executed',
      result: sampleReviewReadyDto,
      stateSynchronized: true
    };

    const next = captureReviewReadyResult(initial, executedResult);
    assert.ok(next['task-100'], 'Record must be stored under taskId');
    assert.equal(next['task-100'].review.reviewHandle, sampleReviewReadyDto.reviewHandle);
    assert.equal(next['task-100'].stateSynchronized, true);
    assert.equal(next['task-100'].warning, null);
  });

  test('capture gate: non-review-ready outcomes (blocked, waiting-input, failed) are NOT captured', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};

    const blockedResult: TaskExecutionResult = {
      status: 'executed',
      result: {
        outcome: 'blocked',
        taskId: 'task-blocked',
        assignmentId: 'asg-1',
        lifecycleSha256: 'sha-blocked'
      },
      stateSynchronized: true
    };
    assert.equal(captureReviewReadyResult(initial, blockedResult), initial);

    const waitingResult: TaskExecutionResult = {
      status: 'executed',
      result: {
        outcome: 'waiting-input',
        taskId: 'task-waiting',
        assignmentId: 'asg-2',
        lifecycleSha256: 'sha-waiting'
      },
      stateSynchronized: true
    };
    assert.equal(captureReviewReadyResult(initial, waitingResult), initial);

    const failedLifecycleResult: TaskExecutionResult = {
      status: 'executed',
      result: {
        outcome: 'failed',
        taskId: 'task-failed',
        assignmentId: 'asg-3',
        lifecycleSha256: 'sha-failed'
      },
      stateSynchronized: true
    };
    assert.equal(captureReviewReadyResult(initial, failedLifecycleResult), initial);
  });

  test('capture gate: ambiguous and transport failed results are NOT captured', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};

    const ambiguousResult: TaskExecutionResult = {
      status: 'ambiguous',
      retryable: true,
      error: { code: 'HTTP_TIMEOUT', message: 'Request timed out' }
    };
    assert.equal(captureReviewReadyResult(initial, ambiguousResult), initial);

    const failedTransportResult: TaskExecutionResult = {
      status: 'failed',
      retryable: false,
      error: { code: 'INVALID_REQUEST', message: 'Bad request' }
    };
    assert.equal(captureReviewReadyResult(initial, failedTransportResult), initial);
  });

  test('evidence survival: ambiguous, failed, or blocked results never erase existing confirmed records', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};
    const executedResult: TaskExecutionResult = {
      status: 'executed',
      result: sampleReviewReadyDto,
      stateSynchronized: true
    };

    const captured = captureReviewReadyResult(initial, executedResult);
    assert.ok(captured['task-100']);

    // Ambiguous result arrives later
    const afterAmbiguous = captureReviewReadyResult(captured, {
      status: 'ambiguous',
      retryable: true,
      error: { code: 'NETWORK_LOST', message: 'Connection dropped' }
    });
    assert.ok(afterAmbiguous['task-100'], 'Prior review record must survive ambiguous');

    // Failed transport result arrives later
    const afterFailed = captureReviewReadyResult(afterAmbiguous, {
      status: 'failed',
      retryable: false,
      error: { code: 'SERVER_ERROR', message: 'Internal error' }
    });
    assert.ok(afterFailed['task-100'], 'Prior review record must survive failed');

    // Blocked lifecycle result arrives later
    const afterBlocked = captureReviewReadyResult(afterFailed, {
      status: 'executed',
      result: {
        outcome: 'blocked',
        taskId: 'task-other',
        assignmentId: 'asg-other',
        lifecycleSha256: 'sha-other'
      },
      stateSynchronized: true
    });
    assert.ok(afterBlocked['task-100'], 'Prior review record must survive blocked');
  });

  test('state sync warning: stateSynchronized=false preserves warning without downgrading record', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};
    const resultWithWarning: TaskExecutionResult = {
      status: 'executed',
      result: sampleReviewReadyDto,
      stateSynchronized: false,
      warning: {
        code: 'STATE_RESYNC_FAILED',
        message: 'Could not fetch latest snapshot after execute'
      }
    };

    const next = captureReviewReadyResult(initial, resultWithWarning);
    assert.ok(next['task-100']);
    assert.equal(next['task-100'].stateSynchronized, false);
    assert.deepEqual(next['task-100'].warning, {
      code: 'STATE_RESYNC_FAILED',
      message: 'Could not fetch latest snapshot after execute'
    });
  });

  test('latest confirmed result for same task replaces earlier record; distinct tasks remain independent', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};

    // Task 1, Rev A
    const res1A: TaskExecutionResult = {
      status: 'executed',
      result: { ...sampleReviewReadyDto, taskId: 'task-1', reviewHandle: 'handle-1A' },
      stateSynchronized: true
    };
    const state1 = captureReviewReadyResult(initial, res1A);
    assert.equal(state1['task-1'].review.reviewHandle, 'handle-1A');

    // Task 2, Rev A
    const res2A: TaskExecutionResult = {
      status: 'executed',
      result: { ...sampleReviewReadyDto, taskId: 'task-2', reviewHandle: 'handle-2A' },
      stateSynchronized: true
    };
    const state2 = captureReviewReadyResult(state1, res2A);
    assert.equal(state2['task-1'].review.reviewHandle, 'handle-1A');
    assert.equal(state2['task-2'].review.reviewHandle, 'handle-2A');

    // Task 1, Rev B (replaces Task 1)
    const res1B: TaskExecutionResult = {
      status: 'executed',
      result: { ...sampleReviewReadyDto, taskId: 'task-1', reviewHandle: 'handle-1B' },
      stateSynchronized: true
    };
    const state3 = captureReviewReadyResult(state2, res1B);
    assert.equal(state3['task-1'].review.reviewHandle, 'handle-1B', 'Newer confirmed review must replace earlier record');
    assert.equal(state3['task-2'].review.reviewHandle, 'handle-2A', 'Different task record must remain intact');
  });

  test('exact DTO preservation: identity, workerResult, source, buildTest, commands, and hashes', { timeout: 5000 }, () => {
    const initial: Record<string, AgentHubReviewSessionRecord> = {};
    const executedResult: TaskExecutionResult = {
      status: 'executed',
      result: sampleReviewReadyDto,
      stateSynchronized: true
    };

    const next = captureReviewReadyResult(initial, executedResult);
    const captured = next['task-100'].review;

    assert.equal(captured.reviewHandle, sampleReviewReadyDto.reviewHandle);
    assert.equal(captured.reviewBundleSha256, sampleReviewReadyDto.reviewBundleSha256);
    assert.equal(captured.taskId, sampleReviewReadyDto.taskId);
    assert.equal(captured.assignmentId, sampleReviewReadyDto.assignmentId);
    assert.equal(captured.agentId, sampleReviewReadyDto.agentId);
    assert.equal(captured.providerId, sampleReviewReadyDto.providerId);
    assert.deepEqual(captured.workerResult, sampleReviewReadyDto.workerResult);
    assert.deepEqual(captured.source, sampleReviewReadyDto.source);
    assert.deepEqual(captured.buildTest, sampleReviewReadyDto.buildTest);
    assert.equal(captured.evidenceSha256, sampleReviewReadyDto.evidenceSha256);
  });

  test('4096 changed paths: capture retains exact length and ordering', { timeout: 5000 }, () => {
    const paths4096 = Array.from({ length: 4096 }, (_, i) => `src/file_${i}.ts`);
    const customReview: ExecuteReviewReadyDto = {
      ...sampleReviewReadyDto,
      source: {
        ...sampleReviewReadyDto.source,
        changedPaths: paths4096
      }
    };

    const next = captureReviewReadyResult({}, {
      status: 'executed',
      result: customReview,
      stateSynchronized: true
    });

    const stored = next['task-100'].review.source.changedPaths;
    assert.equal(stored.length, 4096);
    assert.equal(stored[0], 'src/file_0.ts');
    assert.equal(stored[4095], 'src/file_4095.ts');
  });

  test('NUL preview preservation: exact NUL character preserved in store; visual helper substitutes ␀', { timeout: 5000 }, () => {
    const rawStdout = 'before\0after';
    const rawStderr = '\0error\0';

    const customReview: ExecuteReviewReadyDto = {
      ...sampleReviewReadyDto,
      buildTest: {
        ...sampleReviewReadyDto.buildTest,
        commands: [
          {
            id: 'cmd-nul',
            phase: 'build',
            outcome: 'passed',
            stdoutPreview: rawStdout,
            stderrPreview: rawStderr
          }
        ]
      }
    };

    const next = captureReviewReadyResult({}, {
      status: 'executed',
      result: customReview,
      stateSynchronized: true
    });

    const storedCmd = next['task-100'].review.buildTest.commands[0];
    // Canonical store preserves exact NUL
    assert.equal(storedCmd.stdoutPreview, 'before\0after');
    assert.equal(storedCmd.stderrPreview, '\0error\0');

    // Visual formatting helper substitutes ␀ without altering canonical string
    assert.equal(formatDisplayPreview(storedCmd.stdoutPreview), 'before␀after');
    assert.equal(formatDisplayPreview(storedCmd.stderrPreview), '␀error␀');
    assert.equal(storedCmd.stdoutPreview, 'before\0after', 'Canonical must not be mutated');
  });

  test('Unicode preservation: non-ASCII characters preserved without normalization or stripping', { timeout: 5000 }, () => {
    const unicodeSummary = '🚀 优化编译器：支持 UTF-8 符号与 Emoji ✨';
    const customReview: ExecuteReviewReadyDto = {
      ...sampleReviewReadyDto,
      workerResult: {
        ...sampleReviewReadyDto.workerResult,
        summary: unicodeSummary
      }
    };

    const next = captureReviewReadyResult({}, {
      status: 'executed',
      result: customReview,
      stateSynchronized: true
    });

    assert.equal(next['task-100'].review.workerResult.summary, unicodeSummary);
  });

  test('optional fields: committedPatch and exitCode formatting handle presence and absence', { timeout: 5000 }, () => {
    // exitCode
    assert.equal(formatExitCode(0), '0');
    assert.equal(formatExitCode(1), '1');
    assert.equal(formatExitCode(undefined), 'Not provided');
    assert.equal(formatExitCode(null), 'Not provided');

    // committedPatch
    assert.equal(formatCommittedPatch('diff content'), 'diff content');
    assert.equal(formatCommittedPatch(undefined), 'No committed patch value returned.');
    assert.equal(formatCommittedPatch(''), 'No committed patch value returned.');
  });

  test('architecture guard: Review session store does not use persistent browser/disk APIs', { timeout: 5000 }, () => {
    const storePath = path.resolve(
      __dirname,
      '../src/renderer/src/stores/agentHubReviewSessionStore.ts'
    );
    const storeSource = fs.readFileSync(storePath, 'utf-8');

    const forbidden = [
      'localStorage',
      'sessionStorage',
      'IndexedDB',
      'indexedDB',
      'writeFile',
      'readFile',
      'persist(',
      'window.cth'
    ];

    for (const pattern of forbidden) {
      assert.ok(
        !storeSource.includes(pattern),
        `Review session store contains forbidden persistence pattern: ${pattern}`
      );
    }
  });

  test('architecture guard: Mutation allowlist remains createTask + executeTask only', { timeout: 5000 }, () => {
    const ipcPath = path.resolve(__dirname, '../src/main/agenthub/AgentHubIpc.ts');
    const ipcSource = fs.readFileSync(ipcPath, 'utf-8');

    const preloadPath = path.resolve(__dirname, '../src/preload/index.ts');
    const preloadSource = fs.readFileSync(preloadPath, 'utf-8');

    const forbiddenMutations = [
      'reviewDecision',
      'approveReview',
      'rejectReview',
      'requestRevision',
      '/decision',
      'agenthub:review',
      'agenthub:merge'
    ];

    for (const mutation of forbiddenMutations) {
      assert.ok(
        !ipcSource.includes(mutation),
        `AgentHubIpc.ts contains forbidden review mutation: ${mutation}`
      );
      assert.ok(
        !preloadSource.includes(mutation),
        `preload index.ts contains forbidden review mutation: ${mutation}`
      );
    }
  });

  test('architecture guard: Review modal uses safe text rendering and no PTY/shell authority', { timeout: 5000 }, () => {
    const modalPath = path.resolve(
      __dirname,
      '../src/renderer/src/components/AgentHubReviewEvidenceModal.tsx'
    );
    const modalSource = fs.readFileSync(modalPath, 'utf-8');

    const forbidden = [
      'dangerouslySetInnerHTML',
      'child_process',
      'spawnPty',
      'writePty',
      'worktreePath',
      'repositoryRoot'
    ];

    for (const pattern of forbidden) {
      assert.ok(
        !modalSource.includes(pattern),
        `Review modal contains forbidden pattern: ${pattern}`
      );
    }
  });

  test('session store lifecycle: initial state is empty and resets cleanly on clearSession', { timeout: 5000 }, () => {
    useAgentHubReviewSessionStore.getState().clearSession();

    assert.deepEqual(useAgentHubReviewSessionStore.getState().reviewReadyByTaskId, {});
    assert.equal(useAgentHubReviewSessionStore.getState().selectedReviewTaskId, null);
    assert.equal(useAgentHubReviewSessionStore.getState().isModalOpen, false);

    // Capture execution result via store action
    useAgentHubReviewSessionStore.getState().captureExecutionResult({
      status: 'executed',
      result: sampleReviewReadyDto,
      stateSynchronized: true
    });

    assert.ok(useAgentHubReviewSessionStore.getState().reviewReadyByTaskId['task-100']);
    assert.equal(useAgentHubReviewSessionStore.getState().selectedReviewTaskId, 'task-100');

    // Open and close modal
    useAgentHubReviewSessionStore.getState().openModal();
    assert.equal(useAgentHubReviewSessionStore.getState().isModalOpen, true);
    useAgentHubReviewSessionStore.getState().closeModal();
    assert.equal(useAgentHubReviewSessionStore.getState().isModalOpen, false);

    // Clear session resets everything
    useAgentHubReviewSessionStore.getState().clearSession();
    assert.deepEqual(useAgentHubReviewSessionStore.getState().reviewReadyByTaskId, {});
    assert.equal(useAgentHubReviewSessionStore.getState().selectedReviewTaskId, null);
  });
});
