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
  TaskSubmissionResult,
  ReviewDecisionRequestDto,
  ReviewDecisionResult,
  CreateAgentRequestDto,
  UpdateAgentRequestDto,
  AgentActionRequestDto,
  AgentMutationResult,
  ProviderDto,
  CreateIntakeRequestDto,
  CreatePlanRequestDto,
  CreatePlanRevisionRequestDto,
  PlanDecisionRequestDto,
  StartPlanRequestDto,
  LifecycleMutationResult,
  LifecycleReviewDto
} from '@shared/agenthubTypes';

export interface AgentHubStoreState {
  /** Cache / projection of Backend /state. Not business authority. */
  connection: AgentHubConnectionStatus;
  health: AgentHubHealthDto | null;
  snapshot: AgentHubStateSnapshot | null;
  lifecycleReviews: readonly LifecycleReviewDto[] | null;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  lastError: { code: string; message: string } | null;
  isRefreshing: boolean;
  selectedAgentId: string | null;

  providerCatalog: readonly ProviderDto[] | null;
  providerCatalogStatus: 'idle' | 'loading' | 'ready' | 'failed';
  providerCatalogError: { code: string; message: string } | null;

  init: () => () => void;
  refresh: () => Promise<void>;
  refreshProviderCatalog: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  submitTask: (request: CreateTaskRequestDto) => Promise<TaskSubmissionResult>;
  executeTask: (request: ExecuteTaskRequestDto) => Promise<TaskExecutionResult>;
  reviewDecision: (request: ReviewDecisionRequestDto) => Promise<ReviewDecisionResult>;
  createAgent: (request: CreateAgentRequestDto) => Promise<AgentMutationResult>;
  updateAgent: (request: UpdateAgentRequestDto) => Promise<AgentMutationResult>;
  enableAgent: (request: AgentActionRequestDto) => Promise<AgentMutationResult>;
  disableAgent: (request: AgentActionRequestDto) => Promise<AgentMutationResult>;
  deleteAgent: (request: AgentActionRequestDto) => Promise<AgentMutationResult>;
  createIntake: (request: CreateIntakeRequestDto) => Promise<LifecycleMutationResult>;
  createPlan: (request: CreatePlanRequestDto) => Promise<LifecycleMutationResult>;
  createPlanRevision: (request: CreatePlanRevisionRequestDto) => Promise<LifecycleMutationResult>;
  approvePlan: (request: PlanDecisionRequestDto) => Promise<LifecycleMutationResult>;
  requestPlanChanges: (request: PlanDecisionRequestDto) => Promise<LifecycleMutationResult>;
  rejectPlan: (request: PlanDecisionRequestDto) => Promise<LifecycleMutationResult>;
  startPlan: (request: StartPlanRequestDto) => Promise<LifecycleMutationResult>;
}


function reconcileSelectedAgent(
  prevSelectedId: string | null,
  snapshot: AgentHubStateSnapshot | null
): string | null {
  if (!prevSelectedId || !snapshot || !snapshot.agents) return null;
  return snapshot.agents.some((a) => a.agentId === prevSelectedId) ? prevSelectedId : null;
}

function applyDesktopState(
  prevSelectedId: string | null,
  state: AgentHubDesktopState
): Pick<
  AgentHubStoreState,
  'connection' | 'health' | 'snapshot' | 'lifecycleReviews' | 'lastSyncAt' | 'lastEventAt' | 'lastError' | 'selectedAgentId'
> {
  if (state.lifecycleReviews !== null) {
    useAgentHubReviewSessionStore.getState().hydrateAuthoritativeReviews(
      state.lifecycleReviews,
      state.snapshot?.planTasks ?? []
    );
  }
  return {
    connection: state.connection,
    health: state.health,
    snapshot: state.snapshot,
    lifecycleReviews: state.lifecycleReviews,
    lastSyncAt: state.lastSyncAt,
    lastEventAt: state.lastEventAt,
    lastError: state.lastError,
    selectedAgentId: reconcileSelectedAgent(prevSelectedId, state.snapshot)
  };
}

