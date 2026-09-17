import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  CreateTaskInputDto,
  TaskDto,
  TaskSubmissionResult
} from './AgentHubTypes';
import {
  snapshotCreateTaskRequest,
  AgentHubValidationError
} from './AgentHubTypes';
import { AgentHubContractError } from './AgentHubRestClient';

interface SubmissionRecord {
  readonly fingerprint: string;
  inFlightPromise?: Promise<TaskSubmissionResult>;
}

function computeInputFingerprint(input: CreateTaskInputDto): string {
  const canonical = JSON.stringify({
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    requiredCapabilities: input.requiredCapabilities,
    requiredSpecialties: input.requiredSpecialties,
    acceptanceCriteria: input.acceptanceCriteria,
    complexity: input.complexity,
    risk: input.risk
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function failed(code: string, message: string): TaskSubmissionResult {
  return {
    status: 'failed',
    retryable: false,
    error: { code, message }
  };
}

function ambiguous(code: string, message: string): TaskSubmissionResult {
  return {
    status: 'ambiguous',
    retryable: true,
    error: { code, message }
  };
}

/**
 * UUID or tightly bounded opaque identifier.
 * Renderer typically sends crypto.randomUUID(); Main derives the backend header.
 */
export function isValidSubmissionId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (!id || id.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export class AgentHubTaskSubmission {
  readonly #connection: AgentHubConnection;
  readonly #submissions = new Map<string, SubmissionRecord>();
  readonly #activeControllers = new Set<AbortController>();
  #stopped = false;

  constructor(connection: AgentHubConnection) {
    this.#connection = connection;
  }

  /**
   * Submit a task creation request to AgentHub with strict idempotency and authority guarantees.
   */
  public async submitTask(request: unknown): Promise<TaskSubmissionResult> {
    if (this.#stopped) {
      return failed('STOPPED', 'Task submission is unavailable because Desktop is shutting down');
    }

    let submissionId: string;
    let input: CreateTaskInputDto;
    try {
      const validated = snapshotCreateTaskRequest(request);
      submissionId = validated.submissionId;
      input = validated.input;
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return failed('MALFORMED_REQUEST', (err as Error).message || 'Invalid task submission request');
    }

    if (!isValidSubmissionId(submissionId)) {
      return failed(
        'INVALID_SUBMISSION_ID',
        'Invalid submissionId: must be a non-blank alphanumeric/hyphen string <= 128 chars'
      );
    }

    const fingerprint = computeInputFingerprint(input);
    const existing = this.#submissions.get(submissionId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return failed(
          'IDEMPOTENCY_CONFLICT',
          `Submission ID '${submissionId}' was previously used with a different request payload`
        );
      }
      if (existing.inFlightPromise) {
        return await existing.inFlightPromise;
      }
    }

    const record: SubmissionRecord = existing ?? { fingerprint };
    this.#submissions.set(submissionId, record);

    const promise = this.#executeSubmission(submissionId, input);
    record.inFlightPromise = promise;

    try {
      return await promise;
    } finally {
      record.inFlightPromise = undefined;
    }
  }

  async #executeSubmission(
    submissionId: string,
    input: CreateTaskInputDto
  ): Promise<TaskSubmissionResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);

    const idempotencyKey = `desktop-task:${submissionId}`;
    let createdTask: TaskDto | null = null;

    try {
      createdTask = await this.#connection.restClient.createTask(
        input,
        idempotencyKey,
        controller.signal
      );

      // POST proves AgentHub accepted the task. Connection owns snapshot commit ordering.
      const sync = await this.#connection.syncAuthoritativeState(controller.signal);
      if (sync.disposition === 'committed' || sync.disposition === 'superseded-by-committed') {
        return {
          status: 'created',
          task: createdTask,
          stateSynchronized: true
        };
      }

      return this.#createdWithoutSync(
        createdTask,
        new AgentHubContractError(
          'SYNC_FAILED',
          'Task was created on AgentHub, but state resync failed'
        )
      );
    } catch (err: unknown) {
      if (createdTask) {
        return this.#createdWithoutSync(createdTask, err);
      }

      if (err instanceof AgentHubContractError) {
        if (err.code === 'TIMEOUT' || err.code === 'NETWORK_ERROR' || err.code === 'ABORTED') {
          return ambiguous(err.code, err.message);
        }
        return failed(err.code, err.message);
      }

      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }

      return failed('UNEXPECTED_ERROR', (err as Error).message || 'Unexpected task submission failure');
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  #createdWithoutSync(task: TaskDto, err: unknown): TaskSubmissionResult {
    const code =
      err instanceof AgentHubContractError || err instanceof AgentHubValidationError
        ? err.code
        : 'SYNC_FAILED';
    const message =
      err instanceof Error
        ? err.message
        : 'Task was created on AgentHub, but state resync failed';

    return {
      status: 'created',
      task,
      stateSynchronized: false,
      warning: { code, message }
    };
  }

  /**
   * Abort in-flight submissions. Session binding is in-memory only;
   * crash/restart recovery of ambiguous submissions is deferred to the next
   * authoritative GET /state on startup.
   */
  public stop(): void {
    this.#stopped = true;
    for (const controller of this.#activeControllers) {
      try {
        controller.abort();
      } catch {
        // Ignore abort errors
      }
    }
    this.#activeControllers.clear();
  }
}
