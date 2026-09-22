import crypto from 'node:crypto';
import type { AgentHubConnection } from './AgentHubConnection';
import type { CreateProjectRequestDto, ProjectDto, ProjectMutationResult } from './AgentHubTypes';
import { AgentHubValidationError, snapshotCreateProjectRequest } from './AgentHubTypes';
import { AgentHubContractError, isDefinitiveMutationFailure } from './AgentHubRestClient';

interface MutationRecord {
  readonly fingerprint: string;
  inFlightPromise?: Promise<ProjectMutationResult>;
  settledResult?: ProjectMutationResult;
}

function failed(code: string, message: string): ProjectMutationResult {
  return { status: 'failed', retryable: false, error: { code, message } };
}

function ambiguous(code: string, message: string, retryable = true): ProjectMutationResult {
  return { status: 'ambiguous', retryable, error: { code, message } };
}

function freezeResult(result: ProjectMutationResult): ProjectMutationResult {
  if (result.status === 'failed' || result.status === 'ambiguous') Object.freeze(result.error);
  if (result.status === 'applied' && result.stateSynchronized === false) Object.freeze(result.warning);
  if (result.status === 'applied') Object.freeze(result.project);
  return Object.freeze(result);
}

function fingerprint(input: { readonly name: string; readonly description: string | null }): string {
  return crypto.createHash('sha256')
    .update(`create\0${JSON.stringify({ name: input.name, description: input.description })}`)
    .digest('hex');
}

function idempotencyKey(mutationId: string): string {
  return `desktop-project-create:${mutationId}`;
}

function isReconciliationRequired(code: string): boolean {
  return code.includes('RECONCILIATION');
}

export class AgentHubProjectManagement {
  readonly #connection: AgentHubConnection;
  readonly #mutations = new Map<string, MutationRecord>();
  readonly #activeControllers = new Set<AbortController>();
  #stopped = false;

  constructor(connection: AgentHubConnection) {
    this.#connection = connection;
  }

  public createProject(request: unknown): Promise<ProjectMutationResult> {
    if (this.#stopped) {
      return Promise.resolve(failed('STOPPED', 'Project creation is unavailable because Desktop is shutting down'));
    }
    let parsed: CreateProjectRequestDto;
    try {
      parsed = snapshotCreateProjectRequest(request);
    } catch (err: unknown) {
      if (err instanceof AgentHubValidationError) return Promise.resolve(failed(err.code, err.message));
      return Promise.resolve(failed('MALFORMED_REQUEST', (err as Error).message || 'Invalid Project mutation request'));
    }
    const digest = fingerprint(parsed.input);
    const existing = this.#mutations.get(parsed.mutationId);
    if (existing) {
      if (existing.fingerprint !== digest) {
        return Promise.resolve(failed(
          'IDEMPOTENCY_CONFLICT',
          `Mutation ID '${parsed.mutationId}' was previously used with a different Project request`
        ));
      }
      if (existing.settledResult) return Promise.resolve(existing.settledResult);
      if (existing.inFlightPromise) return existing.inFlightPromise;
    }
    const record: MutationRecord = existing ?? { fingerprint: digest };
    this.#mutations.set(parsed.mutationId, record);
    const promise = this.#applyOnce(parsed);
    record.inFlightPromise = promise;
    return promise.then((result) => {
      if (result.status === 'applied' || result.status === 'failed') {
        record.settledResult = freezeResult(result);
        return record.settledResult;
      }
      return result;
    }).finally(() => {
      record.inFlightPromise = undefined;
    });
  }

  public stop(): void {
    this.#stopped = true;
    for (const controller of this.#activeControllers) {
      try { controller.abort(); } catch { /* ignore abort errors */ }
    }
    this.#activeControllers.clear();
  }

  async #applyOnce(parsed: CreateProjectRequestDto): Promise<ProjectMutationResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);
    let project: ProjectDto | null = null;
    try {
      project = await this.#connection.restClient.createProject(
        parsed.input,
        idempotencyKey(parsed.mutationId),
        controller.signal
      );
      const sync = await this.#connection.syncAuthoritativeState(controller.signal);
      if (sync.disposition === 'committed' || sync.disposition === 'superseded-by-committed') {
        return { status: 'applied', project, stateSynchronized: true };
      }
      return this.#appliedWithoutSync(project, new AgentHubContractError(
        'SYNC_FAILED',
        'AgentHub confirmed the Project, but Desktop could not refresh authoritative state.'
      ));
    } catch (err: unknown) {
      if (project) return this.#appliedWithoutSync(project, err);
      return this.#classifyFailure(err);
    } finally {
      this.#activeControllers.delete(controller);
    }
  }

  #appliedWithoutSync(project: ProjectDto, err: unknown): ProjectMutationResult {
    const code = err instanceof AgentHubContractError || err instanceof AgentHubValidationError ? err.code : 'SYNC_FAILED';
    const message = err instanceof Error
      ? err.message
      : 'AgentHub confirmed the Project, but Desktop could not refresh authoritative state.';
    return {
      status: 'applied',
      project,
      stateSynchronized: false,
      warning: { code, message }
    };
  }

  #classifyFailure(err: unknown): ProjectMutationResult {
    if (err instanceof AgentHubContractError) {
      if (isReconciliationRequired(err.code)) return ambiguous(err.code, err.message, false);
      if (isDefinitiveMutationFailure(err)) return failed(err.code, err.message);
      return ambiguous(err.code, err.message, true);
    }
    if (err instanceof AgentHubValidationError) return failed(err.code, err.message);
    const isAbort = (err as Error)?.name === 'AbortError';
    if (isAbort || this.#stopped) {
      return ambiguous(
        this.#stopped ? 'STOPPED' : 'ABORTED',
        this.#stopped
          ? 'Project creation aborted because Desktop is shutting down'
          : 'Project creation request aborted',
        true
      );
    }
    return ambiguous('UNEXPECTED_ERROR', (err as Error).message || 'Unexpected Project creation failure', true);
  }
}
