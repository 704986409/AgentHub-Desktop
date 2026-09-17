import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubStateCache } from '../src/main/agenthub/AgentHubStateCache';

describe('AgentHubStateCache', () => {
  test('emits change events on status, health, and snapshot updates without coupling connection', () => {
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

    // updateSnapshot must NOT forcibly set connection to 'connected'
    cache.updateSnapshot({
      projects: [{ projectId: 'p1', name: 'P1', description: null, createdAt: '2026', updatedAt: '2026' }],
      agents: [],
      tasks: [],
      assignments: []
    });
    assert.equal(cache.getState().connection, 'connecting', 'updateSnapshot must not infer connected status');
    assert.equal(cache.getState().snapshot?.projects.length, 1);
    assert.ok(cache.getState().lastSyncAt);

    cache.setConnectionStatus('connected');
    assert.equal(cache.getState().connection, 'connected');

    cache.recordEventTimestamp('2026-01-01T00:00:00Z');
    assert.equal(cache.getState().lastEventAt, '2026-01-01T00:00:00Z');

    assert.ok(changes.length >= 4);
  });
});

describe('AgentHubConnection Lifecycle and Failure Closures', () => {
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
            agents: [{
              agentId: `agent-${stateFetchCount}`,
              projectId: null,
              name: 'Bot',
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
              createdAt: '2026',
              updatedAt: '2026'
            }],
            tasks: [],
            assignments: []
          }
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, requestId: '404', error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      wsClientSocket = ws;
      ws.send(JSON.stringify({
        type: 'hello',
        version: 1,
        apiVersion: 'v1'
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

      // Simulate burst of 3 WS events -> coalesced into 1 sync
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

      // Wait for debounce to fire
      await new Promise((r) => setTimeout(r, 150));

      assert.ok(stateFetchCount > prevFetchCount);
      assert.equal(connection.getState().lastEventAt, '2026-01-01T00:00:03Z');

      // Test manual refresh
      await connection.refresh();
      assert.ok(stateFetchCount > prevFetchCount + 1);

      // Test clean stop
      connection.stop();
      assert.equal(connection.getState().connection, 'disconnected');

      // Test refresh after stop: returns null, does NOT reconnect
      const afterStopRes = await connection.refresh();
      assert.equal(afterStopRes, null);
      assert.equal(connection.getState().connection, 'disconnected');
    } finally {
      connection.stop();
      wss.close();
      server.close();
    }
  });

  test('backend-later recovery: starts offline, server appears later, transitions to connected', async () => {
    // 1. Acquire an unused ephemeral port
    const helperServer = net.createServer();
    const port = await new Promise<number>((resolve) => {
      helperServer.listen(0, '127.0.0.1', () => {
        const p = (helperServer.address() as net.AddressInfo).port;
        helperServer.close(() => resolve(p));
      });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const connection = new AgentHubConnection({ baseUrl });

    let server: http.Server | null = null;
    let wss: WebSocketServer | null = null;

    try {
      // 2. Start connection when backend is offline
      await connection.start();
      assert.equal(connection.getState().connection, 'connecting');
      assert.ok(connection.getState().lastError);

      // 3. Start backend now on the target port
      server = http.createServer((req, res) => {
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
            data: { projects: [], agents: [], tasks: [], assignments: [] }
          }));
          return;
        }
      });

      wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({
          type: 'hello',
          version: 1,
          apiVersion: 'v1'
        }));
      });

      await new Promise<void>((resolve) => server!.listen(port, '127.0.0.1', () => resolve()));

      // 4. Wait for backoff reconnection (first delay is 1000ms)
      const maxWaitMs = 2500;
      const startWait = Date.now();
      while (Date.now() - startWait < maxWaitMs) {
        if (connection.getState().connection === 'connected') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      assert.equal(connection.getState().connection, 'connected');
      assert.equal(connection.getState().health?.version, '0.7.0');
      assert.ok(connection.getState().snapshot);
    } finally {
      connection.stop();
      if (wss) wss.close();
      if (server) server.close();
    }
  });

  test('stop-race: in-flight delayed REST response cannot resurrect connection after stop', async () => {
    let releaseResponse: (() => void) | null = null;

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        // Intentionally hold response until released
        new Promise<void>((resolve) => {
          releaseResponse = resolve;
        }).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            requestId: 's-delayed',
            data: {
              projects: [{ projectId: 'stale-p', name: 'Stale', description: null, createdAt: '2026', updatedAt: '2026' }],
              agents: [],
              tasks: [],
              assignments: []
            }
          }));
        });
        return;
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      void connection.start();

      // Wait a tick so /health finishes and /state is in-flight
      await new Promise((r) => setTimeout(r, 60));

      // Stop while /state is still in-flight
      connection.stop();
      assert.equal(connection.getState().connection, 'disconnected');

      // Now release the delayed response
      if (releaseResponse) (releaseResponse as () => void)();
      await new Promise((r) => setTimeout(r, 60));

      // Connection MUST remain disconnected and snapshot must NOT be set
      assert.equal(connection.getState().connection, 'disconnected');
      assert.equal(connection.getState().snapshot, null, 'Stale async response must not set snapshot after stop');
    } finally {
      connection.stop();
      server.close();
    }
  });

  test('resync-failure: when authoritative resync fails, state downgrades to degraded and retains snapshot', async () => {
    let returnErrorOnState = false;
    let wsClient: WebSocket | null = null;

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        if (returnErrorOnState) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            requestId: 'err-500',
            error: { code: 'SYNC_ERROR', message: 'Backend DB dead' }
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: 's-ok',
          data: {
            projects: [{ projectId: 'p-initial', name: 'Initial', description: null, createdAt: '2026', updatedAt: '2026' }],
            agents: [],
            tasks: [],
            assignments: []
          }
        }));
        return;
      }
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      wsClient = ws;
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      await connection.start();
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(connection.getState().connection, 'connected');
      assert.equal(connection.getState().snapshot?.projects[0].projectId, 'p-initial');

      // Now set backend /state to fail
      returnErrorOnState = true;

      // Send event to trigger resync
      wsClient?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: { eventId: 'e-fail', eventType: 'task.broken', timestamp: '2026-01-01T00:00:00Z' }
      }));

      // Wait for debounce and sync to fail
      await new Promise((r) => setTimeout(r, 200));

      // Must degrade to 'degraded', retaining the initial snapshot
      assert.equal(connection.getState().connection, 'degraded');
      assert.equal(connection.getState().snapshot?.projects[0].projectId, 'p-initial', 'Snapshot must be retained');
      assert.equal(connection.getState().lastError?.code, 'SYNC_ERROR');
    } finally {
      connection.stop();
      wss.close();
      server.close();
    }
  });
});
