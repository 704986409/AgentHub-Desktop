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
          agentId: 'agent-1'
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
        wss.close();
        server.close();
      }
    }
  });
});
