import { create } from 'zustand';
import type {
  ExecuteReviewReadyDto,
  TaskExecutionResult
} from '@shared/agenthubTypes';
import type {
  LifecycleReviewDto,
  PlanTaskRuntimeDto
} from '@shared/agenthubLifecycle';

/**
 * Session-only record of a confirmed review-ready execution result.
 * Maintained in renderer memory only, never persisted to disk/storage.
 */
export interface AgentHubReviewSessionRecord {
  readonly review: ExecuteReviewReadyDto;
  readonly stateSynchronized: boolean;
  readonly warning: {
    readonly code: string;
    readonly message: string;
  } | null;
}

/**
 * Pure deep freeze utility to ensure captured session records cannot be mutated.
 * Preserves all character codes (including NUL), order, and array contents.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Deep clone an object while preserving exact strings and structure.
 */
function cloneAndDetachRecord(
  review: ExecuteReviewReadyDto,
  stateSynchronized: boolean,
  warning: { code: string; message: string } | null
): AgentHubReviewSessionRecord {
  const detachedReview: ExecuteReviewReadyDto = {
    outcome: 'review-ready',
    reviewHandle: review.reviewHandle,
    reviewBundleSha256: review.reviewBundleSha256,
    taskId: review.taskId,
    assignmentId: review.assignmentId,
    agentId: review.agentId,
    providerId: review.providerId,
    workerResult: {
      summary: review.workerResult.summary,
      blockers: [...review.workerResult.blockers],
      questions: [...review.workerResult.questions],
      risks: [...review.workerResult.risks],
      notes: [...review.workerResult.notes]
    },
    source: {
      branchName: review.source.branchName,
      baseCommit: review.source.baseCommit,
      headCommit: review.source.headCommit,
      changedPaths: [...review.source.changedPaths],
      changeSetSha256: review.source.changeSetSha256,
      ...(review.source.committedPatch !== undefined
        ? { committedPatch: review.source.committedPatch }
        : {})
    },
    buildTest: {
      build: review.buildTest.build,
      test: review.buildTest.test,
      outcome: review.buildTest.outcome,
      commands: review.buildTest.commands.map((cmd) => ({
        id: cmd.id,
        phase: cmd.phase,
        outcome: cmd.outcome,
        ...(cmd.exitCode !== undefined ? { exitCode: cmd.exitCode } : {}),
        stdoutPreview: cmd.stdoutPreview,
        stderrPreview: cmd.stderrPreview
      }))
    },
    evidenceSha256: review.evidenceSha256
  };

  const detachedWarning = warning
    ? { code: warning.code, message: warning.message }
    : null;

  return deepFreeze({
    review: detachedReview,
    stateSynchronized,
    warning: detachedWarning
  });
}

/**
 * Pure reducer function for capturing a review-ready DTO into session review records.
 * Used by both initial execution results and subsequent review decision revision results.
 */
export function captureReviewReadyDto(
  current: Readonly<Record<string, AgentHubReviewSessionRecord>>,
  review: ExecuteReviewReadyDto,
  stateSynchronized: boolean,
  warning: { code: string; message: string } | null = null
): Readonly<Record<string, AgentHubReviewSessionRecord>> {
  const record = cloneAndDetachRecord(
    review,
    stateSynchronized,
    warning
  );

  return Object.freeze({
    ...current,
    [review.taskId]: record
  });
}

/**
 * Pure reducer function for capturing execution results into session review records.
 * 
 * Rules:
 * - Captures ONLY when result.status === 'executed' AND result.result.outcome === 'review-ready'.
 * - Ambiguous, failed, blocked, waiting-input, or failed-lifecycle results return `current` unchanged.
 * - Confirmed review-ready for an existing taskId replaces the previous session record for that task.
 * - Distinct tasks maintain independent records.
 */
export function captureReviewReadyResult(
  current: Readonly<Record<string, AgentHubReviewSessionRecord>>,
  result: TaskExecutionResult
): Readonly<Record<string, AgentHubReviewSessionRecord>> {
  if (result.status !== 'executed' || result.result.outcome !== 'review-ready') {
    return current;
  }

  const review = result.result;
  const warning = !result.stateSynchronized ? result.warning : null;
  return captureReviewReadyDto(
    current,
    review,
    result.stateSynchronized,
    warning
  );
}

