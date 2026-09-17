import { AgentHubRestClient, AgentHubContractError } from './AgentHubRestClient';
import { AgentHubRealtimeClient } from './AgentHubRealtimeClient';
import { AgentHubStateCache } from './AgentHubStateCache';
import type { AgentHubDesktopState, AgentHubStateSnapshot } from './AgentHubTypes';

const BACKOFF_DELAYS_MS = [1000, 2000, 5000, 10000];
const RESYNC_DEBOUNCE_MS = 50;

export interface AgentHubConnectionOptions {
  readonly baseUrl?: string;
  readonly helloTimeoutMs?: number;
  readonly restClient?: AgentHubRestClient;
  readonly realtimeClient?: AgentHubRealtimeClient;
  readonly cache?: AgentHubStateCache;
}

export class AgentHubConnection {
  readonly #restClient: AgentHubRestClient;
  readonly #realtimeClient: AgentHubRealtimeClient;
  readonly #cache: AgentHubStateCache;

  #isStarted = false;
  #generation = 0;
  #activeAbortController: AbortController | null = null;
  #retryCount = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #debounceTimer: NodeJS.Timeout | null = null;
  #syncGeneration: number | null = null;
  #pendingSyncGeneration: number | null = null;

  constructor(options: AgentHubConnectionOptions = {}) {
    this.#cache = options.cache ?? new AgentHubStateCache();
    this.#restClient = options.restClient ?? new AgentHubRestClient({ baseUrl: options.baseUrl });
    this.#realtimeClient =
      options.realtimeClient ??
      new AgentHubRealtimeClient({
        baseUrl: options.baseUrl,
        helloTimeoutMs: options.helloTimeoutMs
      });

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
    this.#generation++;
    const currentGen = this.#generation;
    this.#activeAbortController = new AbortController();
    this.#retryCount = 0;
    this.#cache.setConnectionStatus('connecting');

    await this.#attemptConnect(currentGen);
  }

  /**
   * Stop the connection lifecycle, abort in-flight REST, clear timers, and close sockets.
   * Prevents any pending async results from mutating state or resurrecting connection.
   */
  public stop(): void {
    this.#isStarted = false;
    this.#generation++;
    this.#clearTimers();

    if (this.#activeAbortController) {
      try {
        this.#activeAbortController.abort();
      } catch {
        // Ignore abort errors
      }
      this.#activeAbortController = null;
    }

    this.#realtimeClient.stop();
    this.#syncGeneration = null;
    this.#pendingSyncGeneration = null;
    this.#cache.setConnectionStatus('disconnected');
  }

  /**
   * Manually trigger a fresh snapshot sync.
   * If the connection lifecycle is stopped, does nothing and returns null.
   */
  public async refresh(): Promise<AgentHubStateSnapshot | null> {
    if (!this.#isStarted) {
      return null;
    }
    return this.#doSync(this.#generation);
  }

