import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  AgentHubRestClient,
  AgentHubContractError,
  validateAgentHubBaseUrl
} from '../src/main/agenthub/AgentHubRestClient';
import {
  snapshotAgentDto,
  snapshotTaskDto,
  snapshotAssignmentDto,
  snapshotProjectDto,
  snapshotEventDto,
  AgentHubValidationError,
  sanitizeEventPayload,
  type CreateTaskInputDto
} from '../src/shared/agenthubTypes';

describe('validateAgentHubBaseUrl', () => {
  test('accepts valid 127.0.0.1 URLs', { timeout: 5000 }, () => {
    assert.equal(validateAgentHubBaseUrl('http://127.0.0.1:3210'), 'http://127.0.0.1:3210');
    assert.equal(validateAgentHubBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
    assert.equal(validateAgentHubBaseUrl('  http://127.0.0.1:3000  '), 'http://127.0.0.1:3000');
  });

  test('rejects non-loopback hostnames or IPs', { timeout: 5000 }, () => {
    assert.throws(() => validateAgentHubBaseUrl('http://localhost:3210'), {
      name: 'AgentHubContractError',
      code: 'NON_LOOPBACK_HOST'
    });
    assert.throws(() => validateAgentHubBaseUrl('http://0.0.0.0:3210'), {
      name: 'AgentHubContractError',
      code: 'NON_LOOPBACK_HOST'
    });
    assert.throws(() => validateAgentHubBaseUrl('http://192.168.1.100:3210'), {
      name: 'AgentHubContractError',
      code: 'NON_LOOPBACK_HOST'
    });
    assert.throws(() => validateAgentHubBaseUrl('http://api.agenthub.dev:3210'), {
      name: 'AgentHubContractError',
      code: 'NON_LOOPBACK_HOST'
    });
  });

  test('rejects non-http protocols', { timeout: 5000 }, () => {
    assert.throws(() => validateAgentHubBaseUrl('https://127.0.0.1:3210'), {
      name: 'AgentHubContractError',
      code: 'INVALID_PROTOCOL'
    });
    assert.throws(() => validateAgentHubBaseUrl('ws://127.0.0.1:3210'), {
      name: 'AgentHubContractError',
      code: 'INVALID_PROTOCOL'
    });
  });

  test('rejects credentials, paths, query, and fragments', { timeout: 5000 }, () => {
    assert.throws(() => validateAgentHubBaseUrl('http://user:pass@127.0.0.1:3210'), {
      name: 'AgentHubContractError',
      code: 'CREDENTIALS_FORBIDDEN'
    });
    assert.throws(() => validateAgentHubBaseUrl('http://127.0.0.1:3210/api'), {
      name: 'AgentHubContractError',
      code: 'PATH_FORBIDDEN'
    });
    assert.throws(() => validateAgentHubBaseUrl('http://127.0.0.1:3210?token=123'), {
      name: 'AgentHubContractError',
      code: 'QUERY_OR_HASH_FORBIDDEN'
    });
    assert.throws(() => validateAgentHubBaseUrl('http://127.0.0.1:3210#frag'), {
      name: 'AgentHubContractError',
      code: 'QUERY_OR_HASH_FORBIDDEN'
    });
  });
});

describe('AgentHubRestClient network and envelope validation', () => {
  test('successfully performs GET health, state, and events with STRICT GET only', { timeout: 5000 }, async () => {
    const receivedMethods: string[] = [];

    const server = http.createServer((req, res) => {
      receivedMethods.push(req.method ?? 'UNKNOWN');

      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, requestId: 'err-1', error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } }));
        return;
      }

      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 'req-h1',
          data: { status: 'ok', version: '0.7.0' }
        }));
        return;
      }

      if (req.url === '/api/v1/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 'req-s1',
          data: {
            projects: [{ projectId: 'p1', name: 'Project 1', description: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
            agents: [{
              agentId: 'a1',
              projectId: null,
              name: 'Agent 1',
              providerId: 'claude',
              position: 'lead',
              status: 'idle',
              authority: 'autonomous',
              routingPriority: 1,
              enabled: true,
              allowedComplexities: [],
              allowedRiskLevels: [],
              capabilities: [],
              specialties: [],
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01'
            }],
            tasks: [{
              taskId: 't1',
              projectId: 'p1',
              title: 'Task 1',
              description: null,
              status: 'pending',
              complexity: 'low',
              risk: 'low',
              requiredCapabilities: [],
              requiredSpecialties: [],
              acceptanceCriteria: [],
              assignedAgentId: null,
              assignmentId: null,
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01'
            }],
            assignments: []
          }
        }));
        return;
      }

      if (req.url?.startsWith('/api/v1/events')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 'req-e1',
          data: [
            {
              eventId: 'evt-1',
              eventType: 'task.created',
              timestamp: '2026-01-01T00:00:00Z',
              projectId: null,
              agentId: null,
              taskId: null,
              assignmentId: null,
              actor: null,
              oldStatus: null,
              newStatus: null,
              payload: {}
            }
          ]
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, requestId: 'req-404', error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const health = await client.health();
      assert.equal(health.status, 'ok');
      assert.equal(health.version, '0.7.0');

      const state = await client.state();
      assert.equal(state.projects.length, 1);
      assert.equal(state.projects[0].description, null);
      assert.equal(state.agents[0].name, 'Agent 1');
      assert.equal(state.agents[0].projectId, null);
      assert.equal(state.tasks[0].title, 'Task 1');
      assert.equal(state.tasks[0].description, null);

      const events = await client.events(10);
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, 'task.created');

      // Verify ZERO non-GET requests were issued
      assert.ok(receivedMethods.length >= 3);
      for (const method of receivedMethods) {
        assert.equal(method, 'GET', `Encountered unexpected non-GET request: ${method}`);
      }
    } finally {
      server.close();
    }
  });

  test('rejects health when status is not ok or version is blank', { timeout: 5000 }, async () => {
    let mode = 'bad_status';

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (mode === 'bad_status') {
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'degraded', version: '0.7.0' } }));
      } else {
        res.end(JSON.stringify({ ok: true, requestId: 'h2', data: { status: 'ok', version: '  ' } }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      mode = 'bad_status';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_HEALTH');

      mode = 'blank_version';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_HEALTH');
    } finally {
      server.close();
    }
  });

  test('validates envelopes: rejects missing or blank requestId, missing/non-string error.message, and unexpected keys', { timeout: 5000 }, async () => {
    let mode = 'missing_requestId';

    const server = http.createServer((_req, res) => {
      if (mode === 'missing_requestId') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { status: 'ok', version: '0.7.0' } }));
      } else if (mode === 'blank_requestId') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: '   ', data: { status: 'ok', version: '0.7.0' } }));
      } else if (mode === 'error_missing_code') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, requestId: 'req-err', error: { message: 'Failed' } }));
      } else if (mode === 'error_missing_message') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, requestId: 'req-err', error: { code: 'FAIL' } }));
      } else if (mode === 'error_non_string_message') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, requestId: 'req-err', error: { code: 'FAIL', message: 12345 } }));
      } else if (mode === 'unexpected_success_key') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'req-ok', data: { status: 'ok', version: '0.7.0' }, extra: 1 }));
      } else if (mode === 'unexpected_error_key') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, requestId: 'req-err', error: { code: 'FAIL', message: 'err' }, extra: 1 }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      mode = 'missing_requestId';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');

      mode = 'blank_requestId';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');

      mode = 'error_missing_code';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');

      mode = 'error_missing_message';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');

      mode = 'error_non_string_message';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');

      mode = 'unexpected_success_key';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');

      mode = 'unexpected_error_key';
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'MALFORMED_ENVELOPE');
    } finally {
      server.close();
    }
  });

  test('runtime snapshot sanitizes private fields from state and events', { timeout: 5000 }, async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/v1/state') {
        res.end(JSON.stringify({
          ok: true,
          requestId: 'req-sec',
          data: {
            projects: [{
              projectId: 'p1',
              name: 'Secret Project',
              description: null,
              repositoryRoot: 'C:\\Users\\Secret\\Repo', // Leak attempt
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01'
            }],
            agents: [{
              agentId: 'a1',
              projectId: 'p1',
              name: 'Agent 1',
              providerId: 'claude',
              position: 'dev',
              status: 'idle',
              authority: 'autonomous',
              routingPriority: 0,
              enabled: true,
              allowedComplexities: [],
              allowedRiskLevels: [],
              capabilities: [],
              specialties: [],
              worktreePath: 'D:\\worktrees\\agent-1', // Leak attempt
              cwd: 'D:\\worktrees\\agent-1', // Leak attempt
              env: { API_KEY: 'secret-key-123' }, // Leak attempt
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01'
            }],
            tasks: [],
            assignments: []
          }
        }));
      } else if (req.url?.startsWith('/api/v1/events')) {
        res.end(JSON.stringify({
          ok: true,
          requestId: 'req-evt',
          data: [{
            eventId: 'evt-leak',
            eventType: 'task.completed',
            timestamp: '2026-01-01T00:00:00Z',
            projectId: null,
            agentId: null,
            taskId: null,
            assignmentId: null,
            actor: null,
            oldStatus: null,
            newStatus: null,
            payload: {
              worktreePath: 'D:\\private\\path', // Should be stripped
              normalField: 'clean-value',
              nested: {
                sessionId: 'sess-123', // Should be stripped
                safeName: 'ok'
              }
            }
          }]
        }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const state = await client.state();
      const proj = state.projects[0] as unknown as Record<string, unknown>;
      assert.equal(proj.projectId, 'p1');
      assert.equal('repositoryRoot' in proj, false, 'repositoryRoot must be stripped');

      const agent = state.agents[0] as unknown as Record<string, unknown>;
      assert.equal(agent.agentId, 'a1');
      assert.equal('worktreePath' in agent, false, 'worktreePath must be stripped');
      assert.equal('cwd' in agent, false, 'cwd must be stripped');
      assert.equal('env' in agent, false, 'env must be stripped');

      const events = await client.events(1);
      const payload = events[0].payload as Record<string, unknown>;
      assert.equal('worktreePath' in payload, false, 'payload.worktreePath must be stripped');
      assert.equal(payload.normalField, 'clean-value');
      const nested = payload.nested as Record<string, unknown>;
      assert.equal('sessionId' in nested, false, 'nested.sessionId must be stripped');
      assert.equal(nested.safeName, 'ok');
    } finally {
      server.close();
    }
  });

  test('oversized body is rejected with BODY_OVERFLOW', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      // Announce Content-Length greater than 8 MiB (e.g. 9 MiB)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': '9437184'
      });
      res.end('{"ok":true}');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => err.code === 'BODY_OVERFLOW');
    } finally {
      server.close();
    }
  });

  test('recursively strips forbidden keys case-insensitively in event payload', { timeout: 5000 }, () => {
    const raw = {
      safeField: 'hello',
      RepositoryRoot: 'C:\\repo',
      repositoryroot: 'C:\\repo2',
      CWD: 'D:\\cwd',
      cwd: 'D:\\cwd2',
      SESSIONID: 'secret-sess',
      sessionId: 'sess-2',
      ENV: { API_KEY: 'key' },
      nested: {
        normal: 123,
        WorktreePath: 'E:\\wt',
        deep: [
          { safe: true, GitDir: 'F:\\git' },
          { SafeItem: 'val', PROFILEHASH: 'hash-abc' }
        ]
      }
    };

    const sanitized = sanitizeEventPayload(raw) as Record<string, unknown>;
    assert.equal(sanitized.safeField, 'hello');
    assert.equal('RepositoryRoot' in sanitized, false);
    assert.equal('repositoryroot' in sanitized, false);
    assert.equal('CWD' in sanitized, false);
    assert.equal('cwd' in sanitized, false);
    assert.equal('SESSIONID' in sanitized, false);
    assert.equal('sessionId' in sanitized, false);
    assert.equal('ENV' in sanitized, false);

    const nested = sanitized.nested as Record<string, unknown>;
    assert.equal(nested.normal, 123);
    assert.equal('WorktreePath' in nested, false);

    const deep = nested.deep as Array<Record<string, unknown>>;
    assert.equal(deep[0].safe, true);
    assert.equal('GitDir' in deep[0], false);
    assert.equal(deep[1].SafeItem, 'val');
    assert.equal('PROFILEHASH' in deep[1], false);
  });
});

