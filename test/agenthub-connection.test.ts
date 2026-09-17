import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRealtimeClient } from '../src/main/agenthub/AgentHubRealtimeClient';
import { AgentHubStateCache } from '../src/main/agenthub/AgentHubStateCache';

describe('AgentHubStateCache', () => {
  test('emits change events on status, health, and snapshot updates without coupling connection', { timeout: 5000 }, () => {
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
  test('orchestrates start, initial sync, WS event coalesced resync, and clean stop', { timeout: 5000 }, async () => {
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
      const mkEvent = (id: string, ts: string) => ({
        eventId: id,
        eventType: 'task.updated',
        timestamp: ts,
        projectId: null,
        agentId: null,
        taskId: null,
        assignmentId: null,
        actor: null,
        oldStatus: null,
        newStatus: null,
        payload: {}
      });

      wsClientSocket?.send(JSON.stringify({ type: 'event', version: 1, event: mkEvent('e1', '2026-01-01T00:00:01Z') }));
      wsClientSocket?.send(JSON.stringify({ type: 'event', version: 1, event: mkEvent('e2', '2026-01-01T00:00:02Z') }));
      wsClientSocket?.send(JSON.stringify({ type: 'event', version: 1, event: mkEvent('e3', '2026-01-01T00:00:03Z') }));

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
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('backend-later recovery: starts offline, server appears later, transitions to connected', { timeout: 5000 }, async () => {
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
      if (wss) {
        for (const c of wss.clients) c.terminate();
        wss.close();
      }
      if (server) server.close();
    }
  });

  test('stop-race: in-flight delayed REST response cannot resurrect connection after stop', { timeout: 5000 }, async () => {
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

  test('resync-failure: when authoritative resync fails, state downgrades to degraded and retains snapshot', { timeout: 5000 }, async () => {
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
        event: {
          eventId: 'e-fail',
          eventType: 'task.broken',
          timestamp: '2026-01-01T00:00:00Z',
          projectId: 'p-initial',
          agentId: null,
          taskId: null,
          assignmentId: null,
          actor: null,
          oldStatus: null,
          newStatus: null,
          payload: {}
        }
      }));

      // Wait for debounce and sync to fail
      await new Promise((r) => setTimeout(r, 200));

      // Must degrade to 'degraded', retaining the initial snapshot
      assert.equal(connection.getState().connection, 'degraded');
      assert.equal(connection.getState().snapshot?.projects[0].projectId, 'p-initial', 'Snapshot must be retained');
      assert.equal(connection.getState().lastError?.code, 'SYNC_ERROR');
    } finally {
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('stop-restart race: generation sync ownership prevents stale cleanup from clobbering new generation', { timeout: 5000 }, async () => {
    let stateCalls = 0;
    let releaseGenAResponse: (() => void) | null = null;
    let activeWsClients: WebSocket[] = [];

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }

      if (req.url === '/api/v1/state') {
        stateCalls++;
        const currentCall = stateCalls;
        if (currentCall === 1) {
          // Generation A initial state request: hold it
          new Promise<void>((resolve) => {
            releaseGenAResponse = resolve;
          }).then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              requestId: 's-genA',
              data: {
                projects: [{ projectId: 'proj-A', name: 'Project A', description: null, createdAt: '2026', updatedAt: '2026' }],
                agents: [],
                tasks: [],
                assignments: []
              }
            }));
          });
          return;
        }

        // Generation B state request: respond immediately with B data
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: `s-genB-${currentCall}`,
          data: {
            projects: [{ projectId: `proj-B-${currentCall}`, name: 'Project B', description: null, createdAt: '2026', updatedAt: '2026' }],
            agents: [],
            tasks: [],
            assignments: []
          }
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      activeWsClients.push(ws);
      ws.on('close', () => {
        activeWsClients = activeWsClients.filter((s) => s !== ws);
      });
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      // 1. start generation A
      void connection.start();

      // Wait a tick for /health to finish and /state A to be in flight
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(stateCalls, 1);

      // 3. stop()
      connection.stop();
      assert.equal(connection.getState().connection, 'disconnected');

      // 4. immediately start generation B
      await connection.start();

      // 5. B connects and finishes valid sync
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(connection.getState().connection, 'connected');
      assert.ok(connection.getState().snapshot?.projects[0].projectId?.startsWith('proj-B-'));

      // 6. release A response / allow A finally
      if (releaseGenAResponse) (releaseGenAResponse as () => void)();
      await new Promise((r) => setTimeout(r, 60));

      // 7. send WS event during/after B sync
      const currentWs = activeWsClients[activeWsClients.length - 1];
      assert.ok(currentWs, 'Active WS for generation B must exist');
      currentWs.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: {
          eventId: 'evt-b-1',
          eventType: 'task.updated',
          timestamp: '2026-01-01T00:00:10Z',
          projectId: 'proj-B',
          agentId: null,
          taskId: null,
          assignmentId: null,
          actor: null,
          oldStatus: null,
          newStatus: null,
          payload: {}
        }
      }));

      // Wait for debounce and resync
      await new Promise((r) => setTimeout(r, 150));

      // 8. Assert:
      // - B remains authoritative (not reverted to proj-A)
      assert.ok(connection.getState().snapshot?.projects[0].projectId?.startsWith('proj-B-'));
      assert.notEqual(connection.getState().snapshot?.projects[0].projectId, 'proj-A');
      // - state remains connected
      assert.equal(connection.getState().connection, 'connected');
      // - exactly one current WS
      assert.equal(activeWsClients.length, 1);
    } finally {
      if (releaseGenAResponse) (releaseGenAResponse as () => void)();
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('hello-timeout triggers degraded/connecting and single bounded reconnect path', { timeout: 5000 }, async () => {
    let wsConnections = 0;
    let sendHello = false;

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
            projects: [{ projectId: 'p1', name: 'Proj', description: null, createdAt: '2026', updatedAt: '2026' }],
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
      wsConnections++;
      if (sendHello) {
        ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
      }
      // If sendHello is false, do not send hello frame to trigger timeout
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({
      baseUrl: `http://127.0.0.1:${addr.port}`,
      helloTimeoutMs: 60
    });

    try {
      await connection.start();

      // Wait for hello timeout to trigger (60ms + buffer)
      await new Promise((r) => setTimeout(r, 120));

      // After timeout, snapshot is retained but connection is degraded with WS_HELLO_TIMEOUT
      assert.equal(connection.getState().connection, 'degraded');
      assert.equal(connection.getState().lastError?.code, 'WS_HELLO_TIMEOUT');
      assert.ok(connection.getState().snapshot);

      // Now allow hello on next connection
      sendHello = true;

      // Wait for backoff reconnect (1000ms delay)
      const maxWaitMs = 2500;
      const startWait = Date.now();
      while (Date.now() - startWait < maxWaitMs) {
        if (connection.getState().connection === 'connected') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      assert.equal(connection.getState().connection, 'connected');
      assert.ok(wsConnections >= 2);
    } finally {
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('slow-sync + WS-close reconnect: pending reconnect intent is retained and re-armed after sync finishes', { timeout: 5000 }, async () => {
    let stateCalls = 0;
    let delayState = false;
    let releaseState: (() => void) | null = null;
    let activeWsClients: WebSocket[] = [];

    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId: 'h1', data: { status: 'ok', version: '0.7.0' } }));
        return;
      }
      if (req.url === '/api/v1/state') {
        stateCalls++;
        if (delayState) {
          new Promise<void>((resolve) => {
            releaseState = resolve;
          }).then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              requestId: `s-${stateCalls}`,
              data: {
                projects: [{ projectId: 'p1', name: 'SlowSyncProj', description: null, createdAt: '2026', updatedAt: '2026' }],
                agents: [],
                tasks: [],
                assignments: []
              }
            }));
          });
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          requestId: `s-${stateCalls}`,
          data: {
            projects: [{ projectId: 'p1', name: 'Proj1', description: null, createdAt: '2026', updatedAt: '2026' }],
            agents: [],
            tasks: [],
            assignments: []
          }
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      activeWsClients.push(ws);
      ws.on('close', () => {
        activeWsClients = activeWsClients.filter((s) => s !== ws);
      });
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const connection = new AgentHubConnection({
      baseUrl: `http://127.0.0.1:${addr.port}`,
      backoffDelaysMs: [40, 80]
    });

    try {
      // 1. Establish valid REST + WS hello
      await connection.start();
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(connection.getState().connection, 'connected');
      assert.equal(activeWsClients.length, 1);

      // 2. Arm delayed state sync, then trigger REST resync via WS event
      delayState = true;
      const initialWs = activeWsClients[0];
      initialWs.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: {
          eventId: 'evt-slow-1',
          eventType: 'task.updated',
          timestamp: '2026-01-01T00:00:20Z',
          projectId: 'p1',
          agentId: null,
          taskId: null,
          assignmentId: null,
          actor: null,
          oldStatus: null,
          newStatus: null,
          payload: {}
        }
      }));

      // Wait for debounce (50ms) so #doSync runs and enters delayed /state
      await new Promise((r) => setTimeout(r, 80));
      assert.ok(releaseState !== null, '/state request must be in flight and waiting');

      // 3. While resync is in flight, close WS
      initialWs.terminate();

      // 4. Allow reconnect timer to fire while sync remains owned (delay is 40ms)
      await new Promise((r) => setTimeout(r, 70));

      // 5. Verify reconnect intent is retained (status degraded, not reconnected yet because sync owns gen)
      assert.equal(connection.getState().connection, 'degraded');

      // 6. Release REST sync
      delayState = false;
      if (releaseState) (releaseState as () => void)();

      // 7. Backend accepts reconnect, sends valid hello
      const startWait = Date.now();
      while (Date.now() - startWait < 1500) {
        if (connection.getState().connection === 'connected') break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // 9. Assert final state connected
      assert.equal(connection.getState().connection, 'connected');
      assert.equal(connection.getState().snapshot?.projects[0].projectId, 'p1');
      assert.ok(stateCalls >= 3, 'Must have completed initial sync, delayed sync, and reconnect sync');

      // 10. Assert only one current WS
      assert.equal(activeWsClients.length, 1);

      // 11. Assert no reconnect storm: wait 100ms and verify client count stays 1
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(activeWsClients.length, 1);
    } finally {
      delayState = false;
      if (releaseState) (releaseState as () => void)();
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('WS_INIT_FAILED: synchronous socket creation failure schedules bounded recovery and recovers', { timeout: 5000 }, async () => {
    let wsConnections = 0;
    let shouldFail = true;

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
            projects: [{ projectId: 'p1', name: 'InitFailProj', description: null, createdAt: '2026', updatedAt: '2026' }],
            agents: [],
            tasks: [],
            assignments: []
          }
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });
    wss.on('connection', (ws) => {
      wsConnections++;
      ws.send(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const realtimeClient = new AgentHubRealtimeClient({
      baseUrl,
      helloTimeoutMs: 100,
      createWebSocket: (url: string) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('OS socket creation failed');
        }
        return new WebSocket(url);
      }
    });

    const connection = new AgentHubConnection({
      baseUrl,
      realtimeClient,
      backoffDelaysMs: [50, 100]
    });

    try {
      await connection.start();

      // Immediately after start, socket creation threw WS_INIT_FAILED synchronously.
      // Connection has snapshot so it must degrade and report WS_INIT_FAILED
      assert.equal(connection.getState().connection, 'degraded');
      assert.equal(connection.getState().lastError?.code, 'WS_INIT_FAILED');

      // Wait for bounded reconnect (50ms backoff)
      const startWait = Date.now();
      while (Date.now() - startWait < 1500) {
        if (connection.getState().connection === 'connected') break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Assert recovered to connected
      assert.equal(connection.getState().connection, 'connected');
      assert.equal(wsConnections, 1);
      assert.equal(realtimeClient.isConnected, true);

      // Verify stop suppresses any further activity
      connection.stop();
      assert.equal(connection.getState().connection, 'disconnected');
    } finally {
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('valid deep backend-normalized event triggers event emission, records lastEventAt, and triggers coalesced REST resync', { timeout: 5000 }, async () => {
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
            agents: [],
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
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(connection.getState().connection, 'connected');
      const initialFetchCount = stateFetchCount;
      assert.ok(initialFetchCount >= 1);

      // Construct backend normalized depth-13 payload
      let deepPayload: unknown = '[TRUNCATED]';
      for (let d = 12; d >= 0; d--) {
        deepPayload = { [`l_${d}`]: deepPayload };
      }

      // Send deep event over WebSocket
      wsClientSocket?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: {
          eventId: 'evt-deep-sync',
          eventType: 'agent.updated',
          timestamp: '2026-01-01T15:30:00Z',
          projectId: null,
          agentId: 'a-deep',
          taskId: null,
          assignmentId: null,
          actor: null,
          oldStatus: null,
          newStatus: null,
          payload: deepPayload
        }
      }));

      // Wait for debounce and coalesced resync
      await new Promise((r) => setTimeout(r, 200));

      // Assert event timestamp recorded in connection state
      assert.equal(connection.getState().lastEventAt, '2026-01-01T15:30:00Z');

      // Assert state resync was triggered
      assert.ok(stateFetchCount > initialFetchCount);
    } finally {
      connection.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });
});
