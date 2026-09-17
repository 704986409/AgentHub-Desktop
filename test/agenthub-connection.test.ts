import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubStateCache } from '../src/main/agenthub/AgentHubStateCache';

describe('AgentHubStateCache', () => {
  test('emits change events on status, health, and snapshot updates', () => {
    const cache = new AgentHubStateCache();
    const changes: string[] = [];

    cache.on('change', (state) => {
      changes.push(state.connection);
    });

    assert.equal(cache.getState().connection, 'disconnected');

    cache.setConnectionStatus('connecting');
    assert.equal(cache.getState().connection, 'connecting');

    cache.setHealth({ status: 'ok', version: '0.7.0' });
    assert.equal(cache.getState().health?.version, '0.7.0');

    cache.updateSnapshot({
      projects: [{ projectId: 'p1', name: 'P1', createdAt: '2026', updatedAt: '2026' }],
      agents: [],
      tasks: [],
      assignments: []
    });
    assert.equal(cache.getState().connection, 'connected');
    assert.equal(cache.getState().snapshot?.projects.length, 1);
    assert.ok(cache.getState().lastSyncAt);

    cache.recordEventTimestamp('2026-01-01T00:00:00Z');
    assert.equal(cache.getState().lastEventAt, '2026-01-01T00:00:00Z');

    assert.ok(changes.length >= 4);
  });
});

describe('AgentHubConnection Coordinator', () => {
  test('orchestrates start, initial sync, WS event coalesced resync, and clean stop', async () => {
    let stateFetchCount = 0;
    let wsClientSocket: WebSocket | null = null;

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }

      if (req.url === '/api/v1/state') {
        stateFetchCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: `s-${stateFetchCount}`,
          data: {
            projects: [],
            agents: [{ agentId: `agent-${stateFetchCount}`, projectId: 'p1', name: 'Bot', providerId: 'claude', status: 'idle', enabled: true, createdAt: '2026', updatedAt: '2026' }],
            tasks: [],
            assignments: []
          }
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      wsClientSocket = ws;
      ws.send(JSON.stringify({
        type: 'hello',
        version: 1,
        apiVersion: '0.7.0'
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const connection = new AgentHubConnection({ baseUrl });

    try {
      await connection.start();

      // Wait a tick for initial sync and hello to settle
      await new Promise((r) => setTimeout(r, 100));

      const state = connection.getState();
      assert.equal(state.connection, 'connected');
      assert.equal(state.health?.version, '0.7.0');
      assert.ok(state.snapshot);
      assert.ok(stateFetchCount >= 1);

      // Now simulate server firing 3 rapid events -> coalesced into 1 sync
      const prevFetchCount = stateFetchCount;
      wsClientSocket?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: { eventId: 'e1', eventType: 'task.updated', timestamp: '2026-01-01T00:00:01Z' }
      }));
      wsClientSocket?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: { eventId: 'e2', eventType: 'task.updated', timestamp: '2026-01-01T00:00:02Z' }
      }));
      wsClientSocket?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: { eventId: 'e3', eventType: 'task.updated', timestamp: '2026-01-01T00:00:03Z' }
      }));

      // Wait for debounce (50ms) to fire
      await new Promise((r) => setTimeout(r, 150));

      assert.ok(stateFetchCount > prevFetchCount);
      assert.equal(connection.getState().lastEventAt, '2026-01-01T00:00:03Z');

      // Test manual refresh
      await connection.refresh();
      assert.ok(stateFetchCount > prevFetchCount + 1);

      // Test clean stop
      connection.stop();
      assert.equal(connection.getState().connection, 'disconnected');
    } finally {
      connection.stop();
      wss.close();
      server.close();
    }
  });

  test('gracefully handles offline server and enters backoff without crashing', async () => {
    // Pick an unused port where no server is listening
    const connection = new AgentHubConnection({ baseUrl: 'http://127.0.0.1:39999' });

    try {
      await connection.start();
      const state = connection.getState();
      assert.equal(state.connection, 'connecting');
      assert.ok(state.lastError);
      assert.equal(state.snapshot, null);
    } finally {
      connection.stop();
      assert.equal(connection.getState().connection, 'disconnected');
    }
  });
});