describe('AgentHub DTO Strict Runtime Validation', () => {
  const validAgent = {
    agentId: 'a1',
    projectId: null,
    name: 'Agent 1',
    providerId: 'codex',
    position: 'engineer',
    status: 'idle',
    authority: 'autonomous',
    routingPriority: 0,
    enabled: true,
    allowedComplexities: ['low', 'medium'],
    allowedRiskLevels: ['low'],
    capabilities: ['code'],
    specialties: ['ts'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  };

  test('snapshotAgentDto succeeds with valid required and nullable fields', { timeout: 5000 }, () => {
    const agent = snapshotAgentDto(validAgent);
    assert.equal(agent.agentId, 'a1');
    assert.equal(agent.projectId, null);
    assert.equal(agent.enabled, true);
    assert.equal(agent.routingPriority, 0);
  });

  test('snapshotAgentDto fails closed with AgentHubValidationError on missing or malformed fields', { timeout: 5000 }, () => {
    assert.throws(() => snapshotAgentDto({ ...validAgent, name: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, name: '   ' }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    // Missing required nullable field (undefined is rejected)
    assert.throws(() => snapshotAgentDto({ ...validAgent, projectId: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    // Non-finite routingPriority
    assert.throws(() => snapshotAgentDto({ ...validAgent, routingPriority: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, routingPriority: NaN }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, routingPriority: Infinity }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, routingPriority: -Infinity }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, routingPriority: '1' }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    // Non-boolean enabled
    assert.throws(() => snapshotAgentDto({ ...validAgent, enabled: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, enabled: 1 }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    // Missing/null arrays
    assert.throws(() => snapshotAgentDto({ ...validAgent, capabilities: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAgentDto({ ...validAgent, capabilities: null }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
  });

  const validTask = {
    taskId: 't1',
    projectId: 'p1',
    title: 'Task 1',
    description: null,
    complexity: 'low',
    risk: 'low',
    status: 'pending',
    assignedAgentId: null,
    assignmentId: null,
    requiredCapabilities: [],
    requiredSpecialties: [],
    acceptanceCriteria: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  };

  test('snapshotTaskDto fails closed on missing nullable fields or arrays', { timeout: 5000 }, () => {
    const task = snapshotTaskDto(validTask);
    assert.equal(task.taskId, 't1');
    assert.equal(task.description, null);

    assert.throws(() => snapshotTaskDto({ ...validTask, description: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotTaskDto({ ...validTask, assignedAgentId: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotTaskDto({ ...validTask, assignmentId: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotTaskDto({ ...validTask, requiredCapabilities: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
  });

  const validAssignment = {
    assignmentId: 'as1',
    taskId: 't1',
    agentId: 'a1',
    specVersion: '1.0',
    status: 'assigned',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  };

  test('snapshotAssignmentDto fails closed on missing specVersion (no default synthesis)', { timeout: 5000 }, () => {
    const asg = snapshotAssignmentDto(validAssignment);
    assert.equal(asg.specVersion, '1.0');

    assert.throws(() => snapshotAssignmentDto({ ...validAssignment, specVersion: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotAssignmentDto({ ...validAssignment, specVersion: '' }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
  });

  test('snapshotProjectDto fails closed on missing description', { timeout: 5000 }, () => {
    const validProj = {
      projectId: 'p1',
      name: 'Proj 1',
      description: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    };
    const proj = snapshotProjectDto(validProj);
    assert.equal(proj.projectId, 'p1');

    assert.throws(() => snapshotProjectDto({ ...validProj, description: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
  });

  test('snapshotEventDto fails closed on missing structural fields or missing nullable fields', { timeout: 5000 }, () => {
    const validEvt = {
      eventId: 'e1',
      eventType: 'task.created',
      timestamp: '2026-01-01T00:00:00Z',
      projectId: null,
      agentId: null,
      taskId: null,
      assignmentId: null,
      actor: null,
      oldStatus: null,
      newStatus: null,
      payload: {}
    };
    const evt = snapshotEventDto(validEvt);
    assert.equal(evt.eventId, 'e1');
    assert.equal(evt.projectId, null);
    assert.deepEqual(evt.payload, {});

    assert.throws(() => snapshotEventDto({ ...validEvt, eventId: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
    assert.throws(() => snapshotEventDto({ ...validEvt, projectId: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_FIELD'
    });
  });

  test('snapshotEventDto and sanitizeEventPayload: strict contract closure for payloads', { timeout: 5000 }, () => {
    const baseEvt = {
      eventId: 'e1',
      eventType: 'task.created',
      timestamp: '2026-01-01T00:00:00Z',
      projectId: null,
      agentId: null,
      taskId: null,
      assignmentId: null,
      actor: null,
      oldStatus: null,
      newStatus: null
    };

    // 1. missing payload -> rejected
    assert.throws(() => snapshotEventDto({ ...baseEvt }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_EVENT'
    });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: undefined }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_EVENT'
    });

    // 2. {} -> accepted
    const emptyObjEvt = snapshotEventDto({ ...baseEvt, payload: {} });
    assert.deepEqual(emptyObjEvt.payload, {});

    // 3. scalar string -> accepted/preserved
    const strEvt = snapshotEventDto({ ...baseEvt, payload: 'hello world' });
    assert.equal(strEvt.payload, 'hello world');

    // 4. number -> accepted/preserved
    const numEvt = snapshotEventDto({ ...baseEvt, payload: 42 });
    assert.equal(numEvt.payload, 42);

    // 5. boolean -> accepted/preserved
    const boolEvt = snapshotEventDto({ ...baseEvt, payload: true });
    assert.equal(boolEvt.payload, true);

    // 6. array -> accepted/preserved
    const arrEvt = snapshotEventDto({ ...baseEvt, payload: ['item1', 123, false] });
    assert.deepEqual(arrEvt.payload, ['item1', 123, false]);

    // 7. array containing null -> null retained
    const arrNullEvt = snapshotEventDto({ ...baseEvt, payload: ['a', null, 'b'] });
    assert.deepEqual(arrNullEvt.payload, ['a', null, 'b']);

    // 8. nested forbidden keys -> stripped
    const nestedEvt = snapshotEventDto({
      ...baseEvt,
      payload: {
        safeField: 'val',
        repositoryRoot: 'C:\\secret',
        nested: {
          innerSafe: 99,
          gitDir: 'D:\\git'
        }
      }
    });
    assert.deepEqual(nestedEvt.payload, {
      safeField: 'val',
      nested: {
        innerSafe: 99
      }
    });

    // 9. array object forbidden keys -> stripped
    const arrObjEvt = snapshotEventDto({
      ...baseEvt,
      payload: [
        { title: 'ok', worktreePath: 'E:\\wt' },
        { id: 1, sessionid: 'sess' }
      ]
    });
    assert.deepEqual(arrObjEvt.payload, [
      { title: 'ok' },
      { id: 1 }
    ]);

    // 10. unsupported values in direct snapshot unit test -> rejected
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: () => {} }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: Symbol('unsupported') }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: BigInt(12345) }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: NaN }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: Infinity }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: -Infinity }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
  });

  test('event payload normalized depth: accepts depth-13 [TRUNCATED], rejects depth-13 containers and depth >13', { timeout: 5000 }, () => {
    const baseEvt = {
      eventId: 'evt-depth',
      eventType: 'agent.updated',
      timestamp: '2026-01-01T00:00:00Z',
      projectId: null,
      agentId: null,
      taskId: null,
      assignmentId: null,
      actor: null,
      oldStatus: null,
      newStatus: null
    };

    // Helper to construct container at depth 12 holding child at depth 13
    const makeDeepPayload = (leaf: unknown): unknown => {
      let cur: unknown = leaf;
      for (let d = 12; d >= 0; d--) {
        cur = { [`l_${d}`]: cur };
      }
      return cur;
    };

    // 1. Valid backend-normalized fixture: container at depth 12 with [TRUNCATED] at depth 13
    const validDeep = makeDeepPayload('[TRUNCATED]');
    const dto = snapshotEventDto({ ...baseEvt, payload: validDeep });
    let check: any = dto.payload;
    for (let d = 0; d <= 12; d++) {
      check = check[`l_${d}`];
    }
    assert.equal(check, '[TRUNCATED]', 'deepest leaf must remain exactly [TRUNCATED]');

    // 2. Invalid container continuation at depth 13: object at depth 13 -> rejected
    const invalidObjContinuation = makeDeepPayload({ deeper: 1 });
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: invalidObjContinuation }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });

    // 3. Invalid container continuation at depth 13: array at depth 13 -> rejected
    const invalidArrContinuation = makeDeepPayload(['deeper']);
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: invalidArrContinuation }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });

    // 4. Invalid non-[TRUNCATED] leaf at depth 13 -> rejected
    const invalidScalarDepth13 = makeDeepPayload('not-truncated-string');
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: invalidScalarDepth13 }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });

    // 5. Direct depth > 13 rejected
    assert.throws(() => sanitizeEventPayload('val', 14), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });
  });

  test('event payload collection semantics: preserves 1000 items, rejects >1000 array items, preserves >1000 object keys and strips forbidden keys', { timeout: 5000 }, () => {
    const baseEvt = {
      eventId: 'evt-coll',
      eventType: 'agent.updated',
      timestamp: '2026-01-01T00:00:00Z',
      projectId: null,
      agentId: null,
      taskId: null,
      assignmentId: null,
      actor: null,
      oldStatus: null,
      newStatus: null
    };

    // 1. Array length 1000 -> accepted and preserved exactly
    const arr1000 = Array.from({ length: 1000 }, (_, i) => `item_${i}`);
    const evt1000 = snapshotEventDto({ ...baseEvt, payload: arr1000 });
    const resArr = evt1000.payload as readonly unknown[];
    assert.equal(resArr.length, 1000);
    assert.equal(resArr[0], 'item_0');
    assert.equal(resArr[999], 'item_999');

    // 2. Array length 1001 -> rejected fail-closed, not truncated
    const arr1001 = Array.from({ length: 1001 }, (_, i) => `item_${i}`);
    assert.throws(() => snapshotEventDto({ ...baseEvt, payload: arr1001 }), {
      name: 'AgentHubValidationError',
      code: 'MALFORMED_PAYLOAD'
    });

    // 3. Object with >1000 allowed keys (1050 keys) -> preserved, not silently truncated
    const bigObj: Record<string, unknown> = {};
    for (let i = 0; i < 1050; i++) {
      bigObj[`k_${i}`] = i;
    }
    // Add forbidden private keys
    bigObj['repositoryRoot'] = 'C:\\secret';
    bigObj['CWD'] = 'D:\\secret';
    bigObj['SessionId'] = 'secret-session';

    const evtBigObj = snapshotEventDto({ ...baseEvt, payload: bigObj });
    const resObj = evtBigObj.payload as Record<string, unknown>;

    // Allowed keys count must be exactly 1050
    assert.equal(Object.keys(resObj).length, 1050);
    assert.equal(resObj['k_0'], 0);
    assert.equal(resObj['k_1049'], 1049);

    // Forbidden keys must be stripped
    assert.equal('repositoryRoot' in resObj, false);
    assert.equal('CWD' in resObj, false);
    assert.equal('cwd' in resObj, false);
    assert.equal('SessionId' in resObj, false);
    assert.equal('sessionid' in resObj, false);
  });
});

describe('AgentHubRestClient Mutation POST /api/v1/tasks', () => {
  const sampleInput: CreateTaskInputDto = {
    projectId: 'p-mutation',
    title: 'Test Create Task',
    description: 'Sample description',
    requiredCapabilities: ['python'],
    requiredSpecialties: ['ml'],
    acceptanceCriteria: ['Valid model'],
    complexity: 'COMPLEX',
    risk: 'MEDIUM'
  };

  test('createTask successfully POSTs to /api/v1/tasks with 201 and validates TaskDto', { timeout: 5000 }, async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    let capturedHeaders: Record<string, string | string[] | undefined> = {};
    let capturedBody = '';

    const expectedTask = {
      taskId: 't-new-1',
      projectId: 'p-mutation',
      title: 'Test Create Task',
      description: 'Sample description',
      requiredCapabilities: ['python'],
      requiredSpecialties: ['ml'],
      acceptanceCriteria: ['Valid model'],
      complexity: 'COMPLEX',
      risk: 'MEDIUM',
      status: 'pending',
      assignedAgentId: null,
      assignmentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };

    const server = http.createServer((req, res) => {
      capturedMethod = req.method || '';
      capturedUrl = req.url || '';
      capturedHeaders = req.headers;

      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        capturedBody = body;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 'req-create-1',
          data: expectedTask
        }));
      });
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const task = await client.createTask(sampleInput, 'desktop-task:sub-1');
      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedUrl, '/api/v1/tasks');
      assert.equal(capturedHeaders['content-type'], 'application/json');
      assert.equal(capturedHeaders['accept'], 'application/json');
      assert.equal(capturedHeaders['idempotency-key'], 'desktop-task:sub-1');
      assert.deepEqual(JSON.parse(capturedBody), sampleInput);

      assert.equal(task.taskId, 't-new-1');
      assert.equal(task.status, 'pending');
    } finally {
      server.close();
    }
  });

  test('createTask rejects non-201 response with HTTP_ERROR', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      // Return 200 instead of 201
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, requestId: 'r2', data: {} }));
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      await assert.rejects(
        () => client.createTask(sampleInput, 'key-200'),
        (err: AgentHubContractError) => err.code === 'HTTP_ERROR'
      );
    } finally {
      server.close();
    }
  });

  test('createTask propagates backend error envelopes', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'err-1',
        error: {
          code: 'INVALID_TASK_INPUT',
          message: 'Project does not exist'
        }
      }));
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      await assert.rejects(
        () => client.createTask(sampleInput, 'key-err'),
        (err: AgentHubContractError) => err.code === 'INVALID_TASK_INPUT' && err.message === 'Project does not exist'
      );
    } finally {
      server.close();
    }
  });

  test('createTask rejects malformed TaskDto with MALFORMED_TASK', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        requestId: 'r-bad',
        data: { missingTaskId: true }
      }));
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      await assert.rejects(
        () => client.createTask(sampleInput, 'key-bad-dto'),
        (err: AgentHubContractError) => err.code === 'MALFORMED_TASK'
      );
    } finally {
      server.close();
    }
  });

  test('mutation allowlist: createTask and executeTask exist; no review/merge or generic request', { timeout: 5000 }, () => {
    const client = new AgentHubRestClient();
    assert.equal(typeof client.createTask, 'function');
    assert.equal(typeof client.executeTask, 'function');

    assert.equal((client as any).reviewTask, undefined);
    assert.equal((client as any).mergeTask, undefined);
    assert.equal((client as any).post, undefined);
    assert.equal((client as any).request, undefined);
    assert.equal((client as any).fetch, undefined);
  });

  test('createTask rejects a blank Idempotency-Key before sending', { timeout: 5000 }, async () => {
    let hit = false;
    const server = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, requestId: 'r', data: {} }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
    try {
      await assert.rejects(
        () => client.createTask(sampleInput, '   '),
        (err: AgentHubContractError) => err.code === 'INVALID_IDEMPOTENCY_KEY'
      );
      assert.equal(hit, false);
    } finally {
      server.close();
    }
  });
});

