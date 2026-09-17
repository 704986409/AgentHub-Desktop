import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type {
  AgentHubEventDto,
  AgentHubWsHelloMessage,
  AgentHubWsServerMessage
} from './AgentHubTypes';
import { snapshotEventDto } from './AgentHubTypes';
import { AgentHubContractError, validateAgentHubBaseUrl } from './AgentHubRestClient';

export interface AgentHubRealtimeClientOptions {
  readonly baseUrl?: string;
  readonly helloTimeoutMs?: number;
  readonly createWebSocket?: (url: string) => WebSocket;
}

const DEFAULT_HELLO_TIMEOUT_MS = 5000;

export class AgentHubRealtimeClient extends EventEmitter {
  readonly #wsUrl: string;
  readonly #helloTimeoutMs: number;
  readonly #createWebSocket?: (url: string) => WebSocket;

  #currentSocket: WebSocket | null = null;
  #helloReceived = false;
  #isStopped = true;

  #currentHelloTimer: NodeJS.Timeout | null = null;

  constructor(options: AgentHubRealtimeClientOptions = {}) {
    super();
    const httpUrl = validateAgentHubBaseUrl(options.baseUrl ?? 'http://127.0.0.1:3210');
    this.#wsUrl = httpUrl.replace(/^http:/, 'ws:') + '/api/v1/realtime';
    this.#helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.#createWebSocket = options.createWebSocket;
  }

  public get wsUrl(): string {
    return this.#wsUrl;
  }

  public get isConnected(): boolean {
    return (
      this.#currentSocket !== null &&
      this.#currentSocket.readyState === WebSocket.OPEN &&
      this.#helloReceived
    );
  }

  /**
   * Connect to the AgentHub realtime WebSocket service.
   * Ensures single active socket ownership and isolates events to that instance.
   */
  public connect(): void {
    if (
      this.#currentSocket &&
      (this.#currentSocket.readyState === WebSocket.CONNECTING || this.#currentSocket.readyState === WebSocket.OPEN)
    ) {
      return; // Already active
    }

    this.#isStopped = false;
    this.#helloReceived = false;
    if (this.#currentHelloTimer !== null) {
      clearTimeout(this.#currentHelloTimer);
      this.#currentHelloTimer = null;
    }

    let socket: WebSocket;
    try {
      socket = this.#createWebSocket ? this.#createWebSocket(this.#wsUrl) : new WebSocket(this.#wsUrl);
      this.#currentSocket = socket;
    } catch (err) {
      const error = new AgentHubContractError('WS_INIT_FAILED', (err as Error).message);
      this.emit('error', error);
      this.emit('init_failed', error);
      return;
    }

    let helloTimer: NodeJS.Timeout | null = null;
    const clearSocketHelloTimer = () => {
      if (helloTimer !== null) {
        clearTimeout(helloTimer);
        if (this.#currentHelloTimer === helloTimer) {
          this.#currentHelloTimer = null;
        }
        helloTimer = null;
      }
    };

    socket.on('open', () => {
      if (this.#currentSocket !== socket) return;

      // Arm bounded hello timeout specifically for this socket instance
      clearSocketHelloTimer();
      helloTimer = setTimeout(() => {
        if (this.#currentHelloTimer === helloTimer) {
          this.#currentHelloTimer = null;
        }
        helloTimer = null;
        if (this.#currentSocket !== socket || this.#helloReceived) return;

        const err = new AgentHubContractError(
          'WS_HELLO_TIMEOUT',
          `WebSocket hello handshake timed out after ${this.#helloTimeoutMs}ms`
        );

        this.#terminateSocket(socket);
        if (this.#currentSocket === socket) {
          this.#currentSocket = null;
          this.#helloReceived = false;
        }

        this.emit('error', err);
        this.emit('hello_timeout', err);
      }, this.#helloTimeoutMs);
      this.#currentHelloTimer = helloTimer;
    });

    socket.on('message', (data: Buffer | string) => {
      if (this.#currentSocket !== socket) return;
      this.#handleSocketMessage(socket, data.toString(), clearSocketHelloTimer);
    });

    socket.on('error', (err: Error) => {
      if (this.#currentSocket !== socket) return;
      this.emit('error', err);
    });

    socket.on('close', (code: number, reasonBuf?: Buffer) => {
      clearSocketHelloTimer();
      if (this.#currentSocket !== socket) {
        return; // Stale socket event, ignore completely
      }

      const reason = reasonBuf ? reasonBuf.toString() : '';
      const wasOpen = this.#helloReceived;
      this.#currentSocket = null;
      this.#helloReceived = false;

      if (!this.#isStopped) {
        this.emit('close', code, reason, wasOpen);
      }
    });
  }

  /**
   * Cleanly stop the WebSocket client and disconnect current socket.
   */
  public stop(): void {
    this.#isStopped = true;
    if (this.#currentHelloTimer !== null) {
      clearTimeout(this.#currentHelloTimer);
      this.#currentHelloTimer = null;
    }
    const socket = this.#currentSocket;
    this.#currentSocket = null;
    this.#helloReceived = false;

    if (socket) {
      this.#terminateSocket(socket);
    }
  }

  #terminateSocket(socket: WebSocket): void {
    try {
      if (typeof socket.terminate === 'function') {
        socket.terminate();
      } else if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'client closed');
      }
    } catch {
      // Ignore errors during termination
    }
  }

  #handleSocketMessage(socket: WebSocket, raw: string, clearTimer: () => void): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON: fail closed
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const msg = parsed as Partial<AgentHubWsServerMessage>;

    if (!this.#helloReceived) {
      // First frame must be hello with version 1 and apiVersion 'v1'
      if (msg.type === 'hello' && msg.version === 1 && msg.apiVersion === 'v1') {
        clearTimer();
        this.#helloReceived = true;
        this.emit('hello', msg as AgentHubWsHelloMessage);
      } else {
        clearTimer();
        const err = new AgentHubContractError(
          'INCOMPATIBLE_HELLO',
          `Incompatible hello frame (expected version: 1, apiVersion: 'v1'): ${raw}`
        );

        this.#terminateSocket(socket);
        if (this.#currentSocket === socket) {
          this.#currentSocket = null;
          this.#helloReceived = false;
        }

        this.emit('error', err);
        this.emit('incompatible_hello', err);
      }
      return;
    }

    if (msg.type === 'event' && msg.version === 1 && msg.event && typeof msg.event === 'object') {
      try {
        const evt = snapshotEventDto(msg.event);
        this.emit('event', evt);
      } catch {
        // Malformed event: fail-closed, do not mutate state
      }
    }
  }
}
