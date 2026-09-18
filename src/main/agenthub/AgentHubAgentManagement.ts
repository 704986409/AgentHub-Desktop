import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  AgentActionRequestDto,
  AgentMutationAppliedPayload,
  AgentMutationResult,
  CreateAgentInputDto,
  CreateAgentRequestDto,
  UpdateAgentInputDto,
  UpdateAgentRequestDto
} from './AgentHubTypes';
import {
  snapshotAgentActionRequest,
  snapshotCreateAgentRequest,
  snapshotUpdateAgentRequest,
  AgentHubValidationError
} from './AgentHubTypes';
import { AgentHubContractError, isDefinitiveMutationFailure } from './AgentHubRestClient';

type AgentOperation = 'create' | 'update' | 'enable' | 'disable' | 'delete';

interface MutationRecord {
  readonly fingerprint: string;
  inFlightPromise?: Promise<AgentMutationResult>;
  settledResult?: AgentMutationResult;
}

function isValidMutationId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (!id || id.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function failed(code: string, message: string): AgentMutationResult {
  return {
    status: 'failed',
    retryable: false,
    error: { code, message }
  };
}

function ambiguous(code: string, message: string, retryable = true): AgentMutationResult {
  return {
    status: 'ambiguous',
    retryable,
    error: { code, message }
  };
}

function freezeResult(result: AgentMutationResult): AgentMutationResult {
  if (result.status === 'failed' || result.status === 'ambiguous') {
    Object.freeze(result.error);
  }
  if (result.status === 'applied' && result.stateSynchronized === false) {
    Object.freeze(result.warning);
  }
  if (result.status === 'applied') {
    Object.freeze(result.payload);
  }
  return Object.freeze(result);
}

function fingerprintCreate(input: CreateAgentInputDto): string {
  return crypto.createHash('sha256').update(`create\0${JSON.stringify(input)}`).digest('hex');
}

function fingerprintUpdate(agentId: string, input: UpdateAgentInputDto): string {
  return crypto.createHash('sha256').update(`update\0${agentId}\0${JSON.stringify(input)}`).digest('hex');
}

function fingerprintAction(operation: Exclude<AgentOperation, 'create'>, agentId: string): string {
  return crypto.createHash('sha256').update(`${operation}\0${agentId}`).digest('hex');
}

function idempotencyKey(operation: AgentOperation, mutationId: string): string {
  return `desktop-agent-${operation}:${mutationId}`;
}

function isReconciliationRequired(code: string): boolean {
  return code.includes('RECONCILIATION');
}

export class AgentHubAgentManagement {
  readonly #connection: AgentHubConnection;
  readonly #mutations = new Map<string, MutationRecord>();
  readonly #activeControllers = new Set<AbortController>();
  #stopped = false;

  constructor(connection: AgentHubConnection) {
    this.#connection = connection;
  }

  public createAgent(request: unknown): Promise<AgentMutationResult> {
    return this.#mutate('create', request);
  }

  public updateAgent(request: unknown): Promise<AgentMutationResult> {
    return this.#mutate('update', request);
  }

  public enableAgent(request: unknown): Promise<AgentMutationResult> {
    return this.#mutate('enable', request);
  }

  public disableAgent(request: unknown): Promise<AgentMutationResult> {
    return this.#mutate('disable', request);
  }

  public deleteAgent(request: unknown): Promise<AgentMutationResult> {
    return this.#mutate('delete', request);
  }

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

  async #mutate(operation: AgentOperation, request: unknown): Promise<AgentMutationResult> {
    if (this.#stopped) {
      return failed('STOPPED', 'Agent mutation is unavailable because Desktop is shutting down');
    }

    let mutationId: string;
    let fingerprint: string;
    let parsed: CreateAgentRequestDto | UpdateAgentRequestDto | AgentActionRequestDto;
    try {
      if (operation === 'create') {
        const createRequest = snapshotCreateAgentRequest(request);
        parsed = createRequest;
        mutationId = createRequest.mutationId;
        fingerprint = fingerprintCreate(createRequest.input);
      } else if (operation === 'update') {
        const updateRequest = snapshotUpdateAgentRequest(request);
        parsed = updateRequest;
        mutationId = updateRequest.mutationId;
        fingerprint = fingerprintUpdate(updateRequest.agentId, updateRequest.input);
      } else {
        const actionRequest = snapshotAgentActionRequest(request);
        parsed = actionRequest;
        mutationId = actionRequest.mutationId;
        fingerprint = fingerprintAction(operation, actionRequest.agentId);
      }
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) {
        return failed(err.code, err.message);
      }
      return failed('MALFORMED_REQUEST', (err as Error).message || 'Invalid Agent mutation request');
    }

    if (!isValidMutationId(mutationId)) {
      return failed('MALFORMED_REQUEST', "Field 'mutationId' is invalid");
    }

    const existing = this.#mutations.get(mutationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return failed(
          'IDEMPOTENCY_CONFLICT',
          `Mutation ID '${mutationId}' was previously used with a different Agent request`
        );
      }
      if (existing.settledResult) {
        return existing.settledResult;
      }
      if (existing.inFlightPromise) {
        return existing.inFlightPromise;
      }
    }

    const record: MutationRecord = existing ?? { fingerprint };
    this.#mutations.set(mutationId, record);
    const promise = this.#applyOnce(operation, mutationId, parsed);
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

  async #applyOnce(
    operation: AgentOperation,
    mutationId: string,
    parsed: CreateAgentRequestDto | UpdateAgentRequestDto | AgentActionRequestDto
  ): Promise<AgentMutationResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);
    const key = idempotencyKey(operation, mutationId);
    let payload: AgentMutationAppliedPayload | null = null;

    try {
      payload = await this.#dispatch(operation, parsed, key, controller.signal);
      const sync = await this.#connection.syncAuthoritativeState(controller.signal);
      if (sync.disposition === 'committed' || sync.disposition === 'superseded-by-committed') {
        return {
          status: 'applied',
          payload,
          stateSynchronized: true
        };
      }
      return this.#appliedWithoutSync(
        payload,
        new AgentHubContractError(
          'SYNC_FAILED',
          'AgentHub confirmed the Agent change, but Desktop could not refresh authoritative state.'
        )
      );
    } catch (err: unknown) {
      if (payload) {
        return this.#appliedWithoutSync(payload, err);
      }
      return this.#classifyFailure(err);
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  async #dispatch(
    operation: AgentOperation,
    parsed: CreateAgentRequestDto | UpdateAgentRequestDto | AgentActionRequestDto,
    key: string,
    signal: AbortSignal
  ): Promise<AgentMutationAppliedPayload> {
    const rest = this.#connection.restClient;
    if (operation === 'create') {
      const agent = await rest.createAgent((parsed as CreateAgentRequestDto).input, key, signal);
      return { operation, agent };
    }
    if (operation === 'update') {
      const request = parsed as UpdateAgentRequestDto;
      const agent = await rest.updateAgent(request.agentId, request.input, key, signal);
      return { operation, agent };
    }
    const agentId = (parsed as AgentActionRequestDto).agentId;
    if (operation === 'enable') {
      return { operation, agent: await rest.enableAgent(agentId, key, signal) };
    }
    if (operation === 'disable') {
      return { operation, agent: await rest.disableAgent(agentId, key, signal) };
    }
    const deleted = await rest.deleteAgent(agentId, key, signal);
    return { operation: 'delete', agentId: deleted.agentId, deleted: true };
  }

  #appliedWithoutSync(payload: AgentMutationAppliedPayload, err: unknown): AgentMutationResult {
    const code =
      err instanceof AgentHubContractError || err instanceof AgentHubValidationError
        ? err.code
        : 'SYNC_FAILED';
    const message =
      err instanceof Error
        ? err.message
        : 'AgentHub confirmed the Agent change, but Desktop could not refresh authoritative state.';
    return {
      status: 'applied',
      payload,
      stateSynchronized: false,
      warning: { code, message }
    };
  }

  #classifyFailure(err: unknown): AgentMutationResult {
    if (err instanceof AgentHubContractError) {
      if (isReconciliationRequired(err.code)) {
        return ambiguous(err.code, err.message, false);
      }
      if (isDefinitiveMutationFailure(err)) {
        return failed(err.code, err.message);
      }
      return ambiguous(err.code, err.message, true);
    }
    if (err instanceof AgentHubValidationError) {
      return failed(err.code, err.message);
    }
    const isAbort = (err as Error)?.name === 'AbortError';
    if (isAbort || this.#stopped) {
      return ambiguous(
        this.#stopped ? 'STOPPED' : 'ABORTED',
        this.#stopped
          ? 'Agent mutation aborted because Desktop is shutting down'
          : 'Agent mutation request aborted',
        true
      );
    }
    return ambiguous('UNEXPECTED_ERROR', (err as Error).message || 'Unexpected Agent mutation failure', true);
  }
}
