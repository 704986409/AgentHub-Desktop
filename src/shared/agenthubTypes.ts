/**
 * Public Data Transfer Objects (DTOs) and runtime snapshotting for AgentHub Desktop.
 * 
 * Strict Invariants:
 * - Pinned to AgentHub 0.7.0G public contracts.
 * - Runtime fail-closed sanitization: never return raw network objects.
 * - ZERO backend-private fields can cross into Desktop cache/IPC.
 * - Fail closed: do NOT synthesize defaults for missing/invalid required fields.
 */

export interface AgentHubSuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly requestId: string;
}

export interface AgentHubErrorEnvelope {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly requestId: string;
}

export type AgentHubEnvelope<T> = AgentHubSuccessEnvelope<T> | AgentHubErrorEnvelope;

export interface AgentHubHealthDto {
  readonly status: string;
  readonly version: string;
}

export interface ProjectDto {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentDto {
  readonly agentId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly providerId: string;
  readonly position: string;
  readonly status: string;
  readonly allowedComplexities: readonly string[];
  readonly allowedRiskLevels: readonly string[];
  readonly capabilities: readonly string[];
  readonly specialties: readonly string[];
  readonly authority: string;
  readonly routingPriority: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskDto {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly requiredCapabilities: readonly string[];
  readonly requiredSpecialties: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly complexity: string;
  readonly risk: string;
  readonly status: string;
  readonly assignedAgentId: string | null;
  readonly assignmentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssignmentDto {
  readonly assignmentId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly specVersion: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentHubEventDto {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly projectId: string | null;
  readonly agentId: string | null;
  readonly taskId: string | null;
  readonly assignmentId: string | null;
  readonly actor: string | null;
  readonly oldStatus: string | null;
  readonly newStatus: string | null;
  readonly payload: Record<string, unknown> | null;
}

export interface AgentHubStateSnapshot {
  readonly projects: readonly ProjectDto[];
  readonly agents: readonly AgentDto[];
  readonly tasks: readonly TaskDto[];
  readonly assignments: readonly AssignmentDto[];
}

export interface AgentHubWsHelloMessage {
  readonly type: 'hello';
  readonly version: 1;
  readonly apiVersion: 'v1';
}

export interface AgentHubWsEventMessage {
  readonly type: 'event';
  readonly version: 1;
  readonly event: AgentHubEventDto;
}

export type AgentHubWsServerMessage = AgentHubWsHelloMessage | AgentHubWsEventMessage;

export type AgentHubConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'degraded';

export interface AgentHubDesktopState {
  readonly connection: AgentHubConnectionStatus;
  readonly health: AgentHubHealthDto | null;
  readonly snapshot: AgentHubStateSnapshot | null;
  readonly lastSyncAt: string | null;
  readonly lastEventAt: string | null;
  readonly lastError: {
    readonly code: string;
    readonly message: string;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Fail-Closed Validation & Whitelist Snapshotting
// ─────────────────────────────────────────────────────────────────────────────

export class AgentHubValidationError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentHubValidationError';
    this.code = code;
  }
}

export const LOWERCASE_FORBIDDEN_KEYS = new Set([
  'repositoryroot',
  'worktreepath',
  'gitdir',
  'cwd',
  'env',
  'environment',
  'executable',
  'sessionid',
  'profilehash',
  'executionprofilesha256'
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function parseRequiredNonBlankString(record: Record<string, unknown>, fieldName: string): string {
  if (!(fieldName in record) || record[fieldName] === undefined) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Required field '${fieldName}' is missing`);
  }
  const val = record[fieldName];
  if (typeof val !== 'string' || !val.trim()) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be a non-blank string`);
  }
  return val;
}

export function parseRequiredNullableString(record: Record<string, unknown>, fieldName: string): string | null {
  if (!(fieldName in record) || record[fieldName] === undefined) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Required field '${fieldName}' is missing`);
  }
  const val = record[fieldName];
  if (val === null) return null;
  if (typeof val !== 'string') {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be a string or null`);
  }
  return val;
}

export function parseRequiredStringArray(record: Record<string, unknown>, fieldName: string): readonly string[] {
  if (!(fieldName in record) || record[fieldName] === undefined || record[fieldName] === null) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Required field '${fieldName}' is missing or null`);
  }
  const val = record[fieldName];
  if (!Array.isArray(val)) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be an array`);
  }
  const result: string[] = [];
  for (const item of val) {
    if (typeof item !== 'string') {
      throw new AgentHubValidationError('MALFORMED_FIELD', `Elements in '${fieldName}' must be strings`);
    }
    result.push(item);
  }
  return Object.freeze(result);
}

export function parseFiniteNumber(record: Record<string, unknown>, fieldName: string): number {
  if (!(fieldName in record) || record[fieldName] === undefined) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Required field '${fieldName}' is missing`);
  }
  const val = record[fieldName];
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be a finite number`);
  }
  return val;
}

export function parseRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  if (!(fieldName in record) || record[fieldName] === undefined) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Required field '${fieldName}' is missing`);
  }
  const val = record[fieldName];
  if (typeof val !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be a boolean`);
  }
  return val;
}

export function sanitizeEventPayload(val: unknown, depth = 0): Record<string, unknown> | null {
  if (val === null || val === undefined) return null;
  if (depth > 5) return null; // Bound nesting depth
  if (!isRecord(val)) return null;

  const sanitized: Record<string, unknown> = {};
  const entries = Object.entries(val);
  const maxEntries = 100; // Bound collection size

  for (let i = 0; i < Math.min(entries.length, maxEntries); i++) {
    const [key, value] = entries[i];
    // Case-insensitive forbidden key check
    if (LOWERCASE_FORBIDDEN_KEYS.has(key.toLowerCase())) {
      continue; // Strip forbidden key
    }
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      if (depth + 1 <= 5) {
        sanitized[key] = value
          .slice(0, 100)
          .map((item) => {
            if (isRecord(item)) return sanitizeEventPayload(item, depth + 1);
            if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
              return item;
            }
            return null;
          })
          .filter((item) => item !== null);
      }
    } else if (isRecord(value)) {
      const child = sanitizeEventPayload(value, depth + 1);
      if (child) sanitized[key] = child;
    }
  }

  return Object.freeze(sanitized);
}

