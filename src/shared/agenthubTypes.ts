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

export type AgentHubPublicValue =
  | string
  | number
  | boolean
  | null
  | readonly AgentHubPublicValue[]
  | { readonly [key: string]: AgentHubPublicValue };

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
  readonly payload: AgentHubPublicValue;
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

export type TaskComplexity = 'TRIVIAL' | 'SIMPLE' | 'MEDIUM' | 'COMPLEX' | 'CRITICAL';
export type TaskRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const TASK_COMPLEXITIES: readonly TaskComplexity[] = Object.freeze([
  'TRIVIAL',
  'SIMPLE',
  'MEDIUM',
  'COMPLEX',
  'CRITICAL'
]);

export const TASK_RISKS: readonly TaskRisk[] = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
]);

export interface CreateTaskInputDto {
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly requiredCapabilities: readonly string[];
  readonly requiredSpecialties: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly complexity: TaskComplexity;
  readonly risk: TaskRisk;
}

export interface CreateTaskRequestDto {
  readonly submissionId: string;
  readonly input: CreateTaskInputDto;
}

export type TaskSubmissionResult =
  | {
      readonly status: 'created';
      readonly task: TaskDto;
      readonly stateSynchronized: true;
    }
  | {
      readonly status: 'created';
      readonly task: TaskDto;
      readonly stateSynchronized: false;
      readonly warning: {
        readonly code: string;
        readonly message: string;
      };
    }
  | {
      readonly status: 'ambiguous';
      readonly retryable: true;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    }
  | {
      readonly status: 'failed';
      readonly retryable: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };


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

