import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { AgentHubConnection, type StateCommitResult } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubTaskExecution } from '../src/main/agenthub/AgentHubTaskExecution';
import {
  snapshotExecuteTaskInput,
  snapshotExecuteTaskRequest,
  snapshotExecuteTaskResult,
  snapshotExecuteReviewReadyDto,
  snapshotExecuteTerminalLifecycleDto,
  AgentHubValidationError,
  type ExecuteTaskInputDto
} from '../src/shared/agenthubTypes';
import { TaskExecutionIdLifecycle, InvalidExecutionTransitionError } from '../src/shared/agenthubExecutionLifecycle';

const HEX64 = 'a'.repeat(64);
const OID40 = 'b'.repeat(40);

const validInput: ExecuteTaskInputDto = {
  baseRef: 'main',
  prompt: 'Implement the change\nwith a second line'
};

function validReviewReady(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcome: 'review-ready',
    reviewHandle: HEX64,
    reviewBundleSha256: HEX64,
    taskId: 'task-1',
    assignmentId: 'asg-1',
    agentId: 'agent-1',
    providerId: 'codex',
    workerResult: { summary: 'done', blockers: [], questions: [], risks: [], notes: [] },
    source: {
      branchName: 'agenthub/task-1',
      baseCommit: OID40,
      headCommit: HEX64,
      changedPaths: ['src/a.ts'],
      changeSetSha256: HEX64
    },
    buildTest: {
      build: 'passed',
      test: 'not-run',
      outcome: 'passed',
      commands: [{
        id: 'cmd-1',
        phase: 'build',
        outcome: 'passed',
        stdoutPreview: '',
        stderrPreview: ''
      }]
    },
    evidenceSha256: HEX64,
    ...overrides
  };
}

function validTerminal(outcome: 'blocked' | 'waiting-input' | 'failed'): Record<string, unknown> {
  return {
    outcome,
    taskId: 'task-1',
    assignmentId: 'asg-1',
    lifecycleSha256: HEX64
  };
}

function envelope(data: unknown): string {
  return JSON.stringify({ ok: true, requestId: 'r1', data });
}

describe('AgentHub Runtime Execute Task Input Validation', () => {
  test('valid baseRef/prompt accepted and snapshot is detached/frozen', { timeout: 5000 }, () => {
    const raw = { ...validInput };
    const validated = snapshotExecuteTaskInput(raw);
    assert.equal(validated.baseRef, 'main');
    assert.equal(validated.prompt, validInput.prompt);
    assert.ok(Object.isFrozen(validated));
    raw.baseRef = 'mutated';
    assert.equal(validated.baseRef, 'main');
  });

  test('extra input keys rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, agentId: 'x' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('blank baseRef rejected without silent trimming', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, baseRef: '   ' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    const spaced = snapshotExecuteTaskInput({ ...validInput, baseRef: '  main  ' });
    assert.equal(spaced.baseRef, '  main  ');
  });

  test('baseRef >1024 UTF-8 bytes rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, baseRef: 'a'.repeat(1025) }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('baseRef NUL/CR/LF rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, baseRef: 'main\0' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, baseRef: 'main\r' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, baseRef: 'main\n' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('blank prompt rejected; NUL rejected; multiline accepted', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, prompt: '  \t  ' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, prompt: 'hello\0world' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    const multiline = snapshotExecuteTaskInput({ ...validInput, prompt: 'line1\nline2\r\nline3' });
    assert.equal(multiline.prompt, 'line1\nline2\r\nline3');
  });

  test('prompt UTF-8 field limit enforced', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskInput({ ...validInput, prompt: 'x'.repeat(1024 * 1024 + 1) }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });
});

