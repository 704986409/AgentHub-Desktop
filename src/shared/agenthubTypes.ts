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
  readonly reviewEvidenceSha256?: string;
  readonly merge?: AgentHubPublicValue;
  readonly mergeGate?: AgentHubPublicValue;
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
const COMMAND_ID_MAX_BYTES = 256;
const COMMAND_PREVIEW_MAX_BYTES = 1024 * 1024;
const BRANCH_NAME_MAX_BYTES = 4096;
const REVIEW_HANDLE_MAX_BYTES = 256;

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
  forbidNul = true
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
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new AgentHubValidationError(code, `Elements in '${fieldName}' must be strings`);
    }
    rejectIfContainsNul(item, fieldName, code);
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
  'lifecycleSha256',
  'reviewEvidenceSha256',
  'merge',
  'mergeGate'
]);

function snapshotExecuteWorkerResult(raw: unknown): ExecuteWorkerResultDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', 'workerResult must be an object');
  }
  rejectUnexpectedKeys(raw, ALLOWED_WORKER_RESULT_KEYS, 'MALFORMED_EXECUTE_RESULT', 'workerResult');
  return Object.freeze({
    summary: snapshotBoundedChars(raw.summary, 'workerResult.summary', WORKER_SUMMARY_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false, false),
    blockers: snapshotBoundedCharStringArray(raw.blockers, 'workerResult.blockers', WORKER_BLOCKERS_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false),
    questions: snapshotBoundedCharStringArray(raw.questions, 'workerResult.questions', WORKER_QUESTIONS_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false),
    risks: snapshotBoundedCharStringArray(raw.risks, 'workerResult.risks', WORKER_RISKS_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false),
    notes: snapshotBoundedCharStringArray(raw.notes, 'workerResult.notes', WORKER_NOTES_MAX_ITEMS, WORKER_ITEM_MAX_CHARS, 'MALFORMED_EXECUTE_RESULT', false)
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
    id: snapshotBoundedText(raw.id, 'command.id', COMMAND_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    phase: raw.phase as ExecuteCommandPhase,
    outcome: raw.outcome as ExecuteCommandOutcome,
    stdoutPreview: snapshotBoundedText(raw.stdoutPreview, 'command.stdoutPreview', COMMAND_PREVIEW_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', false),
    stderrPreview: snapshotBoundedText(raw.stderrPreview, 'command.stderrPreview', COMMAND_PREVIEW_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', false)
  };
  if ('exitCode' in raw) {
    if (typeof raw.exitCode !== 'number' || !Number.isSafeInteger(raw.exitCode)) {
      throw new AgentHubValidationError('MALFORMED_EXECUTE_RESULT', "Field 'command.exitCode' must be a finite safe integer when present");
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
  return Object.freeze({
    build: raw.build as ExecuteBuildTestStatus,
    test: raw.test as ExecuteBuildTestStatus,
    outcome: raw.outcome as ExecuteEvidenceOutcome,
    commands: Object.freeze(raw.commands.map(snapshotExecuteCommand))
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
  return Object.freeze({
    outcome: 'review-ready' as const,
    reviewHandle: snapshotBoundedText(raw.reviewHandle, 'reviewHandle', REVIEW_HANDLE_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    reviewBundleSha256: snapshotSha256(raw.reviewBundleSha256, 'reviewBundleSha256', 'MALFORMED_EXECUTE_RESULT'),
    taskId: snapshotBoundedText(raw.taskId, 'taskId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    assignmentId: snapshotBoundedText(raw.assignmentId, 'assignmentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    agentId: snapshotBoundedText(raw.agentId, 'agentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    providerId: snapshotBoundedText(raw.providerId, 'providerId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    workerResult: snapshotExecuteWorkerResult(raw.workerResult),
    source: snapshotExecuteSource(raw.source),
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
  const dto: {
    outcome: ExecuteTerminalLifecycleDto['outcome'];
    taskId: string;
    assignmentId: string;
    lifecycleSha256: string;
    reviewEvidenceSha256?: string;
    merge?: AgentHubPublicValue;
    mergeGate?: AgentHubPublicValue;
  } = {
    outcome: raw.outcome as ExecuteTerminalLifecycleDto['outcome'],
    taskId: snapshotBoundedText(raw.taskId, 'taskId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    assignmentId: snapshotBoundedText(raw.assignmentId, 'assignmentId', EXECUTE_ID_MAX_BYTES, 'MALFORMED_EXECUTE_RESULT', true),
    lifecycleSha256: snapshotSha256(raw.lifecycleSha256, 'lifecycleSha256', 'MALFORMED_EXECUTE_RESULT')
  };
  if ('reviewEvidenceSha256' in raw) {
    dto.reviewEvidenceSha256 = snapshotSha256(raw.reviewEvidenceSha256, 'reviewEvidenceSha256', 'MALFORMED_EXECUTE_RESULT');
  }
  if ('merge' in raw) {
    dto.merge = sanitizeEventPayload(raw.merge);
  }
  if ('mergeGate' in raw) {
    dto.mergeGate = sanitizeEventPayload(raw.mergeGate);
  }
  return Object.freeze(dto);
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
