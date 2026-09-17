import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  CreateTaskInputDto,
  CreateTaskRequestDto,
  TaskDto,
  TaskSubmissionResult
} from './AgentHubTypes';
import {
  snapshotCreateTaskInput,
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
  public async submitTask(request: CreateTaskRequestDto): Promise<TaskSubmissionResult> {
    if (this.#stopped) {
      return failed('STOPPED', 'Task submission is unavailable because Desktop is shutting down');
    }

    if (!request || typeof request !== 'object') {
      return failed('MALFORMED_REQUEST', 'Task submission request must be an object');
    }

    const { submissionId, input: rawInput } = request;
    if (!isValidSubmissionId(submissionId)) {
      return failed(
        'INVALID_SUBMISSION_ID',
        'Invalid submissionId: must be a non-blank alphanumeric/hyphen string <= 128 chars'
      );
    }

    let input: CreateTaskInputDto;
    try {
      input = snapshotCreateTaskInput(rawInput);
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return failed('MALFORMED_INPUT', (err as Error).message || 'Invalid task creation input');
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

      // POST proves AgentHub accepted the task. REST /state remains the cache authority.
      // Never insert the POST TaskDto into the Desktop cache.
      let snapshot;
      try {
        snapshot = await this.#connection.restClient.state(controller.signal);
      } catch (syncErr: unknown) {
        return this.#createdWithoutSync(createdTask, syncErr);
      }

      if (this.#stopped) {
        return this.#createdWithoutSync(
          createdTask,
          new AgentHubContractError('ABORTED', 'Desktop stopped after the task was accepted')
        );
      }

      this.#connection.cache.updateSnapshot(snapshot);
      return {
        status: 'created',
        task: createdTask,
        stateSynchronized: true
      };
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

    if (!this.#stopped) {
      const hasSnapshot = this.#connection.getState().snapshot !== null;
      const current = this.#connection.getState().connection;
      if (current !== 'disconnected') {
        this.#connection.cache.setConnectionStatus(hasSnapshot ? 'degraded' : 'connecting', {
          code,
          message
        });
      }
    }

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