export function reduceAuthoritativeReviews(
  current: Readonly<Record<string, AgentHubReviewSessionRecord>>,
  reviews: readonly LifecycleReviewDto[],
  planTasks: readonly PlanTaskRuntimeDto[]
): Readonly<Record<string, AgentHubReviewSessionRecord>> {
  const lifecycleTaskIds = new Set<string>();
  const reviewingIds = new Set<string>();
  for (const task of planTasks) {
    if (typeof task.runtimeTaskId !== 'string' || task.runtimeTaskId.length === 0) continue;
    lifecycleTaskIds.add(task.runtimeTaskId);
    if (task.runtimeState === 'REVIEWING') reviewingIds.add(task.runtimeTaskId);
  }
  const byRuntime = new Map(reviews.map((review) => [review.runtimeTaskId, review]));
  let next: Record<string, AgentHubReviewSessionRecord> = { ...current };
  for (const taskId of lifecycleTaskIds) {
    const review = byRuntime.get(taskId);
    if (reviewingIds.has(taskId) && review !== undefined && review.review.taskId === taskId) {
      next = captureReviewReadyDto(next, review.review, true, null) as Record<string, AgentHubReviewSessionRecord>;
    } else if (Object.prototype.hasOwnProperty.call(next, taskId)) {
      const { [taskId]: _removed, ...rest } = next;
      next = rest;
    }
  }
  return Object.freeze(next);
}

export interface AgentHubReviewSessionState {
  readonly reviewReadyByTaskId: Readonly<Record<string, AgentHubReviewSessionRecord>>;
  readonly selectedReviewTaskId: string | null;
  readonly isModalOpen: boolean;

  captureExecutionResult: (result: TaskExecutionResult) => void;
  captureReviewReady: (
    review: ExecuteReviewReadyDto,
    stateSynchronized: boolean,
    warning?: { code: string; message: string } | null
  ) => void;
  hydrateAuthoritativeReviews: (
    reviews: readonly LifecycleReviewDto[],
    planTasks: readonly PlanTaskRuntimeDto[]
  ) => void;
  selectReviewTask: (taskId: string | null) => void;
  openModal: (taskId?: string) => void;
  closeModal: () => void;
  clearSession: () => void;
}

export const useAgentHubReviewSessionStore = create<AgentHubReviewSessionState>((set, get) => ({
  reviewReadyByTaskId: Object.freeze({}),
  selectedReviewTaskId: null,
  isModalOpen: false,

  captureExecutionResult: (result: TaskExecutionResult) => {
    const prev = get().reviewReadyByTaskId;
    const next = captureReviewReadyResult(prev, result);
    if (next === prev) return;

    set((state) => ({
      reviewReadyByTaskId: next,
      selectedReviewTaskId:
        state.selectedReviewTaskId ??
        (result.status === 'executed' && result.result.outcome === 'review-ready'
          ? result.result.taskId
          : null)
    }));
  },

  captureReviewReady: (
    review: ExecuteReviewReadyDto,
    stateSynchronized: boolean,
    warning: { code: string; message: string } | null = null
  ) => {
    const prev = get().reviewReadyByTaskId;
    const next = captureReviewReadyDto(prev, review, stateSynchronized, warning);
    set((state) => ({
      reviewReadyByTaskId: next,
      selectedReviewTaskId: state.selectedReviewTaskId ?? review.taskId
    }));
  },

  hydrateAuthoritativeReviews: (
    reviews: readonly LifecycleReviewDto[],
    planTasks: readonly PlanTaskRuntimeDto[]
  ) => {
    const prev = get().reviewReadyByTaskId;
    const next = reduceAuthoritativeReviews(prev, reviews, planTasks);
    if (next === prev) return;
    const selected = get().selectedReviewTaskId;
    set({
      reviewReadyByTaskId: next,
      selectedReviewTaskId: selected && selected in next ? selected : (Object.keys(next)[0] ?? null)
    });
  },


  selectReviewTask: (taskId: string | null) => {
    set({ selectedReviewTaskId: taskId });
  },

  openModal: (taskId?: string) => {
    const currentSelected = get().selectedReviewTaskId;
    const records = get().reviewReadyByTaskId;
    const availableTaskIds = Object.keys(records);

    let targetTaskId = taskId ?? currentSelected;
    if (!targetTaskId && availableTaskIds.length > 0) {
      targetTaskId = availableTaskIds[0];
    }

    set({
      selectedReviewTaskId: targetTaskId ?? null,
      isModalOpen: true
    });
  },

  closeModal: () => {
    set({ isModalOpen: false });
  },

  clearSession: () => {
    set({
      reviewReadyByTaskId: Object.freeze({}),
      selectedReviewTaskId: null,
      isModalOpen: false
    });
  }
}));
