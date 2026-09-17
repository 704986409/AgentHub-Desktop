import type {
  AgentHubEnvelope,
  AgentHubHealthDto,
  AgentHubStateSnapshot,
  AgentHubEventDto,
  TaskDto,
  CreateTaskInputDto,
  ExecuteTaskInputDto,
  ExecuteTaskResultDto
} from './AgentHubTypes';
import {
  snapshotState,
  snapshotEventDto,
  snapshotTaskDto,
  snapshotCreateTaskInput,
  snapshotExecuteTaskInput,
  snapshotExecuteTaskId,
  snapshotExecuteTaskResult,
  AgentHubValidationError
} from './AgentHubTypes';

export const DEFAULT_AGENTHUB_BASE_URL = 'http://127.0.0.1:3210';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MiB

export class AgentHubContractError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentHubContractError';
    this.code = code;
  }
}

/**
 * Validates that an AgentHub base URL is strictly loopback HTTP.
 * Rejects localhost, LAN IPs, 0.0.0.0, HTTPS, credentials, paths, queries, and fragments.
 */
export function validateAgentHubBaseUrl(rawUrl: string): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new AgentHubContractError('INVALID_URL', 'AgentHub base URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new AgentHubContractError('INVALID_URL', `Malformed AgentHub URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:') {
    throw new AgentHubContractError('INVALID_PROTOCOL', `AgentHub URL protocol must be http:, got ${parsed.protocol}`);
  }

  if (parsed.hostname !== '127.0.0.1') {
    throw new AgentHubContractError(
      'NON_LOOPBACK_HOST',
      `AgentHub URL host must be strictly 127.0.0.1 (loopback), got ${parsed.hostname}`
    );
  }

  if (parsed.username || parsed.password) {
    throw new AgentHubContractError('CREDENTIALS_FORBIDDEN', 'AgentHub URL must not contain user credentials');
  }

  if (parsed.search || parsed.hash) {
    throw new AgentHubContractError('QUERY_OR_HASH_FORBIDDEN', 'AgentHub base URL must not contain query or hash');
  }

  if (parsed.pathname && parsed.pathname !== '/') {
    throw new AgentHubContractError('PATH_FORBIDDEN', `AgentHub base URL must not contain path prefix: ${parsed.pathname}`);
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 80;
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new AgentHubContractError('INVALID_PORT', `AgentHub port is invalid: ${parsed.port}`);
  }

  return `http://127.0.0.1:${parsed.port || '3210'}`;
}