let inFlightCatalogPromise: Promise<void> | null = null;
let catalogGeneration = 0;

export const useAgentHubStore = create<AgentHubStoreState>((set, get) => ({
  connection: 'disconnected',
  health: null,
  snapshot: null,
  lifecycleReviews: null,
  lastSyncAt: null,
  lastEventAt: null,
  lastError: null,
  isRefreshing: false,
  selectedAgentId: null,

  providerCatalog: null,
  providerCatalogStatus: 'idle',
  providerCatalogError: null,

  init: () => {
    if (typeof window === 'undefined' || !window.agentHub) {
      return () => {};
    }

    // Pull initial connection state from main
    void window.agentHub.getConnectionState()
      .then((state: AgentHubDesktopState) => {
        set((s) => applyDesktopState(s.selectedAgentId, state));
        if (state.connection === 'connected' || state.connection === 'degraded') {
          void get().refreshProviderCatalog();
        }
      })
      .catch((err: Error) => {
        set({
          connection: 'disconnected',
          lastError: { code: 'INIT_FAILED', message: err.message }
        });
      });

    // Subscribe to pushed state updates
    const cleanup = window.agentHub.onChanged((state: AgentHubDesktopState) => {
      set((s) => applyDesktopState(s.selectedAgentId, state));
      if ((state.connection === 'connected' || state.connection === 'degraded') && !get().providerCatalog) {
        void get().refreshProviderCatalog();
      }
    });

    return cleanup;
  },

  refresh: async () => {
    if (get().isRefreshing) return;
    if (typeof window === 'undefined' || !window.agentHub) return;

    set({ isRefreshing: true });
    try {
      const state = await window.agentHub.refresh();
      set((s) => applyDesktopState(s.selectedAgentId, state));
    } catch (err) {
      set({
        lastError: { code: 'REFRESH_FAILED', message: (err as Error).message }
      });
    } finally {
      set({ isRefreshing: false });
    }
  },

  refreshProviderCatalog: async () => {
    if (inFlightCatalogPromise) {
      return inFlightCatalogPromise;
    }
    if (typeof window === 'undefined' || !window.agentHub?.getProviders) {
      return;
    }

    const currentGen = ++catalogGeneration;
    set({
      providerCatalogStatus: 'loading',
      providerCatalogError: null
    });

    const execute = async (): Promise<void> => {
      try {
        const catalog = await window.agentHub.getProviders();
        if (currentGen === catalogGeneration) {
          set({
            providerCatalog: catalog,
            providerCatalogStatus: 'ready',
            providerCatalogError: null
          });
        }
      } catch (err) {
        if (currentGen === catalogGeneration) {
          set({
            providerCatalogStatus: 'failed',
            providerCatalogError: {
              code: 'CATALOG_REFRESH_FAILED',
              message: (err as Error).message || 'Failed to refresh provider catalog'
            }
          });
        }
      } finally {
        if (inFlightCatalogPromise === currentPromise) {
          inFlightCatalogPromise = null;
        }
      }
    };

    const currentPromise = execute();
    inFlightCatalogPromise = currentPromise;
    return currentPromise;
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
  },

  reviewDecision: async (request: ReviewDecisionRequestDto): Promise<ReviewDecisionResult> => {
    if (typeof window === 'undefined' || !window.agentHub) {
      return {
        status: 'failed',
        retryable: false,
        error: { code: 'NO_PRELOAD', message: 'AgentHub preload bridge is unavailable' }
      };
    }
    try {
      const result = await window.agentHub.reviewDecision(request);
      if (result.status === 'applied' && result.result.outcome === 'review-ready') {
        const warning = !result.stateSynchronized ? result.warning : null;
        useAgentHubReviewSessionStore.getState().captureReviewReady(
          result.result,
          result.stateSynchronized,
          warning
        );
      }
      return result;
    } catch (err) {
      return {
        status: 'ambiguous',
        retryable: true,
        error: {
          code: 'IPC_LOST',
          message: (err as Error).message || 'Review decision IPC result was lost'
        }
      };
    }
  },

  createAgent: (request) => invokeAgentMutation('createAgent', request),
  updateAgent: (request) => invokeAgentMutation('updateAgent', request),
  enableAgent: (request) => invokeAgentMutation('enableAgent', request),
  disableAgent: (request) => invokeAgentMutation('disableAgent', request),
  deleteAgent: (request) => invokeAgentMutation('deleteAgent', request),
  createIntake: (request) => invokeLifecycleMutation('createIntake', request),
  createPlan: (request) => invokeLifecycleMutation('createPlan', request),
  createPlanRevision: (request) => invokeLifecycleMutation('createPlanRevision', request),
  approvePlan: (request) => invokeLifecycleMutation('approvePlan', request),
  requestPlanChanges: (request) => invokeLifecycleMutation('requestPlanChanges', request),
  rejectPlan: (request) => invokeLifecycleMutation('rejectPlan', request),
  startPlan: (request) => invokeLifecycleMutation('startPlan', request)
}));

