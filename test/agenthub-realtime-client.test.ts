import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentHubRealtimeClient } from '../src/main/agenthub/AgentHubRealtimeClient';
import { AgentHubContractError } from '../src/main/agenthub/AgentHubRestClient';

describe('AgentHubRealtimeClient', () => {
  test('connects, receives hello with apiVersion v1, receives events, and sends zero outbound messages', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });

    let clientSentMessages = 0;
    let serverSocket: WebSocket | null = null;

    wss.on('connection', (ws) => {
      serverSocket = ws;
      ws.on('message', () => {
        clientSentMessages++;
      });

      // 1. Send valid hello frame according to backend contract (version 1, apiVersion 'v1')
      ws.send(JSON.stringify({
        type: 'hello',
        version: 1,
        apiVersion: 'v1'
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRealtimeClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const helloPromise = new Promise<{ apiVersion: string }>((resolve) => {
        client.on('hello', (hello) => resolve(hello));
      });

      client.connect();

      const hello = await helloPromise;
      assert.equal(hello.apiVersion, 'v1');
      assert.equal(client.isConnected, true);

      // 2. Server sends an event
      const eventPromise = new Promise<{ eventId: string; eventType: string }>((resolve) => {
        client.on('event', (evt) => resolve(evt));
      });

      serverSocket?.send(JSON.stringify({
        type: 'event',
        version: 1,
        event: {
          eventId: 'evt-ws-1',
          eventType: 'agent.status_changed',
          timestamp: '2026-01-01T12:00:00Z',
          projectId: null,
          agentId: 'agent-1',
          taskId: null,
          assignmentId: null,
          actor: null,
          oldStatus: null,
          newStatus: null,
          payload: null
        }
      }));

      const evt = await eventPromise;
      assert.equal(evt.eventId, 'evt-ws-1');
      assert.equal(evt.eventType, 'agent.status_changed');

      // 3. Verify client never sent any message to server
      assert.equal(clientSentMessages, 0);

      // 4. Test client.stop()
      client.stop();
      assert.equal(client.isConnected, false);
    } finally {
      client.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('rejects incompatible hello handshakes (version!=1, apiVersion!=v1, missing apiVersion, event before hello)', async () => {
    const incompatibleFixtures = [
      { type: 'hello', version: 2, apiVersion: 'v1' }, // version 2
      { type: 'hello', version: 1, apiVersion: '0.7.0' }, // legacy 0.7.0
      { type: 'hello', version: 1, apiVersion: 'v2' }, // future v2
      { type: 'hello', version: 1 }, // missing apiVersion
      { type: 'event', version: 1, event: { eventId: 'e1', eventType: 'x', timestamp: '2026' } } // event before hello
    ];

    for (const fixture of incompatibleFixtures) {
      const server = http.createServer();
      const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });

      wss.on('connection', (ws) => {
        ws.send(JSON.stringify(fixture));
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as { port: number };
      const client = new AgentHubRealtimeClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

      try {
        const errorPromise = new Promise<AgentHubContractError>((resolve) => {
          client.on('error', (err) => resolve(err as AgentHubContractError));
        });

        client.connect();

        const err = await errorPromise;
        assert.equal(err.code, 'INCOMPATIBLE_HELLO');
        assert.equal(client.isConnected, false);
      } finally {
        client.stop();
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close();
      }
    }
  });

  test('bounded hello timeout: aborts socket and emits WS_HELLO_TIMEOUT if hello is not received within deadline', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });

    wss.on('connection', (_ws) => {
      // Intentionally do NOT send hello frame
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRealtimeClient({
      baseUrl: `http://127.0.0.1:${addr.port}`,
      helloTimeoutMs: 60
    });

    try {
      let receivedError: Error | null = null;
      client.on('error', (err) => {
        receivedError = err;
      });

      const timeoutPromise = new Promise<AgentHubContractError>((resolve) => {
        client.on('hello_timeout', (err) => resolve(err as AgentHubContractError));
      });

      client.connect();

      const err = await timeoutPromise;
      assert.equal(err.code, 'WS_HELLO_TIMEOUT');
      assert.equal((receivedError as AgentHubContractError | null)?.code, 'WS_HELLO_TIMEOUT');
      assert.equal(client.isConnected, false);
    } finally {
      client.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close();
    }
  });

  test('stale socket isolation: delayed events from an old socket instance cannot clear or mutate current socket', async () => {
    const { EventEmitter } = await import('node:events');

    class FakeSocket extends EventEmitter {
      public readyState = WebSocket.OPEN;
      public closed = false;
      public closeCode: number | null = null;
      public closeReason: string | null = null;

      public close(code = 1000, reason = ''): void {
        this.closed = true;
        this.closeCode = code;
        this.closeReason = reason;
        this.readyState = WebSocket.CLOSED;
      }

      public terminate(): void {
        this.close(1006, 'terminated');
      }
    }

    const socketA = new FakeSocket();
    const socketB = new FakeSocket();
    let currentSpawn = socketA;

    const client = new AgentHubRealtimeClient({
      baseUrl: 'http://127.0.0.1:3210',
      helloTimeoutMs: 5000,
      createWebSocket: () => currentSpawn as unknown as WebSocket
    });

    try {
      // 1. Connect socketA and perform valid hello
      client.connect();
      socketA.emit('open');
      socketA.emit('message', Buffer.from(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' })));
      assert.equal(client.isConnected, true);

      // 2. socketA is replaced by socketB
      socketA.close(1006, 'abnormal drop');
      currentSpawn = socketB;
      client.connect();
      socketB.emit('open');
      socketB.emit('message', Buffer.from(JSON.stringify({ type: 'hello', version: 1, apiVersion: 'v1' })));
      assert.equal(client.isConnected, true);

      let clientCloseEmitted = false;
      let clientErrorEmitted = false;
      client.on('close', () => {
        clientCloseEmitted = true;
      });
      client.on('error', () => {
        clientErrorEmitted = true;
      });

      // 3. Late events from socketA arrive now
      socketA.emit('message', Buffer.from(JSON.stringify({ type: 'hello', version: 999, apiVersion: 'bad' })));
      socketA.emit('error', new Error('stale network error'));
      socketA.emit('close', 1006, Buffer.from('stale close'));

      // Assert: socketA events had ZERO effect on client and socketB
      assert.equal(client.isConnected, true, 'socketB must remain connected');
      assert.equal(clientCloseEmitted, false, 'Stale close must not emit client close');
      assert.equal(clientErrorEmitted, false, 'Stale error must not emit client error');

      // 4. Now close active socketB
      socketB.emit('close', 1000, Buffer.from('clean close'));
      assert.equal(client.isConnected, false);
      assert.equal(clientCloseEmitted, true);
    } finally {
      client.stop();
    }
  });
});
