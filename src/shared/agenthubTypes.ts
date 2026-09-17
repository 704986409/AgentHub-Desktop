/**
 * Public Data Transfer Objects (DTOs) and runtime snapshotting for AgentHub Desktop.
 * 
 * Strict Invariants:
 * - Pinned to AgentHub 0.7.0G public contracts.
 * - Runtime fail-closed sanitization: never return raw network objects.
 * - ZERO backend-private fields can cross into Desktop cache/IPC.
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
  readonly projectId?: string | null;
  readonly agentId?: string | null;
  readonly taskId?: string | null;
  readonly assignmentId?: string | null;
  readonly actor?: string | null;
  readonly oldStatus?: string | null;
  readonly newStatus?: string | null;
  readonly payload?: Record<string, unknown> | null;
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

export const FORBIDDEN_PRIVATE_KEYS = new Set([
  'repositoryRoot',
  'worktreePath',
  'gitDir',
  'cwd',
  'env',
  'environment',
  'executable',
  'sessionId',
  'profileHash',
  'executionProfileSha256'
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseString(val: unknown, fieldName: string, allowBlank = false): string {
  if (typeof val !== 'string') {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be a string`);
  }
  if (!allowBlank && !val.trim()) {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must not be blank`);
  }
  return val;
}

function parseNullableString(val: unknown, fieldName: string): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') {
    throw new AgentHubValidationError('MALFORMED_FIELD', `Field '${fieldName}' must be a string or null`);
  }
  return val;
}

function parseStringArray(val: unknown, fieldName: string): readonly string[] {
  if (val === undefined || val === null) return Object.freeze([]);
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

export function sanitizeEventPayload(val: unknown, depth = 0): Record<string, unknown> | null {
  if (val === null || val === undefined) return null;
  if (depth > 5) return null; // Bound nesting depth
  if (!isRecord(val)) return null;

  const sanitized: Record<string, unknown> = {};
  const entries = Object.entries(val);
  const maxEntries = 100; // Bound collection size

  for (let i = 0; i < Math.min(entries.length, maxEntries); i++) {
    const [key, value] = entries[i];
    if (FORBIDDEN_PRIVATE_KEYS.has(key)) {
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

  const project: ProjectDto = {
    projectId: parseString(raw.projectId, 'projectId'),
    name: parseString(raw.name, 'name'),
    description: parseNullableString(raw.description, 'description'),
    createdAt: parseString(raw.createdAt, 'createdAt'),
    updatedAt: parseString(raw.updatedAt, 'updatedAt')
  };

  return Object.freeze(project);
}

export function snapshotAgentDto(raw: unknown): AgentDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_AGENT', 'Agent must be an object');
  }

  const routingPriority = typeof raw.routingPriority === 'number' ? raw.routingPriority : 0;
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : false;

  const agent: AgentDto = {
    agentId: parseString(raw.agentId, 'agentId'),
    projectId: parseNullableString(raw.projectId, 'projectId'),
    name: parseString(raw.name, 'name'),
    providerId: parseString(raw.providerId, 'providerId'),
    position: typeof raw.position === 'string' ? raw.position : 'engineer',
    status: parseString(raw.status, 'status'),
    allowedComplexities: parseStringArray(raw.allowedComplexities, 'allowedComplexities'),
    allowedRiskLevels: parseStringArray(raw.allowedRiskLevels, 'allowedRiskLevels'),
    capabilities: parseStringArray(raw.capabilities, 'capabilities'),
    specialties: parseStringArray(raw.specialties, 'specialties'),
    authority: typeof raw.authority === 'string' ? raw.authority : 'autonomous',
    routingPriority,
    enabled,
    createdAt: parseString(raw.createdAt, 'createdAt'),
    updatedAt: parseString(raw.updatedAt, 'updatedAt')
  };

  return Object.freeze(agent);
}

export function snapshotTaskDto(raw: unknown): TaskDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_TASK', 'Task must be an object');
  }

  const task: TaskDto = {
    taskId: parseString(raw.taskId, 'taskId'),
    projectId: parseString(raw.projectId, 'projectId'),
    title: parseString(raw.title, 'title'),
    description: parseNullableString(raw.description, 'description'),
    requiredCapabilities: parseStringArray(raw.requiredCapabilities, 'requiredCapabilities'),
    requiredSpecialties: parseStringArray(raw.requiredSpecialties, 'requiredSpecialties'),
    acceptanceCriteria: parseStringArray(raw.acceptanceCriteria, 'acceptanceCriteria'),
    complexity: parseString(raw.complexity, 'complexity'),
    risk: parseString(raw.risk, 'risk'),
    status: parseString(raw.status, 'status'),
    assignedAgentId: parseNullableString(raw.assignedAgentId, 'assignedAgentId'),
    assignmentId: parseNullableString(raw.assignmentId, 'assignmentId'),
    createdAt: parseString(raw.createdAt, 'createdAt'),
    updatedAt: parseString(raw.updatedAt, 'updatedAt')
  };

  return Object.freeze(task);
}

export function snapshotAssignmentDto(raw: unknown): AssignmentDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_ASSIGNMENT', 'Assignment must be an object');
  }

  const assignment: AssignmentDto = {
    assignmentId: parseString(raw.assignmentId, 'assignmentId'),
    taskId: parseString(raw.taskId, 'taskId'),
    agentId: parseString(raw.agentId, 'agentId'),
    specVersion: typeof raw.specVersion === 'string' ? raw.specVersion : '1.0',
    status: parseString(raw.status, 'status'),
    createdAt: parseString(raw.createdAt, 'createdAt'),
    updatedAt: parseString(raw.updatedAt, 'updatedAt')
  };

  return Object.freeze(assignment);
}

export function snapshotEventDto(raw: unknown): AgentHubEventDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EVENT', 'Event must be an object');
  }

  const event: AgentHubEventDto = {
    eventId: parseString(raw.eventId, 'eventId'),
    eventType: parseString(raw.eventType, 'eventType'),
    timestamp: parseString(raw.timestamp, 'timestamp'),
    projectId: parseNullableString(raw.projectId, 'projectId'),
    agentId: parseNullableString(raw.agentId, 'agentId'),
    taskId: parseNullableString(raw.taskId, 'taskId'),
    assignmentId: parseNullableString(raw.assignmentId, 'assignmentId'),
    actor: parseNullableString(raw.actor, 'actor'),
    oldStatus: parseNullableString(raw.oldStatus, 'oldStatus'),
    newStatus: parseNullableString(raw.newStatus, 'newStatus'),
    payload: sanitizeEventPayload(raw.payload)
  };

  return Object.freeze(event);
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
