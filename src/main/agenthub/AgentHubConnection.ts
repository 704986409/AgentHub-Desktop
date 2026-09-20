import { AgentHubRestClient, AgentHubContractError } from './AgentHubRestClient';
import { AgentHubRealtimeClient } from './AgentHubRealtimeClient';
import { AgentHubStateCache } from './AgentHubStateCache';
import type { AgentHubDesktopState, AgentHubStateSnapshot, ProviderDto } from './AgentHubTypes';
import { isLifecycleCompatibleBackendVersion } from '../../shared/agenthubLifecycle';
import type { LifecycleReviewDto } from '../../shared/agenthubLifecycle';

const BACKOFF_DELAYS_MS = [1000, 2000, 5000, 10000];
const RESYNC_DEBOUNCE_MS = 50;

export type StateCommitResult =
  | {
      readonly disposition: 'committed';
      readonly snapshot: AgentHubStateSnapshot;
      readonly lifecycleReviews: readonly LifecycleReviewDto[] | null;
    }
  | {
      readonly disposition: 'superseded-by-committed';
      readonly snapshot: AgentHubStateSnapshot;
      readonly lifecycleReviews: readonly LifecycleReviewDto[] | null;
    }
  | { readonly disposition: 'superseded-uncommitted'; readonly snapshot: null; readonly lifecycleReviews: null };

export interface AgentHubConnectionOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly executeTimeoutMs?: number;
  readonly helloTimeoutMs?: number;
  readonly restClient?: AgentHubRestClient;
  readonly realtimeClient?: AgentHubRealtimeClient;
  readonly cache?: AgentHubStateCache;
  readonly backoffDelaysMs?: readonly number[];
}

export class AgentHubConnection {
  readonly #restClient: AgentHubRestClient;
  readonly #realtimeClient: AgentHubRealtimeClient;
  readonly #cache: AgentHubStateCache;
  readonly #backoffDelaysMs: readonly number[];

  #isStarted = false;
  #generation = 0;
  #activeAbortController: AbortController | null = null;
  #retryCount = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #debounceTimer: NodeJS.Timeout | null = null;
  #syncGeneration: number | null = null;
  #pendingSyncGeneration: number | null = null;
  #pendingReconnectGeneration: number | null = null;
  #stateRequestSequence = 0;
  #latestCommittedSequence = 0;
  #providerCatalog: readonly ProviderDto[] | null = null;
  #inFlightProvidersPromise: Promise<readonly ProviderDto[]> | null = null;
  #providerRequestSequence = 0;
  #latestCommittedProviderSequence = 0;

  constructor(options: AgentHubConnectionOptions = {}) {
    this.#cache = options.cache ?? new AgentHubStateCache();
    this.#restClient =
      options.restClient ??
      new AgentHubRestClient({
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        executeTimeoutMs: options.executeTimeoutMs
      });
    this.#realtimeClient =
      options.realtimeClient ??
      new AgentHubRealtimeClient({
        baseUrl: options.baseUrl,
        helloTimeoutMs: options.helloTimeoutMs
      });
    this.#backoffDelaysMs = options.backoffDelaysMs ?? BACKOFF_DELAYS_MS;

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
    this.#pendingReconnectGeneration = null;
    this.#inFlightProvidersPromise = null;
    this.#providerCatalog = null;
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

  /**
   * Get cached providers if available.
   */
  public getCachedProviders(): readonly ProviderDto[] | null {
    return this.#providerCatalog;
  }

  /**
   * Fetch providers from Backend with request coalescing and generation safety.
   */
  public async getProviders(signal?: AbortSignal): Promise<readonly ProviderDto[]> {
    if (this.#inFlightProvidersPromise) {
      return this.#inFlightProvidersPromise;
    }

    const sequence = ++this.#providerRequestSequence;
    const currentGen = this.#generation;

    const execute = async (): Promise<readonly ProviderDto[]> => {
      try {
        const catalog = await this.#restClient.getProviders(signal);
        if (this.#isStarted && currentGen === this.#generation && sequence >= this.#latestCommittedProviderSequence) {
          this.#latestCommittedProviderSequence = sequence;
          this.#providerCatalog = catalog;
        }
        return catalog;
      } finally {
        if (this.#inFlightProvidersPromise === currentPromise) {
          this.#inFlightProvidersPromise = null;
        }
      }
    };

    const currentPromise = execute();
    this.#inFlightProvidersPromise = currentPromise;
    return currentPromise;
  }

  /**
   * Alias for getProviders()
   */
  public async refreshProviders(signal?: AbortSignal): Promise<readonly ProviderDto[]> {
    return this.getProviders(signal);
  }

  /**
   * Mutation follow-up authoritative /state sync.
   * Connection is the sole production owner of snapshot commits.
   * An older /state response cannot commit after a newer request has been issued.
   * Not exposed to Renderer/Preload.
   */
  public async syncAuthoritativeState(signal?: AbortSignal): Promise<StateCommitResult> {
    if (this.#isLifecycleStopped()) {
      return { disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null };
    }

    const sequence = ++this.#stateRequestSequence;
    try {
      const snapshot = await this.#restClient.state(signal);
      const lifecycleReviews = await this.#fetchReviewsIfCompatible(signal);
      return this.#commitSnapshotIfCurrent(sequence, snapshot, lifecycleReviews);
    } catch (err) {
      if (this.#isLifecycleStopped()) {
        return { disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null };
      }
      if (this.#latestCommittedSequence > sequence) {
        const current = this.#cache.getState();
        if (current.snapshot) {
          return {
            disposition: 'superseded-by-committed',
            snapshot: current.snapshot,
            lifecycleReviews: current.lifecycleReviews
          };
        }
      }
      this.#markAuthoritativeSyncFailure(err);
      return { disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null };
    }
  }

  #isLifecycleStopped(): boolean {
    return !this.#isStarted && this.#generation > 0;
  }

