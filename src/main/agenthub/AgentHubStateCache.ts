import { EventEmitter } from 'node:events';
import type {
  AgentHubConnectionStatus,
  AgentHubDesktopState,
  AgentHubHealthDto,
  AgentHubStateSnapshot
} from './AgentHubTypes';

export class AgentHubStateCache extends EventEmitter {
  #state: AgentHubDesktopState;

  constructor() {
    super();
    this.#state = {
      connection: 'disconnected',
      health: null,
      snapshot: null,
      lastSyncAt: null,
      lastEventAt: null,
      lastError: null
    };
  }

  public getState(): AgentHubDesktopState {
    return this.#state;
  }

  public setConnectionStatus(status: AgentHubConnectionStatus, error?: { code: string; message: string } | null): void {
    if (this.#state.connection === status && !error && !this.#state.lastError) {
      return;
    }
    this.#state = {
      ...this.#state,
      connection: status,
      lastError: error ?? (status === 'connected' ? null : this.#state.lastError)
    };
    this.emit('change', this.#state);
  }

  public setHealth(health: AgentHubHealthDto): void {
    this.#state = {
      ...this.#state,
      health
    };
    this.emit('change', this.#state);
  }

  /**
   * Atomically replace the snapshot from an authoritative REST response.
   */
  public updateSnapshot(snapshot: AgentHubStateSnapshot): void {
    const now = new Date().toISOString();
    this.#state = {
      ...this.#state,
      snapshot,
      lastSyncAt: now,
      connection: 'connected',
      lastError: null
    };
    this.emit('change', this.#state);
  }

  public recordEventTimestamp(timestamp: string): void {
    this.#state = {
      ...this.#state,
      lastEventAt: timestamp
    };
    this.emit('change', this.#state);
  }

  public setError(code: string, message: string): void {
    this.#state = {
      ...this.#state,
      lastError: { code, message }
    };
    this.emit('change', this.#state);
  }
}
