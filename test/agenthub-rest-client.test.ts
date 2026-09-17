import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  AgentHubRestClient,
  AgentHubContractError,
  validateAgentHubBaseUrl
} from '../src/main/agenthub/AgentHubRestClient';

describe('validateAgentHubBaseUrl', () => {
  test('accepts valid 127.0.0.1 URLs', () => {
    assert.equal(validateAgentHubBaseUrl('http://127.0.0.1:3210'), 'http://127.0.0.1:3210');
    assert.equal(validateAgentHubBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
    assert.equal(validateAgentHubBaseUrl('  http://127.0.0.1:3000  '), 'http://127.0.0.1:3000');
  });

  test('rejects non-loopback hostnames or IPs', () => {
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

  test('rejects non-http protocols', () => {
    assert.throws(() => validateAgentHubBaseUrl('https://127.0.0.1:3210'), {
      name: 'AgentHubContractError',
      code: 'INVALID_PROTOCOL'
    });
    assert.throws(() => validateAgentHubBaseUrl('ws://127.0.0.1:3210'), {
      name: 'AgentHubContractError',
      code: 'INVALID_PROTOCOL'
    });
  });

  test('rejects credentials, paths, query, and fragments', () => {
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
  test('successfully performs GET health, state, and events with STRICT GET only', async () => {
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
            { eventId: 'evt-1', eventType: 'task.created', timestamp: '2026-01-01T00:00:00Z' }
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

  test('rejects health when status is not ok or version is blank', async () => {
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

  test('validates envelopes: rejects missing or blank requestId and validates error shapes', async () => {
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
    } finally {
      server.close();
    }
  });

  test('runtime snapshot sanitizes private fields from state and events', async () => {
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

  test('oversized body is rejected with BODY_OVERFLOW', async () => {
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
});
