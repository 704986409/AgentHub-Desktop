import { AgentHubRestClient, AgentHubContractError } from './AgentHubRestClient';
import { AgentHubRealtimeClient } from './AgentHubRealtimeClient';
import { AgentHubStateCache } from './AgentHubStateCache';
import type { AgentHubDesktopState, AgentHubStateSnapshot } from './AgentHubTypes';

const BACKOFF_DELAYS_MS = [1000, 2000, 5000, 10000];
const RESYNC_DEBOUNCE_MS = 50;

export interface AgentHubConnectionOptions {
  readonly baseUrl?: string;
  readonly restClient?: AgentHubRestClient;
  readonly realtimeClient?: AgentHubRealtimeClient;
  readonly cache?: AgentHubStateCache;
}

export class AgentHubConnection {
  readonly #restClient: AgentHubRestClient;
  readonly #realtimeClient: AgentHubRealtimeClient;
  readonly #cache: AgentHubStateCache;

  #isStarted = false;
  #retryCount = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #debounceTimer: NodeJS.Timeout | null = null;
  #isSyncing = false;
  #hasPendingSync = false;

  constructor(options: AgentHubConnectionOptions = {}) {
    this.#cache = options.cache ?? new AgentHubStateCache();
    this.#restClient = options.restClient ?? new AgentHubRestClient({ baseUrl: options.baseUrl });
    this.#realtimeClient = options.realtimeClient ?? new AgentHubRealtimeClient({ baseUrl: options.baseUrl });

    this.#setupRealtimeListeners();
  }

  public get cache(): AgentHubStateCache {
    return this.#cache;
  }

  public get restClient(): AgentHubRestClient {
    return this.#restClient;
  }

  public get realtimeClient(): AgentHubRealtimeClient {
    return this.#realtimeClient;
  }

  public getState(): AgentHubDesktopState {
    return this.#cache.getState();
  }

  /**
   * Start the connection lifecycle.
   */
  public async start(): Promise<void> {
    if (this.#isStarted) {
      return;
    }
    this.#isStarted = true;
    this.#retryCount = 0;
    this.#cache.setConnectionStatus('connecting');

    await this.#attemptConnect();
  }

  /**
   * Stop the connection lifecycle and release all timers and sockets.
   */
  public stop(): void {
    this.#isStarted = false;
    this.#clearTimers();
    this.#realtimeClient.stop();
    this.#cache.setConnectionStatus('disconnected');
  }

  /**
   * Manually trigger a fresh snapshot sync.
   */
  public async refresh(): Promise<AgentHubStateSnapshot | null> {
    return this.#doSync();
  }

  #setupRealtimeListeners(): void {
    this.#realtimeClient.on('hello', () => {
      this.#retryCount = 0;
      // On successful WS handshake, trigger snapshot sync
      this.#scheduleResync(0);
    });

    this.#realtimeClient.on('event', (evt) => {
      this.#cache.recordEventTimestamp(evt.timestamp);
      // Coalesced REST resync: WS event is just an invalidation notification
      this.#scheduleResync(RESYNC_DEBOUNCE_MS);
    });

    this.#realtimeClient.on('close', (_code: number, reason: string, wasOpen: boolean) => {
      if (!this.#isStarted) return;

      const currentStatus = this.#cache.getState().connection;
      // If we previously had a connected session, state is degraded until reconnected
      if (wasOpen || currentStatus === 'connected') {
        this.#cache.setConnectionStatus('degraded', {
          code: 'WS_CLOSED',
          message: reason || 'Realtime connection closed by server'
        });
      } else {
        this.#cache.setConnectionStatus('connecting');
      }

      this.#scheduleReconnect();
    });

    this.#realtimeClient.on('error', (err: Error) => {
      if (!this.#isStarted) return;
      const code = err instanceof AgentHubContractError ? err.code : 'WS_ERROR';
      this.#cache.setError(code, err.message);
    });
  }

  async #attemptConnect(): Promise<void> {
    if (!this.#isStarted) return;

    try {
      // 1. Initial health check via REST
      const health = await this.#restClient.health();
      this.#cache.setHealth(health);

      // 2. Initial state snapshot sync
      const snapshot = await this.#restClient.state();
      this.#cache.updateSnapshot(snapshot);

      // 3. Initiate WS connection
      this.#realtimeClient.connect();
    } catch (err) {
      if (!this.#isStarted) return;
      const code = err instanceof AgentHubContractError ? err.code : 'CONN_FAILED';
      const msg = (err as Error).message;

      const hasSnapshot = this.#cache.getState().snapshot !== null;
      this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
        code,
        message: msg
      });

      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (!this.#isStarted || this.#reconnectTimer) return;

    const delay = BACKOFF_DELAYS_MS[Math.min(this.#retryCount, BACKOFF_DELAYS_MS.length - 1)];
    this.#retryCount++;

    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      if (!this.#isStarted) return;

      if (!this.#realtimeClient.isConnected) {
        await this.#attemptConnect();
      }
    }, delay);
  }

  #scheduleResync(delayMs: number): void {
    if (!this.#isStarted) return;

    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    this.#debounceTimer = setTimeout(async () => {
      this.#debounceTimer = null;
      await this.#doSync();
    }, delayMs);
  }

  async #doSync(): Promise<AgentHubStateSnapshot | null> {
    if (this.#isSyncing) {
      this.#hasPendingSync = true;
      return null;
    }

    this.#isSyncing = true;
    try {
      const [health, snapshot] = await Promise.all([
        this.#restClient.health(),
        this.#restClient.state()
      ]);

      this.#cache.setHealth(health);
      this.#cache.updateSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      const code = err instanceof AgentHubContractError ? err.code : 'SYNC_FAILED';
      this.#cache.setError(code, (err as Error).message);
      return null;
    } finally {
      this.#isSyncing = false;
      if (this.#hasPendingSync && this.#isStarted) {
        this.#hasPendingSync = false;
        this.#scheduleResync(RESYNC_DEBOUNCE_MS);
      }
    }
  }

  #clearTimers(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
  }
}
