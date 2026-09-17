import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubTaskSubmission } from '../src/main/agenthub/AgentHubTaskSubmission';
import {
  snapshotCreateTaskInput,
  snapshotCreateTaskRequest,
  AgentHubValidationError,
  type CreateTaskInputDto,
  type TaskDto
} from '../src/shared/agenthubTypes';
import { TaskSubmissionIdLifecycle } from '../src/shared/agenthubSubmissionLifecycle';

describe('AgentHub Runtime Create Task Input Validation', () => {
  const validBase: CreateTaskInputDto = {
    projectId: 'p-1',
    title: 'Valid Task Title',
    description: 'A valid description',
    requiredCapabilities: ['cap-1', 'cap-2'],
    requiredSpecialties: ['spec-1'],
    acceptanceCriteria: ['Must pass tests', 'Must be fast'],
    complexity: 'MEDIUM',
    risk: 'LOW'
  };

  test('valid input accepted and produces frozen detached object', { timeout: 5000 }, () => {
    const raw = { ...validBase, requiredCapabilities: [...validBase.requiredCapabilities] };
    const validated = snapshotCreateTaskInput(raw);

    assert.equal(validated.projectId, 'p-1');
    assert.equal(validated.title, 'Valid Task Title');
    assert.equal(validated.description, 'A valid description');
    assert.deepEqual(validated.requiredCapabilities, ['cap-1', 'cap-2']);
    assert.equal(validated.complexity, 'MEDIUM');
    assert.equal(validated.risk, 'LOW');

    // Immutability checks
    assert.ok(Object.isFrozen(validated));
    assert.ok(Object.isFrozen(validated.requiredCapabilities));
    assert.ok(Object.isFrozen(validated.requiredSpecialties));
    assert.ok(Object.isFrozen(validated.acceptanceCriteria));

    // Detached mutation check: mutating raw array should not affect validated
    raw.requiredCapabilities.push('cap-mutated');
    assert.equal(validated.requiredCapabilities.length, 2);
  });

  test('extra top-level keys rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, unexpectedKey: 'malicious' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('blank projectId and title rejected without silent trimming', { timeout: 5000 }, () => {
    // Blank projectId
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, projectId: '   ' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    // Blank title
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, title: '  \t\n ' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    // Non-blank with whitespace preserved (no silent trim)
    const spaced = snapshotCreateTaskInput({ ...validBase, title: '  Important Task  ' });
    assert.equal(spaced.title, '  Important Task  ');
  });

  test('UTF-8 byte limits enforced', { timeout: 5000 }, () => {
    // projectId > 256 UTF-8 bytes (Chinese character is 3 bytes each)
    const longProject = '项'.repeat(86); // 86 * 3 = 258 bytes
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, projectId: longProject }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );

    // title > 16 KiB (16384 bytes)
    const longTitle = 'a'.repeat(16385);
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, title: longTitle }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );

    // description null accepted, description > 128 KiB rejected
    const nullDesc = snapshotCreateTaskInput({ ...validBase, description: null });
    assert.equal(nullDesc.description, null);

    const longDesc = 'd'.repeat(131073);
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, description: longDesc }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('array limits and non-blank items enforced', { timeout: 5000 }, () => {
    // > 256 items
    const tooManyCaps = Array.from({ length: 257 }, (_, i) => `cap-${i}`);
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, requiredCapabilities: tooManyCaps }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );

    // item > 512 bytes
    const hugeCap = 'c'.repeat(513);
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, requiredCapabilities: [hugeCap] }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );

    // blank string in array
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, requiredCapabilities: ['valid', '  '] }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );

    const tooManySpecs = Array.from({ length: 257 }, (_, i) => `spec-${i}`);
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, requiredSpecialties: tooManySpecs }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );

    // acceptance criteria item > 8192 bytes
    const hugeCrit = 'x'.repeat(8193);
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, acceptanceCriteria: [hugeCrit] }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('invalid complexity and risk rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, complexity: 'EXTREME' as any }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, risk: 'UNKNOWN' as any }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });

  test('NUL bytes are rejected in all bounded CreateTask strings', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, projectId: 'p-1\0x' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, title: 'Title\0' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, description: 'Desc\0more' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, requiredCapabilities: ['ok', 'cap\0'] }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, requiredSpecialties: ['sp\0ec'] }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
    assert.throws(
      () => snapshotCreateTaskInput({ ...validBase, acceptanceCriteria: ['pass\0'] }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_INPUT'
    );
  });
});

