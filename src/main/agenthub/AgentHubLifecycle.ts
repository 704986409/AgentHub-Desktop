import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  CreateIntakeInputDto,
  CreatePlanInputDto,
  CreatePlanRevisionInputDto,
  LifecycleMutationResult,
  PlanDecisionInputDto,
  StartPlanInputDto
} from './AgentHubTypes';
import { AgentHubValidationError } from './AgentHubTypes';
import {
  snapshotCreateIntakeRequest,
  snapshotCreatePlanRequest,
  snapshotCreatePlanRevisionRequest,
  snapshotPlanDecisionRequest,
  snapshotStartPlanRequest
} from '../../shared/agenthubLifecycle';
import { AgentHubContractError, isDefinitiveMutationFailure } from './AgentHubRestClient';

type LifecycleOperation =
  | 'createIntake'
  | 'createPlan'
  | 'createRevision'
  | 'approve'
  | 'requestChanges'
  | 'reject'
  | 'start';

interface MutationRecord {
  readonly fingerprint: string;
  inFlightPromise?: Promise<LifecycleMutationResult>;
  settledResult?: LifecycleMutationResult;
}

function isValidMutationId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (!id || id.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function fingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function failed(code: string, message: string): LifecycleMutationResult {
  return { status: 'failed', retryable: false, error: { code, message } };
}

function ambiguous(code: string, message: string): LifecycleMutationResult {
  return { status: 'ambiguous', retryable: true, error: { code, message } };
}

function freezeResult(result: LifecycleMutationResult): LifecycleMutationResult {
  if (result.status === 'failed' || result.status === 'ambiguous') {
    Object.freeze(result.error);
  }
  if (result.status === 'applied' && result.stateSynchronized === false) {
    Object.freeze(result.warning);
  }
  return Object.freeze(result);
}

export class AgentHubLifecycle {
  readonly #connection: AgentHubConnection;
  readonly #mutations = new Map<string, MutationRecord>();
  readonly #activeControllers = new Set<AbortController>();
  #stopped = false;

  constructor(connection: AgentHubConnection) {
    this.#connection = connection;
  }

  public stop(): void {
    this.#stopped = true;
    for (const controller of this.#activeControllers) {
      controller.abort();
    }
    this.#activeControllers.clear();
  }

  public createIntake(request: unknown): Promise<LifecycleMutationResult> {
    return this.#submit('createIntake', request, () => {
      const parsed = snapshotCreateIntakeRequest(request);
      return {
        mutationId: parsed.mutationId,
        fingerprint: fingerprint({ op: 'createIntake', input: parsed.input }),
        run: (signal) => this.#connection.restClient.createIntake(parsed.input, this.#key('createIntake', parsed.mutationId), signal)
      };
    });
  }

  public createPlan(request: unknown): Promise<LifecycleMutationResult> {
    return this.#submit('createPlan', request, () => {
      const parsed = snapshotCreatePlanRequest(request);
      return {
        mutationId: parsed.mutationId,
        fingerprint: fingerprint({ op: 'createPlan', input: parsed.input }),
        run: (signal) => this.#connection.restClient.createPlan(parsed.input, this.#key('createPlan', parsed.mutationId), signal)
      };
    });
  }

  public createRevision(request: unknown): Promise<LifecycleMutationResult> {
    return this.#submit('createRevision', request, () => {
      const parsed = snapshotCreatePlanRevisionRequest(request);
      this.#assertPlanBinding(parsed.planId, parsed.input.basedOnVersion, null);
      return {
        mutationId: parsed.mutationId,
        fingerprint: fingerprint({ op: 'createRevision', planId: parsed.planId, input: parsed.input }),
        run: (signal) =>
          this.#connection.restClient.createPlanRevision(
            parsed.planId,
            parsed.input,
            this.#key('createRevision', parsed.mutationId),
            signal
          )
      };
    });
  }

  public approve(request: unknown): Promise<LifecycleMutationResult> {
    return this.#decide('approve', request);
  }

  public requestChanges(request: unknown): Promise<LifecycleMutationResult> {
    return this.#decide('requestChanges', request);
  }

  public reject(request: unknown): Promise<LifecycleMutationResult> {
    return this.#decide('reject', request);
  }

  public start(request: unknown): Promise<LifecycleMutationResult> {
    return this.#submit('start', request, () => {
      const parsed = snapshotStartPlanRequest(request);
      this.#assertPlanBinding(parsed.planId, parsed.input.planVersion, parsed.input.proposalHash);
      return {
        mutationId: parsed.mutationId,
        fingerprint: fingerprint({ op: 'start', planId: parsed.planId, input: parsed.input }),
        run: (signal) =>
          this.#connection.restClient.startPlan(
            parsed.planId,
            parsed.input,
            this.#key('start', parsed.mutationId),
            signal
          )
      };
    });
  }

  #decide(operation: 'approve' | 'requestChanges' | 'reject', request: unknown): Promise<LifecycleMutationResult> {
    return this.#submit(operation, request, () => {
      const parsed = snapshotPlanDecisionRequest(request);
      this.#assertPlanBinding(parsed.planId, parsed.input.planVersion, parsed.input.proposalHash);
      return {
        mutationId: parsed.mutationId,
        fingerprint: fingerprint({ op: operation, planId: parsed.planId, input: parsed.input }),
        run: (signal) => {
          if (operation === 'approve') {
            return this.#connection.restClient.approvePlan(
              parsed.planId,
              parsed.input,
              this.#key(operation, parsed.mutationId),
              signal
            );
          }
          if (operation === 'reject') {
            return this.#connection.restClient.rejectPlan(
              parsed.planId,
              parsed.input,
              this.#key(operation, parsed.mutationId),
              signal
            );
          }
          return this.#connection.restClient.requestPlanChanges(
            parsed.planId,
            parsed.input,
            this.#key(operation, parsed.mutationId),
            signal
          );
        }
      };
    });
  }

  async #submit(
    operation: LifecycleOperation,
    _request: unknown,
    prepare: () => {
      mutationId: string;
      fingerprint: string;
      run: (signal: AbortSignal) => Promise<unknown>;
    }
  ): Promise<LifecycleMutationResult> {
    if (this.#stopped) {
      return failed('STOPPED', 'Lifecycle mutation is unavailable because Desktop is shutting down');
    }

    let prepared: ReturnType<typeof prepare>;
    try {
      prepared = prepare();
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return failed('MALFORMED_REQUEST', (err as Error).message || 'Invalid lifecycle mutation request');
    }

    if (!isValidMutationId(prepared.mutationId)) {
      return failed(
        'INVALID_MUTATION_ID',
        'Invalid mutationId: must be a non-blank alphanumeric/hyphen string <= 128 chars'
      );
    }

    const existing = this.#mutations.get(prepared.mutationId);
    if (existing) {
      if (existing.fingerprint !== prepared.fingerprint) {
        return failed(
          'IDEMPOTENCY_CONFLICT',
          `Mutation ID '${prepared.mutationId}' was previously used with a different request payload`
        );
      }
      if (existing.settledResult) {
        return existing.settledResult;
      }
      if (existing.inFlightPromise) {
        return await existing.inFlightPromise;
      }
    }

    const record: MutationRecord = existing ?? { fingerprint: prepared.fingerprint };
    this.#mutations.set(prepared.mutationId, record);
    const promise = this.#execute(operation, prepared.run);
    record.inFlightPromise = promise;
    try {
      const result = await promise;
      if (result.status === 'applied' || result.status === 'failed') {
        record.settledResult = freezeResult(result);
        return record.settledResult;
      }
      return result;
    } finally {
      record.inFlightPromise = undefined;
    }
  }

  async #execute(
    operation: LifecycleOperation,
    run: (signal: AbortSignal) => Promise<unknown>
  ): Promise<LifecycleMutationResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);
    let accepted = false;

    try {
      await run(controller.signal);
      accepted = true;
      const sync = await this.#connection.syncAuthoritativeState(controller.signal);
      if (sync.disposition === 'committed' || sync.disposition === 'superseded-by-committed') {
        return { status: 'applied', stateSynchronized: true };
      }
      return this.#appliedWithoutSync(
        new AgentHubContractError('SYNC_FAILED', 'Lifecycle mutation was accepted, but state resync failed')
      );
    } catch (err: unknown) {
      if (accepted) {
        return this.#appliedWithoutSync(err);
      }
      if (err instanceof AgentHubContractError) {
        if (isDefinitiveMutationFailure(err)) {
          return failed(err.code, err.message);
        }
        try {
          await this.#connection.syncAuthoritativeState(controller.signal);
        } catch {
          // Ambiguous mutations still attempt resync; outcome remains unknown.
        }
        return ambiguous(err.code, err.message);
      }
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return ambiguous('UNEXPECTED_ERROR', (err as Error).message || `Unexpected ${operation} failure`);
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  #appliedWithoutSync(err: unknown): LifecycleMutationResult {
    const code =
      err instanceof AgentHubContractError || err instanceof AgentHubValidationError ? err.code : 'SYNC_FAILED';
    const message =
      err instanceof Error
        ? err.message
        : 'AgentHub accepted the lifecycle mutation, but Desktop could not refresh authoritative state.';
    return {
      status: 'applied',
      stateSynchronized: false,
      warning: { code, message }
    };
  }

  #key(operation: LifecycleOperation, mutationId: string): string {
    return `desktop-lifecycle:${operation}:${mutationId}`;
  }

  #assertPlanBinding(planId: string, expectedVersion: number, expectedHash: string | null): void {
    const snapshot = this.#connection.getState().snapshot;
    const plan = snapshot?.plans.find((item) => item.planId === planId) ?? null;
    if (!plan) {
      return;
    }
    if (plan.currentVersion !== expectedVersion || plan.current.version !== expectedVersion) {
      throw new AgentHubValidationError(
        'STALE_PLAN_DECISION',
        `Displayed plan version ${expectedVersion} is not the current Backend version ${plan.currentVersion}`
      );
    }
    if (expectedHash !== null && plan.current.proposalHash !== expectedHash) {
      throw new AgentHubValidationError(
        'STALE_PLAN_DECISION',
        'Displayed proposal hash is not the current Backend proposal hash'
      );
    }
  }
}