describe('AgentHubRestClient Mutation POST /api/v1/tasks/:taskId/execute', () => {
  const HEX64 = 'a'.repeat(64);
  const OID40 = 'b'.repeat(40);
  const sampleInput = { baseRef: 'main', prompt: 'Implement the change' };

  const reviewReady = {
    outcome: 'review-ready',
    reviewHandle: HEX64,
    reviewBundleSha256: HEX64,
    taskId: 'task-1',
    assignmentId: 'asg-1',
    agentId: 'agent-1',
    providerId: 'codex',
    workerResult: { summary: 'done', blockers: [], questions: [], risks: [], notes: [] },
    source: {
      branchName: 'agent/task-1',
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
    evidenceSha256: HEX64
  };

  test('executeTask POSTs encoded path, exact body, and Main-owned Idempotency-Key', { timeout: 5000 }, async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    let capturedHeaders: Record<string, string | string[] | undefined> = {};
    let capturedBody = '';

    const server = http.createServer((req, res) => {
      capturedMethod = req.method || '';
      capturedUrl = req.url || '';
      capturedHeaders = req.headers;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        capturedBody = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'req-exec-1', data: reviewReady }));
      });
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const result = await client.executeTask('task/a b', sampleInput, 'desktop-execute:exec-1');
      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedUrl, `/api/v1/tasks/${encodeURIComponent('task/a b')}/execute`);
      assert.equal(capturedHeaders['content-type'], 'application/json');
      assert.equal(capturedHeaders['accept'], 'application/json');
      assert.equal(capturedHeaders['idempotency-key'], 'desktop-execute:exec-1');
      assert.deepEqual(JSON.parse(capturedBody), sampleInput);
      assert.equal(result.outcome, 'review-ready');
    } finally {
      server.close();
    }
  });

  test('executeTask parses blocked, waiting-input, and failed lifecycle DTOs', { timeout: 5000 }, async () => {
    const outcomes = ['blocked', 'waiting-input', 'failed'] as const;
    for (const outcome of outcomes) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: `req-${outcome}`,
          data: {
            outcome,
            taskId: 'task-1',
            assignmentId: 'asg-1',
            lifecycleSha256: HEX64
          }
        }));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };
      const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
      try {
        const result = await client.executeTask('task-1', sampleInput, `key-${outcome}`);
        assert.equal(result.outcome, outcome);
      } finally {
        server.close();
      }
    }
  });

  test('executeTask rejects unknown outcome and malformed success DTO', { timeout: 5000 }, async () => {
    const payloads = [
      { outcome: 'merge-ready', taskId: 't', assignmentId: 'a', lifecycleSha256: HEX64 },
      { outcome: 'blocked', taskId: 't' }
    ];
    for (const data of payloads) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'bad', data }));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };
      const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
      try {
        await assert.rejects(
          () => client.executeTask('task-1', sampleInput, 'key-bad'),
          (err: AgentHubContractError) => err.code === 'MALFORMED_EXECUTE_RESULT'
        );
      } finally {
        server.close();
      }
    }
  });

  test('executeTask rejects non-200 success and propagates non-2xx envelopes', { timeout: 5000 }, async () => {
    const server201 = http.createServer((_req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, requestId: 'r201', data: reviewReady }));
    });
    await new Promise<void>((r) => server201.listen(0, '127.0.0.1', () => r()));
    const addr201 = server201.address() as { port: number };
    const client201 = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr201.port}` });
    try {
      await assert.rejects(
        () => client201.executeTask('task-1', sampleInput, 'key-201'),
        (err: AgentHubContractError) => err.code === 'HTTP_ERROR'
      );
    } finally {
      server201.close();
    }

    const serverErr = http.createServer((_req, res) => {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'err',
        error: { code: 'AGENTHUB_API_CONFLICT', message: 'already reserved' }
      }));
    });
    await new Promise<void>((r) => serverErr.listen(0, '127.0.0.1', () => r()));
    const addrErr = serverErr.address() as { port: number };
    const clientErr = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addrErr.port}` });
    try {
      await assert.rejects(
        () => clientErr.executeTask('task-1', sampleInput, 'key-err'),
        (err: AgentHubContractError) => err.code === 'AGENTHUB_API_CONFLICT'
      );
    } finally {
      serverErr.close();
    }
  });

  test('prompt under field limit but serialized body over 1 MiB is rejected with zero HTTP', { timeout: 5000 }, async () => {
    let hit = false;
    const server = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, requestId: 'r', data: {} }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const prompt = 'x'.repeat(1024 * 1024 - 1);
    try {
      await assert.rejects(
        () => client.executeTask('task-1', { baseRef: 'main', prompt }, 'key-overflow'),
        (err: AgentHubContractError) => err.code === 'BODY_OVERFLOW'
      );
      assert.equal(hit, false);
    } finally {
      server.close();
    }
  });

  test('near-limit valid execute body is sent', { timeout: 5000 }, async () => {
    let capturedBody = '';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        capturedBody = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 'r',
          data: {
            outcome: 'failed',
            taskId: 'task-1',
            assignmentId: 'asg-1',
            lifecycleSha256: HEX64
          }
        }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
    try {
      await client.executeTask('task-1', { baseRef: 'main', prompt: 'hi' }, 'key-near');
      const parsed = JSON.parse(capturedBody);
      assert.equal(parsed.baseRef, 'main');
      assert.equal(parsed.prompt, 'hi');
      assert.equal(Object.keys(parsed).length, 2);
      assert.ok(Buffer.byteLength(capturedBody, 'utf8') < 1024 * 1024);
    } finally {
      server.close();
    }
  });

  test('executeTask still enforces 8 MiB response bound', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': '9437184'
      });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
    try {
      await assert.rejects(
        () => client.executeTask('task-1', sampleInput, 'key-overflow-resp'),
        (err: AgentHubContractError) => err.code === 'BODY_OVERFLOW'
      );
    } finally {
      server.close();
    }
  });

  test('invalid execute input never sends HTTP', { timeout: 5000 }, async () => {
    let hit = false;
    const server = http.createServer((_req, res) => {
      hit = true;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
    try {
      await assert.rejects(() => client.executeTask('task-1', { baseRef: 'main\n', prompt: 'x' } as any, 'k'));
      await assert.rejects(() => client.executeTask('task\nid', sampleInput, 'k'));
      assert.equal(hit, false);
    } finally {
      server.close();
    }
  });
});