describe('AgentHubTaskSubmission Idempotency and Authority', () => {
  const validBase: CreateTaskInputDto = {
    projectId: 'p-1',
    title: 'Implement Task Creation',
    description: 'Unit test task',
    requiredCapabilities: ['node'],
    requiredSpecialties: ['backend'],
    acceptanceCriteria: ['Tests pass'],
    complexity: 'MEDIUM',
    risk: 'LOW'
  };

  test('same submissionId + same body sends same derived Idempotency-Key and succeeds', { timeout: 5000 }, async () => {
    const receivedHeaders: Record<string, string>[] = [];
    let taskCreateCount = 0;

    const mockTask: TaskDto = {
      taskId: 'task-100',
      projectId: 'p-1',
      title: 'Implement Task Creation',
      description: 'Unit test task',
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 's1',
          data: {
            projects: [{ projectId: 'p-1', name: 'Project 1', description: null, createdAt: '2026', updatedAt: '2026' }],
            agents: [],
            tasks: taskCreateCount > 0 ? [mockTask] : [],
            assignments: []
          }
        }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        taskCreateCount++;
        receivedHeaders.push({
          'content-type': req.headers['content-type'] || '',
          'idempotency-key': (req.headers['idempotency-key'] as string) || ''
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: `req-create-${taskCreateCount}`,
          data: mockTask
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"ok":false}');
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      await connection.start();
      await new Promise((r) => setTimeout(r, 80));

      // First submit
      const submissionId = 'sub-test-123';
      const res1 = await submissionService.submitTask({ submissionId, input: validBase });

      assert.equal(res1.status, 'created');
      if (res1.status === 'created') {
        assert.equal(res1.task.taskId, 'task-100');
        assert.equal(res1.stateSynchronized, true);
      }

      // Assert derived Idempotency-Key
      assert.equal(receivedHeaders[0]['idempotency-key'], 'desktop-task:sub-test-123');
      assert.equal(receivedHeaders[0]['content-type'], 'application/json');

      // Second submit with same submissionId and exact same body (e.g. user retry)
      const res2 = await submissionService.submitTask({ submissionId, input: validBase });
      assert.equal(res2.status, 'created');
      assert.equal(receivedHeaders[1]['idempotency-key'], 'desktop-task:sub-test-123');
      assert.equal(taskCreateCount, 2);

      // Verify authoritative state has the task from /state
      assert.equal(connection.getState().snapshot?.tasks.length, 1);
      assert.equal(connection.getState().snapshot?.tasks[0].taskId, 'task-100');
    } finally {
      submissionService.stop();
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('same submissionId + different body rejected locally with IDEMPOTENCY_CONFLICT', { timeout: 5000 }, async () => {
    let tasksPostCalled = false;
    const mockTask: TaskDto = {
      taskId: 'task-conflict-1',
      projectId: 'p-1',
      title: 'Implement Task Creation',
      description: 'Unit test task',
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 's1',
          data: {
            projects: [{ projectId: 'p-1', name: 'Project 1', description: null, createdAt: '2026', updatedAt: '2026' }],
            agents: [],
            tasks: [mockTask],
            assignments: []
          }
        }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        tasksPostCalled = true;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: mockTask, requestId: 'r-conflict' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"data":{}}');
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      const submissionId = 'sub-conflict-test';
      // First submission succeeds cleanly
      const firstResult = await submissionService.submitTask({ submissionId, input: validBase });
      assert.equal(firstResult.status, 'created');
      assert.equal(tasksPostCalled, true);

      // Now attempt with same submissionId but CHANGED body — reject locally, no second POST
      tasksPostCalled = false;
      const conflict = await submissionService.submitTask({
        submissionId,
        input: { ...validBase, title: 'Completely Different Title' }
      });
      assert.equal(conflict.status, 'failed');
      if (conflict.status === 'failed') {
        assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal(conflict.retryable, false);
      }
      assert.equal(tasksPostCalled, false);
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });

  test('double click while in-flight coalesces to single in-flight request', { timeout: 5000 }, async () => {
    let postCallCount = 0;
    const mockTask: TaskDto = {
      taskId: 'task-coalesce',
      projectId: 'p-1',
      title: 'Coalesce Task',
      description: null,
      requiredCapabilities: [],
      requiredSpecialties: [],
      acceptanceCriteria: [],
      complexity: 'SIMPLE',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026',
      updatedAt: '2026'
    };

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 's', data: { projects: [], agents: [], tasks: [mockTask], assignments: [] } }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        postCallCount++;
        setTimeout(() => {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, requestId: 'c', data: mockTask }));
        }, 100);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      const submissionId = 'sub-double-click';
      // Fire two concurrent submissions simultaneously
      const [r1, r2] = await Promise.all([
        submissionService.submitTask({ submissionId, input: validBase }),
        submissionService.submitTask({ submissionId, input: validBase })
      ]);

      assert.equal(r1.status, 'created');
      assert.equal(r2.status, 'created');
      assert.equal(postCallCount, 1, 'POST must only be dispatched once for concurrent duplicate click');
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });

  test('POST succeeds + /state fails: creation acknowledged but stateSynchronized is false and connection degraded', { timeout: 5000 }, async () => {
    let postCallCount = 0;
    const mockTask: TaskDto = {
      taskId: 'task-split-success',
      projectId: 'p-1',
      title: 'Task Created But Sync Failed',
      description: null,
      requiredCapabilities: [],
      requiredSpecialties: [],
      acceptanceCriteria: [],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026',
      updatedAt: '2026'
    };

    let stateShouldFail = false;
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        if (stateShouldFail) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, requestId: 'err', error: { code: 'SERVER_ERROR', message: 'Database failure' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 's', data: { projects: [], agents: [], tasks: [], assignments: [] } }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        postCallCount++;
        stateShouldFail = true; // Make follow-up /state fail
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'created', data: mockTask }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      await connection.start();
      await new Promise((r) => setTimeout(r, 60));

      const res = await submissionService.submitTask({
        submissionId: 'sub-resync-fail',
        input: validBase
      });

      assert.equal(res.status, 'created');
      if (res.status === 'created') {
        assert.equal(res.task.taskId, 'task-split-success');
        assert.equal(res.stateSynchronized, false);
        assert.ok(res.warning);
      }

      // Assert connection status downgraded to degraded
      assert.equal(connection.getState().connection, 'degraded');
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });

  test('ambiguous network error is classified as ambiguous and retryable', { timeout: 5000 }, async () => {
    // Create server and close it immediately so client encounters connection refused (NETWORK_ERROR)
    const server = http.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const port = addr.port;
    await new Promise<void>((r) => server.close(() => r()));

    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      const res = await submissionService.submitTask({
        submissionId: 'sub-network-fail',
        input: validBase
      });

      assert.equal(res.status, 'ambiguous');
      if (res.status === 'ambiguous') {
        assert.equal(res.retryable, true);
        assert.equal(res.error.code, 'NETWORK_ERROR');
      }
    } finally {
      submissionService.stop();
      connection.stop();
    }
  });

  test('POST TaskDto is never inserted into cache; /state remains authoritative', { timeout: 5000 }, async () => {
    const postOnlyTask: TaskDto = {
      taskId: 'task-from-post-only',
      projectId: 'p-1',
      title: 'Implement Task Creation',
      description: 'Unit test task',
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'CREATED',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };
    const stateTask: TaskDto = {
      ...postOnlyTask,
      taskId: 'task-from-state',
      status: 'pending'
    };

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 's',
          data: { projects: [], agents: [], tasks: [stateTask], assignments: [] }
        }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'c', data: postOnlyTask }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      const res = await submissionService.submitTask({
        submissionId: 'sub-cache-authority',
        input: validBase
      });
      assert.equal(res.status, 'created');
      const tasks = connection.getState().snapshot?.tasks ?? [];
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].taskId, 'task-from-state');
      assert.equal(tasks.some((t) => t.taskId === 'task-from-post-only'), false);
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });

  test('ambiguous timeout retry reuses the same derived Idempotency-Key', { timeout: 5000 }, async () => {
    const receivedKeys: string[] = [];
    let postCount = 0;
    const mockTask: TaskDto = {
      taskId: 'task-retry',
      projectId: 'p-1',
      title: 'Implement Task Creation',
      description: 'Unit test task',
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026',
      updatedAt: '2026'
    };

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 's',
          data: { projects: [], agents: [], tasks: [mockTask], assignments: [] }
        }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        postCount++;
        receivedKeys.push(String(req.headers['idempotency-key'] || ''));
        if (postCount === 1) {
          return; // hang first POST so the client times out
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'c', data: mockTask }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const restClient = new AgentHubRestClient({ baseUrl, timeoutMs: 80 });
    const connection = new AgentHubConnection({ baseUrl, restClient });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      const submissionId = 'sub-ambiguous-retry';
      const first = await submissionService.submitTask({ submissionId, input: validBase });
      assert.equal(first.status, 'ambiguous');
      if (first.status === 'ambiguous') {
        assert.equal(first.retryable, true);
        assert.equal(first.error.code, 'TIMEOUT');
      }

      const second = await submissionService.submitTask({ submissionId, input: validBase });
      assert.equal(second.status, 'created');
      assert.deepEqual(receivedKeys, [
        'desktop-task:sub-ambiguous-retry',
        'desktop-task:sub-ambiguous-retry'
      ]);
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });

  test('stop() aborts an in-flight POST as ambiguous rather than a definitive failure', { timeout: 5000 }, async () => {
    const mockTask: TaskDto = {
      taskId: 'task-aborted',
      projectId: 'p-1',
      title: 'Implement Task Creation',
      description: 'Unit test task',
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026',
      updatedAt: '2026'
    };

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 's',
          data: { projects: [], agents: [], tasks: [], assignments: [] }
        }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        setTimeout(() => {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, requestId: 'c', data: mockTask }));
        }, 400);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      const pending = submissionService.submitTask({
        submissionId: 'sub-shutdown-abort',
        input: validBase
      });
      await new Promise((r) => setTimeout(r, 30));
      submissionService.stop();
      const res = await pending;
      assert.equal(res.status, 'ambiguous');
      if (res.status === 'ambiguous') {
        assert.equal(res.retryable, true);
        assert.equal(res.error.code, 'ABORTED');
      }

      const afterStop = await submissionService.submitTask({
        submissionId: 'sub-after-stop',
        input: validBase
      });
      assert.equal(afterStop.status, 'failed');
      if (afterStop.status === 'failed') {
        assert.equal(afterStop.error.code, 'STOPPED');
      }
    } finally {
      connection.stop();
      server.close();
    }
  });

  test('POST + WS invalidation: delayed older mutation /state cannot roll back newer committed snapshot', { timeout: 8000 }, async () => {
    const oldTask: TaskDto = {
      taskId: 'task-state-old',
      projectId: 'p-1',
      title: 'Implement Task Creation',
      description: 'Unit test task',
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };
    const newTask: TaskDto = { ...oldTask, taskId: 'task-state-new', status: 'ASSIGNED' };
    const postTask: TaskDto = { ...oldTask, taskId: 'task-from-post', status: 'CREATED' };

    let holdAResolve: (() => void) | null = null;
    const holdA = new Promise<void>((r) => {
      holdAResolve = r;
    });
    let payload: 'initial' | 'old' | 'new' = 'initial';
    let postSeen = false;
    let postStateStarts = 0;
    let firstPostStateStarted!: () => void;
    const firstPostState = new Promise<void>((r) => {
      firstPostStateStarted = r;
    });
    let wsClient: import('ws').WebSocket | null = null;

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        const capturedHold = postSeen && payload === 'old' ? holdA : null;
        const capturedPayload = payload;
        if (postSeen) {
          postStateStarts++;
          if (postStateStarts === 1) firstPostStateStarted();
        }
        void (async () => {
          if (capturedHold) await capturedHold;
          const tasks =
            capturedPayload === 'old' ? [oldTask] : capturedPayload === 'new' ? [newTask] : [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            requestId: `s-${capturedPayload}`,
            data: { projects: [], agents: [], tasks, assignments: [] }
          }));
        })();
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        postSeen = true;
        payload = 'old';
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'c', data: postTask }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      wsClient = ws;
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      await connection.start();
      const startWait = Date.now();
      while (Date.now() - startWait < 2000) {
        if (connection.getState().connection === 'connected') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(connection.getState().connection, 'connected');
      await new Promise((r) => setTimeout(r, 80));

      const pending = submissionService.submitTask({
        submissionId: 'sub-ws-race',
        input: validBase
      });

      await firstPostState;
      payload = 'new';
      wsClient?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: {
          eventId: 'evt-task-created',
          eventType: 'task.created',
          timestamp: '2026-01-01T00:00:10Z',
          projectId: 'p-1',
          agentId: null,
          taskId: 'task-state-new',
          assignmentId: null,
          actor: null,
          oldStatus: null,
          newStatus: 'ASSIGNED',
          payload: {}
        }
      }));

      const newWait = Date.now();
      while (Date.now() - newWait < 2000) {
        if (connection.getState().snapshot?.tasks.some((t) => t.taskId === 'task-state-new')) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(connection.getState().snapshot?.tasks[0]?.taskId, 'task-state-new');

      holdAResolve?.();
      const res = await pending;
      assert.equal(res.status, 'created');
      if (res.status === 'created') {
        assert.equal(res.task.taskId, 'task-from-post');
        assert.equal(res.stateSynchronized, true);
      }
      const tasks = connection.getState().snapshot?.tasks ?? [];
      assert.equal(tasks.some((t) => t.taskId === 'task-state-new'), true);
      assert.equal(tasks.some((t) => t.taskId === 'task-state-old'), false);
      assert.equal(connection.getState().connection, 'connected');
    } finally {
      submissionService.stop();
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('newer mutation /state failure blocks older pre-mutation /state from committing and healing degraded', { timeout: 8000 }, async () => {
    const preMutationTask: TaskDto = {
      taskId: 'task-pre-mutation',
      projectId: 'p-1',
      title: 'Stale',
      description: null,
      requiredCapabilities: ['node'],
      requiredSpecialties: ['backend'],
      acceptanceCriteria: ['Tests pass'],
      complexity: 'MEDIUM',
      risk: 'LOW',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };
    const createdTask: TaskDto = { ...preMutationTask, taskId: 'task-from-post', title: 'Implement Task Creation' };

    let armed = false;
    let stateN = 0;
    let holdAResolve: (() => void) | null = null;
    const holdA = new Promise<void>((r) => {
      holdAResolve = r;
    });
    let aStarted!: () => void;
    const aStart = new Promise<void>((r) => {
      aStarted = r;
    });
    let postHit = false;

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        if (!armed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            requestId: 's0',
            data: { projects: [], agents: [], tasks: [], assignments: [] }
          }));
          return;
        }
        stateN++;
        const n = stateN;
        if (n === 1) {
          aStarted();
          void (async () => {
            await holdA;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              requestId: 's-pre',
              data: { projects: [], agents: [], tasks: [preMutationTask], assignments: [] }
            }));
          })();
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          requestId: 's-fail',
          error: { code: 'SERVER_ERROR', message: 'mutation follow-up failed' }
        }));
        return;
      }
      if (req.url === '/api/v1/tasks' && req.method === 'POST') {
        postHit = true;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'c', data: createdTask }));
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
    const submissionService = new AgentHubTaskSubmission(connection);

    try {
      await connection.start();
      const startWait = Date.now();
      while (Date.now() - startWait < 2000) {
        if (connection.getState().connection === 'connected') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(connection.getState().connection, 'connected');
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(connection.getState().snapshot?.tasks.length, 0);
      const s0SyncAt = connection.getState().lastSyncAt;

      armed = true;
      const pendingA = connection.refresh();
      await aStart;

      const created = await submissionService.submitTask({
        submissionId: 'sub-stale-barrier',
        input: validBase
      });
      assert.equal(postHit, true);
      assert.equal(created.status, 'created');
      if (created.status === 'created') {
        assert.equal(created.stateSynchronized, false);
        assert.equal(created.task.taskId, 'task-from-post');
      }
      assert.equal(connection.getState().connection, 'degraded');

      holdAResolve?.();
      await pendingA;
      await new Promise((r) => setTimeout(r, 20));

      const tasks = connection.getState().snapshot?.tasks ?? [];
      assert.equal(tasks.some((t) => t.taskId === 'task-pre-mutation'), false);
      assert.equal(tasks.length, 0);
      assert.equal(connection.getState().connection, 'degraded');
      assert.equal(connection.getState().lastSyncAt, s0SyncAt);
    } finally {
      submissionService.stop();
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });
});