export class AgentHubRestClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(options: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.#baseUrl = validateAgentHubBaseUrl(options.baseUrl ?? DEFAULT_AGENTHUB_BASE_URL);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public get baseUrl(): string {
    return this.#baseUrl;
  }

  /**
   * GET /api/v1/health
   */
  public async health(signal?: AbortSignal): Promise<AgentHubHealthDto> {
    const data = await this.#get<AgentHubHealthDto>('/api/v1/health', signal);
    if (!data || typeof data !== 'object') {
      throw new AgentHubContractError('MALFORMED_HEALTH', 'Health response missing data object');
    }

    const raw = data as Partial<AgentHubHealthDto>;
    if (raw.status !== 'ok') {
      throw new AgentHubContractError('MALFORMED_HEALTH', `Health status must be 'ok', got '${String(raw.status)}'`);
    }

    if (typeof raw.version !== 'string' || !raw.version.trim()) {
      throw new AgentHubContractError('MALFORMED_HEALTH', 'Health response missing non-empty version');
    }

    return {
      status: 'ok',
      version: raw.version
    };
  }

  /**
   * GET /api/v1/state
   */
  public async state(signal?: AbortSignal): Promise<AgentHubStateSnapshot> {
    const data = await this.#get<unknown>('/api/v1/state', signal);
    try {
      return snapshotState(data);
    } catch (err) {
      if (err instanceof AgentHubValidationError) {
        throw new AgentHubContractError(err.code, err.message);
      }
      throw new AgentHubContractError('MALFORMED_SNAPSHOT', (err as Error).message);
    }
  }

  /**
   * GET /api/v1/events?limit=N
   */
  public async events(limit = 100, signal?: AbortSignal): Promise<readonly AgentHubEventDto[]> {
    const boundedLimit = Math.max(1, Math.min(1000, limit));
    const data = await this.#get<unknown[]>(`/api/v1/events?limit=${boundedLimit}`, signal);
    if (!Array.isArray(data)) {
      throw new AgentHubContractError('MALFORMED_EVENTS', 'Events response must be an array');
    }

    try {
      const sanitized = data.map((item) => snapshotEventDto(item));
      return Object.freeze(sanitized);
    } catch (err) {
      if (err instanceof AgentHubValidationError) {
        throw new AgentHubContractError(err.code, err.message);
      }
      throw new AgentHubContractError('MALFORMED_EVENTS', (err as Error).message);
    }
  }

  /**
   * POST /api/v1/tasks
   * Strictly bounded task creation endpoint.
   */
  public async createTask(
    input: CreateTaskInputDto,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<TaskDto> {
    const validatedInput = snapshotCreateTaskInput(input);
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!key) {
      throw new AgentHubContractError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a non-empty string');
    }

    const bodyString = JSON.stringify(validatedInput);
    if (new TextEncoder().encode(bodyString).length > 1024 * 1024) {
      throw new AgentHubContractError('BODY_OVERFLOW', 'Request body exceeds 1 MiB limit');
    }

    const data = await this.#post<unknown>('/api/v1/tasks', bodyString, key, 201, signal);
    try {
      return snapshotTaskDto(data);
    } catch (err) {
      throw new AgentHubContractError('MALFORMED_TASK', (err as Error).message);
    }
  }

  /**
   * POST /api/v1/tasks/:taskId/execute
   * Strictly bounded task execution endpoint.
   */
  public async executeTask(
    taskId: string,
    input: ExecuteTaskInputDto,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ExecuteTaskResultDto> {
    const validatedTaskId = snapshotExecuteTaskId(taskId);
    const validatedInput = snapshotExecuteTaskInput(input);
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!key) {
      throw new AgentHubContractError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a non-empty string');
    }

    const bodyString = JSON.stringify(validatedInput);
    if (new TextEncoder().encode(bodyString).length > 1024 * 1024) {
      throw new AgentHubContractError('BODY_OVERFLOW', 'Request body exceeds 1 MiB limit');
    }

    const path = `/api/v1/tasks/${encodeURIComponent(validatedTaskId)}/execute`;
    const data = await this.#post<unknown>(path, bodyString, key, 200, signal);
    try {
      return snapshotExecuteTaskResult(data);
    } catch (err) {
      throw new AgentHubContractError('MALFORMED_EXECUTE_RESULT', (err as Error).message);
    }
  }

  /**
   * Internal GET-only helper. Strictly rejects any method other than GET.
   * Enforces streaming byte bounds, timeouts, and exact envelope validation.
   */
  async #get<T>(path: string, externalSignal?: AbortSignal): Promise<T> {
    return this.#request<T>('GET', path, { 'Accept': 'application/json' }, undefined, externalSignal);
  }

  /**
   * Internal POST-only helper. Allowlist: /api/v1/tasks and /api/v1/tasks/:id/execute.
   */
  async #post<T>(
    path: string,
    body: string,
    idempotencyKey: string,
    expectedStatus: 200 | 201,
    externalSignal?: AbortSignal
  ): Promise<T> {
    if (path !== '/api/v1/tasks' && !/^\/api\/v1\/tasks\/[^/]+\/execute$/.test(path)) {
      throw new AgentHubContractError('FORBIDDEN_ROUTE', `POST path is not in the mutation allowlist: ${path}`);
    }
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Idempotency-Key': idempotencyKey
    };
    return this.#request<T>('POST', path, headers, body, externalSignal, expectedStatus);
  }

  async #request<T>(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    body: string | undefined,
    externalSignal?: AbortSignal,
    expectedStatus?: 200 | 201
  ): Promise<T> {
    if (externalSignal?.aborted) {
      throw new AgentHubContractError('ABORTED', 'Request aborted by caller');
    }

    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    const onExternalAbort = (): void => {
      controller.abort();
    };

    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });

      // 1. Fail-closed Content-Length header check
      const contentLengthHeader = response.headers.get('Content-Length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
          controller.abort();
          throw new AgentHubContractError('BODY_OVERFLOW', `Response Content-Length (${contentLength}) exceeded limit of ${MAX_BODY_BYTES} bytes`);
        }
      }

      // 2. Stream-based body reading to strictly bound memory
      let text = '';
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > MAX_BODY_BYTES) {
                try { await reader.cancel(); } catch { /* ignore */ }
                controller.abort();
                throw new AgentHubContractError('BODY_OVERFLOW', `Response body exceeded limit of ${MAX_BODY_BYTES} bytes`);
              }
              chunks.push(value);
            }
          }
        } finally {
          reader.releaseLock();
        }

        const totalBuffer = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          totalBuffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        text = new TextDecoder('utf-8').decode(totalBuffer);
      } else {
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > MAX_BODY_BYTES) {
          throw new AgentHubContractError('BODY_OVERFLOW', `Response body exceeded limit of ${MAX_BODY_BYTES} bytes`);
        }
        text = new TextDecoder('utf-8').decode(arrayBuf);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new AgentHubContractError('MALFORMED_JSON', `Failed to parse JSON response: ${(err as Error).message}`);
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Response must be a JSON object');
      }

      const env = parsed as Record<string, unknown>;
      const keys = Object.keys(env);

      // Validate requestId
      if (typeof env.requestId !== 'string' || !env.requestId.trim()) {
        throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Envelope must contain a non-blank requestId');
      }

      // Validate ok flag
      if (typeof env.ok !== 'boolean') {
        throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Envelope must contain a boolean ok field');
      }

      if (env.ok === false) {
        for (const k of keys) {
          if (k !== 'ok' && k !== 'requestId' && k !== 'error') {
            throw new AgentHubContractError('MALFORMED_ENVELOPE', `Unexpected key '${k}' in error envelope`);
          }
        }
        const errObj = env.error as { code?: unknown; message?: unknown } | undefined;
        if (!errObj || typeof errObj !== 'object' || Array.isArray(errObj)) {
          throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Error envelope must contain an error object');
        }
        if (typeof errObj.code !== 'string' || !errObj.code.trim()) {
          throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Error object must contain a non-blank code');
        }
        if (typeof errObj.message !== 'string') {
          throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Error object must contain a string message');
        }
        throw new AgentHubContractError(errObj.code, errObj.message);
      }

      for (const k of keys) {
        if (k !== 'ok' && k !== 'requestId' && k !== 'data') {
          throw new AgentHubContractError('MALFORMED_ENVELOPE', `Unexpected key '${k}' in success envelope`);
        }
      }

      if (!response.ok) {
        throw new AgentHubContractError('HTTP_ERROR', `HTTP ${response.status} ${response.statusText}`);
      }

      if (method === 'POST') {
        const expected = expectedStatus ?? 201;
        if (response.status !== expected) {
          throw new AgentHubContractError(
            'HTTP_ERROR',
            `Expected HTTP ${expected} for mutation, got ${response.status}`
          );
        }
      }

      // ok: true must have data
      if (env.data === undefined) {
        throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Success envelope must contain data');
      }

      return env.data as T;
    } catch (err: unknown) {
      if (err instanceof AgentHubContractError) throw err;
      if ((err as { name?: string }).name === 'AbortError') {
        if (externalSignal?.aborted) {
          throw new AgentHubContractError('ABORTED', 'Request aborted by caller');
        }
        throw new AgentHubContractError('TIMEOUT', `Request timed out after ${this.#timeoutMs}ms`);
      }
      throw new AgentHubContractError('NETWORK_ERROR', (err as Error).message || 'Network request failed');
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}
