import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  ReviewDecisionInputDto,
  ReviewDecisionLifecycleDto,
  ReviewDecisionRequestDto,
  ReviewDecisionResult
} from './AgentHubTypes';
import {
  snapshotReviewDecisionRequest,
  toBackendReviewDecisionBody,
  AgentHubValidationError
} from './AgentHubTypes';
import { AgentHubContractError, isDefinitiveMutationFailure } from './AgentHubRestClient';

interface DecisionRecord {
  readonly fingerprint: string;
  inFlightPromise?: Promise<ReviewDecisionResult>;
  settledResult?: ReviewDecisionResult;
}

function computeReviewDecisionFingerprint(reviewHandle: string, input: ReviewDecisionInputDto): string {
  const canonical = JSON.stringify({
    reviewHandle,
    verdict: input.verdict,
    summary: input.summary,
    findings: input.findings,
    allowNoChangeCompletion: input.allowNoChangeCompletion
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function failed(code: string, message: string): ReviewDecisionResult {
  return {
    status: 'failed',
    retryable: false,
    error: { code, message }
  };
}

function ambiguous(code: string, message: string): ReviewDecisionResult {
  return {
    status: 'ambiguous',
    retryable: true,
    error: { code, message }
  };
}

function freezeDecisionResult(result: ReviewDecisionResult): ReviewDecisionResult {
  if (result.status === 'failed' || result.status === 'ambiguous') {
    Object.freeze(result.error);
  }
  if (result.status === 'applied' && result.stateSynchronized === false) {
    Object.freeze(result.warning);
  }
  return Object.freeze(result);
}

export class AgentHubReviewDecision {
  readonly #connection: AgentHubConnection;
  readonly #decisions = new Map<string, DecisionRecord>();
  readonly #activeControllers = new Set<AbortController>();
  #stopped = false;

  constructor(connection: AgentHubConnection) {
    this.#connection = connection;
  }

  public async reviewDecision(request: unknown): Promise<ReviewDecisionResult> {
    return this.applyDecision(request);
  }

  public async applyDecision(request: unknown): Promise<ReviewDecisionResult> {
    if (this.#stopped) {
      return failed('STOPPED', 'Review decision is unavailable because Desktop is shutting down');
    }

    let decisionId: string;
    let reviewHandle: string;
    let input: ReviewDecisionInputDto;
    try {
      const validated: ReviewDecisionRequestDto = snapshotReviewDecisionRequest(request);
      decisionId = validated.decisionId;
      reviewHandle = validated.reviewHandle;
      input = validated.input;
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return failed('MALFORMED_REQUEST', (err as Error).message || 'Invalid review decision request');
    }

    const fingerprint = computeReviewDecisionFingerprint(reviewHandle, input);
    const existing = this.#decisions.get(decisionId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return failed(
          'IDEMPOTENCY_CONFLICT',
          `Decision ID '${decisionId}' was previously used with a different request payload`
        );
      }
      if (existing.settledResult) {
        return existing.settledResult;
      }
      if (existing.inFlightPromise) {
        return await existing.inFlightPromise;
      }
    }

    const record: DecisionRecord = existing ?? { fingerprint };
    this.#decisions.set(decisionId, record);

    const promise = this.#applyOnce(decisionId, reviewHandle, input);
    record.inFlightPromise = promise;

    try {
      const result = await promise;
      if (result.status === 'applied' || result.status === 'failed') {
        record.settledResult = freezeDecisionResult(result);
        return record.settledResult;
      }
      return result;
    } finally {
      record.inFlightPromise = undefined;
    }
  }

  async #applyOnce(
    decisionId: string,
    reviewHandle: string,
    input: ReviewDecisionInputDto
  ): Promise<ReviewDecisionResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);

    const idempotencyKey = `desktop-review:${decisionId}`;
    let decisionResult: ReviewDecisionLifecycleDto | null = null;

    try {
      const backendBody = toBackendReviewDecisionBody(decisionId, input);
      decisionResult = await this.#connection.restClient.reviewDecision(
        reviewHandle,
        backendBody,
        idempotencyKey,
        controller.signal
      );

      const sync = await this.#connection.syncAuthoritativeState(controller.signal);
      if (sync.disposition === 'committed' || sync.disposition === 'superseded-by-committed') {
        return {
          status: 'applied',
          result: decisionResult,
          stateSynchronized: true
        };
      }

      return this.#appliedWithoutSync(
        decisionResult,
        new AgentHubContractError(
          'SYNC_FAILED',
          'Review decision was applied on AgentHub, but state resync failed'
        )
      );
    } catch (err: unknown) {
      if (decisionResult) {
        return this.#appliedWithoutSync(decisionResult, err);
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

      const isAbort = (err as Error)?.name === 'AbortError';
      if (isAbort || this.#stopped) {
        return ambiguous(
          this.#stopped ? 'STOPPED' : 'ABORTED',
          this.#stopped
            ? 'Review decision aborted because Desktop is shutting down'
            : 'Review decision request aborted'
        );
      }

      return ambiguous('UNEXPECTED_ERROR', (err as Error).message || 'Unexpected review decision failure');
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  #appliedWithoutSync(result: ReviewDecisionLifecycleDto, err: unknown): ReviewDecisionResult {
    const code =
      err instanceof AgentHubContractError || err instanceof AgentHubValidationError
        ? err.code
        : 'SYNC_FAILED';
    const message =
      err instanceof Error
        ? err.message
        : 'Review decision was applied on AgentHub, but state resync failed';

    return {
      status: 'applied',
      result,
      stateSynchronized: false,
      warning: { code, message }
    };
  }

  /**
   * Abort in-flight review decisions during shutdown.
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
