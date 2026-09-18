import { create } from 'zustand';
import { useAgentHubReviewSessionStore } from './agentHubReviewSessionStore';
import type {
  AgentHubConnectionStatus,
  AgentHubDesktopState,
  AgentHubHealthDto,
  AgentHubStateSnapshot,
  CreateTaskRequestDto,
  ExecuteTaskRequestDto,
  TaskExecutionResult,
  TaskSubmissionResult
} from '@shared/agenthubTypes';

export interface AgentHubStoreState {
  connection: AgentHubConnectionStatus;
  health: AgentHubHealthDto | null;
  snapshot: AgentHubStateSnapshot | null;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  lastError: { code: string; message: string } | null;
  isRefreshing: boolean;
  selectedAgentId: string | null;

  init: () => () => void;
  refresh: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  submitTask: (request: CreateTaskRequestDto) => Promise<TaskSubmissionResult>;
  executeTask: (request: ExecuteTaskRequestDto) => Promise<TaskExecutionResult>;
}

function reconcileSelectedAgent(
  prevSelectedId: string | null,
  snapshot: AgentHubStateSnapshot | null
): string | null {
  if (!prevSelectedId || !snapshot || !snapshot.agents) return null;
  return snapshot.agents.some((a) => a.agentId === prevSelectedId) ? prevSelectedId : null;
}

export const useAgentHubStore = create<AgentHubStoreState>((set, get) => ({
  connection: 'disconnected',
  health: null,
  snapshot: null,
  lastSyncAt: null,
  lastEventAt: null,
  lastError: null,
  isRefreshing: false,
  selectedAgentId: null,

  init: () => {
    if (typeof window === 'undefined' || !window.agentHub) {
      return () => {};
    }

    // Pull initial connection state from main
    void window.agentHub.getConnectionState()
      .then((state: AgentHubDesktopState) => {
        set((s) => ({
          connection: state.connection,
          health: state.health,
          snapshot: state.snapshot,
          lastSyncAt: state.lastSyncAt,
          lastEventAt: state.lastEventAt,
          lastError: state.lastError,
          selectedAgentId: reconcileSelectedAgent(s.selectedAgentId, state.snapshot)
        }));
      })
      .catch((err: Error) => {
        set({
          connection: 'disconnected',
          lastError: { code: 'INIT_FAILED', message: err.message }
        });
      });

    // Subscribe to pushed state updates
    const cleanup = window.agentHub.onChanged((state: AgentHubDesktopState) => {
      set((s) => ({
        connection: state.connection,
        health: state.health,
        snapshot: state.snapshot,
        lastSyncAt: state.lastSyncAt,
        lastEventAt: state.lastEventAt,
        lastError: state.lastError,
        selectedAgentId: reconcileSelectedAgent(s.selectedAgentId, state.snapshot)
      }));
    });

    return cleanup;
  },

  refresh: async () => {
    if (get().isRefreshing) return;
    if (typeof window === 'undefined' || !window.agentHub) return;

    set({ isRefreshing: true });
    try {
      const state = await window.agentHub.refresh();
      set((s) => ({
        connection: state.connection,
        health: state.health,
        snapshot: state.snapshot,
        lastSyncAt: state.lastSyncAt,
        lastEventAt: state.lastEventAt,
        lastError: state.lastError,
        selectedAgentId: reconcileSelectedAgent(s.selectedAgentId, state.snapshot)
      }));
    } catch (err) {
      set({
        lastError: { code: 'REFRESH_FAILED', message: (err as Error).message }
      });
    } finally {
      set({ isRefreshing: false });
    }
  },

  selectAgent: (agentId: string | null) => {
    if (!agentId) {
      set({ selectedAgentId: null });
      return;
    }
    const snapshot = get().snapshot;
    const exists = snapshot?.agents ? snapshot.agents.some((a) => a.agentId === agentId) : false;
    set({ selectedAgentId: exists ? agentId : null });
  },

  submitTask: async (request: CreateTaskRequestDto): Promise<TaskSubmissionResult> => {
    if (typeof window === 'undefined' || !window.agentHub) {
      return {
        status: 'failed',
        retryable: false,
        error: { code: 'NO_PRELOAD', message: 'AgentHub preload bridge is unavailable' }
      };
    }
    try {
      return await window.agentHub.createTask(request);
    } catch (err) {
      return {
        status: 'ambiguous',
        retryable: true,
        error: {
          code: 'IPC_LOST',
          message: (err as Error).message || 'Task submission IPC result was lost'
        }
      };
    }
  },

  executeTask: async (request: ExecuteTaskRequestDto): Promise<TaskExecutionResult> => {
    if (typeof window === 'undefined' || !window.agentHub) {
      return {
        status: 'failed',
        retryable: false,
        error: { code: 'NO_PRELOAD', message: 'AgentHub preload bridge is unavailable' }
      };
    }
    try {
      const result = await window.agentHub.executeTask(request);
      useAgentHubReviewSessionStore.getState().captureExecutionResult(result);
      return result;
    } catch (err) {
      return {
        status: 'ambiguous',
        retryable: true,
        error: {
          code: 'IPC_LOST',
          message: (err as Error).message || 'Task execution IPC result was lost'
        }
      };
    }
  }
}));
