import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentHubRealtimeClient } from '../src/main/agenthub/AgentHubRealtimeClient';
import { AgentHubContractError } from '../src/main/agenthub/AgentHubRestClient';

describe('AgentHubRealtimeClient', () => {
  test('connects, receives hello, receives events, and sends zero outbound messages', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });

    let clientSentMessages = 0;
    let serverSocket: WebSocket | null = null;

    wss.on('connection', (ws) => {
      serverSocket = ws;
      ws.on('message', () => {
        clientSentMessages++;
      });

      // 1. Send valid hello frame
      ws.send(JSON.stringify({
        type: 'hello',
        version: 1,
        apiVersion: '0.7.0'
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
      assert.equal(hello.apiVersion, '0.7.0');
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

  test('rejects incompatible hello handshake and terminates socket', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/api/v1/realtime' });

    wss.on('connection', (ws) => {
      // Send incompatible hello version 2
      ws.send(JSON.stringify({
        type: 'hello',
        version: 2,
        apiVersion: '2.0.0'
      }));
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
  });
});