describe('AgentHub V0.8.3 mutation surface allowlist', () => {
  test('IPC exposes createTask and executeTask and no review/merge transport', { timeout: 5000 }, () => {
    const ipcPath = path.join(process.cwd(), 'src/main/agenthub/AgentHubIpc.ts');
    const source = fs.readFileSync(ipcPath, 'utf8');
    assert.match(source, /CREATE_TASK:\s*'agenthub:createTask'/);
    assert.match(source, /EXECUTE_TASK:\s*'agenthub:executeTask'/);
    assert.match(source, /GET_STATE:\s*'agenthub:getConnectionState'/);
    assert.match(source, /GET_SNAPSHOT:\s*'agenthub:getSnapshot'/);
    assert.match(source, /REFRESH:\s*'agenthub:refresh'/);
    assert.match(source, /CHANGED:\s*'agenthub:changed'/);
    assert.equal(source.includes('agenthub:review'), false);
    assert.equal(source.includes('agenthub:merge'), false);
    assert.equal(source.includes('Idempotency-Key'), false);
  });

  test('preload agentHub bridge is narrow and does not expose generic HTTP/WS or raw headers', { timeout: 5000 }, () => {
    const preloadPath = path.join(process.cwd(), 'src/preload/index.ts');
    const source = fs.readFileSync(preloadPath, 'utf8');
    assert.match(source, /createTask:\s*\(request: CreateTaskRequestDto\)/);
    assert.match(source, /executeTask:\s*\(request: ExecuteTaskRequestDto\)/);
    assert.match(source, /ipcRenderer\.invoke\('agenthub:createTask', request\)/);
    assert.match(source, /ipcRenderer\.invoke\('agenthub:executeTask', request\)/);
    assert.equal(source.includes("invoke('agenthub:review"), false);
    assert.equal(source.includes('Idempotency-Key'), false);
    assert.equal(/exposeInMainWorld\('agentHub'[\s\S]*fetch\s*:/.test(source), false);

    const apiBlock = source.slice(source.indexOf('const agentHubApi'), source.indexOf("exposeInMainWorld('agentHub'"));
    assert.match(apiBlock, /getConnectionState:/);
    assert.match(apiBlock, /getSnapshot:/);
    assert.match(apiBlock, /refresh:/);
    assert.match(apiBlock, /onChanged:/);
    assert.match(apiBlock, /createTask:/);
    assert.match(apiBlock, /executeTask:/);
    assert.equal(apiBlock.includes('review'), false);
    assert.equal(apiBlock.includes('merge'), false);
  });

  test('TaskSubmission does not own snapshot fetch/commit; Connection is the only production owner', { timeout: 5000 }, () => {
    const submissionSrc = fs.readFileSync(path.join(process.cwd(), 'src/main/agenthub/AgentHubTaskSubmission.ts'), 'utf8');
    const connectionSrc = fs.readFileSync(path.join(process.cwd(), 'src/main/agenthub/AgentHubConnection.ts'), 'utf8');
    assert.equal(submissionSrc.includes('cache.updateSnapshot'), false);
    assert.equal(submissionSrc.includes('restClient.state'), false);
    assert.match(submissionSrc, /syncAuthoritativeState/);
    assert.match(connectionSrc, /syncAuthoritativeState\(/);
    assert.match(connectionSrc, /#commitSnapshotIfCurrent/);
    assert.match(connectionSrc, /#latestCommittedSequence/);
  });
});

describe('AgentHub CreateTask IPC request envelope', () => {
  const validBase: CreateTaskInputDto = {
    projectId: 'p-1',
    title: 'Valid Task Title',
    description: 'A valid description',
    requiredCapabilities: ['cap-1', 'cap-2'],
    requiredSpecialties: ['spec-1'],
    acceptanceCriteria: ['Must pass tests', 'Must be fast'],
    complexity: 'MEDIUM',
    risk: 'LOW'
  };

  test('valid { submissionId, input } accepted; extra/header/path/idempotency keys rejected before HTTP', { timeout: 5000 }, () => {
    const valid = snapshotCreateTaskRequest({
      submissionId: 'sub-envelope-1',
      input: validBase
    });
    assert.equal(valid.submissionId, 'sub-envelope-1');
    assert.equal(valid.input.title, validBase.title);
    assert.ok(Object.isFrozen(valid));

    const extraCases = [
      { submissionId: 's1', input: validBase, idempotencyKey: 'desktop-task:s1' },
      { submissionId: 's1', input: validBase, path: '/api/v1/tasks' },
      { submissionId: 's1', input: validBase, headers: { 'Idempotency-Key': 'x' } },
      { submissionId: 's1', input: validBase, url: 'http://127.0.0.1:3210' },
      { submissionId: 's1', input: validBase, method: 'POST' },
      { submissionId: 's1', input: validBase, execute: true },
      { submissionId: 's1', input: validBase, review: true },
      { submissionId: 's1', input: validBase, merge: true }
    ];
    for (const raw of extraCases) {
      assert.throws(
        () => snapshotCreateTaskRequest(raw),
        (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST'
      );
    }

    assert.throws(() => snapshotCreateTaskRequest(null), (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST');
    assert.throws(() => snapshotCreateTaskRequest([]), (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST');
    assert.throws(() => snapshotCreateTaskRequest('nope'), (err: AgentHubValidationError) => err.code === 'MALFORMED_REQUEST');
  });

  test('rejected envelopes never send HTTP', { timeout: 5000 }, async () => {
    let hit = false;
    const server = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);
    try {
      const extra = await submissionService.submitTask({
        submissionId: 'sub-extra',
        input: validBase,
        idempotencyKey: 'injected'
      } as any);
      assert.equal(extra.status, 'failed');
      if (extra.status === 'failed') {
        assert.equal(extra.error.code, 'MALFORMED_REQUEST');
      }
      const empty = await submissionService.submitTask(null);
      assert.equal(empty.status, 'failed');
      assert.equal(hit, false);
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });

  test('NUL-invalid input is rejected locally and never POSTs /api/v1/tasks', { timeout: 5000 }, async () => {
    let postHit = false;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') postHit = true;
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const submissionService = new AgentHubTaskSubmission(connection);
    try {
      const res = await submissionService.submitTask({
        submissionId: 'sub-nul',
        input: { ...validBase, title: 'Bad\0Title' }
      });
      assert.equal(res.status, 'failed');
      if (res.status === 'failed') {
        assert.equal(res.error.code, 'MALFORMED_INPUT');
      }
      assert.equal(postHit, false);
    } finally {
      submissionService.stop();
      connection.stop();
      server.close();
    }
  });
});

describe('TaskSubmissionIdLifecycle', () => {
  test('ambiguous retry keeps ID; created/failed rotate; edit after ambiguous rotates', { timeout: 5000 }, () => {
    let n = 0;
    const life = new TaskSubmissionIdLifecycle(() => `id-${++n}`);
    assert.equal(life.id, 'id-1');

    const first = life.beginSubmit();
    assert.equal(first, 'id-1');
    life.onResult('ambiguous');
    assert.equal(life.id, 'id-1');
    assert.equal(life.beginRetry(), 'id-1');
    life.onResult('ambiguous');
    assert.equal(life.id, 'id-1');

    const createdLife = new TaskSubmissionIdLifecycle(() => `id-${++n}`);
    const createdId = createdLife.beginSubmit();
    createdLife.onResult('created');
    assert.notEqual(createdLife.id, createdId);
    const nextAfterCreated = createdLife.beginSubmit();
    assert.equal(nextAfterCreated, createdLife.id);
    assert.notEqual(nextAfterCreated, createdId);

    const failedLife = new TaskSubmissionIdLifecycle(() => `id-${++n}`);
    const failedId = failedLife.beginSubmit();
    failedLife.onResult('failed');
    assert.notEqual(failedLife.id, failedId);
    const nextAfterFailed = failedLife.beginSubmit();
    assert.notEqual(nextAfterFailed, failedId);

    const editLife = new TaskSubmissionIdLifecycle(() => `id-${++n}`);
    const ambId = editLife.beginSubmit();
    editLife.onResult('ambiguous');
    const afterEdit = editLife.onEdit();
    assert.notEqual(afterEdit, ambId);
  });
});
