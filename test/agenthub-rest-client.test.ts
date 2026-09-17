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
        res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } }));
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
            projects: [{ projectId: 'p1', name: 'Project 1', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
            agents: [{ agentId: 'a1', projectId: 'p1', name: 'Agent 1', providerId: 'claude', status: 'idle', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
            tasks: [{ taskId: 't1', projectId: 'p1', title: 'Task 1', description: 'Desc', status: 'pending', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
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
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
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
      assert.equal(state.agents[0].name, 'Agent 1');
      assert.equal(state.tasks[0].title, 'Task 1');

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

  test('handles malformed envelopes and HTTP errors gracefully', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        // Missing ok envelope
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.7.0' }));
        return;
      }
      if (req.url === '/api/v1/state') {
        // ok: false envelope
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          requestId: 'err-1',
          error: { code: 'INTERNAL_ERROR', message: 'Database failed' }
        }));
        return;
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      await assert.rejects(async () => {
        await client.health();
      }, (err: AgentHubContractError) => {
        return err.code === 'MALFORMED_ENVELOPE';
      });

      await assert.rejects(async () => {
        await client.state();
      }, (err: AgentHubContractError) => {
        return err.code === 'INTERNAL_ERROR' && err.message === 'Database failed';
      });
    } finally {
      server.close();
    }
  });
});
