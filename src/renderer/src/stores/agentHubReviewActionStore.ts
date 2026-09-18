import { create } from 'zustand';
import type {
  ReviewDecisionInputDto,
  ReviewDecisionLifecycleDto,
  ReviewFindingInputDto,
  ReviewVerdictDto
} from '@shared/agenthubTypes';

export interface ReviewActionSession {
  readonly decisionId: string;
  readonly taskId: string;
  readonly reviewHandle: string;
  readonly input: ReviewDecisionInputDto;
  readonly status: 'idle' | 'submitting' | 'applied' | 'failed' | 'ambiguous';
  readonly result?: ReviewDecisionLifecycleDto;
  readonly error?: { readonly code: string; readonly message: string };
  readonly stateSynchronized?: boolean;
  readonly warning?: { readonly code: string; readonly message: string };
}

export const DEFAULT_REVIEW_DECISION_INPUT: ReviewDecisionInputDto = Object.freeze({
  verdict: 'ACCEPT' as const,
  summary: '',
  findings: Object.freeze([]),
  allowNoChangeCompletion: false
});

function generateDecisionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export interface AgentHubReviewActionState {
  readonly sessionsByTaskId: Readonly<Record<string, ReviewActionSession>>;
  readonly unavailableHandles: Readonly<Record<string, boolean>>;

  getOrCreateSession: (taskId: string, reviewHandle: string) => ReviewActionSession;
  updateDraftInput: (taskId: string, inputPartial: Partial<ReviewDecisionInputDto>) => void;
  setSubmitting: (taskId: string) => void;
  setApplied: (
    taskId: string,
    result: ReviewDecisionLifecycleDto,
    stateSynchronized: boolean,
    warning?: { code: string; message: string } | null
  ) => void;
  setFailed: (taskId: string, error: { code: string; message: string }) => void;
  setAmbiguous: (taskId: string, error: { code: string; message: string }) => void;
  rotateDecisionId: (taskId: string) => void;
  markHandleUnavailable: (reviewHandle: string) => void;
  isHandleUnavailable: (reviewHandle: string) => boolean;
  clearSession: () => void;
}

export const useAgentHubReviewActionStore = create<AgentHubReviewActionState>((set, get) => ({
  sessionsByTaskId: Object.freeze({}),
  unavailableHandles: Object.freeze({}),

  getOrCreateSession: (taskId: string, reviewHandle: string): ReviewActionSession => {
    const existing = get().sessionsByTaskId[taskId];
    if (existing && existing.reviewHandle === reviewHandle) {
      return existing;
    }

    const newSession: ReviewActionSession = Object.freeze({
      decisionId: generateDecisionId(),
      taskId,
      reviewHandle,
      input: DEFAULT_REVIEW_DECISION_INPUT,
      status: 'idle'
    });

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: newSession
      })
    }));

    return newSession;
  },

  updateDraftInput: (taskId: string, inputPartial: Partial<ReviewDecisionInputDto>) => {
    const existing = get().sessionsByTaskId[taskId];
    if (!existing) return;

    const wasAmbiguous = existing.status === 'ambiguous';
    const nextDecisionId = wasAmbiguous ? generateDecisionId() : existing.decisionId;
    const nextStatus = wasAmbiguous ? 'idle' : existing.status;

    const nextInput: ReviewDecisionInputDto = Object.freeze({
      verdict: inputPartial.verdict ?? existing.input.verdict,
      summary: inputPartial.summary !== undefined ? inputPartial.summary : existing.input.summary,
      findings: inputPartial.findings !== undefined ? Object.freeze([...inputPartial.findings]) : existing.input.findings,
      allowNoChangeCompletion:
        inputPartial.allowNoChangeCompletion !== undefined
          ? inputPartial.allowNoChangeCompletion
          : existing.input.allowNoChangeCompletion
    });

    const updatedSession: ReviewActionSession = Object.freeze({
      ...existing,
      decisionId: nextDecisionId,
      input: nextInput,
      status: nextStatus,
      ...(wasAmbiguous ? { error: undefined } : {})
    });

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: updatedSession
      })
    }));
  },

  setSubmitting: (taskId: string) => {
    const existing = get().sessionsByTaskId[taskId];
    if (!existing) return;

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: Object.freeze({
          ...existing,
          status: 'submitting',
          error: undefined
        })
      })
    }));
  },

  setApplied: (
    taskId: string,
    result: ReviewDecisionLifecycleDto,
    stateSynchronized: boolean,
    warning?: { code: string; message: string } | null
  ) => {
    const existing = get().sessionsByTaskId[taskId];
    if (!existing) return;

    // Terminal outcomes make current reviewHandle unavailable
    if (
      result.outcome === 'completed' ||
      result.outcome === 'completed-no-change' ||
      result.outcome === 'failed' ||
      result.outcome === 'blocked' ||
      result.outcome === 'waiting-input'
    ) {
      get().markHandleUnavailable(existing.reviewHandle);
    }

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: Object.freeze({
          ...existing,
          status: 'applied',
          result,
          stateSynchronized,
          warning: warning ? { code: warning.code, message: warning.message } : undefined,
          error: undefined
        })
      })
    }));
  },

  setFailed: (taskId: string, error: { code: string; message: string }) => {
    const existing = get().sessionsByTaskId[taskId];
    if (!existing) return;

    if (error.code === 'AGENTHUB_API_REVIEW_HANDLE_EXPIRED') {
      get().markHandleUnavailable(existing.reviewHandle);
    }

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: Object.freeze({
          ...existing,
          status: 'failed',
          error: { code: error.code, message: error.message }
        })
      })
    }));
  },

  setAmbiguous: (taskId: string, error: { code: string; message: string }) => {
    const existing = get().sessionsByTaskId[taskId];
    if (!existing) return;

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: Object.freeze({
          ...existing,
          status: 'ambiguous',
          error: { code: error.code, message: error.message }
        })
      })
    }));
  },

  rotateDecisionId: (taskId: string) => {
    const existing = get().sessionsByTaskId[taskId];
    if (!existing) return;

    set((state) => ({
      sessionsByTaskId: Object.freeze({
        ...state.sessionsByTaskId,
        [taskId]: Object.freeze({
          ...existing,
          decisionId: generateDecisionId(),
          status: 'idle',
          error: undefined
        })
      })
    }));
  },

  markHandleUnavailable: (reviewHandle: string) => {
    set((state) => ({
      unavailableHandles: Object.freeze({
        ...state.unavailableHandles,
        [reviewHandle]: true
      })
    }));
  },

  isHandleUnavailable: (reviewHandle: string): boolean => {
    return Boolean(get().unavailableHandles[reviewHandle]);
  },

  clearSession: () => {
    set({
      sessionsByTaskId: Object.freeze({}),
      unavailableHandles: Object.freeze({})
    });
  }
}));