describe('AgentHub Execute IPC request envelope', () => {
  test('valid {executionId, taskId, input} accepted; extras rejected', { timeout: 5000 }, () => {
    const valid = snapshotExecuteTaskRequest({
      executionId: 'exec-1',
      taskId: 'task-1',
      input: validInput
    });
    assert.equal(valid.executionId, 'exec-1');
    assert.equal(valid.taskId, 'task-1');
    assert.ok(Object.isFrozen(valid));

    const extras = [
      { executionId: 'e', taskId: 't', input: validInput, headers: {} },
      { executionId: 'e', taskId: 't', input: validInput, path: '/api/v1/tasks/t/execute' },
      { executionId: 'e', taskId: 't', input: validInput, method: 'POST' },
      { executionId: 'e', taskId: 't', input: validInput, url: 'http://127.0.0.1:3210' },
      { executionId: 'e', taskId: 't', input: validInput, idempotencyKey: 'x' },
      { executionId: 'e', taskId: 't', input: validInput, providerId: 'codex' },
      { executionId: 'e', taskId: 't', input: validInput, model: 'gpt' },
      { executionId: 'e', taskId: 't', input: validInput, agentId: 'a' },
      { executionId: 'e', taskId: 't', input: validInput, reviewHandle: HEX64 }
    ];
    for (const raw of extras) {
      assert.throws(
        () => snapshotExecuteTaskRequest(raw),
        (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST'
      );
    }

    assert.throws(() => snapshotExecuteTaskRequest(null), (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST');
    assert.throws(() => snapshotExecuteTaskRequest([]), (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST');
    assert.throws(() => snapshotExecuteTaskRequest('nope'), (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST');
  });

  test('invalid taskId and malformed input rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteTaskRequest({ executionId: 'e', taskId: 'task\nid', input: validInput }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST'
    );
    assert.throws(
      () => snapshotExecuteTaskRequest({ executionId: 'e', taskId: 'task-1', input: { ...validInput, extra: true } }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('rejected request sends zero HTTP', { timeout: 5000 }, async () => {
    let hit = false;
    const server = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: { projects: [], agents: [], tasks: [], assignments: [] } })
    } as unknown as AgentHubConnection;
    const execution = new AgentHubTaskExecution(connection);
    try {
      const extra = await execution.executeTask({
        executionId: 'exec-extra',
        taskId: 'task-1',
        input: validInput,
        idempotencyKey: 'injected'
      } as any);
      assert.equal(extra.status, 'failed');
      const badId = await execution.executeTask({
        executionId: 'exec-1',
        taskId: 'task\r1',
        input: validInput
      });
      assert.equal(badId.status, 'failed');
      assert.equal(hit, false);
    } finally {
      execution.stop();
      server.close();
    }
  });
});

describe('AgentHub Execute review-ready and terminal DTOs', () => {
  test('valid review-ready with and without committedPatch', { timeout: 5000 }, () => {
    const without = snapshotExecuteReviewReadyDto(validReviewReady());
    assert.equal(without.outcome, 'review-ready');
    assert.equal('committedPatch' in without.source, false);
    assert.ok(Object.isFrozen(without));
    assert.ok(Object.isFrozen(without.workerResult));

    const withPatch = snapshotExecuteReviewReadyDto(validReviewReady({
      source: {
        branchName: 'agenthub/task-1',
        baseCommit: OID40,
        headCommit: HEX64,
        changedPaths: ['src/a.ts'],
        changeSetSha256: HEX64,
        committedPatch: 'diff --git a/src/a.ts b/src/a.ts'
      }
    }));
    assert.equal(withPatch.source.committedPatch, 'diff --git a/src/a.ts b/src/a.ts');
  });

  test('malformed hashes, OIDs, and reviewHandle rejected', { timeout: 5000 }, () => {
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({ reviewHandle: '' })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({ reviewBundleSha256: 'ZZ' + 'a'.repeat(62) })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      source: {
        branchName: 'agenthub/task-1',
        baseCommit: 'not-an-oid',
        headCommit: HEX64,
        changedPaths: [],
        changeSetSha256: HEX64
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({ evidenceSha256: 'A'.repeat(64) })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
  });

  test('invalid build/test/evidence/command enums rejected', { timeout: 5000 }, () => {
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: { build: 'ok', test: 'not-run', outcome: 'passed', commands: [] }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: { build: 'passed', test: 'skipped', outcome: 'passed', commands: [] }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: { build: 'passed', test: 'not-run', outcome: 'flaky', commands: [] }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: {
        build: 'passed',
        test: 'not-run',
        outcome: 'passed',
        commands: [{ id: 'c', phase: 'lint', outcome: 'passed', stdoutPreview: '', stderrPreview: '' }]
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: {
        build: 'passed',
        test: 'not-run',
        outcome: 'passed',
        commands: [{ id: 'c', phase: 'build', outcome: 'crashed', stdoutPreview: '', stderrPreview: '' }]
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
  });

  test('missing command exitCode accepted; non-integer rejected', { timeout: 5000 }, () => {
    const ok = snapshotExecuteReviewReadyDto(validReviewReady());
    assert.equal('exitCode' in ok.buildTest.commands[0], false);

    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: {
        build: 'passed',
        test: 'not-run',
        outcome: 'passed',
        commands: [{ id: 'c', phase: 'build', outcome: 'passed', exitCode: 1.5, stdoutPreview: '', stderrPreview: '' }]
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
  });

  test('wrong array types and unknown private fields rejected', { timeout: 5000 }, () => {
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      workerResult: { summary: 'x', blockers: 'nope', questions: [], risks: [], notes: [] }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      source: {
        branchName: 'b',
        baseCommit: OID40,
        headCommit: HEX64,
        changedPaths: 'src/a.ts',
        changeSetSha256: HEX64
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({ repositoryRoot: '/secret' })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      source: {
        branchName: 'b',
        baseCommit: OID40,
        headCommit: HEX64,
        changedPaths: [],
        changeSetSha256: HEX64,
        committedPatch: null
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
  });

  test('terminal lifecycle DTOs validate exact enum and hashes', { timeout: 5000 }, () => {
    for (const outcome of ['blocked', 'waiting-input', 'failed'] as const) {
      const dto = snapshotExecuteTerminalLifecycleDto(validTerminal(outcome));
      assert.equal(dto.outcome, outcome);
      assert.ok(Object.isFrozen(dto));
    }
    assert.throws(() => snapshotExecuteTaskResult({ outcome: 'queued' }), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
    assert.throws(() => snapshotExecuteTerminalLifecycleDto({
      ...validTerminal('blocked'),
      lifecycleSha256: 'nope'
    }), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
  });

  test('changedPaths 4096 accepted exactly; 4097 rejected', { timeout: 5000 }, () => {
    const paths4096 = Array.from({ length: 4096 }, (_, i) => `src/f${String(i).padStart(4, '0')}.ts`);
    const accepted = snapshotExecuteReviewReadyDto(validReviewReady({
      source: {
        branchName: 'agenthub/task-1',
        baseCommit: OID40,
        headCommit: HEX64,
        changedPaths: paths4096,
        changeSetSha256: HEX64
      }
    }));
    assert.equal(accepted.source.changedPaths.length, 4096);
    assert.equal(accepted.source.changedPaths[0], 'src/f0000.ts');
    assert.equal(accepted.source.changedPaths[4095], 'src/f4095.ts');

    assert.throws(() => snapshotExecuteReviewReadyDto(validReviewReady({
      source: {
        branchName: 'agenthub/task-1',
        baseCommit: OID40,
        headCommit: HEX64,
        changedPaths: [...paths4096, 'src/extra.ts'],
        changeSetSha256: HEX64
      }
    })), (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT');
  });

  test('worker Unicode character limits and exact item counts are accepted', { timeout: 5000 }, () => {
    const summary = '项'.repeat(8192);
    const item = '危'.repeat(4096);
    const accepted = snapshotExecuteReviewReadyDto(validReviewReady({
      workerResult: {
        summary,
        blockers: [],
        questions: [],
        risks: Array.from({ length: 64 }, () => item),
        notes: Array.from({ length: 128 }, () => item)
      }
    }));
    assert.equal(accepted.workerResult.summary.length, 8192);
    assert.equal(accepted.workerResult.blockers.length, 0);
    assert.equal(accepted.workerResult.questions.length, 0);
    assert.equal(accepted.workerResult.risks.length, 64);
    assert.equal(accepted.workerResult.notes.length, 128);
    assert.equal(accepted.workerResult.risks[0], item);
  });

  test('backend-valid worker NUL is preserved exactly and oversize remains rejected', { timeout: 5000 }, () => {
    const withNul = snapshotExecuteReviewReadyDto(validReviewReady({
      workerResult: {
        summary: 'done\0with marker',
        blockers: [],
        questions: [],
        risks: ['risk\0y'],
        notes: ['note\0x']
      }
    }));
    assert.equal(withNul.workerResult.summary, 'done\0with marker');
    assert.equal(withNul.workerResult.risks[0], 'risk\0y');
    assert.equal(withNul.workerResult.notes[0], 'note\0x');

    const nulOnly = snapshotExecuteReviewReadyDto(validReviewReady({
      workerResult: { summary: '\0', blockers: [], questions: [], risks: ['x\0'], notes: ['\0'] }
    }));
    assert.equal(nulOnly.workerResult.summary, '\0');
    assert.equal(nulOnly.workerResult.notes[0], '\0');

    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: '   ', blockers: [], questions: [], risks: [], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: ['   '], questions: [], risks: [], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: [], questions: ['\t'], risks: [], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: [], questions: [], risks: ['\n'], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: [], questions: [], risks: [], notes: ['   '] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'x'.repeat(8193), blockers: [], questions: [], risks: [], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: [], questions: [], risks: ['y'.repeat(4097)], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
  });

  test('review-ready worker, handle, branch, paths, and command invariants', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: ['block\0er'], questions: [], risks: [], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        workerResult: { summary: 'ok', blockers: [], questions: ['ask\0me'], risks: [], notes: [] }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );

    const otherSha = 'b'.repeat(64);
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({ reviewHandle: 'not-a-sha' })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({ reviewHandle: otherSha })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );

    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({ taskId: 'bad task' })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({ taskId: 'CON' })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        source: {
          branchName: 'agenthub/other-task',
          baseCommit: OID40,
          headCommit: HEX64,
          changedPaths: ['src/a.ts'],
          changeSetSha256: HEX64
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );

    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        source: {
          branchName: 'agenthub/task-1',
          baseCommit: OID40,
          headCommit: HEX64,
          changedPaths: ['src/a.ts', 'src/a.ts'],
          changeSetSha256: HEX64
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        source: {
          branchName: 'agenthub/task-1',
          baseCommit: OID40,
          headCommit: HEX64,
          changedPaths: ['src/b.ts', 'src/a.ts'],
          changeSetSha256: HEX64
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );

    const longId = 'c'.repeat(65);
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        buildTest: {
          build: 'passed',
          test: 'not-run',
          outcome: 'passed',
          commands: [{ id: longId, phase: 'build', outcome: 'passed', stdoutPreview: '', stderrPreview: '' }]
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        buildTest: {
          build: 'passed',
          test: 'not-run',
          outcome: 'passed',
          commands: [{ id: 'has space', phase: 'build', outcome: 'passed', stdoutPreview: '', stderrPreview: '' }]
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        buildTest: {
          build: 'passed',
          test: 'not-run',
          outcome: 'passed',
          commands: [{ id: 'has/slash', phase: 'build', outcome: 'passed', stdoutPreview: '', stderrPreview: '' }]
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        buildTest: {
          build: 'passed',
          test: 'not-run',
          outcome: 'passed',
          commands: [
            { id: 'cmd-1', phase: 'build', outcome: 'passed', stdoutPreview: '', stderrPreview: '' },
            { id: 'cmd-1', phase: 'test', outcome: 'passed', stdoutPreview: '', stderrPreview: '' }
          ]
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );

    const maxExit = snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: {
        build: 'passed',
        test: 'not-run',
        outcome: 'passed',
        commands: [{ id: 'cmd-1', phase: 'build', outcome: 'passed', exitCode: 2147483647, stdoutPreview: '', stderrPreview: '' }]
      }
    }));
    assert.equal(maxExit.buildTest.commands[0].exitCode, 2147483647);
    const minExit = snapshotExecuteReviewReadyDto(validReviewReady({
      buildTest: {
        build: 'passed',
        test: 'not-run',
        outcome: 'passed',
        commands: [{ id: 'cmd-1', phase: 'build', outcome: 'passed', exitCode: -2147483648, stdoutPreview: '', stderrPreview: '' }]
      }
    }));
    assert.equal(minExit.buildTest.commands[0].exitCode, -2147483648);
    assert.throws(
      () => snapshotExecuteReviewReadyDto(validReviewReady({
        buildTest: {
          build: 'passed',
          test: 'not-run',
          outcome: 'passed',
          commands: [{ id: 'cmd-1', phase: 'build', outcome: 'passed', exitCode: 2147483648, stdoutPreview: '', stderrPreview: '' }]
        }
      })),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );

    assert.throws(
      () => snapshotExecuteTerminalLifecycleDto({
        ...validTerminal('blocked'),
        reviewEvidenceSha256: HEX64
      }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteTerminalLifecycleDto({
        ...validTerminal('blocked'),
        merge: { ok: true }
      }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
    assert.throws(
      () => snapshotExecuteTerminalLifecycleDto({
        ...validTerminal('blocked'),
        mergeGate: { ok: true }
      }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_EXECUTE_RESULT'
    );
  });
});

describe('AgentHub Task Execution service', () => {
  function stubConnection(
    baseUrl: string,
    disposition: StateCommitResult['disposition'] = 'committed'
  ): { connection: AgentHubConnection; syncCalls: { n: number } } {
    const syncCalls = { n: 0 };
    const connection = {
      restClient: new AgentHubRestClient({ baseUrl }),
      syncAuthoritativeState: async () => {
        syncCalls.n++;
        return { disposition, snapshot: disposition === 'superseded-uncommitted' ? null : { projects: [], agents: [], tasks: [], assignments: [] } };
      }
    } as unknown as AgentHubConnection;
    return { connection, syncCalls };
  }

  test('same executionId + same body reuses desktop-execute key', { timeout: 5000 }, async () => {
    const keys: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url?.endsWith('/execute')) {
        keys.push(String(req.headers['idempotency-key'] || ''));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(validReviewReady()));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const req = { executionId: 'exec-same', taskId: 'task-1', input: validInput };
      const r1 = await execution.executeTask(req);
      const r2 = await execution.executeTask(req);
      assert.equal(r1.status, 'executed');
      assert.equal(r2.status, 'executed');
      assert.deepEqual(keys, ['desktop-execute:exec-same']);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('same executionId with changed taskId/baseRef/prompt is local IDEMPOTENCY_CONFLICT', { timeout: 5000 }, async () => {
    let posts = 0;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        posts++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(validTerminal('blocked')));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const first = await execution.executeTask({ executionId: 'exec-conflict', taskId: 'task-1', input: validInput });
      assert.equal(first.status, 'executed');
      posts = 0;

      const changedTask = await execution.executeTask({ executionId: 'exec-conflict', taskId: 'task-2', input: validInput });
      assert.equal(changedTask.status, 'failed');
      if (changedTask.status === 'failed') assert.equal(changedTask.error.code, 'IDEMPOTENCY_CONFLICT');

      const changedRef = await execution.executeTask({
        executionId: 'exec-conflict',
        taskId: 'task-1',
        input: { ...validInput, baseRef: 'develop' }
      });
      assert.equal(changedRef.status, 'failed');
      if (changedRef.status === 'failed') assert.equal(changedRef.error.code, 'IDEMPOTENCY_CONFLICT');

      const changedPrompt = await execution.executeTask({
        executionId: 'exec-conflict',
        taskId: 'task-1',
        input: { ...validInput, prompt: 'different prompt' }
      });
      assert.equal(changedPrompt.status, 'failed');
      if (changedPrompt.status === 'failed') assert.equal(changedPrompt.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(posts, 0);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('duplicate in-flight execute coalesces to one POST', { timeout: 5000 }, async () => {
    let posts = 0;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        posts++;
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(envelope(validTerminal('waiting-input')));
        }, 80);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const req = { executionId: 'exec-coalesce', taskId: 'task-1', input: validInput };
      const [a, b] = await Promise.all([execution.executeTask(req), execution.executeTask(req)]);
      assert.equal(a.status, 'executed');
      assert.equal(b.status, 'executed');
      assert.equal(posts, 1);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('HTTP 200 lifecycle outcomes are executed, not transport failed', { timeout: 5000 }, async () => {
    const cases = [
      { data: validReviewReady(), outcome: 'review-ready' },
      { data: validTerminal('blocked'), outcome: 'blocked' },
      { data: validTerminal('waiting-input'), outcome: 'waiting-input' },
      { data: validTerminal('failed'), outcome: 'failed' }
    ];
    for (const item of cases) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(item.data));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };
      const { connection, syncCalls } = stubConnection(`http://127.0.0.1:${addr.port}`);
      const execution = new AgentHubTaskExecution(connection);
      try {
        const res = await execution.executeTask({
          executionId: `exec-${item.outcome}`,
          taskId: 'task-1',
          input: validInput
        });
        assert.equal(res.status, 'executed');
        if (res.status === 'executed') {
          assert.equal(res.result.outcome, item.outcome);
          assert.equal(res.stateSynchronized, true);
        }
        assert.equal(syncCalls.n, 1);
      } finally {
        execution.stop();
        server.close();
      }
    }
  });

  test('definitive non-2xx is failed and not retryable', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'missing',
        error: { code: 'AGENTHUB_API_NOT_FOUND', message: 'task missing' }
      }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection, syncCalls } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const res = await execution.executeTask({
        executionId: 'exec-missing',
        taskId: 'task-1',
        input: validInput
      });
      assert.equal(res.status, 'failed');
      if (res.status === 'failed') {
        assert.equal(res.retryable, false);
        assert.equal(res.error.code, 'AGENTHUB_API_NOT_FOUND');
      }
      assert.equal(syncCalls.n, 0);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('network failure and timeout are ambiguous', { timeout: 8000 }, async () => {
    const closed = new AgentHubTaskExecution({
      restClient: new AgentHubRestClient({ baseUrl: 'http://127.0.0.1:1' }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection);
    const net = await closed.executeTask({ executionId: 'exec-net', taskId: 'task-1', input: validInput });
    assert.equal(net.status, 'ambiguous');
    if (net.status === 'ambiguous') {
      assert.equal(net.retryable, true);
      assert.equal(net.error.code, 'NETWORK_ERROR');
    }
    closed.stop();

    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(validTerminal('blocked')));
      }, 80);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const slow = new AgentHubTaskExecution({
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}`, timeoutMs: 20 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection);
    try {
      const timed = await slow.executeTask({ executionId: 'exec-timeout', taskId: 'task-1', input: validInput });
      assert.equal(timed.status, 'ambiguous');
      if (timed.status === 'ambiguous') assert.equal(timed.error.code, 'TIMEOUT');
    } finally {
      slow.stop();
      server.close();
    }
  });

  test('state commit dispositions map to stateSynchronized correctly', { timeout: 5000 }, async () => {
    const cases: Array<[StateCommitResult['disposition'], boolean]> = [
      ['committed', true],
      ['superseded-by-committed', true],
      ['superseded-uncommitted', false]
    ];
    for (const [disposition, synchronized] of cases) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(validReviewReady()));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };
      const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`, disposition);
      const execution = new AgentHubTaskExecution(connection);
      try {
        const res = await execution.executeTask({
          executionId: `exec-${disposition}`,
          taskId: 'task-1',
          input: validInput
        });
        assert.equal(res.status, 'executed');
        if (res.status === 'executed') {
          assert.equal(res.stateSynchronized, synchronized);
          assert.equal(res.result.outcome, 'review-ready');
        }
      } finally {
        execution.stop();
        server.close();
      }
    }
  });

  test('execute success + real /state failure preserves executed result and degrades connection', { timeout: 5000 }, async () => {
    let armed = false;
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        if (!armed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, requestId: 's0', data: { projects: [], agents: [], tasks: [], assignments: [] } }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          requestId: 's-fail',
          error: { code: 'SERVER_ERROR', message: 'state failed' }
        }));
        return;
      }
      if (req.method === 'POST' && req.url?.endsWith('/execute')) {
        armed = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(validReviewReady()));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const execution = new AgentHubTaskExecution(connection);
    try {
      await connection.start();
      const wait = Date.now();
      while (Date.now() - wait < 2000) {
        if (connection.getState().snapshot) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const res = await execution.executeTask({
        executionId: 'exec-sync-fail',
        taskId: 'task-1',
        input: validInput
      });
      assert.equal(res.status, 'executed');
      if (res.status === 'executed') {
        assert.equal(res.stateSynchronized, false);
        assert.equal(res.result.outcome, 'review-ready');
        assert.ok(res.warning);
      }
      assert.equal(connection.getState().connection, 'degraded');
    } finally {
      execution.stop();
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('shutdown abort of in-flight execute is ambiguous and does not retry', { timeout: 5000 }, async () => {
    let posts = 0;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        posts++;
        setTimeout(() => {
          try {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(envelope(validReviewReady()));
          } catch {
            // aborted
          }
        }, 200);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const pending = execution.executeTask({
        executionId: 'exec-stop',
        taskId: 'task-1',
        input: validInput
      });
      await new Promise((r) => setTimeout(r, 30));
      execution.stop();
      const res = await pending;
      assert.equal(res.status, 'ambiguous');
      if (res.status === 'ambiguous') assert.equal(res.error.code, 'ABORTED');
      assert.equal(posts, 1);
      const after = await execution.executeTask({
        executionId: 'exec-stop-2',
        taskId: 'task-1',
        input: validInput
      });
      assert.equal(after.status, 'failed');
      if (after.status === 'failed') assert.equal(after.error.code, 'STOPPED');
      assert.equal(posts, 1);
    } finally {
      server.close();
    }
  });

  test('HTTP 200 malformed execute DTO is ambiguous and retry reuses the same key', { timeout: 5000 }, async () => {
    const keys: string[] = [];
    let n = 0;
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      keys.push(String(req.headers['idempotency-key'] || ''));
      n++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (n === 1) {
        res.end(JSON.stringify({ ok: true, requestId: 'r', data: { outcome: 'blocked', taskId: 'task-1' } }));
        return;
      }
      res.end(envelope(validTerminal('blocked')));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    const req = { executionId: 'exec-malformed-dto', taskId: 'task-1', input: validInput };
    try {
      const first = await execution.executeTask(req);
      assert.equal(first.status, 'ambiguous');
      if (first.status === 'ambiguous') assert.equal(first.retryable, true);
      const retry = await execution.executeTask(req);
      assert.equal(retry.status, 'executed');
      assert.deepEqual(keys, ['desktop-execute:exec-malformed-dto', 'desktop-execute:exec-malformed-dto']);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('HTTP 200 malformed JSON/envelope and response overflow after POST are ambiguous', { timeout: 5000 }, async () => {
    const cases: Array<{ name: string; write: (res: http.ServerResponse) => void }> = [
      {
        name: 'json',
        write: (res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{not-json');
        }
      },
      {
        name: 'envelope',
        write: (res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, extra: true, requestId: 'r', data: validTerminal('blocked') }));
        }
      },
      {
        name: 'overflow',
        write: (res) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '9437184' });
          res.end('{"ok":true}');
        }
      }
    ];

    for (const item of cases) {
      let posts = 0;
      const server = http.createServer((req, res) => {
        if (req.method === 'POST') {
          posts++;
          item.write(res);
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };
      const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
      const execution = new AgentHubTaskExecution(connection);
      try {
        const res = await execution.executeTask({
          executionId: `exec-${item.name}`,
          taskId: 'task-1',
          input: validInput
        });
        assert.equal(res.status, 'ambiguous', item.name);
        if (res.status === 'ambiguous') assert.equal(res.retryable, true);
        assert.equal(posts, 1, item.name);
      } finally {
        execution.stop();
        server.close();
      }
    }
  });

  test('local request-body overflow is definitive failed with zero HTTP', { timeout: 5000 }, async () => {
    let hit = false;
    const server = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const res = await execution.executeTask({
        executionId: 'exec-local-overflow',
        taskId: 'task-1',
        input: { baseRef: 'main', prompt: 'x'.repeat(1024 * 1024 - 1) }
      });
      assert.equal(res.status, 'failed');
      if (res.status === 'failed') {
        assert.equal(res.retryable, false);
        assert.equal(res.error.code, 'BODY_OVERFLOW');
      }
      assert.equal(hit, false);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('valid backend-sized review-ready that V0.8.3 rejected is now executed', { timeout: 5000 }, async () => {
    const paths = Array.from({ length: 4096 }, (_, i) => `src/f${String(i).padStart(4, '0')}.ts`);
    const payload = validReviewReady({
      workerResult: {
        summary: '项'.repeat(8192),
        blockers: [],
        questions: [],
        risks: ['危'.repeat(4096)],
        notes: []
      },
      source: {
        branchName: 'agenthub/task-1',
        baseCommit: OID40,
        headCommit: HEX64,
        changedPaths: paths,
        changeSetSha256: HEX64
      }
    });
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(payload));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const res = await execution.executeTask({
        executionId: 'exec-backend-parity',
        taskId: 'task-1',
        input: validInput
      });
      assert.equal(res.status, 'executed');
      if (res.status === 'executed') {
        assert.equal(res.result.outcome, 'review-ready');
        if (res.result.outcome === 'review-ready') {
          assert.equal(res.result.source.changedPaths.length, 4096);
          assert.equal(res.result.workerResult.summary.length, 8192);
        }
      }
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('HTTP 200 review-ready with backend-valid worker NUL is executed', { timeout: 5000 }, async () => {
    const payload = validReviewReady({
      workerResult: {
        summary: 'done\0with marker',
        blockers: [],
        questions: [],
        risks: [],
        notes: []
      }
    });
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(payload));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    try {
      const res = await execution.executeTask({
        executionId: 'exec-worker-nul',
        taskId: 'task-1',
        input: validInput
      });
      assert.equal(res.status, 'executed');
      if (res.status === 'executed' && res.result.outcome === 'review-ready') {
        assert.equal(res.result.workerResult.summary, 'done\0with marker');
      }
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('HTTP 200 review-ready with blank worker summary is ambiguous and retries same key', { timeout: 5000 }, async () => {
    const keys: string[] = [];
    let n = 0;
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      keys.push(String(req.headers['idempotency-key'] || ''));
      n++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (n === 1) {
        res.end(envelope(validReviewReady({
          workerResult: { summary: '   ', blockers: [], questions: [], risks: [], notes: [] }
        })));
        return;
      }
      res.end(envelope(validReviewReady()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${addr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    const req = { executionId: 'exec-blank-summary', taskId: 'task-1', input: validInput };
    try {
      const first = await execution.executeTask(req);
      assert.equal(first.status, 'ambiguous');
      if (first.status === 'ambiguous') assert.equal(first.retryable, true);
      const retry = await execution.executeTask(req);
      assert.equal(retry.status, 'executed');
      assert.deepEqual(keys, ['desktop-execute:exec-blank-summary', 'desktop-execute:exec-blank-summary']);
    } finally {
      execution.stop();
      server.close();
    }
  });

  test('HTTP 200 + ok:false execute is ambiguous; 409 exact error is definitive failed', { timeout: 5000 }, async () => {
    const keys: string[] = [];
    const server200 = http.createServer((req, res) => {
      if (req.method === 'POST') keys.push(String(req.headers['idempotency-key'] || ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'contradiction',
        error: { code: 'UNEXPECTED', message: 'ok false on 200' }
      }));
    });
    await new Promise<void>((r) => server200.listen(0, '127.0.0.1', () => r()));
    const addr200 = server200.address() as { port: number };
    const { connection: conn200 } = stubConnection(`http://127.0.0.1:${addr200.port}`);
    const exec200 = new AgentHubTaskExecution(conn200);
    try {
      const first = await exec200.executeTask({ executionId: 'exec-200-false', taskId: 'task-1', input: validInput });
      assert.equal(first.status, 'ambiguous');
      const retry = await exec200.executeTask({ executionId: 'exec-200-false', taskId: 'task-1', input: validInput });
      assert.equal(retry.status, 'ambiguous');
      assert.deepEqual(keys, ['desktop-execute:exec-200-false', 'desktop-execute:exec-200-false']);
    } finally {
      exec200.stop();
      server200.close();
    }

    let posts = 0;
    const server409 = http.createServer((_req, res) => {
      posts++;
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'conflict',
        error: { code: 'AGENTHUB_API_CONFLICT', message: 'already reserved' }
      }));
    });
    await new Promise<void>((r) => server409.listen(0, '127.0.0.1', () => r()));
    const addr409 = server409.address() as { port: number };
    const { connection: conn409 } = stubConnection(`http://127.0.0.1:${addr409.port}`);
    const exec409 = new AgentHubTaskExecution(conn409);
    try {
      const req = { executionId: 'exec-409', taskId: 'task-1', input: validInput };
      const first = await exec409.executeTask(req);
      assert.equal(first.status, 'failed');
      if (first.status === 'failed') {
        assert.equal(first.retryable, false);
        assert.equal(first.error.code, 'AGENTHUB_API_CONFLICT');
      }
      const replay = await exec409.executeTask(req);
      assert.equal(replay.status, 'failed');
      assert.equal(posts, 1);
    } finally {
      exec409.stop();
      server409.close();
    }
  });

  test('HTTP 409 nested extra error key and HTTP 500 + ok:true are ambiguous', { timeout: 5000 }, async () => {
    const extra = http.createServer((_req, res) => {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'extra',
        error: { code: 'FAIL', message: 'nope', extra: true }
      }));
    });
    await new Promise<void>((r) => extra.listen(0, '127.0.0.1', () => r()));
    const extraAddr = extra.address() as { port: number };
    const { connection: extraConn } = stubConnection(`http://127.0.0.1:${extraAddr.port}`);
    const extraExec = new AgentHubTaskExecution(extraConn);
    try {
      const res = await extraExec.executeTask({ executionId: 'exec-extra-err', taskId: 'task-1', input: validInput });
      assert.equal(res.status, 'ambiguous');
    } finally {
      extraExec.stop();
      extra.close();
    }

    const okTrue = http.createServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, requestId: 'r500', data: validTerminal('failed') }));
    });
    await new Promise<void>((r) => okTrue.listen(0, '127.0.0.1', () => r()));
    const okAddr = okTrue.address() as { port: number };
    const { connection: okConn } = stubConnection(`http://127.0.0.1:${okAddr.port}`);
    const okExec = new AgentHubTaskExecution(okConn);
    try {
      const res = await okExec.executeTask({ executionId: 'exec-500-true', taskId: 'task-1', input: validInput });
      assert.equal(res.status, 'ambiguous');
    } finally {
      okExec.stop();
      okTrue.close();
    }
  });

  test('execute redirect is never followed and remains ambiguous with the same ID', { timeout: 5000 }, async () => {
    let sinkHits = 0;
    const sink = http.createServer((_req, res) => {
      sinkHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(validTerminal('blocked')));
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', () => r()));
    const sinkAddr = sink.address() as { port: number };

    const keys: string[] = [];
    const origin = http.createServer((req, res) => {
      if (req.method === 'POST') keys.push(String(req.headers['idempotency-key'] || ''));
      res.writeHead(307, { Location: `http://127.0.0.1:${sinkAddr.port}${req.url}` });
      res.end();
    });
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()));
    const originAddr = origin.address() as { port: number };
    const { connection } = stubConnection(`http://127.0.0.1:${originAddr.port}`);
    const execution = new AgentHubTaskExecution(connection);
    const req = { executionId: 'exec-redirect', taskId: 'task-1', input: validInput };
    try {
      const first = await execution.executeTask(req);
      assert.equal(first.status, 'ambiguous');
      const retry = await execution.executeTask(req);
      assert.equal(retry.status, 'ambiguous');
      assert.equal(sinkHits, 0);
      assert.deepEqual(keys, ['desktop-execute:exec-redirect', 'desktop-execute:exec-redirect']);
    } finally {
      execution.stop();
      origin.close();
      sink.close();
    }
  });
});

describe('AgentHub Task Execution ID lifecycle', () => {
  test('ambiguous retry preserves ID; executed/failed rotate; edits after ambiguous rotate', { timeout: 5000 }, () => {
    let n = 0;
    const life = new TaskExecutionIdLifecycle(() => `id-${++n}`);
    assert.equal(life.id, 'id-1');
    assert.equal(life.beginExecute(), 'id-1');
    assert.equal(life.onResult('ambiguous'), 'id-1');
    assert.throws(() => life.beginExecute(), InvalidExecutionTransitionError);
    assert.equal(life.beginRetry(), 'id-1');
    assert.equal(life.onResult('executed'), 'id-2');
    assert.equal(life.beginExecute(), 'id-2');
    assert.equal(life.onResult('failed'), 'id-3');
    assert.equal(life.beginExecute(), 'id-3');

    const life2 = new TaskExecutionIdLifecycle(() => `id-${++n}`);
    life2.beginExecute();
    life2.onResult('ambiguous');
    const afterEdit = life2.onEdit();
    assert.equal(afterEdit, 'id-5');
    assert.equal(life2.phase, 'idle');
    assert.equal(life2.beginExecute(), 'id-5');
  });
});

describe('AgentHub Task Execution ownership and UI allowlist', () => {
  test('execution service does not own snapshot commits or generic POST', { timeout: 5000 }, () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/main/agenthub/AgentHubTaskExecution.ts'), 'utf8');
    const restSrc = fs.readFileSync(path.join(process.cwd(), 'src/main/agenthub/AgentHubRestClient.ts'), 'utf8');
    assert.equal(src.includes('cache.updateSnapshot'), false);
    assert.equal(src.includes('restClient.state'), false);
    assert.match(src, /syncAuthoritativeState/);
    assert.match(src, /desktop-execute:/);
    assert.equal(src.includes('scheduleTask'), false);
    assert.equal(src.includes('worktree'), false);
    assert.match(restSrc, /createTask\(/);
    assert.match(restSrc, /executeTask\(/);
    assert.equal(restSrc.includes('/api/v1/reviews/'), false);
    assert.equal(restSrc.includes('/merge'), false);
  });

  test('execute UI has no review mutation actions and blocks normal Execute while ambiguous', { timeout: 5000 }, () => {
    const ui = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/components/AgentHubExecuteModal.tsx'), 'utf8');
    assert.match(ui, /Execute/);
    assert.match(ui, /Retry Same Execution/);
    assert.match(ui, /status !== 'ambiguous'/);
    assert.match(ui, /status === 'executing' \|\| status === 'ambiguous'/);
    assert.match(ui, /selectedTaskInSnapshot/);
    assert.match(ui, /tasks\.some\(\(task\) => task\.taskId === taskId\)/);
    assert.match(ui, /IPC result was lost|Task execution outcome is unknown/);
    assert.equal(ui.includes('Accept'), false);
    assert.equal(ui.includes('Request Revision'), false);
    assert.equal(ui.includes('Approve'), false);
    assert.equal(ui.includes('Merge'), false);
  });
});
