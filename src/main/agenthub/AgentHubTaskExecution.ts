import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  ExecuteTaskInputDto,
  ExecuteTaskResultDto,
  TaskExecutionResult
} from './AgentHubTypes';
import {
  snapshotExecuteTaskRequest,
  AgentHubValidationError
} from './AgentHubTypes';
import { AgentHubContractError, isDefinitiveMutationFailure } from './AgentHubRestClient';

interface ExecutionRecord {
  readonly fingerprint: string;
  inFlightPromise?: Promise<TaskExecutionResult>;
}

function computeExecutionFingerprint(taskId: string, input: ExecuteTaskInputDto): string {
  const canonical = JSON.stringify({
    taskId,
    baseRef: input.baseRef,
    prompt: input.prompt
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function failed(code: string, message: string): TaskExecutionResult {
  return {
    status: 'failed',
    retryable: false,
    error: { code, message }
  };
}

function ambiguous(code: string, message: string): TaskExecutionResult {
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
export function isValidExecutionId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (!id || id.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export class AgentHubTaskExecution {
  readonly #connection: AgentHubConnection;
  readonly #executions = new Map<string, ExecutionRecord>();
  readonly #activeControllers = new Set<AbortController>();
  #stopped = false;

  constructor(connection: AgentHubConnection) {
    this.#connection = connection;
  }

  public async executeTask(request: unknown): Promise<TaskExecutionResult> {
    if (this.#stopped) {
      return failed('STOPPED', 'Task execution is unavailable because Desktop is shutting down');
    }

    let executionId: string;
    let taskId: string;
    let input: ExecuteTaskInputDto;
    try {
      const validated = snapshotExecuteTaskRequest(request);
      executionId = validated.executionId;
      taskId = validated.taskId;
      input = validated.input;
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return failed('MALFORMED_REQUEST', (err as Error).message || 'Invalid task execution request');
    }

    if (!isValidExecutionId(executionId)) {
      return failed(
        'INVALID_EXECUTION_ID',
        'Invalid executionId: must be a non-blank alphanumeric/hyphen string <= 128 chars'
      );
    }

    const fingerprint = computeExecutionFingerprint(taskId, input);
    const existing = this.#executions.get(executionId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return failed(
          'IDEMPOTENCY_CONFLICT',
          `Execution ID '${executionId}' was previously used with a different request payload`
        );
      }
      if (existing.inFlightPromise) {
        return await existing.inFlightPromise;
      }
    }

    const record: ExecutionRecord = existing ?? { fingerprint };
    this.#executions.set(executionId, record);

    const promise = this.#executeOnce(executionId, taskId, input);
    record.inFlightPromise = promise;

    try {
      return await promise;
    } finally {
      record.inFlightPromise = undefined;
    }
  }

  async #executeOnce(
    executionId: string,
    taskId: string,
    input: ExecuteTaskInputDto
  ): Promise<TaskExecutionResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);

    const idempotencyKey = `desktop-execute:${executionId}`;
    let executeResult: ExecuteTaskResultDto | null = null;

    try {
      executeResult = await this.#connection.restClient.executeTask(
        taskId,
        input,
        idempotencyKey,
        controller.signal
      );

      const sync = await this.#connection.syncAuthoritativeState(controller.signal);
      if (sync.disposition === 'committed' || sync.disposition === 'superseded-by-committed') {
        return {
          status: 'executed',
          result: executeResult,
          stateSynchronized: true
        };
      }

      return this.#executedWithoutSync(
        executeResult,
        new AgentHubContractError(
          'SYNC_FAILED',
          'Task was executed on AgentHub, but state resync failed'
        )
      );
    } catch (err: unknown) {
      if (executeResult) {
        return this.#executedWithoutSync(executeResult, err);
      }

      if (err instanceof AgentHubContractError) {
        if (isDefinitiveMutationFailure(err)) {
          return failed(err.code, err.message);
        }
        return ambiguous(err.code, err.message);
      }

      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }

      return ambiguous('UNEXPECTED_ERROR', (err as Error).message || 'Unexpected task execution failure');
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  #executedWithoutSync(result: ExecuteTaskResultDto, err: unknown): TaskExecutionResult {
    const code =
      err instanceof AgentHubContractError || err instanceof AgentHubValidationError
        ? err.code
        : 'SYNC_FAILED';
    const message =
      err instanceof Error
        ? err.message
        : 'Task was executed on AgentHub, but state resync failed';

    return {
      status: 'executed',
      result,
      stateSynchronized: false,
      warning: { code, message }
    };
  }

  /**
   * Abort in-flight executions. Session binding is in-memory only;
   * crash/restart recovery of ambiguous executions is deferred to the next
   * authoritative GET /state on startup plus an explicit user decision.
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