  #commitSnapshotIfCurrent(
    sequence: number,
    snapshot: AgentHubStateSnapshot,
    lifecycleReviews: readonly LifecycleReviewDto[] | null
  ): StateCommitResult {
    if (this.#isLifecycleStopped()) {
      return { disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null };
    }

    // Case A: a newer request already committed a safer snapshot.
    if (sequence < this.#latestCommittedSequence) {
      const current = this.#cache.getState();
      if (current.snapshot) {
        return {
          disposition: 'superseded-by-committed',
          snapshot: current.snapshot,
          lifecycleReviews: current.lifecycleReviews
        };
      }
      return { disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null };
    }

    // Case B: a newer request was issued but has not committed.
    // The older result is invalidated and must not heal cache or status.
    if (sequence < this.#stateRequestSequence) {
      return { disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null };
    }

    // Case C: this is the current newest issued request.
    this.#cache.commitAuthoritative(snapshot, lifecycleReviews);
    this.#latestCommittedSequence = sequence;
    return { disposition: 'committed', snapshot, lifecycleReviews };
  }

  #markAuthoritativeSyncFailure(err: unknown): void {
    if (!this.#isStarted || this.#isLifecycleStopped()) {
      return;
    }
    const code = err instanceof AgentHubContractError ? err.code : 'SYNC_FAILED';
    const msg = (err as Error).message;
    const hasSnapshot = this.#cache.getState().snapshot !== null;
    this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
      code,
      message: msg
    });
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
      void this.getProviders().catch(() => {
        // Provider catalog failure must not degrade authoritative snapshot or connection
      });
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

    this.#realtimeClient.on('init_failed', (err: Error) => {
      const gen = this.#generation;
      if (!this.#isStarted || gen !== this.#generation) return;
      const hasSnapshot = this.#cache.getState().snapshot !== null;
      this.#cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
        code: 'WS_INIT_FAILED',
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
    if (this.#syncGeneration === gen) {
      this.#pendingReconnectGeneration = gen;
      return;
    }

    this.#syncGeneration = gen;
    const signal = this.#activeAbortController?.signal;

    try {
      // 1. Initial health check via REST
      const health = await this.#restClient.health(signal);
      if (!this.#isStarted || gen !== this.#generation) return;
      this.#cache.setHealth(health);

      // 2. Initial state snapshot sync (Connection-owned sequenced commit)
      const sequence = ++this.#stateRequestSequence;
      const snapshot = await this.#restClient.state(signal);
      if (!this.#isStarted || gen !== this.#generation) return;
      const lifecycleReviews = await this.#fetchReviewsIfCompatible(signal, health.version);
      if (!this.#isStarted || gen !== this.#generation) return;
      this.#commitSnapshotIfCurrent(sequence, snapshot, lifecycleReviews);

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
      if (this.#pendingReconnectGeneration === gen) {
        this.#pendingReconnectGeneration = null;
        if (this.#isStarted && gen === this.#generation && !this.#realtimeClient.isConnected) {
          this.#scheduleReconnect(gen);
        }
      }
    }
  }

  #scheduleReconnect(gen: number): void {
    if (!this.#isStarted || gen !== this.#generation || this.#reconnectTimer) return;

    const delay = this.#backoffDelaysMs[Math.min(this.#retryCount, this.#backoffDelaysMs.length - 1)];
    this.#retryCount++;

    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      if (!this.#isStarted || gen !== this.#generation) return;

      if (!this.#realtimeClient.isConnected) {
        if (this.#syncGeneration === gen) {
          this.#pendingReconnectGeneration = gen;
          return;
        }
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
    const sequence = ++this.#stateRequestSequence;

    try {
      const [health, snapshot] = await Promise.all([
        this.#restClient.health(signal),
        this.#restClient.state(signal)
      ]);

      if (!this.#isStarted || gen !== this.#generation) return null;
      const lifecycleReviews = await this.#fetchReviewsIfCompatible(signal, health.version);
      if (!this.#isStarted || gen !== this.#generation) return null;

      const commit = this.#commitSnapshotIfCurrent(sequence, snapshot, lifecycleReviews);
      if (commit.disposition !== 'committed') {
        return commit.disposition === 'superseded-by-committed'
          ? commit.snapshot
          : this.#cache.getState().snapshot;
      }

      this.#cache.setHealth(health);

      // connected requires BOTH valid REST snapshot AND valid open WS hello
      if (this.#realtimeClient.isConnected) {
        this.#cache.setConnectionStatus('connected');
      } else {
        this.#cache.setConnectionStatus('degraded', {
          code: 'WS_DISCONNECTED',
          message: 'REST snapshot succeeded but realtime connection is disconnected'
        });
      }
      return commit.snapshot;
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
      if (this.#pendingReconnectGeneration === gen) {
        this.#pendingReconnectGeneration = null;
        if (this.#isStarted && gen === this.#generation && !this.#realtimeClient.isConnected) {
          this.#scheduleReconnect(gen);
        }
      }
    }
  }

  async #fetchReviewsIfCompatible(
    signal?: AbortSignal,
    version?: string
  ): Promise<readonly LifecycleReviewDto[] | null> {
    let resolved = version ?? this.#cache.getState().health?.version;
    if (typeof resolved !== 'string') {
      const health = await this.#restClient.health(signal);
      this.#cache.setHealth(health);
      resolved = health.version;
    }
    if (!isLifecycleCompatibleBackendVersion(resolved)) {
      return null;
    }
    return this.#restClient.lifecycleReviews(signal);
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