export function snapshotProjectDto(raw: unknown): ProjectDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PROJECT', 'Project must be an object');
  }

  return Object.freeze({
    projectId: parseRequiredNonBlankString(raw, 'projectId'),
    name: parseRequiredNonBlankString(raw, 'name'),
    description: parseRequiredNullableString(raw, 'description'),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt'),
    updatedAt: parseRequiredNonBlankString(raw, 'updatedAt')
  });
}

export function snapshotAgentDto(raw: unknown): AgentDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_AGENT', 'Agent must be an object');
  }

  return Object.freeze({
    agentId: parseRequiredNonBlankString(raw, 'agentId'),
    projectId: parseRequiredNullableString(raw, 'projectId'),
    name: parseRequiredNonBlankString(raw, 'name'),
    providerId: parseRequiredNonBlankString(raw, 'providerId'),
    position: parseRequiredNonBlankString(raw, 'position'),
    status: parseRequiredNonBlankString(raw, 'status'),
    allowedComplexities: parseRequiredStringArray(raw, 'allowedComplexities'),
    allowedRiskLevels: parseRequiredStringArray(raw, 'allowedRiskLevels'),
    capabilities: parseRequiredStringArray(raw, 'capabilities'),
    specialties: parseRequiredStringArray(raw, 'specialties'),
    authority: parseRequiredNonBlankString(raw, 'authority'),
    routingPriority: parseFiniteNumber(raw, 'routingPriority'),
    enabled: parseRequiredBoolean(raw, 'enabled'),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt'),
    updatedAt: parseRequiredNonBlankString(raw, 'updatedAt')
  });
}

export function snapshotTaskDto(raw: unknown): TaskDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_TASK', 'Task must be an object');
  }

  return Object.freeze({
    taskId: parseRequiredNonBlankString(raw, 'taskId'),
    projectId: parseRequiredNonBlankString(raw, 'projectId'),
    title: parseRequiredNonBlankString(raw, 'title'),
    description: parseRequiredNullableString(raw, 'description'),
    requiredCapabilities: parseRequiredStringArray(raw, 'requiredCapabilities'),
    requiredSpecialties: parseRequiredStringArray(raw, 'requiredSpecialties'),
    acceptanceCriteria: parseRequiredStringArray(raw, 'acceptanceCriteria'),
    complexity: parseRequiredNonBlankString(raw, 'complexity'),
    risk: parseRequiredNonBlankString(raw, 'risk'),
    status: parseRequiredNonBlankString(raw, 'status'),
    assignedAgentId: parseRequiredNullableString(raw, 'assignedAgentId'),
    assignmentId: parseRequiredNullableString(raw, 'assignmentId'),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt'),
    updatedAt: parseRequiredNonBlankString(raw, 'updatedAt')
  });
}

export function snapshotAssignmentDto(raw: unknown): AssignmentDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_ASSIGNMENT', 'Assignment must be an object');
  }

  return Object.freeze({
    assignmentId: parseRequiredNonBlankString(raw, 'assignmentId'),
    taskId: parseRequiredNonBlankString(raw, 'taskId'),
    agentId: parseRequiredNonBlankString(raw, 'agentId'),
    specVersion: parseRequiredNonBlankString(raw, 'specVersion'),
    status: parseRequiredNonBlankString(raw, 'status'),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt'),
    updatedAt: parseRequiredNonBlankString(raw, 'updatedAt')
  });
}

export function snapshotEventDto(raw: unknown): AgentHubEventDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EVENT', 'Event must be an object');
  }

  return Object.freeze({
    eventId: parseRequiredNonBlankString(raw, 'eventId'),
    eventType: parseRequiredNonBlankString(raw, 'eventType'),
    timestamp: parseRequiredNonBlankString(raw, 'timestamp'),
    projectId: parseRequiredNullableString(raw, 'projectId'),
    agentId: parseRequiredNullableString(raw, 'agentId'),
    taskId: parseRequiredNullableString(raw, 'taskId'),
    assignmentId: parseRequiredNullableString(raw, 'assignmentId'),
    actor: parseRequiredNullableString(raw, 'actor'),
    oldStatus: parseRequiredNullableString(raw, 'oldStatus'),
    newStatus: parseRequiredNullableString(raw, 'newStatus'),
    payload: sanitizeEventPayload(raw.payload)
  });
}

export function snapshotState(raw: unknown): AgentHubStateSnapshot {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_STATE', 'State snapshot must be an object');
  }

  if (!Array.isArray(raw.projects) || !Array.isArray(raw.agents) || !Array.isArray(raw.tasks) || !Array.isArray(raw.assignments)) {
    throw new AgentHubValidationError('MALFORMED_STATE', 'State snapshot missing projects, agents, tasks, or assignments array');
  }

  const projects = raw.projects.map(snapshotProjectDto);
  const agents = raw.agents.map(snapshotAgentDto);
  const tasks = raw.tasks.map(snapshotTaskDto);
  const assignments = raw.assignments.map(snapshotAssignmentDto);

  return Object.freeze({
    projects: Object.freeze(projects),
    agents: Object.freeze(agents),
    tasks: Object.freeze(tasks),
    assignments: Object.freeze(assignments)
  });
}