  #setupRealtimeListeners(): void {
    this.#realtimeClient.on('hello', () => {
      const gen = this.#generation;
      if (!this.#isStarted || gen !== this.#generation) return;

      this.#retryCount = 0;
      // On valid WS handshake: if we already have snapshot, mark connected
      if (this.#cache.getState().snapshot) {
        this.#cache.setConnectionStatus('connected');
      }
      this.#scheduleResync(0, gen);
    });

    this.#realtimeClient.on('incompatible_hello', (err: Error) => {
      const gen = this.#generation;
      if (!this.#isStarted || gen !== this.#generation) return;
      const hasSnapshot = this.#cache.getState().snapshot !== null;
      this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
        code: 'INCOMPATIBLE_HELLO',
        message: err.message
      });
      this.#scheduleReconnect(gen);
    });

    this.#realtimeClient.on('hello_timeout', (err: Error) => {
      const gen = this.#generation;
      if (!this.#isStarted || gen !== this.#generation) return;
      const hasSnapshot = this.#cache.getState().snapshot !== null;
      this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
        code: 'WS_HELLO_TIMEOUT',
        message: err.message
      });
      this.#scheduleReconnect(gen);
    });

    this.#realtimeClient.on('event', (evt) => {
      const gen = this.#generation;
      if (!this.#isStarted || gen !== this.#generation) return;

      this.#cache.recordEventTimestamp(evt.timestamp);
      // Coalesced REST resync: WS event is just an invalidation notification
      this.#scheduleResync(RESYNC_DEBOUNCE_MS, gen);
    });

    this.#realtimeClient.on('close', (_code: number, reason: string, wasOpen: boolean) => {
      const gen = this.#generation;
      if (!this.#isStarted || gen !== this.#generation) return;

      const currentStatus = this.#cache.getState().connection;
      const hasSnapshot = this.#cache.getState().snapshot !== null;

      // If we had an open session or currently hold cached data, state is degraded
      if (wasOpen || currentStatus === 'connected' || hasSnapshot) {
        this.#cache.setConnectionStatus('degraded', {
          code: 'WS_CLOSED',
          message: reason || 'Realtime connection closed by server'
        });
      } else {
        this.#cache.setConnectionStatus('connecting');
      }

      this.#scheduleReconnect(gen);
    });

    this.#realtimeClient.on('error', (err: Error) => {
      if (!this.#isStarted) return;
      const code = err instanceof AgentHubContractError ? err.code : 'WS_ERROR';
      this.#cache.setError(code, err.message);
    });
  }

  async #attemptConnect(gen: number): Promise<void> {
    if (!this.#isStarted || gen !== this.#generation) return;
    if (this.#syncGeneration === gen) return;

    this.#syncGeneration = gen;
    const signal = this.#activeAbortController?.signal;

    try {
      // 1. Initial health check via REST
      const health = await this.#restClient.health(signal);
      if (!this.#isStarted || gen !== this.#generation) return;
      this.#cache.setHealth(health);

      // 2. Initial state snapshot sync
      const snapshot = await this.#restClient.state(signal);
      if (!this.#isStarted || gen !== this.#generation) return;
      this.#cache.updateSnapshot(snapshot);

      // 3. Initiate WS connection
      // Status remains 'connecting' until WS hello is confirmed
      this.#realtimeClient.connect();
    } catch (err) {
      if (!this.#isStarted || gen !== this.#generation) return;
      const code = err instanceof AgentHubContractError ? err.code : 'CONN_FAILED';
      const msg = (err as Error).message;

      const hasSnapshot = this.#cache.getState().snapshot !== null;
      this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
        code,
        message: msg
      });

      this.#scheduleReconnect(gen);
    } finally {
      if (this.#syncGeneration === gen) {
        this.#syncGeneration = null;
      }
      if (this.#pendingSyncGeneration === gen) {
        this.#pendingSyncGeneration = null;
        if (this.#isStarted && gen === this.#generation) {
          this.#scheduleResync(RESYNC_DEBOUNCE_MS, gen);
        }
      }
    }
  }

  #scheduleReconnect(gen: number): void {
    if (!this.#isStarted || gen !== this.#generation || this.#reconnectTimer) return;

    const delay = BACKOFF_DELAYS_MS[Math.min(this.#retryCount, BACKOFF_DELAYS_MS.length - 1)];
    this.#retryCount++;

    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      if (!this.#isStarted || gen !== this.#generation) return;

      if (!this.#realtimeClient.isConnected) {
        await this.#attemptConnect(gen);
      }
    }, delay);
  }

  #scheduleResync(delayMs: number, gen: number): void {
    if (!this.#isStarted || gen !== this.#generation) return;

    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    this.#debounceTimer = setTimeout(async () => {
      this.#debounceTimer = null;
      await this.#doSync(gen);
    }, delayMs);
  }

  async #doSync(gen: number): Promise<AgentHubStateSnapshot | null> {
    if (!this.#isStarted || gen !== this.#generation) return null;

    if (this.#syncGeneration === gen) {
      this.#pendingSyncGeneration = gen;
      return null;
    }

    this.#syncGeneration = gen;
    const signal = this.#activeAbortController?.signal;

    try {
      const [health, snapshot] = await Promise.all([
        this.#restClient.health(signal),
        this.#restClient.state(signal)
      ]);

      if (!this.#isStarted || gen !== this.#generation) return null;

      this.#cache.setHealth(health);
      this.#cache.updateSnapshot(snapshot);

      // connected requires BOTH valid REST snapshot AND valid open WS hello
      if (this.#realtimeClient.isConnected) {
        this.#cache.setConnectionStatus('connected');
      } else {
        this.#cache.setConnectionStatus('degraded', {
          code: 'WS_DISCONNECTED',
          message: 'REST snapshot succeeded but realtime connection is disconnected'
        });
      }
      return snapshot;
    } catch (err) {
      if (!this.#isStarted || gen !== this.#generation) return null;

      const code = err instanceof AgentHubContractError ? err.code : 'SYNC_FAILED';
      const msg = (err as Error).message;

      const hasSnapshot = this.#cache.getState().snapshot !== null;
      // Authoritative resync failure downgrades to degraded (preserving last snapshot)
      this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
        code,
        message: msg
      });
      return null;
    } finally {
      if (this.#syncGeneration === gen) {
        this.#syncGeneration = null;
      }
      if (this.#pendingSyncGeneration === gen) {
        this.#pendingSyncGeneration = null;
        if (this.#isStarted && gen === this.#generation) {
          this.#scheduleResync(RESYNC_DEBOUNCE_MS, gen);
        }
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