export function sanitizeEventPayload(val: unknown, depth = 0): AgentHubPublicValue {
  if (depth > 13) {
    throw new AgentHubValidationError('MALFORMED_PAYLOAD', 'Payload exceeds maximum nesting depth (13)');
  }

  if (depth === 13) {
    if (val === '[TRUNCATED]') {
      return val;
    }
    if (Array.isArray(val) || isRecord(val)) {
      throw new AgentHubValidationError('MALFORMED_PAYLOAD', 'Payload container cannot continue at depth 13');
    }
    throw new AgentHubValidationError('MALFORMED_PAYLOAD', 'Leaf at depth 13 must be [TRUNCATED]');
  }

  if (val === null) {
    return null;
  }

  if (typeof val === 'string') {
    return val;
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new AgentHubValidationError('MALFORMED_PAYLOAD', 'Payload number must be finite');
    }
    return val;
  }

  if (typeof val === 'boolean') {
    return val;
  }

  if (Array.isArray(val)) {
    if (val.length > 1000) {
      throw new AgentHubValidationError('MALFORMED_PAYLOAD', 'Array exceeds maximum element limit (1000)');
    }
    const sanitizedArray = val.map((item) => sanitizeEventPayload(item, depth + 1));
    return Object.freeze(sanitizedArray);
  }

  if (isRecord(val)) {
    const sanitizedObj: Record<string, AgentHubPublicValue> = {};
    for (const [key, child] of Object.entries(val)) {
      if (LOWERCASE_FORBIDDEN_KEYS.has(key.toLowerCase())) {
        continue;
      }
      sanitizedObj[key] = sanitizeEventPayload(child, depth + 1);
    }
    return Object.freeze(sanitizedObj);
  }

  throw new AgentHubValidationError('MALFORMED_PAYLOAD', `Unsupported payload type: ${typeof val}`);
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

  if (!('payload' in raw) || raw.payload === undefined) {
    throw new AgentHubValidationError('MALFORMED_EVENT', "Required field 'payload' is missing");
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

const ALLOWED_CREATE_TASK_KEYS = new Set([
  'projectId',
  'title',
  'description',
  'requiredCapabilities',
  'requiredSpecialties',
  'acceptanceCriteria',
  'complexity',
  'risk'
]);

function getUtf8Bytes(str: string): number {
  return new TextEncoder().encode(str).length;
}

function rejectIfContainsNul(value: string, fieldName: string): void {
  if (value.includes('\0')) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must not contain NUL`);
  }
}

export function snapshotCreateTaskInput(raw: unknown): CreateTaskInputDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Task creation input must be an object');
  }

  // Reject unexpected top-level keys
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_CREATE_TASK_KEYS.has(key)) {
      throw new AgentHubValidationError('MALFORMED_INPUT', `Unexpected key in task creation input: '${key}'`);
    }
  }

  // projectId: nonblank string, UTF-8 <= 256 bytes
  if (!('projectId' in raw) || typeof raw.projectId !== 'string' || !raw.projectId.trim()) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'projectId' must be a non-blank string");
  }
  rejectIfContainsNul(raw.projectId, 'projectId');
  if (getUtf8Bytes(raw.projectId) > 256) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'projectId' exceeds maximum length (256 bytes)");
  }

  // title: nonblank string, UTF-8 <= 16 KiB (16384 bytes)
  if (!('title' in raw) || typeof raw.title !== 'string' || !raw.title.trim()) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'title' must be a non-blank string");
  }
  rejectIfContainsNul(raw.title, 'title');
  if (getUtf8Bytes(raw.title) > 16384) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'title' exceeds maximum length (16 KiB)");
  }

  // description: string | null, UTF-8 <= 128 KiB (131072 bytes) when string
  if (!('description' in raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'description' is required (can be null)");
  }
  if (raw.description !== null && typeof raw.description !== 'string') {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'description' must be a string or null");
  }
  if (typeof raw.description === 'string') {
    rejectIfContainsNul(raw.description, 'description');
    if (getUtf8Bytes(raw.description) > 131072) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'description' exceeds maximum length (128 KiB)");
    }
  }

  // requiredCapabilities: array <= 256 items, each nonblank, <= 512 bytes
  if (!('requiredCapabilities' in raw) || !Array.isArray(raw.requiredCapabilities)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'requiredCapabilities' must be an array");
  }
  if (raw.requiredCapabilities.length > 256) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'requiredCapabilities' exceeds maximum length (256 items)");
  }
  for (const item of raw.requiredCapabilities) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Elements in 'requiredCapabilities' must be non-blank strings");
    }
    rejectIfContainsNul(item, 'requiredCapabilities');
    if (getUtf8Bytes(item) > 512) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Element in 'requiredCapabilities' exceeds maximum length (512 bytes)");
    }
  }

  // requiredSpecialties: array <= 256 items, each nonblank, <= 512 bytes
  if (!('requiredSpecialties' in raw) || !Array.isArray(raw.requiredSpecialties)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'requiredSpecialties' must be an array");
  }
  if (raw.requiredSpecialties.length > 256) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'requiredSpecialties' exceeds maximum length (256 items)");
  }
  for (const item of raw.requiredSpecialties) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Elements in 'requiredSpecialties' must be non-blank strings");
    }
    rejectIfContainsNul(item, 'requiredSpecialties');
    if (getUtf8Bytes(item) > 512) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Element in 'requiredSpecialties' exceeds maximum length (512 bytes)");
    }
  }

  // acceptanceCriteria: array <= 256 items, each nonblank, <= 8192 bytes
  if (!('acceptanceCriteria' in raw) || !Array.isArray(raw.acceptanceCriteria)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'acceptanceCriteria' must be an array");
  }
  if (raw.acceptanceCriteria.length > 256) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'acceptanceCriteria' exceeds maximum length (256 items)");
  }
  for (const item of raw.acceptanceCriteria) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Elements in 'acceptanceCriteria' must be non-blank strings");
    }
    rejectIfContainsNul(item, 'acceptanceCriteria');
    if (getUtf8Bytes(item) > 8192) {
      throw new AgentHubValidationError('MALFORMED_INPUT', "Element in 'acceptanceCriteria' exceeds maximum length (8192 bytes)");
    }
  }

  // complexity: exactly one backend enum value
  if (!('complexity' in raw) || typeof raw.complexity !== 'string' || !TASK_COMPLEXITIES.includes(raw.complexity as TaskComplexity)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field 'complexity' must be one of: ${TASK_COMPLEXITIES.join(', ')}`);
  }

  // risk: exactly one backend enum value
  if (!('risk' in raw) || typeof raw.risk !== 'string' || !TASK_RISKS.includes(raw.risk as TaskRisk)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field 'risk' must be one of: ${TASK_RISKS.join(', ')}`);
  }

  return Object.freeze({
    projectId: raw.projectId,
    title: raw.title,
    description: raw.description,
    requiredCapabilities: Object.freeze([...raw.requiredCapabilities]),
    requiredSpecialties: Object.freeze([...raw.requiredSpecialties]),
    acceptanceCriteria: Object.freeze([...raw.acceptanceCriteria]),
    complexity: raw.complexity as TaskComplexity,
    risk: raw.risk as TaskRisk
  });
}

const ALLOWED_CREATE_TASK_REQUEST_KEYS = new Set(['submissionId', 'input']);

export function snapshotCreateTaskRequest(raw: unknown): CreateTaskRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Task submission request must be an object');
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_CREATE_TASK_REQUEST_KEYS.has(key)) {
      throw new AgentHubValidationError(
        'MALFORMED_REQUEST',
        `Unexpected key in task submission request: '${key}'`
      );
    }
  }

  if (!('submissionId' in raw) || typeof raw.submissionId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'submissionId' must be a string");
  }
  if (!('input' in raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'input' is required");
  }

  return Object.freeze({
    submissionId: raw.submissionId,
    input: snapshotCreateTaskInput(raw.input)
  });
}
