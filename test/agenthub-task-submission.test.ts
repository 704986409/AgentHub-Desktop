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
  AgentHubValidationError,
  type CreateTaskInputDto,
  type TaskDto
} from '../src/shared/agenthubTypes';

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
});

describe('AgentHub V0.8.2 mutation surface allowlist', () => {
  test('IPC exposes only the narrow createTask channel and no execute/review/merge transport', { timeout: 5000 }, () => {
    const ipcPath = path.join(process.cwd(), 'src/main/agenthub/AgentHubIpc.ts');
    const source = fs.readFileSync(ipcPath, 'utf8');
    assert.match(source, /CREATE_TASK:\s*'agenthub:createTask'/);
    assert.match(source, /GET_STATE:\s*'agenthub:getConnectionState'/);
    assert.match(source, /GET_SNAPSHOT:\s*'agenthub:getSnapshot'/);
    assert.match(source, /REFRESH:\s*'agenthub:refresh'/);
    assert.match(source, /CHANGED:\s*'agenthub:changed'/);
    assert.equal(source.includes('agenthub:execute'), false);
    assert.equal(source.includes('agenthub:review'), false);
    assert.equal(source.includes('agenthub:merge'), false);
    assert.equal(source.includes('Idempotency-Key'), false);
  });

  test('preload agentHub bridge is narrow and does not expose generic HTTP/WS or raw headers', { timeout: 5000 }, () => {
    const preloadPath = path.join(process.cwd(), 'src/preload/index.ts');
    const source = fs.readFileSync(preloadPath, 'utf8');
    assert.match(source, /createTask:\s*\(request: CreateTaskRequestDto\)/);
    assert.match(source, /ipcRenderer\.invoke\('agenthub:createTask', request\)/);
    assert.equal(source.includes("invoke('agenthub:execute"), false);
    assert.equal(source.includes('Idempotency-Key'), false);
    assert.equal(/exposeInMainWorld\('agentHub'[\s\S]*fetch\s*:/.test(source), false);

    const apiBlock = source.slice(source.indexOf('const agentHubApi'), source.indexOf("exposeInMainWorld('agentHub'"));
    assert.match(apiBlock, /getConnectionState:/);
    assert.match(apiBlock, /getSnapshot:/);
    assert.match(apiBlock, /refresh:/);
    assert.match(apiBlock, /onChanged:/);
    assert.match(apiBlock, /createTask:/);
    assert.equal(apiBlock.includes('execute'), false);
    assert.equal(apiBlock.includes('review'), false);
    assert.equal(apiBlock.includes('merge'), false);
  });
});