async function invokeAgentMutation(
  method: 'createAgent' | 'updateAgent' | 'enableAgent' | 'disableAgent' | 'deleteAgent',
  request: CreateAgentRequestDto | UpdateAgentRequestDto | AgentActionRequestDto
): Promise<AgentMutationResult> {
  if (typeof window === 'undefined' || !window.agentHub) {
    return {
      status: 'failed',
      retryable: false,
      error: { code: 'NO_PRELOAD', message: 'AgentHub preload bridge is unavailable' }
    };
  }
  try {
    if (method === 'createAgent') {
      return await window.agentHub.createAgent(request as CreateAgentRequestDto);
    }
    if (method === 'updateAgent') {
      return await window.agentHub.updateAgent(request as UpdateAgentRequestDto);
    }
    if (method === 'enableAgent') {
      return await window.agentHub.enableAgent(request as AgentActionRequestDto);
    }
    if (method === 'disableAgent') {
      return await window.agentHub.disableAgent(request as AgentActionRequestDto);
    }
    return await window.agentHub.deleteAgent(request as AgentActionRequestDto);
  } catch (err) {
    return {
      status: 'ambiguous',
      retryable: true,
      error: {
        code: 'IPC_LOST',
        message: (err as Error).message || 'Agent mutation IPC result was lost'
      }
    };
  }
}

async function invokeLifecycleMutation(
  method:
    | 'createIntake'
    | 'createPlan'
    | 'createPlanRevision'
    | 'approvePlan'
    | 'requestPlanChanges'
    | 'rejectPlan'
    | 'startPlan',
  request:
    | CreateIntakeRequestDto
    | CreatePlanRequestDto
    | CreatePlanRevisionRequestDto
    | PlanDecisionRequestDto
    | StartPlanRequestDto
): Promise<LifecycleMutationResult> {
  if (typeof window === 'undefined' || !window.agentHub) {
    return {
      status: 'failed',
      retryable: false,
      error: { code: 'NO_PRELOAD', message: 'AgentHub preload bridge is unavailable' }
    };
  }
  try {
    if (method === 'createIntake') {
      return await window.agentHub.createIntake(request as CreateIntakeRequestDto);
    }
    if (method === 'createPlan') {
      return await window.agentHub.createPlan(request as CreatePlanRequestDto);
    }
    if (method === 'createPlanRevision') {
      return await window.agentHub.createPlanRevision(request as CreatePlanRevisionRequestDto);
    }
    if (method === 'approvePlan') {
      return await window.agentHub.approvePlan(request as PlanDecisionRequestDto);
    }
    if (method === 'requestPlanChanges') {
      return await window.agentHub.requestPlanChanges(request as PlanDecisionRequestDto);
    }
    if (method === 'rejectPlan') {
      return await window.agentHub.rejectPlan(request as PlanDecisionRequestDto);
    }
    return await window.agentHub.startPlan(request as StartPlanRequestDto);
  } catch (err) {
    return {
      status: 'ambiguous',
      retryable: true,
      error: {
        code: 'IPC_LOST',
        message: (err as Error).message || 'Lifecycle mutation IPC result was lost'
      }
    };
  }
}
