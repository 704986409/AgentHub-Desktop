import type {
  AgentHubEnvelope,
  AgentHubHealthDto,
  AgentHubStateSnapshot,
  AgentHubEventDto
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
  public async health(): Promise<AgentHubHealthDto> {
    const data = await this.#get<AgentHubHealthDto>('/api/v1/health');
    if (!data || typeof data !== 'object' || typeof (data as AgentHubHealthDto).status !== 'string') {
      throw new AgentHubContractError('MALFORMED_HEALTH', 'Health response missing status string');
    }
    if (typeof (data as AgentHubHealthDto).version !== 'string' || !(data as AgentHubHealthDto).version.trim()) {
      throw new AgentHubContractError('MALFORMED_HEALTH', 'Health response missing non-empty version');
    }
    return {
      status: data.status,
      version: data.version
    };
  }

  /**
   * GET /api/v1/state
   */
  public async state(): Promise<AgentHubStateSnapshot> {
    const data = await this.#get<AgentHubStateSnapshot>('/api/v1/state');
    if (!data || typeof data !== 'object') {
      throw new AgentHubContractError('MALFORMED_SNAPSHOT', 'State snapshot must be an object');
    }
    if (!Array.isArray(data.projects) || !Array.isArray(data.agents) || !Array.isArray(data.tasks) || !Array.isArray(data.assignments)) {
      throw new AgentHubContractError('MALFORMED_SNAPSHOT', 'State snapshot must contain projects, agents, tasks, and assignments arrays');
    }

    return {
      projects: Object.freeze([...data.projects]),
      agents: Object.freeze([...data.agents]),
      tasks: Object.freeze([...data.tasks]),
      assignments: Object.freeze([...data.assignments])
    };
  }

  /**
   * GET /api/v1/events?limit=N
   */
  public async events(limit = 100): Promise<readonly AgentHubEventDto[]> {
    const boundedLimit = Math.max(1, Math.min(1000, limit));
    const data = await this.#get<AgentHubEventDto[]>(`/api/v1/events?limit=${boundedLimit}`);
    if (!Array.isArray(data)) {
      throw new AgentHubContractError('MALFORMED_EVENTS', 'Events response must be an array');
    }
    return Object.freeze([...data]);
  }

  /**
   * Internal GET-only helper. Strictly rejects any method other than GET.
   */
  async #get<T>(path: string): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: controller.signal
      });

      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) {
        throw new AgentHubContractError('BODY_OVERFLOW', `Response body exceeded limit of ${MAX_BODY_BYTES} bytes`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new AgentHubContractError('MALFORMED_JSON', `Failed to parse JSON response: ${(err as Error).message}`);
      }

      if (!response.ok) {
        const errorEnv = parsed as Partial<AgentHubEnvelope<unknown>> | undefined;
        if (errorEnv && errorEnv.ok === false && errorEnv.error) {
          throw new AgentHubContractError(errorEnv.error.code || 'HTTP_ERROR', errorEnv.error.message || `HTTP ${response.status}`);
        }
        throw new AgentHubContractError('HTTP_ERROR', `HTTP ${response.status} ${response.statusText}`);
      }

      const envelope = parsed as AgentHubEnvelope<T>;
      if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
        throw new AgentHubContractError('MALFORMED_ENVELOPE', 'Response missing standard AgentHub envelope');
      }

      if (envelope.ok !== true) {
        const err = (envelope as unknown as { error?: { code?: string; message?: string } }).error;
        throw new AgentHubContractError(err?.code ?? 'UNKNOWN_ERROR', err?.message ?? 'AgentHub returned ok: false');
      }

      return envelope.data;
    } catch (err: unknown) {
      if (err instanceof AgentHubContractError) throw err;
      if ((err as { name?: string }).name === 'AbortError') {
        throw new AgentHubContractError('TIMEOUT', `Request timed out after ${this.#timeoutMs}ms`);
      }
      throw new AgentHubContractError('NETWORK_ERROR', (err as Error).message || 'Network request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
