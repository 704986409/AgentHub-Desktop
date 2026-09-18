/**
 * Public Data Transfer Objects (DTOs) and runtime snapshotting for AgentHub Desktop.
 * 
 * Strict Invariants:
 * - Pinned to AgentHub 0.7.1 public contracts.
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

export type AgentStatusDto = 'IDLE' | 'BUSY' | 'OFFLINE' | 'DISABLED';
export type AgentAuthorityDto = 'READ_ONLY' | 'STANDARD' | 'PRIVILEGED' | 'ADMIN';

export interface AgentDto {
  readonly agentId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly providerId: string;
  readonly modelId: string;
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

export interface ExecuteTaskInputDto {
  readonly baseRef: string;
  readonly prompt: string;
}

export interface ExecuteTaskRequestDto {
  readonly executionId: string;
  readonly taskId: string;
  readonly input: ExecuteTaskInputDto;
}

export interface ExecuteWorkerResultDto {
  readonly summary: string;
  readonly blockers: readonly string[];
  readonly questions: readonly string[];
  readonly risks: readonly string[];
  readonly notes: readonly string[];
}

export interface ExecuteSourceDto {
  readonly branchName: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly changedPaths: readonly string[];
  readonly changeSetSha256: string;
  readonly committedPatch?: string;
}

export type ExecuteBuildTestStatus = 'passed' | 'failed' | 'infrastructure-failed' | 'not-run';
export type ExecuteEvidenceOutcome = 'passed' | 'failed' | 'workspace-mutated' | 'infrastructure-failed';
export type ExecuteCommandPhase = 'build' | 'test';
export type ExecuteCommandOutcome = 'passed' | 'failed' | 'timed-out' | 'output-limit' | 'spawn-failed';

export interface ExecuteBuildTestCommandDto {
  readonly id: string;
  readonly phase: ExecuteCommandPhase;
  readonly outcome: ExecuteCommandOutcome;
  readonly exitCode?: number;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
}

export interface ExecuteBuildTestDto {
  readonly build: ExecuteBuildTestStatus;
  readonly test: ExecuteBuildTestStatus;
  readonly outcome: ExecuteEvidenceOutcome;
  readonly commands: readonly ExecuteBuildTestCommandDto[];
}

export interface ExecuteReviewReadyDto {
  readonly outcome: 'review-ready';
  readonly reviewHandle: string;
  readonly reviewBundleSha256: string;
  readonly taskId: string;
  readonly assignmentId: string;
  readonly agentId: string;
  readonly providerId: string;
  readonly workerResult: ExecuteWorkerResultDto;
  readonly source: ExecuteSourceDto;
  readonly buildTest: ExecuteBuildTestDto;
  readonly evidenceSha256: string;
}

export interface ExecuteTerminalLifecycleDto {
  readonly outcome: 'blocked' | 'waiting-input' | 'failed';
  readonly taskId: string;
  readonly assignmentId: string;
  readonly lifecycleSha256: string;
}

export type ExecuteTaskResultDto = ExecuteReviewReadyDto | ExecuteTerminalLifecycleDto;

export type TaskExecutionResult =
  | {
      readonly status: 'executed';
      readonly result: ExecuteTaskResultDto;
      readonly stateSynchronized: true;
    }
  | {
      readonly status: 'executed';
      readonly result: ExecuteTaskResultDto;
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

const EXECUTE_BUILD_STATUSES = ['passed', 'failed', 'infrastructure-failed', 'not-run'] as const;
const EXECUTE_EVIDENCE_OUTCOMES = ['passed', 'failed', 'workspace-mutated', 'infrastructure-failed'] as const;
const EXECUTE_COMMAND_PHASES = ['build', 'test'] as const;
const EXECUTE_COMMAND_OUTCOMES = ['passed', 'failed', 'timed-out', 'output-limit', 'spawn-failed'] as const;
const EXECUTE_TERMINAL_OUTCOMES = ['blocked', 'waiting-input', 'failed'] as const;

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
    modelId: parseRequiredNonBlankString(raw, 'modelId'),
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

function rejectIfContainsNul(value: string, fieldName: string, code = 'MALFORMED_INPUT'): void {
  if (value.includes('\0')) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must not contain NUL`);
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

const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_OID_RE = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
const PROMPT_MAX_BYTES = 1024 * 1024;
const BASE_REF_MAX_BYTES = 1024;
const EXECUTE_ID_MAX_BYTES = 256;
const WORKER_SUMMARY_MAX_CHARS = 8192;
const WORKER_ITEM_MAX_CHARS = 4096;
const WORKER_BLOCKERS_MAX_ITEMS = 64;
const WORKER_QUESTIONS_MAX_ITEMS = 64;
const WORKER_RISKS_MAX_ITEMS = 64;
const WORKER_NOTES_MAX_ITEMS = 128;
const CHANGED_PATHS_MAX_ITEMS = 4096;
const COMMANDS_MAX_ITEMS = 256;
const COMMAND_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const COMMAND_PREVIEW_MAX_BYTES = 1024 * 1024;
const BRANCH_NAME_MAX_BYTES = 4096;
const MANAGED_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function rejectUnexpectedKeys(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: string,
  context: string
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new AgentHubValidationError(code, `Unexpected key in ${context}: '${key}'`);
    }
  }
}

function snapshotBoundedText(
  value: unknown,
  fieldName: string,
  maxBytes: number,
  code: string,
  nonBlank: boolean
): string {
  if (typeof value !== 'string') {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a string`);
  }
  rejectIfContainsNul(value, fieldName, code);
  if (nonBlank && value.trim().length === 0) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a non-blank string`);
  }
  if (getUtf8Bytes(value) > maxBytes) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds maximum length (${maxBytes} bytes)`);
  }
  return value;
}

export function snapshotCommandPreviewText(
  value: unknown,
  fieldName: string,
  maxBytes: number,
  code: string
): string {
  if (typeof value !== 'string') {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a string`);
  }
  if (getUtf8Bytes(value) > maxBytes) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds maximum length (${maxBytes} bytes)`);
  }
  return value;
}

function snapshotBoundedChars(
  value: unknown,
  fieldName: string,
  maxChars: number,
  code: string,
  nonBlank: boolean,
  forbidNul = true
): string {
  if (typeof value !== 'string') {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a string`);
  }
  if (forbidNul) {
    rejectIfContainsNul(value, fieldName, code);
  }
  if (nonBlank && value.trim().length === 0) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a non-blank string`);
  }
  if (value.length > maxChars) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds maximum length (${maxChars} characters)`);
  }
  return value;
}

function snapshotBoundedCharStringArray(
  value: unknown,
  fieldName: string,
  maxItems: number,
  maxItemChars: number,
  code: string,
  forbidNul = true,
  requireNonBlank = false
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be an array`);
  }
  if (value.length > maxItems) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds maximum length (${maxItems} items)`);
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new AgentHubValidationError(code, `Elements in '${fieldName}' must be strings`);
    }
    if (forbidNul) {
      rejectIfContainsNul(item, fieldName, code);
    }
    if (requireNonBlank && item.trim().length === 0) {
      throw new AgentHubValidationError(code, `Elements in '${fieldName}' must be non-blank strings`);
    }
    if (item.length > maxItemChars) {
      throw new AgentHubValidationError(code, `Element in '${fieldName}' exceeds maximum length (${maxItemChars} characters)`);
    }
    items.push(item);
  }
  return Object.freeze(items);
}

function snapshotPathArray(
  value: unknown,
  fieldName: string,
  maxItems: number,
  code: string
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be an array`);
  }
  if (value.length > maxItems) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds maximum length (${maxItems} items)`);
  }
  const items: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new AgentHubValidationError(code, `Elements in '${fieldName}' must be strings`);
    }
    if (item.length === 0) {
      throw new AgentHubValidationError(code, `Elements in '${fieldName}' must be nonempty strings`);
    }
    rejectIfContainsNul(item, fieldName, code);
    if (seen.has(item)) {
      throw new AgentHubValidationError(code, `Field '${fieldName}' must not contain duplicate paths`);
    }
    if (items.length > 0 && item < items[items.length - 1]) {
      throw new AgentHubValidationError(code, `Field '${fieldName}' must be in backend lexical order`);
    }
    seen.add(item);
    items.push(item);
  }
  return Object.freeze(items);
}

function snapshotSha256(value: unknown, fieldName: string, code: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be 64 lowercase hex characters`);
  }
  return value;
}

function snapshotGitOid(value: unknown, fieldName: string, code: string): string {
  if (typeof value !== 'string' || !GIT_OID_RE.test(value)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a 40- or 64-character lowercase hex Git OID`);
  }
  return value;
}

function snapshotManagedExecuteTaskId(raw: unknown, fieldName: string): string {
  const taskId = snapshotBoundedText(raw, fieldName, EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true);
  if (!MANAGED_TASK_ID_RE.test(taskId) || taskId.includes('..') || taskId.endsWith('.')) {
    throw new AgentHubValidationError(
      'MALFORMED_EXECUTE_RESULT',
      `Field '${fieldName}' must be a pinned managed task ID`
    );
  }
  if (WINDOWS_RESERVED_DEVICE_NAMES.has(taskId.toUpperCase())) {
    throw new AgentHubValidationError(
      'MALFORMED_EXECUTE_RESULT',
      `Field '${fieldName}' must not be a Windows-reserved device name`
    );
  }
  return taskId;
}

function snapshotExecuteCommandId(raw: unknown): string {
  if (typeof raw !== 'string' || !COMMAND_ID_RE.test(raw)) {
    throw new AgentHubValidationError(
      'MALFORMED_EXECUTE_RESULT',
      "Field 'command.id' must match ^[A-Za-z0-9._-]{1,64}$"
    );
  }
  return raw;
}

const ALLOWED_EXECUTE_TASK_INPUT_KEYS = new Set(['baseRef', 'prompt']);

export function snapshotExecuteTaskInput(raw: unknown): ExecuteTaskInputDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Execute task input must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_EXECUTE_TASK_INPUT_KEYS, 'MALFORMED_INPUT', 'execute task input');
  if (!('baseRef' in raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'baseRef' is required");
  }
  if (!('prompt' in raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'prompt' is required");
  }

  const baseRef = snapshotBoundedText(raw.baseRef, 'baseRef', BASE_REF_MAX_BYTES, 'MALFORMED_INPUT', true);
  if (/[\r\n]/u.test(baseRef)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'baseRef' must not contain CR or LF");
  }
  const prompt = snapshotBoundedText(raw.prompt, 'prompt', PROMPT_MAX_BYTES, 'MALFORMED_INPUT', true);

  return Object.freeze({ baseRef, prompt });
}

export function snapshotExecuteTaskId(raw: unknown): string {
  const taskId = snapshotBoundedText(raw, 'taskId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_REQUEST', true);
  if (/[\r\n]/u.test(taskId)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'taskId' must not contain CR or LF");
  }
  return taskId;
}

const ALLOWED_EXECUTE_TASK_REQUEST_KEYS = new Set(['executionId', 'taskId', 'input']);

export function snapshotExecuteTaskRequest(raw: unknown): ExecuteTaskRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Task execution request must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_EXECUTE_TASK_REQUEST_KEYS, 'MALFORMED_REQUEST', 'task execution request');
  if (!('executionId' in raw) || typeof raw.executionId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'executionId' must be a string");
  }
  if (!('taskId' in raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'taskId' is required");
  }
  if (!('input' in raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'input' is required");
  }

  return Object.freeze({
    executionId: raw.executionId,
    taskId: snapshotExecuteTaskId(raw.taskId),
    input: snapshotExecuteTaskInput(raw.input)
  });
}

const ALLOWED_WORKER_RESULT_KEYS = new Set(['summary', 'blockers', 'questions', 'risks', 'notes']);
const ALLOWED_SOURCE_KEYS = new Set([
  'branchName',
  'baseCommit',
  'headCommit',
  'changedPaths',
  'changeSetSha256',
  'committedPatch'
]);
const ALLOWED_BUILD_TEST_KEYS = new Set(['build', 'test', 'outcome', 'commands']);
const ALLOWED_COMMAND_KEYS = new Set(['id', 'phase', 'outcome', 'exitCode', 'stdoutPreview', 'stderrPreview']);
const ALLOWED_REVIEW_READY_KEYS = new Set([
  'outcome',
  'reviewHandle',
  'reviewBundleSha256',
  'taskId',
  'assignmentId',
  'agentId',
  'providerId',
  'workerResult',
  'source',
  'buildTest',
  'evidenceSha256'
]);
const ALLOWED_TERMINAL_KEYS = new Set([
  'outcome',
  'taskId',
  'assignmentId',
  'lifecycleSha256'
]);

function snapshotExecuteWorkerResult(raw: unknown): ExecuteWorkerResultDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'workerResult must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_WORKER_RESULT_KEYS, 'MALFORMED_EXECUTE_RESULT', 'workerResult');
  return Object.freeze({
    summary: snapshotBoundedChars(raw.summary, 'workerResult.summary', WORKER_SUMMARY_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', true, false),
    blockers: snapshotBoundedCharStringArray(raw.blockers, 'workerResult.blockers', WORKER_BLOCKERS_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false, true),
    questions: snapshotBoundedCharStringArray(raw.questions, 'workerResult.questions', WORKER_QUESTIONS_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false, true),
    risks: snapshotBoundedCharStringArray(raw.risks, 'workerResult.risks', WORKER_RISKS_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false, true),
    notes: snapshotBoundedCharStringArray(raw.notes, 'workerResult.notes', WORKER_NOTES_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false, true)
  });
}

function snapshotExecuteSource(raw: unknown): ExecuteSourceDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'source must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_SOURCE_KEYS, 'MALFORMED_EXECUTE_RESULT', 'source');
  const source: {
    branchName: string;
    baseCommit: string;
    headCommit: string;
    changedPaths: readonly string[];
    changeSetSha256: string;
    committedPatch?: string;
  } = {
    branchName: snapshotBoundedText(raw.branchName, 'source.branchName', BRANCH_NAME_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    baseCommit: snapshotGitOid(raw.baseCommit, 'source.baseCommit', 'MALFORMED_EXECUTE_RESULT'),
    headCommit: snapshotGitOid(raw.headCommit, 'source.headCommit', 'MALFORMED_EXECUTE_RESULT'),
    changedPaths: snapshotPathArray(
      raw.changedPaths,
      'source.changedPaths',
      CHANGED_PATHS_MAX_ITEMS,
      'MALFORMED_EXECUTE_RESULT'
    ),
    changeSetSha256: snapshotSha256(raw.changeSetSha256, 'source.changeSetSha256', 'MALFORMED_EXECUTE_RESULT')
  };
  if ('committedPatch' in raw) {
    if (typeof raw.committedPatch !== 'string') {
      throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'source.committedPatch' must be a string when present");
    }
    rejectIfContainsNul(raw.committedPatch, 'source.committedPatch', 'MALFORMED_EXECUTE_RESULT');
    source.committedPatch = raw.committedPatch;
  }
  return Object.freeze(source);
}

function snapshotExecuteCommand(raw: unknown): ExecuteBuildTestCommandDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'buildTest.commands item must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_COMMAND_KEYS, 'MALFORMED_EXECUTE_RESULT', 'buildTest.commands item');
  if (typeof raw.phase !== 'string' || !EXECUTE_COMMAND_PHASES.includes(raw.phase as ExecuteCommandPhase)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'command.phase' is invalid");
  }
  if (typeof raw.outcome !== 'string' || !EXECUTE_COMMAND_OUTCOMES.includes(raw.outcome as ExecuteCommandOutcome)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'command.outcome' is invalid");
  }
  const command: {
    id: string;
    phase: ExecuteCommandPhase;
    outcome: ExecuteCommandOutcome;
    stdoutPreview: string;
    stderrPreview: string;
    exitCode?: number;
  } = {
    id: snapshotExecuteCommandId(raw.id),
    phase: raw.phase as ExecuteCommandPhase,
    outcome: raw.outcome as ExecuteCommandOutcome,
    stdoutPreview: snapshotCommandPreviewText(raw.stdoutPreview, 'command.stdoutPreview', COMMAND_PREVIEW_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT'),
    stderrPreview: snapshotCommandPreviewText(raw.stderrPreview, 'command.stderrPreview', COMMAND_PREVIEW_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT')
  };
  if ('exitCode' in raw) {
    if (
      typeof raw.exitCode !== 'number' ||
      !Number.isSafeInteger(raw.exitCode) ||
      raw.exitCode < INT32_MIN ||
      raw.exitCode > INT32_MAX
    ) {
      throw new AgentHubValidationError(
        'MALFORMED_EXECUTE_RESULT',
        "Field 'command.exitCode' must be a safe int32 when present"
      );
    }
    command.exitCode = raw.exitCode;
  }
  return Object.freeze(command);
}

function snapshotExecuteBuildTest(raw: unknown): ExecuteBuildTestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'buildTest must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_BUILD_TEST_KEYS, 'MALFORMED_EXECUTE_RESULT', 'buildTest');
  if (typeof raw.build !== 'string' || !EXECUTE_BUILD_STATUSES.includes(raw.build as ExecuteBuildTestStatus)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'buildTest.build' is invalid");
  }
  if (typeof raw.test !== 'string' || !EXECUTE_BUILD_STATUSES.includes(raw.test as ExecuteBuildTestStatus)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'buildTest.test' is invalid");
  }
  if (typeof raw.outcome !== 'string' || !EXECUTE_EVIDENCE_OUTCOMES.includes(raw.outcome as ExecuteEvidenceOutcome)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'buildTest.outcome' is invalid");
  }
  if (!Array.isArray(raw.commands)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'buildTest.commands' must be an array");
  }
  if (raw.commands.length > COMMANDS_MAX_ITEMS) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', `Field 'buildTest.commands' exceeds maximum length (${COMMANDS_MAX_ITEMS} items)`);
  }
  const commands = Object.freeze(raw.commands.map(snapshotExecuteCommand));
  const commandIds = new Set<string>();
  for (const command of commands) {
    if (commandIds.has(command.id)) {
      throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'buildTest.commands' must have unique ids");
    }
    commandIds.add(command.id);
  }
  return Object.freeze({
    build: raw.build as ExecuteBuildTestStatus,
    test: raw.test as ExecuteBuildTestStatus,
    outcome: raw.outcome as ExecuteEvidenceOutcome,
    commands
  });
}

export function snapshotExecuteReviewReadyDto(raw: unknown): ExecuteReviewReadyDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'review-ready result must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_REVIEW_READY_KEYS, 'MALFORMED_EXECUTE_RESULT', 'review-ready result');
  if (raw.outcome !== 'review-ready') {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'outcome' must be 'review-ready'");
  }
  const reviewBundleSha256 = snapshotSha256(raw.reviewBundleSha256, 'reviewBundleSha256', 'MALFORMED_EXECUTE_RESULT');
  const reviewHandle = snapshotSha256(raw.reviewHandle, 'reviewHandle', 'MALFORMED_EXECUTE_RESULT');
  if (reviewHandle !== reviewBundleSha256) {
    throw new AgentHubValidationError(
      'MALFORMED_EXECUTE_RESULT',
      "Field 'reviewHandle' must equal reviewBundleSha256"
    );
  }
  const taskId = snapshotManagedExecuteTaskId(raw.taskId, 'taskId');
  const workerResult = snapshotExecuteWorkerResult(raw.workerResult);
  if (workerResult.blockers.length > 0 || workerResult.questions.length > 0) {
    throw new AgentHubValidationError(
      'MALFORMED_EXECUTE_RESULT',
      'review-ready workerResult must not include blockers or questions'
    );
  }
  const source = snapshotExecuteSource(raw.source);
  if (source.branchName !== `agenthub/${taskId}`) {
    throw new AgentHubValidationError(
      'MALFORMED_EXECUTE_RESULT',
      "Field 'source.branchName' must equal agenthub/<taskId>"
    );
  }
  return Object.freeze({
    outcome: 'review-ready' as const,
    reviewHandle,
    reviewBundleSha256,
    taskId,
    assignmentId: snapshotBoundedText(raw.assignmentId, 'assignmentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    agentId: snapshotBoundedText(raw.agentId, 'agentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    providerId: snapshotBoundedText(raw.providerId, 'providerId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    workerResult,
    source,
    buildTest: snapshotExecuteBuildTest(raw.buildTest),
    evidenceSha256: snapshotSha256(raw.evidenceSha256, 'evidenceSha256', 'MALFORMED_EXECUTE_RESULT')
  });
}

export function snapshotExecuteTerminalLifecycleDto(raw: unknown): ExecuteTerminalLifecycleDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'terminal lifecycle result must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_TERMINAL_KEYS, 'MALFORMED_EXECUTE_RESULT', 'terminal lifecycle result');
  if (typeof raw.outcome !== 'string' || !EXECUTE_TERMINAL_OUTCOMES.includes(raw.outcome as ExecuteTerminalLifecycleDto['outcome'])) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'outcome' must be blocked, waiting-input, or failed");
  }
  return Object.freeze({
    outcome: raw.outcome as ExecuteTerminalLifecycleDto['outcome'],
    taskId: snapshotManagedExecuteTaskId(raw.taskId, 'taskId'),
    assignmentId: snapshotBoundedText(raw.assignmentId, 'assignmentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    lifecycleSha256: snapshotSha256(raw.lifecycleSha256, 'lifecycleSha256', 'MALFORMED_EXECUTE_RESULT')
  });
}

export function snapshotExecuteTaskResult(raw: unknown): ExecuteTaskResultDto {
  if (!isRecord(raw) || typeof raw.outcome !== 'string') {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'Execute result must be an object with an outcome discriminator');
  }
  if (raw.outcome === 'review-ready') {
    return snapshotExecuteReviewReadyDto(raw);
  }
  if (EXECUTE_TERMINAL_OUTCOMES.includes(raw.outcome as ExecuteTerminalLifecycleDto['outcome'])) {
    return snapshotExecuteTerminalLifecycleDto(raw);
  }
  throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', `Unknown execute outcome '${raw.outcome}'`);
}

// ============================================================================
// Review Decision Actions & Lifecycle DTOs (V0.8.6)
// ============================================================================

export type ReviewVerdictDto = 'ACCEPT' | 'REQUEST_REVISION' | 'BLOCK';
export const REVIEW_VERDICTS: readonly ReviewVerdictDto[] = Object.freeze(['ACCEPT', 'REQUEST_REVISION', 'BLOCK']);

export type ReviewFindingSeverityDto = 'info' | 'warning' | 'error' | 'blocker';
export const REVIEW_FINDING_SEVERITIES: readonly ReviewFindingSeverityDto[] = Object.freeze(['info', 'warning', 'error', 'blocker']);

export interface ReviewFindingInputDto {
  readonly code: string;
  readonly severity: ReviewFindingSeverityDto;
  readonly message: string;
  readonly path?: string;
}

export interface ReviewDecisionInputDto {
  readonly verdict: ReviewVerdictDto;
  readonly summary: string;
  readonly findings: readonly ReviewFindingInputDto[];
  readonly allowNoChangeCompletion: boolean;
}

export interface ReviewDecisionRequestDto {
  readonly decisionId: string;
  readonly reviewHandle: string;
  readonly input: ReviewDecisionInputDto;
}

export interface ReviewDecisionTerminalLifecycleDto {
  readonly outcome: 'blocked' | 'waiting-input' | 'failed';
  readonly taskId: string;
  readonly assignmentId: string;
  readonly lifecycleSha256: string;
  readonly reviewEvidenceSha256?: string;
}

export interface ReviewDecisionCompletedNoChangeDto {
  readonly outcome: 'completed-no-change';
  readonly taskId: string;
  readonly lifecycleSha256: string;
  readonly reviewEvidenceSha256: string;
}

export type MergeGateReasonDto =
  | 'BUILD_EVIDENCE_INVALID'
  | 'BUILD_EVIDENCE_NOT_PASSED'
  | 'REQUIRED_PHASE_NOT_PASSED'
  | 'REQUIRED_COMMAND_NOT_PASSED'
  | 'REVIEW_EVIDENCE_INVALID'
  | 'REVIEW_BINDING_MISMATCH'
  | 'REVIEW_NOT_ACCEPTED'
  | 'STALE_SOURCE'
  | 'STALE_VISIBILITY'
  | 'UNCOMMITTED_SOURCE'
  | 'CONFLICTS'
  | 'NO_COMMITTED_CHANGES';

export const MERGE_GATE_REASONS: readonly MergeGateReasonDto[] = Object.freeze([
  'BUILD_EVIDENCE_INVALID',
  'BUILD_EVIDENCE_NOT_PASSED',
  'REQUIRED_PHASE_NOT_PASSED',
  'REQUIRED_COMMAND_NOT_PASSED',
  'REVIEW_EVIDENCE_INVALID',
  'REVIEW_BINDING_MISMATCH',
  'REVIEW_NOT_ACCEPTED',
  'STALE_SOURCE',
  'STALE_VISIBILITY',
  'UNCOMMITTED_SOURCE',
  'CONFLICTS',
  'NO_COMMITTED_CHANGES'
]);

export interface MergeGateDto {
  readonly version: 1;
  readonly taskId: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly changeSetSha256: string;
  readonly sourceVisibilitySha256: string;
  readonly buildTestEvidenceSha256: string;
  readonly reviewEvidenceSha256: string;
  readonly eligible: boolean;
  readonly reasons: readonly MergeGateReasonDto[];
  readonly mergeGateSha256: string;
}

export type TaskMergeOutcomeDto = 'merged' | 'already-merged';
export const TASK_MERGE_OUTCOMES: readonly TaskMergeOutcomeDto[] = Object.freeze(['merged', 'already-merged']);

export interface TaskMergeResultDto {
  readonly version: 1;
  readonly taskId: string;
  readonly targetBranch: string;
  readonly baseCommit: string;
  readonly taskHeadCommit: string;
  readonly targetHeadBefore: string;
  readonly targetHeadAfter: string;
  readonly changeSetSha256: string;
  readonly sourceVisibilitySha256: string;
  readonly buildTestEvidenceSha256: string;
  readonly reviewEvidenceSha256: string;
  readonly mergeGateSha256: string;
  readonly outcome: TaskMergeOutcomeDto;
  readonly mergeResultSha256: string;
}

export interface ReviewDecisionMergeDeniedDto {
  readonly outcome: 'merge-denied';
  readonly taskId: string;
  readonly lifecycleSha256: string;
  readonly reviewEvidenceSha256: string;
  readonly mergeGate: MergeGateDto;
}

export interface ReviewDecisionCompletedDto {
  readonly outcome: 'completed';
  readonly taskId: string;
  readonly lifecycleSha256: string;
  readonly reviewEvidenceSha256: string;
  readonly mergeGate: MergeGateDto;
  readonly merge: TaskMergeResultDto;
}

export type ReviewDecisionLifecycleDto =
  | ExecuteReviewReadyDto
  | ReviewDecisionTerminalLifecycleDto
  | ReviewDecisionCompletedNoChangeDto
  | ReviewDecisionMergeDeniedDto
  | ReviewDecisionCompletedDto;

export type ReviewDecisionResult =
  | {
      readonly status: 'applied';
      readonly result: ReviewDecisionLifecycleDto;
      readonly stateSynchronized: true;
    }
  | {
      readonly status: 'applied';
      readonly result: ReviewDecisionLifecycleDto;
      readonly stateSynchronized: false;
      readonly warning: {
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
    }
  | {
      readonly status: 'ambiguous';
      readonly retryable: true;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

const FINDING_CODE_RE = /^[A-Za-z0-9._-]{1,128}$/;
const REVIEW_HANDLE_RE = /^[a-f0-9]{64}$/;
const DECISION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const ALLOWED_FINDING_KEYS = new Set(['code', 'severity', 'message', 'path']);
const ALLOWED_DECISION_INPUT_KEYS = new Set(['verdict', 'summary', 'findings', 'allowNoChangeCompletion']);
const ALLOWED_DECISION_REQUEST_KEYS = new Set(['decisionId', 'reviewHandle', 'input']);

const ALLOWED_REVIEW_TERMINAL_KEYS = new Set(['outcome', 'taskId', 'assignmentId', 'lifecycleSha256', 'reviewEvidenceSha256']);
const ALLOWED_COMPLETED_NO_CHANGE_KEYS = new Set(['outcome', 'taskId', 'lifecycleSha256', 'reviewEvidenceSha256']);
const ALLOWED_MERGE_DENIED_KEYS = new Set(['outcome', 'taskId', 'lifecycleSha256', 'reviewEvidenceSha256', 'mergeGate']);
const ALLOWED_COMPLETED_KEYS = new Set(['outcome', 'taskId', 'lifecycleSha256', 'reviewEvidenceSha256', 'mergeGate', 'merge']);
const ALLOWED_MERGE_GATE_KEYS = new Set([
  'version',
  'taskId',
  'branchName',
  'baseCommit',
  'headCommit',
  'changeSetSha256',
  'sourceVisibilitySha256',
  'buildTestEvidenceSha256',
  'reviewEvidenceSha256',
  'eligible',
  'reasons',
  'mergeGateSha256'
]);
const ALLOWED_MERGE_RESULT_KEYS = new Set([
  'version',
  'taskId',
  'targetBranch',
  'baseCommit',
  'taskHeadCommit',
  'targetHeadBefore',
  'targetHeadAfter',
  'changeSetSha256',
  'sourceVisibilitySha256',
  'buildTestEvidenceSha256',
  'reviewEvidenceSha256',
  'mergeGateSha256',
  'outcome',
  'mergeResultSha256'
]);

function snapshotFindingPath(pathVal: unknown, fieldName: string, code: string): string {
  if (typeof pathVal !== 'string') {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a string`);
  }
  if (!pathVal.trim() || pathVal.length === 0) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be nonblank`);
  }
  rejectIfContainsNul(pathVal, fieldName, code);
  if (new TextEncoder().encode(pathVal).length > 4096) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds 4096 bytes`);
  }
  if (pathVal.startsWith('/') || pathVal.startsWith('\\') || /^[A-Za-z]:/.test(pathVal)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a relative path`);
  }
  const segments = pathVal.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new AgentHubValidationError(code, `Field '${fieldName}' contains invalid path segment '${seg}'`);
    }
  }
  return pathVal;
}

export function snapshotReviewFindingInput(raw: unknown): ReviewFindingInputDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', 'finding must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_FINDING_KEYS, 'MALFORMED_REVIEW_DECISION_REQUEST', 'finding');
  if (typeof raw.code !== 'string' || !FINDING_CODE_RE.test(raw.code)) {
    throw new AgentHubValidationError(
      'MALFORMED_REVIEW_DECISION_REQUEST',
      "Field 'code' must match ^[A-Za-z0-9._-]{1,128}$"
    );
  }
  if (typeof raw.severity !== 'string' || !REVIEW_FINDING_SEVERITIES.includes(raw.severity as ReviewFindingSeverityDto)) {
    throw new AgentHubValidationError(
      'MALFORMED_REVIEW_DECISION_REQUEST',
      "Field 'severity' must be one of: info, warning, error, blocker"
    );
  }
  if (typeof raw.message !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'message' must be a string");
  }
  rejectIfContainsNul(raw.message, 'finding.message', 'MALFORMED_REVIEW_DECISION_REQUEST');
  if (new TextEncoder().encode(raw.message).length > 8192) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'message' exceeds 8192 bytes");
  }

  const finding: {
    code: string;
    severity: ReviewFindingSeverityDto;
    message: string;
    path?: string;
  } = {
    code: raw.code,
    severity: raw.severity as ReviewFindingSeverityDto,
    message: raw.message
  };

  if ('path' in raw && raw.path !== undefined) {
    finding.path = snapshotFindingPath(raw.path, 'finding.path', 'MALFORMED_REVIEW_DECISION_REQUEST');
  }

  return Object.freeze(finding);
}

export function snapshotReviewDecisionInput(raw: unknown): ReviewDecisionInputDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', 'decision input must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_DECISION_INPUT_KEYS, 'MALFORMED_REVIEW_DECISION_REQUEST', 'decision input');
  if (typeof raw.verdict !== 'string' || !REVIEW_VERDICTS.includes(raw.verdict as ReviewVerdictDto)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'verdict' must be ACCEPT, REQUEST_REVISION, or BLOCK");
  }
  if (typeof raw.summary !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'summary' must be a string");
  }
  rejectIfContainsNul(raw.summary, 'summary', 'MALFORMED_REVIEW_DECISION_REQUEST');
  if (new TextEncoder().encode(raw.summary).length > 16384) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'summary' exceeds 16384 bytes limit");
  }
  if (!Array.isArray(raw.findings)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'findings' must be an array");
  }
  if (raw.findings.length > 256) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'findings' exceeds 256 items limit");
  }
  const findings = Object.freeze(raw.findings.map(snapshotReviewFindingInput));
  if (typeof raw.allowNoChangeCompletion !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'allowNoChangeCompletion' must be a boolean");
  }

  // Verdict / findings semantic checks
  const verdict = raw.verdict as ReviewVerdictDto;
  if (verdict === 'ACCEPT') {
    for (const f of findings) {
      if (f.severity === 'error' || f.severity === 'blocker') {
        throw new AgentHubValidationError('INVALID_VERDICT_FINDINGS', `ACCEPT verdict cannot contain '${f.severity}' findings`);
      }
    }
  } else if (verdict === 'BLOCK') {
    const hasBlocker = findings.some((f) => f.severity === 'blocker');
    if (!hasBlocker) {
      throw new AgentHubValidationError('INVALID_VERDICT_FINDINGS', "BLOCK verdict requires at least one finding with severity 'blocker'");
    }
  }

  return Object.freeze({
    verdict,
    summary: raw.summary,
    findings,
    allowNoChangeCompletion: raw.allowNoChangeCompletion
  });
}

export function snapshotReviewDecisionRequest(raw: unknown): ReviewDecisionRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', 'decision request must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_DECISION_REQUEST_KEYS, 'MALFORMED_REVIEW_DECISION_REQUEST', 'decision request');
  if (typeof raw.decisionId !== 'string' || !DECISION_ID_RE.test(raw.decisionId)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'decisionId' must match ^[A-Za-z0-9_-]{1,128}$");
  }
  if (typeof raw.reviewHandle !== 'string' || !REVIEW_HANDLE_RE.test(raw.reviewHandle)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_REQUEST', "Field 'reviewHandle' must be 64 lowercase hex characters");
  }
  const input = snapshotReviewDecisionInput(raw.input);
  return Object.freeze({
    decisionId: raw.decisionId,
    reviewHandle: raw.reviewHandle,
    input
  });
}

export function toBackendReviewDecisionBody(
  decisionId: string,
  input: ReviewDecisionInputDto
): {
  reviewId: string;
  reviewerId: 'desktop-human';
  verdict: ReviewVerdictDto;
  summary: string;
  findings: readonly ReviewFindingInputDto[];
  allowNoChangeCompletion: boolean;
} {
  return Object.freeze({
    reviewId: decisionId,
    reviewerId: 'desktop-human' as const,
    verdict: input.verdict,
    summary: input.summary,
    findings: Object.freeze(input.findings.map((f) => Object.freeze({
      code: f.code,
      severity: f.severity,
      message: f.message,
      ...(f.path !== undefined ? { path: f.path } : {})
    }))),
    allowNoChangeCompletion: input.allowNoChangeCompletion
  });
}

export function snapshotMergeGateDto(raw: unknown): MergeGateDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', 'mergeGate must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_MERGE_GATE_KEYS, 'MALFORMED_REVIEW_DECISION_RESULT', 'mergeGate');
  if (raw.version !== 1) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', "Field 'mergeGate.version' must equal 1");
  }
  const taskId = snapshotManagedExecuteTaskId(raw.taskId, 'mergeGate.taskId');
  const branchName = snapshotBoundedText(raw.branchName, 'mergeGate.branchName', BRANCH_NAME_MAX_BYTES, 'MALFORMED_REVIEW_DECISION_RESULT', true);
  const baseCommit = snapshotGitOid(raw.baseCommit, 'mergeGate.baseCommit', 'MALFORMED_REVIEW_DECISION_RESULT');
  const headCommit = snapshotGitOid(raw.headCommit, 'mergeGate.headCommit', 'MALFORMED_REVIEW_DECISION_RESULT');
  const changeSetSha256 = snapshotSha256(raw.changeSetSha256, 'mergeGate.changeSetSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const sourceVisibilitySha256 = snapshotSha256(raw.sourceVisibilitySha256, 'mergeGate.sourceVisibilitySha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const buildTestEvidenceSha256 = snapshotSha256(raw.buildTestEvidenceSha256, 'mergeGate.buildTestEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const reviewEvidenceSha256 = snapshotSha256(raw.reviewEvidenceSha256, 'mergeGate.reviewEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT');

  if (!Array.isArray(raw.reasons)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', "Field 'mergeGate.reasons' must be an array");
  }

  const reasons: MergeGateReasonDto[] = [];
  const seenReasons = new Set<string>();
  let lastCanonicalIndex = -1;

  for (const reason of raw.reasons) {
    if (typeof reason !== 'string' || !MERGE_GATE_REASONS.includes(reason as MergeGateReasonDto)) {
      throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', `Invalid mergeGate reason '${String(reason)}'`);
    }
    if (seenReasons.has(reason)) {
      throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', `Duplicate reason '${reason}' in mergeGate.reasons`);
    }
    const canonicalIndex = MERGE_GATE_REASONS.indexOf(reason as MergeGateReasonDto);
    if (canonicalIndex < lastCanonicalIndex) {
      throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', 'reasons in mergeGate must be in backend canonical order');
    }
    lastCanonicalIndex = canonicalIndex;
    seenReasons.add(reason);
    reasons.push(reason as MergeGateReasonDto);
  }

  if (typeof raw.eligible !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', "Field 'mergeGate.eligible' must be a boolean");
  }
  if (raw.eligible !== (reasons.length === 0)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', 'mergeGate.eligible must match reasons.length === 0');
  }

  const mergeGateSha256 = snapshotSha256(raw.mergeGateSha256, 'mergeGate.mergeGateSha256', 'MALFORMED_REVIEW_DECISION_RESULT');

  return Object.freeze({
    version: 1,
    taskId,
    branchName,
    baseCommit,
    headCommit,
    changeSetSha256,
    sourceVisibilitySha256,
    buildTestEvidenceSha256,
    reviewEvidenceSha256,
    eligible: raw.eligible,
    reasons: Object.freeze(reasons),
    mergeGateSha256
  });
}

export function snapshotTaskMergeResultDto(raw: unknown): TaskMergeResultDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', 'merge must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_MERGE_RESULT_KEYS, 'MALFORMED_REVIEW_DECISION_RESULT', 'merge');
  if (raw.version !== 1) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', "Field 'merge.version' must equal 1");
  }
  const taskId = snapshotManagedExecuteTaskId(raw.taskId, 'merge.taskId');
  const targetBranch = snapshotBoundedText(raw.targetBranch, 'merge.targetBranch', BRANCH_NAME_MAX_BYTES, 'MALFORMED_REVIEW_DECISION_RESULT', true);
  const baseCommit = snapshotGitOid(raw.baseCommit, 'merge.baseCommit', 'MALFORMED_REVIEW_DECISION_RESULT');
  const taskHeadCommit = snapshotGitOid(raw.taskHeadCommit, 'merge.taskHeadCommit', 'MALFORMED_REVIEW_DECISION_RESULT');
  const targetHeadBefore = snapshotGitOid(raw.targetHeadBefore, 'merge.targetHeadBefore', 'MALFORMED_REVIEW_DECISION_RESULT');
  const targetHeadAfter = snapshotGitOid(raw.targetHeadAfter, 'merge.targetHeadAfter', 'MALFORMED_REVIEW_DECISION_RESULT');
  const changeSetSha256 = snapshotSha256(raw.changeSetSha256, 'merge.changeSetSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const sourceVisibilitySha256 = snapshotSha256(raw.sourceVisibilitySha256, 'merge.sourceVisibilitySha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const buildTestEvidenceSha256 = snapshotSha256(raw.buildTestEvidenceSha256, 'merge.buildTestEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const reviewEvidenceSha256 = snapshotSha256(raw.reviewEvidenceSha256, 'merge.reviewEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  const mergeGateSha256 = snapshotSha256(raw.mergeGateSha256, 'merge.mergeGateSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
  if (typeof raw.outcome !== 'string' || !TASK_MERGE_OUTCOMES.includes(raw.outcome as TaskMergeOutcomeDto)) {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', "Field 'merge.outcome' must be 'merged' or 'already-merged'");
  }
  const mergeResultSha256 = snapshotSha256(raw.mergeResultSha256, 'merge.mergeResultSha256', 'MALFORMED_REVIEW_DECISION_RESULT');

  return Object.freeze({
    version: 1,
    taskId,
    targetBranch,
    baseCommit,
    taskHeadCommit,
    targetHeadBefore,
    targetHeadAfter,
    changeSetSha256,
    sourceVisibilitySha256,
    buildTestEvidenceSha256,
    reviewEvidenceSha256,
    mergeGateSha256,
    outcome: raw.outcome as TaskMergeOutcomeDto,
    mergeResultSha256
  });
}

export function snapshotReviewDecisionLifecycleResult(raw: unknown): ReviewDecisionLifecycleDto {
  if (!isRecord(raw) || typeof raw.outcome !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', 'Review decision result must be an object with an outcome discriminator');
  }

  if (raw.outcome === 'review-ready') {
    return snapshotExecuteReviewReadyDto(raw);
  }

  if (raw.outcome === 'blocked' || raw.outcome === 'waiting-input' || raw.outcome === 'failed') {
    rejectUnexpectedKeys(raw, ALLOWED_REVIEW_TERMINAL_KEYS, 'MALFORMED_REVIEW_DECISION_RESULT', 'terminal outcome');
    const result: {
      outcome: 'blocked' | 'waiting-input' | 'failed';
      taskId: string;
      assignmentId: string;
      lifecycleSha256: string;
      reviewEvidenceSha256?: string;
    } = {
      outcome: raw.outcome,
      taskId: snapshotManagedExecuteTaskId(raw.taskId, 'taskId'),
      assignmentId: snapshotBoundedText(raw.assignmentId, 'assignmentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_REVIEW_DECISION_RESULT', true),
      lifecycleSha256: snapshotSha256(raw.lifecycleSha256, 'lifecycleSha256', 'MALFORMED_REVIEW_DECISION_RESULT')
    };
    if ('reviewEvidenceSha256' in raw && raw.reviewEvidenceSha256 !== undefined) {
      result.reviewEvidenceSha256 = snapshotSha256(raw.reviewEvidenceSha256, 'reviewEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT');
    }
    return Object.freeze(result);
  }

  if (raw.outcome === 'completed-no-change') {
    rejectUnexpectedKeys(raw, ALLOWED_COMPLETED_NO_CHANGE_KEYS, 'MALFORMED_REVIEW_DECISION_RESULT', 'completed-no-change');
    return Object.freeze({
      outcome: 'completed-no-change' as const,
      taskId: snapshotManagedExecuteTaskId(raw.taskId, 'taskId'),
      lifecycleSha256: snapshotSha256(raw.lifecycleSha256, 'lifecycleSha256', 'MALFORMED_REVIEW_DECISION_RESULT'),
      reviewEvidenceSha256: snapshotSha256(raw.reviewEvidenceSha256, 'reviewEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT')
    });
  }

  if (raw.outcome === 'merge-denied') {
    rejectUnexpectedKeys(raw, ALLOWED_MERGE_DENIED_KEYS, 'MALFORMED_REVIEW_DECISION_RESULT', 'merge-denied');
    return Object.freeze({
      outcome: 'merge-denied' as const,
      taskId: snapshotManagedExecuteTaskId(raw.taskId, 'taskId'),
      lifecycleSha256: snapshotSha256(raw.lifecycleSha256, 'lifecycleSha256', 'MALFORMED_REVIEW_DECISION_RESULT'),
      reviewEvidenceSha256: snapshotSha256(raw.reviewEvidenceSha256, 'reviewEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT'),
      mergeGate: snapshotMergeGateDto(raw.mergeGate)
    });
  }

  if (raw.outcome === 'completed') {
    rejectUnexpectedKeys(raw, ALLOWED_COMPLETED_KEYS, 'MALFORMED_REVIEW_DECISION_RESULT', 'completed');
    return Object.freeze({
      outcome: 'completed' as const,
      taskId: snapshotManagedExecuteTaskId(raw.taskId, 'taskId'),
      lifecycleSha256: snapshotSha256(raw.lifecycleSha256, 'lifecycleSha256', 'MALFORMED_REVIEW_DECISION_RESULT'),
      reviewEvidenceSha256: snapshotSha256(raw.reviewEvidenceSha256, 'reviewEvidenceSha256', 'MALFORMED_REVIEW_DECISION_RESULT'),
      mergeGate: snapshotMergeGateDto(raw.mergeGate),
      merge: snapshotTaskMergeResultDto(raw.merge)
    });
  }

  throw new AgentHubValidationError('MALFORMED_REVIEW_DECISION_RESULT', `Unknown review decision outcome '${raw.outcome}'`);
}

export const AGENT_AUTHORITIES: readonly AgentAuthorityDto[] = Object.freeze([
  'READ_ONLY',
  'STANDARD',
  'PRIVILEGED',
  'ADMIN'
]);

export const KNOWN_AGENT_PROVIDER_IDS = Object.freeze([
  'claude',
  'codex',
  'cursor',
  'antigravity'
] as const);

export type KnownAgentProviderId = (typeof KNOWN_AGENT_PROVIDER_IDS)[number];

export const ACTIONABLE_AGENT_PROVIDER_IDS = KNOWN_AGENT_PROVIDER_IDS;

export interface CreateAgentInputDto {
  readonly projectId: string | null;
  readonly name: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly position: string;
  readonly allowedComplexities: readonly TaskComplexity[];
  readonly allowedRiskLevels: readonly TaskRisk[];
  readonly capabilities: readonly string[];
  readonly specialties: readonly string[];
  readonly authority: AgentAuthorityDto;
  readonly routingPriority: number;
  readonly enabled: boolean;
}

export interface CreateAgentRequestDto {
  readonly mutationId: string;
  readonly input: CreateAgentInputDto;
}

export interface UpdateAgentInputDto {
  readonly name: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly position: string;
  readonly allowedComplexities: readonly TaskComplexity[];
  readonly allowedRiskLevels: readonly TaskRisk[];
  readonly capabilities: readonly string[];
  readonly specialties: readonly string[];
  readonly authority: AgentAuthorityDto;
  readonly routingPriority: number;
}

export interface UpdateAgentRequestDto {
  readonly mutationId: string;
  readonly agentId: string;
  readonly input: UpdateAgentInputDto;
}

export interface AgentActionRequestDto {
  readonly mutationId: string;
  readonly agentId: string;
}

export interface AgentDeleteDto {
  readonly agentId: string;
  readonly deleted: true;
}

export type AgentMutationAppliedPayload =
  | {
      readonly operation: 'create' | 'update' | 'enable' | 'disable';
      readonly agent: AgentDto;
    }
  | {
      readonly operation: 'delete';
      readonly agentId: string;
      readonly deleted: true;
    };

export type AgentMutationResult =
  | {
      readonly status: 'applied';
      readonly payload: AgentMutationAppliedPayload;
      readonly stateSynchronized: true;
    }
  | {
      readonly status: 'applied';
      readonly payload: AgentMutationAppliedPayload;
      readonly stateSynchronized: false;
      readonly warning: {
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
    }
  | {
      readonly status: 'ambiguous';
      readonly retryable: boolean;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

const ALLOWED_CREATE_AGENT_INPUT_KEYS = new Set([
  'projectId', 'name', 'providerId', 'modelId', 'position',
  'allowedComplexities', 'allowedRiskLevels', 'capabilities', 'specialties',
  'authority', 'routingPriority', 'enabled'
]);
const ALLOWED_UPDATE_AGENT_INPUT_KEYS = new Set([
  'name', 'providerId', 'modelId', 'position',
  'allowedComplexities', 'allowedRiskLevels', 'capabilities', 'specialties',
  'authority', 'routingPriority'
]);
const ALLOWED_CREATE_AGENT_REQUEST_KEYS = new Set(['mutationId', 'input']);
const ALLOWED_UPDATE_AGENT_REQUEST_KEYS = new Set(['mutationId', 'agentId', 'input']);
const ALLOWED_AGENT_ACTION_REQUEST_KEYS = new Set(['mutationId', 'agentId']);
const ALLOWED_AGENT_DELETE_KEYS = new Set(['agentId', 'deleted']);

function snapshotExactBoundedText(value: unknown, fieldName: string, maxBytes: number): string {
  if (typeof value !== 'string') {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must be a string`);
  }
  rejectIfContainsNul(value, fieldName);
  if (value.trim().length === 0 || value !== value.trim()) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must be a non-blank string without surrounding whitespace`);
  }
  if (getUtf8Bytes(value) > maxBytes) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' exceeds maximum length (${maxBytes} bytes)`);
  }
  return value;
}

function snapshotExactEnum<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function snapshotUniqueBoundedStringArray(
  value: unknown,
  fieldName: string,
  maxItems: number,
  maxItemBytes: number
): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must be an array with at most ${maxItems} items`);
  }
  const items = value.map((item, index) => snapshotExactBoundedText(item, `${fieldName}[${index}]`, maxItemBytes));
  if (new Set(items).size !== items.length) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must not contain duplicates`);
  }
  return Object.freeze([...items]);
}

function snapshotEnumArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[]
): readonly T[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must be an array with at most 256 items`);
  }
  const items = value.map((item, index) => snapshotExactEnum(item, `${fieldName}[${index}]`, allowed));
  if (new Set(items).size !== items.length) {
    throw new AgentHubValidationError('MALFORMED_INPUT', `Field '${fieldName}' must not contain duplicates`);
  }
  return Object.freeze([...items]);
}

export function snapshotCreateAgentInput(raw: unknown): CreateAgentInputDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Create Agent input must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_CREATE_AGENT_INPUT_KEYS, 'MALFORMED_INPUT', 'create Agent input');
  if (typeof raw.enabled !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'enabled' must be a boolean");
  }
  if (typeof raw.routingPriority !== 'number' || !Number.isSafeInteger(raw.routingPriority) || raw.routingPriority < 0) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'routingPriority' must be a nonnegative safe integer");
  }
  const projectId = raw.projectId === null ? null : snapshotExactBoundedText(raw.projectId, 'projectId', 256);
  return Object.freeze({
    projectId,
    name: snapshotExactBoundedText(raw.name, 'name', 256),
    providerId: snapshotExactBoundedText(raw.providerId, 'providerId', 128),
    modelId: snapshotExactBoundedText(raw.modelId, 'modelId', 512),
    position: snapshotExactBoundedText(raw.position, 'position', 256),
    allowedComplexities: snapshotEnumArray(raw.allowedComplexities, 'allowedComplexities', TASK_COMPLEXITIES),
    allowedRiskLevels: snapshotEnumArray(raw.allowedRiskLevels, 'allowedRiskLevels', TASK_RISKS),
    capabilities: snapshotUniqueBoundedStringArray(raw.capabilities, 'capabilities', 256, 512),
    specialties: snapshotUniqueBoundedStringArray(raw.specialties, 'specialties', 256, 512),
    authority: snapshotExactEnum(raw.authority, 'authority', AGENT_AUTHORITIES),
    routingPriority: raw.routingPriority,
    enabled: raw.enabled
  });
}

export function snapshotUpdateAgentInput(raw: unknown): UpdateAgentInputDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Update Agent input must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_UPDATE_AGENT_INPUT_KEYS, 'MALFORMED_INPUT', 'update Agent input');
  if (typeof raw.routingPriority !== 'number' || !Number.isSafeInteger(raw.routingPriority) || raw.routingPriority < 0) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'routingPriority' must be a nonnegative safe integer");
  }
  return Object.freeze({
    name: snapshotExactBoundedText(raw.name, 'name', 256),
    providerId: snapshotExactBoundedText(raw.providerId, 'providerId', 128),
    modelId: snapshotExactBoundedText(raw.modelId, 'modelId', 512),
    position: snapshotExactBoundedText(raw.position, 'position', 256),
    allowedComplexities: snapshotEnumArray(raw.allowedComplexities, 'allowedComplexities', TASK_COMPLEXITIES),
    allowedRiskLevels: snapshotEnumArray(raw.allowedRiskLevels, 'allowedRiskLevels', TASK_RISKS),
    capabilities: snapshotUniqueBoundedStringArray(raw.capabilities, 'capabilities', 256, 512),
    specialties: snapshotUniqueBoundedStringArray(raw.specialties, 'specialties', 256, 512),
    authority: snapshotExactEnum(raw.authority, 'authority', AGENT_AUTHORITIES),
    routingPriority: raw.routingPriority
  });
}

export function snapshotCreateAgentRequest(raw: unknown): CreateAgentRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Create Agent request must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_CREATE_AGENT_REQUEST_KEYS, 'MALFORMED_REQUEST', 'create Agent request');
  if (typeof raw.mutationId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'mutationId' must be a string");
  }
  return Object.freeze({
    mutationId: raw.mutationId,
    input: snapshotCreateAgentInput(raw.input)
  });
}

export function snapshotUpdateAgentRequest(raw: unknown): UpdateAgentRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Update Agent request must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_UPDATE_AGENT_REQUEST_KEYS, 'MALFORMED_REQUEST', 'update Agent request');
  if (typeof raw.mutationId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'mutationId' must be a string");
  }
  return Object.freeze({
    mutationId: raw.mutationId,
    agentId: snapshotExactBoundedText(raw.agentId, 'agentId', 256),
    input: snapshotUpdateAgentInput(raw.input)
  });
}

export function snapshotAgentActionRequest(raw: unknown): AgentActionRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Agent action request must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_AGENT_ACTION_REQUEST_KEYS, 'MALFORMED_REQUEST', 'Agent action request');
  if (typeof raw.mutationId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'mutationId' must be a string");
  }
  return Object.freeze({
    mutationId: raw.mutationId,
    agentId: snapshotExactBoundedText(raw.agentId, 'agentId', 256)
  });
}

export function snapshotAgentDeleteDto(raw: unknown): AgentDeleteDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_AGENT_DELETE', 'Agent delete result must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_AGENT_DELETE_KEYS, 'MALFORMED_AGENT_DELETE', 'Agent delete result');
  if (raw.deleted !== true) {
    throw new AgentHubValidationError('MALFORMED_AGENT_DELETE', "Field 'deleted' must be true");
  }
  return Object.freeze({
    agentId: parseRequiredNonBlankString(raw, 'agentId'),
    deleted: true as const
  });
}

export type ProviderRuntimeStatus =
  | 'READY'
  | 'EXECUTABLE_NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'PROBE_FAILED'
  | 'PROBE_TIMEOUT';

export const PROVIDER_RUNTIME_STATUSES: readonly ProviderRuntimeStatus[] = Object.freeze([
  'READY',
  'EXECUTABLE_NOT_FOUND',
  'AUTH_REQUIRED',
  'PROBE_FAILED',
  'PROBE_TIMEOUT'
]);

export interface ProviderModelDto {
  readonly modelId: string;
  readonly label: string;
}

export interface ProviderCapabilitiesDto {
  readonly outputProtocols: readonly ('manager-directive' | 'worker-result')[];
  readonly sessionContinuation: boolean;
}

export interface ProviderDto {
  readonly providerId: string;
  readonly supported: true;
  readonly usable: boolean;
  readonly installed: boolean;
  readonly authenticated: boolean | null;
  readonly version: string | null;
  readonly status: ProviderRuntimeStatus;
  readonly capabilities: ProviderCapabilitiesDto;
  readonly modelDiscovery: 'native' | 'unavailable';
  readonly models: readonly ProviderModelDto[];
  readonly checkedAt: string;
}

const ALLOWED_PROVIDER_KEYS: ReadonlySet<string> = new Set([
  'providerId',
  'supported',
  'usable',
  'installed',
  'authenticated',
  'version',
  'status',
  'capabilities',
  'modelDiscovery',
  'models',
  'checkedAt'
]);

const ALLOWED_PROVIDER_CAPABILITY_KEYS: ReadonlySet<string> = new Set([
  'outputProtocols',
  'sessionContinuation'
]);

const ALLOWED_PROVIDER_MODEL_KEYS: ReadonlySet<string> = new Set([
  'modelId',
  'label'
]);

const FORBIDDEN_PRIVATE_KEYS = Object.freeze(new Set([
  'env',
  'environment',
  'filepath',
  'executablepath',
  'command',
  'args',
  'token',
  'secret',
  'credential',
  'key',
  'apikey',
  'session',
  'sessionid',
  'conversationid',
  'rawerror',
  'stderr',
  'stdout'
]));

function assertNoForbiddenPrivateKeys(record: Record<string, unknown>, context: string): void {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PRIVATE_KEYS.has(key.toLowerCase())) {
      throw new AgentHubValidationError('FORBIDDEN_PROVIDER_DATA', `Forbidden private field '${key}' detected in ${context}`);
    }
  }
}

export function snapshotProviderModelDto(raw: unknown): ProviderModelDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER_MODEL', 'Provider model must be an object');
  }
  assertNoForbiddenPrivateKeys(raw, 'provider model');
  rejectUnexpectedKeys(raw, ALLOWED_PROVIDER_MODEL_KEYS, 'MALFORMED_PROVIDER_MODEL', 'Provider model');
  return Object.freeze({
    modelId: snapshotExactBoundedText(raw.modelId, 'modelId', 512),
    label: snapshotExactBoundedText(raw.label, 'label', 512)
  });
}

export function snapshotProviderDto(raw: unknown): ProviderDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', 'Provider entry must be an object');
  }
  assertNoForbiddenPrivateKeys(raw, 'provider entry');
  rejectUnexpectedKeys(raw, ALLOWED_PROVIDER_KEYS, 'MALFORMED_PROVIDER', 'Provider entry');

  const providerId = parseRequiredNonBlankString(raw, 'providerId');
  if (raw.supported !== true) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'supported' must be true");
  }
  if (typeof raw.usable !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'usable' must be boolean");
  }
  if (typeof raw.installed !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'installed' must be boolean");
  }
  if (raw.authenticated !== null && typeof raw.authenticated !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'authenticated' must be boolean or null");
  }
  const version = raw.version === null ? null : snapshotExactBoundedText(raw.version, 'version', 64);

  if (typeof raw.status !== 'string' || !(PROVIDER_RUNTIME_STATUSES as readonly string[]).includes(raw.status)) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', `Unknown provider status '${String(raw.status)}'`);
  }
  const status = raw.status as ProviderRuntimeStatus;

  if (!isRecord(raw.capabilities)) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'capabilities' must be an object");
  }
  assertNoForbiddenPrivateKeys(raw.capabilities, 'provider capabilities');
  rejectUnexpectedKeys(raw.capabilities, ALLOWED_PROVIDER_CAPABILITY_KEYS, 'MALFORMED_PROVIDER', 'Provider capabilities');

  if (!Array.isArray(raw.capabilities.outputProtocols)) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'capabilities.outputProtocols' must be an array");
  }
  const allowedProtocols = ['manager-directive', 'worker-result'] as const;
  const outputProtocols = raw.capabilities.outputProtocols.map((p) => {
    if (typeof p !== 'string' || !(allowedProtocols as readonly string[]).includes(p)) {
      throw new AgentHubValidationError('MALFORMED_PROVIDER', `Unknown output protocol '${String(p)}'`);
    }
    return p as (typeof allowedProtocols)[number];
  });
  if (typeof raw.capabilities.sessionContinuation !== 'boolean') {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'capabilities.sessionContinuation' must be boolean");
  }
  const capabilities: ProviderCapabilitiesDto = Object.freeze({
    outputProtocols: Object.freeze(outputProtocols),
    sessionContinuation: raw.capabilities.sessionContinuation
  });

  if (raw.modelDiscovery !== 'native' && raw.modelDiscovery !== 'unavailable') {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'modelDiscovery' must be 'native' or 'unavailable'");
  }

  if (!Array.isArray(raw.models) || raw.models.length > 512) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER', "Provider 'models' must be an array with at most 512 entries");
  }
  const models = Object.freeze(raw.models.map((m) => snapshotProviderModelDto(m)));

  const checkedAt = parseRequiredNonBlankString(raw, 'checkedAt');

  return Object.freeze({
    providerId,
    supported: true as const,
    usable: raw.usable,
    installed: raw.installed,
    authenticated: raw.authenticated,
    version,
    status,
    capabilities,
    modelDiscovery: raw.modelDiscovery,
    models,
    checkedAt
  });
}

export function snapshotProviderCatalog(raw: unknown): readonly ProviderDto[] {
  if (!Array.isArray(raw)) {
    throw new AgentHubValidationError('MALFORMED_PROVIDER_CATALOG', 'Provider catalog must be an array');
  }
  return Object.freeze(raw.map((item) => snapshotProviderDto(item)));
}

export function formatProviderStatus(status: ProviderRuntimeStatus): string {
  switch (status) {
    case 'READY':
      return 'Ready';
    case 'EXECUTABLE_NOT_FOUND':
      return 'CLI Not Found';
    case 'AUTH_REQUIRED':
      return 'Login Required';
    case 'PROBE_FAILED':
      return 'Probe Failed';
    case 'PROBE_TIMEOUT':
      return 'Probe Timed Out';
    default:
      return status;
  }
}

export function isProviderUsable(providerId: string, catalog: readonly ProviderDto[] | null): boolean {
  if (!catalog) {
    return providerId === 'claude' || providerId === 'codex';
  }
  const entry = catalog.find((p) => p.providerId === providerId);
  return Boolean(entry?.usable && entry?.status === 'READY');
}
