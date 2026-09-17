import { create } from 'zustand';
import type {
  AgentHubConnectionStatus,
  AgentHubDesktopState,
  AgentHubHealthDto,
  AgentHubStateSnapshot
} from '@shared/agenthubTypes';

export interface AgentHubStoreState {
  connection: AgentHubConnectionStatus;
  health: AgentHubHealthDto | null;
  snapshot: AgentHubStateSnapshot | null;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  lastError: { code: string; message: string } | null;
  isRefreshing: boolean;

  init: () => () => void;
  refresh: () => Promise<void>;
}

export const useAgentHubStore = create<AgentHubStoreState>((set, get) => ({
  connection: 'disconnected',
  health: null,
  snapshot: null,
  lastSyncAt: null,
  lastEventAt: null,
  lastError: null,
  isRefreshing: false,

  init: () => {
    if (typeof window === 'undefined' || !window.agentHub) {
      return () => {};
    }

    // Pull initial connection state from main
    void window.agentHub.getConnectionState()
      .then((state: AgentHubDesktopState) => {
        set({
          connection: state.connection,
          health: state.health,
          snapshot: state.snapshot,
          lastSyncAt: state.lastSyncAt,
          lastEventAt: state.lastEventAt,
          lastError: state.lastError
        });
      })
      .catch((err: Error) => {
        set({
          connection: 'disconnected',
          lastError: { code: 'INIT_FAILED', message: err.message }
        });
      });

    // Subscribe to pushed state updates
    const cleanup = window.agentHub.onChanged((state: AgentHubDesktopState) => {
      set({
        connection: state.connection,
        health: state.health,
        snapshot: state.snapshot,
        lastSyncAt: state.lastSyncAt,
        lastEventAt: state.lastEventAt,
        lastError: state.lastError
      });
    });

    return cleanup;
  },

  refresh: async () => {
    if (get().isRefreshing) return;
    if (typeof window === 'undefined' || !window.agentHub) return;

    set({ isRefreshing: true });
    try {
      const state = await window.agentHub.refresh();
      set({
        connection: state.connection,
        health: state.health,
        snapshot: state.snapshot,
        lastSyncAt: state.lastSyncAt,
        lastEventAt: state.lastEventAt,
        lastError: state.lastError
      });
    } catch (err) {
      set({
        lastError: { code: 'REFRESH_FAILED', message: (err as Error).message }
      });
    } finally {
      set({ isRefreshing: false });
    }
  }
}));
