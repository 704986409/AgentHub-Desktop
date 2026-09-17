import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type {
  AgentHubEventDto,
  AgentHubWsHelloMessage,
  AgentHubWsServerMessage
} from './AgentHubTypes';
import { AgentHubContractError, validateAgentHubBaseUrl } from './AgentHubRestClient';

export class AgentHubRealtimeClient extends EventEmitter {
  readonly #wsUrl: string;
  #socket: WebSocket | null = null;
  #isStopping = false;
  #helloReceived = false;

  constructor(options: { baseUrl?: string } = {}) {
    super();
    const httpUrl = validateAgentHubBaseUrl(options.baseUrl ?? 'http://127.0.0.1:3210');
    // Derive WebSocket URL from validated loopback HTTP base URL
    this.#wsUrl = httpUrl.replace(/^http:/, 'ws:') + '/api/v1/realtime';
  }

  public get wsUrl(): string {
    return this.#wsUrl;
  }

  public get isConnected(): boolean {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN && this.#helloReceived;
  }

  /**
   * Connect to the AgentHub realtime WebSocket service.
   */
  public connect(): void {
    if (this.#socket && (this.#socket.readyState === WebSocket.CONNECTING || this.#socket.readyState === WebSocket.OPEN)) {
      return; // Already connecting or open
    }

    this.#isStopping = false;
    this.#helloReceived = false;

    try {
      this.#socket = new WebSocket(this.#wsUrl);
    } catch (err) {
      this.emit('error', new AgentHubContractError('WS_INIT_FAILED', (err as Error).message));
      return;
    }

    this.#socket.on('open', () => {
      // Wait for server hello message before treating connection as ready
    });

    this.#socket.on('message', (data: Buffer | string) => {
      this.#handleMessage(data.toString());
    });

    this.#socket.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.#socket.on('close', (code: number, reasonBuf: Buffer) => {
      const reason = reasonBuf.toString();
      const wasOpen = this.#helloReceived;
      this.#socket = null;
      this.#helloReceived = false;
      if (!this.#isStopping) {
        this.emit('close', code, reason, wasOpen);
      }
    });
  }

  /**
   * Cleanly stop the WebSocket connection.
   */
  public stop(): void {
    this.#isStopping = true;
    if (this.#socket) {
      try {
        if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING) {
          this.#socket.close(1000, 'client closed');
        }
      } catch {
        // Ignore close errors during shutdown
      }
      this.#socket = null;
    }
    this.#helloReceived = false;
  }

  #handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed frame: ignore or emit warning
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const msg = parsed as Partial<AgentHubWsServerMessage>;

    if (!this.#helloReceived) {
      // First frame must be hello
      if (msg.type === 'hello' && msg.version === 1) {
        this.#helloReceived = true;
        this.emit('hello', msg as AgentHubWsHelloMessage);
      } else {
        // Incompatible hello version: terminate socket
        this.stop();
        this.emit('error', new AgentHubContractError('INCOMPATIBLE_HELLO', `Incompatible hello frame: ${raw}`));
      }
      return;
    }

    if (msg.type === 'event' && msg.version === 1 && msg.event && typeof msg.event === 'object') {
      const evt = msg.event as AgentHubEventDto;
      if (typeof evt.eventId === 'string' && typeof evt.eventType === 'string') {
        this.emit('event', evt);
      }
    }
  }
}
