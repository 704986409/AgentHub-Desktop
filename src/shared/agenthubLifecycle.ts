import {
  AgentHubValidationError,
  parseFiniteNumber,
  parseRequiredNonBlankString,
  parseRequiredNullableString,
  parseRequiredStringArray,
  TASK_COMPLEXITIES,
  TASK_RISKS,
  type TaskComplexity,
  type TaskRisk
} from './agenthubTypes';

export const LIFECYCLE_SUPPORTED_BACKEND_VERSIONS = Object.freeze(['0.7.3D'] as const);
export type LifecycleSupportedBackendVersion = (typeof LIFECYCLE_SUPPORTED_BACKEND_VERSIONS)[number];

export const HUMAN_BOSS_ACTOR_ID = 'human-boss';
export const HUMAN_BOSS_CREATED_BY = HUMAN_BOSS_ACTOR_ID;

export const PLAN_STATES = Object.freeze([
  'WAITING_APPROVAL',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'EXECUTING',
  'REVIEWING',
  'COMPLETED',
  'FAILED'
] as const);
export type PlanState = (typeof PLAN_STATES)[number];

export const PLAN_DECISIONS = Object.freeze(['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const);
export type PlanDecision = (typeof PLAN_DECISIONS)[number];

export const PLAN_DEPENDENCY_STATES = Object.freeze(['BLOCKED', 'ELIGIBLE', 'SATISFIED'] as const);
export type PlanDependencyState = (typeof PLAN_DEPENDENCY_STATES)[number];

export const PLAN_TASK_RUNTIME_STATES = Object.freeze([
  'PENDING',
  'BLOCKED',
  'ELIGIBLE',
  'RUNNING',
  'REVIEWING',
  'WAITING_INPUT',
  'PAUSED',
  'COMPLETED',
  'FAILED'
] as const);
export type PlanTaskRuntimeState = (typeof PLAN_TASK_RUNTIME_STATES)[number];

export function isLifecycleCompatibleBackendVersion(version: string): boolean {
  return (LIFECYCLE_SUPPORTED_BACKEND_VERSIONS as readonly string[]).includes(version);
}

export interface CreatePlanTaskInputDto {
  readonly clientId: string;
  readonly parentClientId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly requiredSpecialties: readonly string[];
  readonly complexity: TaskComplexity;
  readonly risk: TaskRisk;
}

export interface CreatePlanDependencyInputDto {
  readonly prerequisiteClientId: string;
  readonly dependentClientId: string;
}

export interface CreateIntakeInputDto {
  readonly projectId: string;
  readonly createdBy: string;
  readonly goal: string;
  readonly leadAgentId: string;
}

export interface CreatePlanInputDto {
  readonly intakeId: string;
  readonly leadAgentId: string;
  readonly summary: string;
  readonly tasks: readonly CreatePlanTaskInputDto[];
  readonly dependencies: readonly CreatePlanDependencyInputDto[];
}

export interface CreatePlanRevisionInputDto {
  readonly basedOnVersion: number;
  readonly leadAgentId: string;
  readonly summary: string;
  readonly tasks: readonly CreatePlanTaskInputDto[];
  readonly dependencies: readonly CreatePlanDependencyInputDto[];
}

export interface PlanDecisionInputDto {
  readonly planVersion: number;
  readonly proposalHash: string;
  readonly actorId: string;
  readonly summary: string;
}

export interface StartPlanInputDto {
  readonly planVersion: number;
  readonly proposalHash: string;
}

export interface IntakeDto {
  readonly intakeId: string;
  readonly projectId: string;
  readonly createdBy: string;
  readonly goal: string;
  readonly leadAgentId: string;
  readonly createdAt: string;
}

export interface PlanTaskDefinitionDto {
  readonly planTaskId: string;
  readonly clientId: string;
  readonly parentPlanTaskId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly requiredSpecialties: readonly string[];
  readonly complexity: TaskComplexity;
  readonly risk: TaskRisk;
}

export interface PlanTaskRuntimeDto extends PlanTaskDefinitionDto {
  readonly planId: string;
  readonly planVersion: number;
  readonly runtimeTaskId: string | null;
  readonly assignmentId: string | null;
  readonly agentId: string | null;
  readonly dependencyState: PlanDependencyState;
  readonly blockedBy: readonly string[];
  readonly runtimeState: PlanTaskRuntimeState;
}

export interface PlanDependencyDto {
  readonly prerequisitePlanTaskId: string;
  readonly dependentPlanTaskId: string;
}

export interface PlanVersionDto {
  readonly planId: string;
  readonly version: number;
  readonly proposalHash: string;
  readonly leadAgentId: string;
  readonly summary: string;
  readonly tasks: readonly PlanTaskDefinitionDto[];
  readonly dependencies: readonly PlanDependencyDto[];
  readonly createdAt: string;
}

export interface PlanApprovalDecisionDto {
  readonly decisionId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly proposalHash: string;
  readonly decision: PlanDecision;
  readonly actorId: string;
  readonly summary: string;
  readonly decidedAt: string;
}

export interface PlanAggregateDto {
  readonly total: number;
  readonly pending: number;
  readonly blocked: number;
  readonly eligible: number;
  readonly running: number;
  readonly reviewing: number;
  readonly completed: number;
  readonly failed: number;
  readonly state: PlanState;
}

export interface PlanDto {
  readonly planId: string;
  readonly intakeId: string;
  readonly projectId: string;
  readonly leadAgentId: string;
  readonly currentVersion: number;
  readonly state: PlanState;
  readonly current: PlanVersionDto;
  readonly tasks: readonly PlanTaskRuntimeDto[];
  readonly dependencies: readonly PlanDependencyDto[];
  readonly decisions: readonly PlanApprovalDecisionDto[];
  readonly aggregate: PlanAggregateDto;
  readonly startedVersion: number | null;
  readonly startedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CreateIntakeRequestDto {
  readonly mutationId: string;
  readonly input: CreateIntakeInputDto;
}

export interface CreatePlanRequestDto {
  readonly mutationId: string;
  readonly input: CreatePlanInputDto;
}

export interface CreatePlanRevisionRequestDto {
  readonly mutationId: string;
  readonly planId: string;
  readonly input: CreatePlanRevisionInputDto;
}

export interface PlanDecisionRequestDto {
  readonly mutationId: string;
  readonly planId: string;
  readonly input: PlanDecisionInputDto;
}

export interface StartPlanRequestDto {
  readonly mutationId: string;
  readonly planId: string;
  readonly input: StartPlanInputDto;
}

export type LifecycleMutationResult =
  | { readonly status: 'applied'; readonly stateSynchronized: true }
  | {
      readonly status: 'applied';
      readonly stateSynchronized: false;
      readonly warning: { readonly code: string; readonly message: string };
    }
  | {
      readonly status: 'failed';
      readonly retryable: false;
      readonly error: { readonly code: string; readonly message: string };
    }
  | {
      readonly status: 'ambiguous';
      readonly retryable: true;
      readonly error: { readonly code: string; readonly message: string };
    };

export const EMPTY_LIFECYCLE_SNAPSHOT = Object.freeze({
  intakes: Object.freeze([]) as readonly IntakeDto[],
  plans: Object.freeze([]) as readonly PlanDto[],
  planTasks: Object.freeze([]) as readonly PlanTaskRuntimeDto[],
  planDependencies: Object.freeze([]) as readonly PlanDependencyDto[]
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function rejectUnexpectedKeys(raw: Record<string, unknown>, allowed: readonly string[], code: string, context: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new AgentHubValidationError(code, `Unexpected key in ${context}: '${key}'`);
    }
  }
}

function boundedText(value: unknown, fieldName: string, maxBytes: number, nonBlank: boolean, code = 'MALFORMED_INPUT'): string {
  if (typeof value !== 'string') {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a string`);
  }
  if (value.includes('\0')) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must not contain NUL`);
  }
  if (nonBlank && value.trim().length === 0) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a non-blank string`);
  }
  if (utf8Bytes(value) > maxBytes) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' exceeds maximum length (${maxBytes} bytes)`);
  }
  return value;
}

function exactBoundedText(value: unknown, fieldName: string, maxBytes: number, code = 'MALFORMED_INPUT'): string {
  const text = boundedText(value, fieldName, maxBytes, true, code);
  if (text !== text.trim()) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a non-blank string without surrounding whitespace`);
  }
  return text;
}

function boundedStringArray(
  value: unknown,
  fieldName: string,
  maxItems: number,
  maxItemBytes: number,
  code = 'MALFORMED_INPUT'
): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be an array with at most ${maxItems} items`);
  }
  return Object.freeze(value.map((item, index) => boundedText(item, `${fieldName}[${index}]`, maxItemBytes, true, code)));
}

function snapshotEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
  code: string
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function snapshotPositiveVersion(value: unknown, fieldName: string, code = 'MALFORMED_INPUT'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a positive safe integer`);
  }
  return value;
}

function parseOptionalText(record: Record<string, unknown>, fieldName: string, code: string): string {
  if (!(fieldName in record) || record[fieldName] === undefined) {
    throw new AgentHubValidationError(code, `Required field '${fieldName}' is missing`);
  }
  const value = record[fieldName];
  if (typeof value !== 'string') {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a string`);
  }
  return value;
}

function snapshotNonNegativeInteger(record: Record<string, unknown>, fieldName: string, code: string): number {
  const value = parseFiniteNumber(record, fieldName);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be a non-negative integer`);
  }
  return value;
}

function snapshotProposalHash(value: unknown, fieldName: string, code: string): string {
  const hash = exactBoundedText(value, fieldName, 64, code);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new AgentHubValidationError(code, `Field '${fieldName}' must be 64 lowercase hex characters`);
  }
  return hash;
}

function snapshotMutationId(raw: Record<string, unknown>): string {
  if (typeof raw.mutationId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_REQUEST', "Field 'mutationId' must be a string");
  }
  return raw.mutationId;
}

function snapshotPlanPathId(value: unknown, fieldName = 'planId'): string {
  return exactBoundedText(value, fieldName, 256, 'MALFORMED_REQUEST');
}

export function snapshotCreatePlanTaskInput(value: unknown): CreatePlanTaskInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Plan task input must be an object');
  }
  rejectUnexpectedKeys(value, [
    'clientId',
    'parentClientId',
    'title',
    'description',
    'acceptanceCriteria',
    'requiredCapabilities',
    'requiredSpecialties',
    'complexity',
    'risk'
  ], 'MALFORMED_INPUT', 'plan task input');
  if (value.parentClientId !== null && typeof value.parentClientId !== 'string') {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'parentClientId' must be a string or null");
  }
  if (value.description !== null && typeof value.description !== 'string') {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'description' must be a string or null");
  }
  return Object.freeze({
    clientId: exactBoundedText(value.clientId, 'clientId', 256),
    parentClientId: value.parentClientId === null ? null : exactBoundedText(value.parentClientId, 'parentClientId', 256),
    title: boundedText(value.title, 'title', 16 * 1024, true),
    description: value.description === null ? null : boundedText(value.description, 'description', 128 * 1024, false),
    acceptanceCriteria: boundedStringArray(value.acceptanceCriteria, 'acceptanceCriteria', 256, 8192),
    requiredCapabilities: boundedStringArray(value.requiredCapabilities, 'requiredCapabilities', 256, 512),
    requiredSpecialties: boundedStringArray(value.requiredSpecialties, 'requiredSpecialties', 256, 512),
    complexity: snapshotEnum(value.complexity, 'complexity', TASK_COMPLEXITIES, 'MALFORMED_INPUT'),
    risk: snapshotEnum(value.risk, 'risk', TASK_RISKS, 'MALFORMED_INPUT')
  });
}

export function snapshotCreatePlanDependencyInput(value: unknown): CreatePlanDependencyInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Plan dependency input must be an object');
  }
  rejectUnexpectedKeys(value, ['prerequisiteClientId', 'dependentClientId'], 'MALFORMED_INPUT', 'plan dependency input');
  return Object.freeze({
    prerequisiteClientId: exactBoundedText(value.prerequisiteClientId, 'prerequisiteClientId', 256),
    dependentClientId: exactBoundedText(value.dependentClientId, 'dependentClientId', 256)
  });
}

function snapshotPlanTaskList(value: unknown): readonly CreatePlanTaskInputDto[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'tasks' must be an array with 1 to 1000 items");
  }
  return Object.freeze(value.map((item) => snapshotCreatePlanTaskInput(item)));
}

function snapshotPlanDependencyList(value: unknown): readonly CreatePlanDependencyInputDto[] {
  if (!Array.isArray(value) || value.length > 4000) {
    throw new AgentHubValidationError('MALFORMED_INPUT', "Field 'dependencies' must be an array with at most 4000 items");
  }
  return Object.freeze(value.map((item) => snapshotCreatePlanDependencyInput(item)));
}

export function snapshotCreateIntakeInput(value: unknown): CreateIntakeInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Intake input must be an object');
  }
  rejectUnexpectedKeys(value, ['projectId', 'createdBy', 'goal', 'leadAgentId'], 'MALFORMED_INPUT', 'intake input');
  return Object.freeze({
    projectId: exactBoundedText(value.projectId, 'projectId', 256),
    createdBy: exactBoundedText(value.createdBy, 'createdBy', 256),
    goal: boundedText(value.goal, 'goal', 128 * 1024, true),
    leadAgentId: exactBoundedText(value.leadAgentId, 'leadAgentId', 256)
  });
}

export function snapshotCreatePlanInput(value: unknown): CreatePlanInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Plan input must be an object');
  }
  rejectUnexpectedKeys(value, ['intakeId', 'leadAgentId', 'summary', 'tasks', 'dependencies'], 'MALFORMED_INPUT', 'plan input');
  return Object.freeze({
    intakeId: exactBoundedText(value.intakeId, 'intakeId', 256),
    leadAgentId: exactBoundedText(value.leadAgentId, 'leadAgentId', 256),
    summary: boundedText(value.summary, 'summary', 16 * 1024, true),
    tasks: snapshotPlanTaskList(value.tasks),
    dependencies: snapshotPlanDependencyList(value.dependencies)
  });
}

export function snapshotCreatePlanRevisionInput(value: unknown): CreatePlanRevisionInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Plan revision input must be an object');
  }
  rejectUnexpectedKeys(
    value,
    ['basedOnVersion', 'leadAgentId', 'summary', 'tasks', 'dependencies'],
    'MALFORMED_INPUT',
    'plan revision input'
  );
  return Object.freeze({
    basedOnVersion: snapshotPositiveVersion(value.basedOnVersion, 'basedOnVersion'),
    leadAgentId: exactBoundedText(value.leadAgentId, 'leadAgentId', 256),
    summary: boundedText(value.summary, 'summary', 16 * 1024, true),
    tasks: snapshotPlanTaskList(value.tasks),
    dependencies: snapshotPlanDependencyList(value.dependencies)
  });
}

export function snapshotPlanDecisionInput(value: unknown): PlanDecisionInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Plan decision input must be an object');
  }
  rejectUnexpectedKeys(value, ['planVersion', 'proposalHash', 'actorId', 'summary'], 'MALFORMED_INPUT', 'plan decision input');
  return Object.freeze({
    planVersion: snapshotPositiveVersion(value.planVersion, 'planVersion'),
    proposalHash: snapshotProposalHash(value.proposalHash, 'proposalHash', 'MALFORMED_INPUT'),
    actorId: exactBoundedText(value.actorId, 'actorId', 256),
    summary: boundedText(value.summary, 'summary', 16 * 1024, false)
  });
}

export function snapshotStartPlanInput(value: unknown): StartPlanInputDto {
  if (!isRecord(value)) {
    throw new AgentHubValidationError('MALFORMED_INPUT', 'Plan start input must be an object');
  }
  rejectUnexpectedKeys(value, ['planVersion', 'proposalHash'], 'MALFORMED_INPUT', 'plan start input');
  return Object.freeze({
    planVersion: snapshotPositiveVersion(value.planVersion, 'planVersion'),
    proposalHash: snapshotProposalHash(value.proposalHash, 'proposalHash', 'MALFORMED_INPUT')
  });
}

export function snapshotCreateIntakeRequest(raw: unknown): CreateIntakeRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Create intake request must be an object');
  }
  rejectUnexpectedKeys(raw, ['mutationId', 'input'], 'MALFORMED_REQUEST', 'create intake request');
  return Object.freeze({
    mutationId: snapshotMutationId(raw),
    input: snapshotCreateIntakeInput(raw.input)
  });
}

export function snapshotCreatePlanRequest(raw: unknown): CreatePlanRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Create plan request must be an object');
  }
  rejectUnexpectedKeys(raw, ['mutationId', 'input'], 'MALFORMED_REQUEST', 'create plan request');
  return Object.freeze({
    mutationId: snapshotMutationId(raw),
    input: snapshotCreatePlanInput(raw.input)
  });
}

export function snapshotCreatePlanRevisionRequest(raw: unknown): CreatePlanRevisionRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Create plan revision request must be an object');
  }
  rejectUnexpectedKeys(raw, ['mutationId', 'planId', 'input'], 'MALFORMED_REQUEST', 'create plan revision request');
  return Object.freeze({
    mutationId: snapshotMutationId(raw),
    planId: snapshotPlanPathId(raw.planId),
    input: snapshotCreatePlanRevisionInput(raw.input)
  });
}

export function snapshotPlanDecisionRequest(raw: unknown): PlanDecisionRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Plan decision request must be an object');
  }
  rejectUnexpectedKeys(raw, ['mutationId', 'planId', 'input'], 'MALFORMED_REQUEST', 'plan decision request');
  return Object.freeze({
    mutationId: snapshotMutationId(raw),
    planId: snapshotPlanPathId(raw.planId),
    input: snapshotPlanDecisionInput(raw.input)
  });
}

export function snapshotStartPlanRequest(raw: unknown): StartPlanRequestDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_REQUEST', 'Start plan request must be an object');
  }
  rejectUnexpectedKeys(raw, ['mutationId', 'planId', 'input'], 'MALFORMED_REQUEST', 'start plan request');
  return Object.freeze({
    mutationId: snapshotMutationId(raw),
    planId: snapshotPlanPathId(raw.planId),
    input: snapshotStartPlanInput(raw.input)
  });
}

function snapshotDtoArray<T>(value: unknown, field: string, mapItem: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) {
    throw new AgentHubValidationError('MALFORMED_STATE', `State snapshot missing ${field} array`);
  }
  return Object.freeze(value.map((item) => mapItem(item)));
}

export function snapshotIntakeDto(raw: unknown): IntakeDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_INTAKE', 'Intake must be an object');
  }
  return Object.freeze({
    intakeId: parseRequiredNonBlankString(raw, 'intakeId'),
    projectId: parseRequiredNonBlankString(raw, 'projectId'),
    createdBy: parseRequiredNonBlankString(raw, 'createdBy'),
    goal: parseRequiredNonBlankString(raw, 'goal'),
    leadAgentId: parseRequiredNonBlankString(raw, 'leadAgentId'),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt')
  });
}

export function snapshotPlanTaskDefinitionDto(raw: unknown): PlanTaskDefinitionDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_TASK', 'Plan task definition must be an object');
  }
  return Object.freeze({
    planTaskId: parseRequiredNonBlankString(raw, 'planTaskId'),
    clientId: parseRequiredNonBlankString(raw, 'clientId'),
    parentPlanTaskId: parseRequiredNullableString(raw, 'parentPlanTaskId'),
    title: parseRequiredNonBlankString(raw, 'title'),
    description: parseRequiredNullableString(raw, 'description'),
    acceptanceCriteria: parseRequiredStringArray(raw, 'acceptanceCriteria'),
    requiredCapabilities: parseRequiredStringArray(raw, 'requiredCapabilities'),
    requiredSpecialties: parseRequiredStringArray(raw, 'requiredSpecialties'),
    complexity: snapshotEnum(raw.complexity, 'complexity', TASK_COMPLEXITIES, 'MALFORMED_PLAN_TASK'),
    risk: snapshotEnum(raw.risk, 'risk', TASK_RISKS, 'MALFORMED_PLAN_TASK')
  });
}

export function snapshotPlanTaskRuntimeDto(raw: unknown): PlanTaskRuntimeDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_TASK', 'Plan task runtime must be an object');
  }
  const definition = snapshotPlanTaskDefinitionDto(raw);
  const planVersion = parseFiniteNumber(raw, 'planVersion');
  if (!Number.isSafeInteger(planVersion) || planVersion < 1) {
    throw new AgentHubValidationError('MALFORMED_PLAN_TASK', "Field 'planVersion' must be a positive integer");
  }
  return Object.freeze({
    ...definition,
    planId: parseRequiredNonBlankString(raw, 'planId'),
    planVersion,
    runtimeTaskId: parseRequiredNullableString(raw, 'runtimeTaskId'),
    assignmentId: parseRequiredNullableString(raw, 'assignmentId'),
    agentId: parseRequiredNullableString(raw, 'agentId'),
    dependencyState: snapshotEnum(raw.dependencyState, 'dependencyState', PLAN_DEPENDENCY_STATES, 'MALFORMED_PLAN_TASK'),
    blockedBy: parseRequiredStringArray(raw, 'blockedBy'),
    runtimeState: snapshotEnum(raw.runtimeState, 'runtimeState', PLAN_TASK_RUNTIME_STATES, 'MALFORMED_PLAN_TASK')
  });
}

export function snapshotPlanDependencyDto(raw: unknown): PlanDependencyDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_DEPENDENCY', 'Plan dependency must be an object');
  }
  return Object.freeze({
    prerequisitePlanTaskId: parseRequiredNonBlankString(raw, 'prerequisitePlanTaskId'),
    dependentPlanTaskId: parseRequiredNonBlankString(raw, 'dependentPlanTaskId')
  });
}

export function snapshotPlanVersionDto(raw: unknown): PlanVersionDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_VERSION', 'Plan version must be an object');
  }
  const version = parseFiniteNumber(raw, 'version');
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AgentHubValidationError('MALFORMED_PLAN_VERSION', "Field 'version' must be a positive integer");
  }
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.dependencies)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_VERSION', 'Plan version missing tasks or dependencies array');
  }
  return Object.freeze({
    planId: parseRequiredNonBlankString(raw, 'planId'),
    version,
    proposalHash: snapshotProposalHash(raw.proposalHash, 'proposalHash', 'MALFORMED_PLAN_VERSION'),
    leadAgentId: parseRequiredNonBlankString(raw, 'leadAgentId'),
    summary: parseRequiredNonBlankString(raw, 'summary'),
    tasks: Object.freeze(raw.tasks.map((item) => snapshotPlanTaskDefinitionDto(item))),
    dependencies: Object.freeze(raw.dependencies.map((item) => snapshotPlanDependencyDto(item))),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt')
  });
}

export function snapshotPlanApprovalDecisionDto(raw: unknown): PlanApprovalDecisionDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_DECISION', 'Plan decision must be an object');
  }
  const planVersion = parseFiniteNumber(raw, 'planVersion');
  if (!Number.isSafeInteger(planVersion) || planVersion < 1) {
    throw new AgentHubValidationError('MALFORMED_PLAN_DECISION', "Field 'planVersion' must be a positive integer");
  }
  return Object.freeze({
    decisionId: parseRequiredNonBlankString(raw, 'decisionId'),
    planId: parseRequiredNonBlankString(raw, 'planId'),
    planVersion,
    proposalHash: snapshotProposalHash(raw.proposalHash, 'proposalHash', 'MALFORMED_PLAN_DECISION'),
    decision: snapshotEnum(raw.decision, 'decision', PLAN_DECISIONS, 'MALFORMED_PLAN_DECISION'),
    actorId: parseRequiredNonBlankString(raw, 'actorId'),
    summary: parseOptionalText(raw, 'summary', 'MALFORMED_PLAN_DECISION'),
    decidedAt: parseRequiredNonBlankString(raw, 'decidedAt')
  });
}

export function snapshotPlanAggregateDto(raw: unknown): PlanAggregateDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN_AGGREGATE', 'Plan aggregate must be an object');
  }
  return Object.freeze({
    total: snapshotNonNegativeInteger(raw, 'total', 'MALFORMED_PLAN_AGGREGATE'),
    pending: snapshotNonNegativeInteger(raw, 'pending', 'MALFORMED_PLAN_AGGREGATE'),
    blocked: snapshotNonNegativeInteger(raw, 'blocked', 'MALFORMED_PLAN_AGGREGATE'),
    eligible: snapshotNonNegativeInteger(raw, 'eligible', 'MALFORMED_PLAN_AGGREGATE'),
    running: snapshotNonNegativeInteger(raw, 'running', 'MALFORMED_PLAN_AGGREGATE'),
    reviewing: snapshotNonNegativeInteger(raw, 'reviewing', 'MALFORMED_PLAN_AGGREGATE'),
    completed: snapshotNonNegativeInteger(raw, 'completed', 'MALFORMED_PLAN_AGGREGATE'),
    failed: snapshotNonNegativeInteger(raw, 'failed', 'MALFORMED_PLAN_AGGREGATE'),
    state: snapshotEnum(raw.state, 'state', PLAN_STATES, 'MALFORMED_PLAN_AGGREGATE')
  });
}

export function snapshotPlanDto(raw: unknown): PlanDto {
  if (!isRecord(raw)) {
    throw new AgentHubValidationError('MALFORMED_PLAN', 'Plan must be an object');
  }
  const currentVersion = parseFiniteNumber(raw, 'currentVersion');
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    throw new AgentHubValidationError('MALFORMED_PLAN', "Field 'currentVersion' must be a positive integer");
  }
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.dependencies) || !Array.isArray(raw.decisions)) {
    throw new AgentHubValidationError('MALFORMED_PLAN', 'Plan missing tasks, dependencies, or decisions array');
  }
  let startedVersion: number | null = null;
  if (raw.startedVersion !== null) {
    startedVersion = parseFiniteNumber(raw, 'startedVersion');
    if (!Number.isSafeInteger(startedVersion) || startedVersion < 1) {
      throw new AgentHubValidationError('MALFORMED_PLAN', "Field 'startedVersion' must be a positive integer or null");
    }
  }
  return Object.freeze({
    planId: parseRequiredNonBlankString(raw, 'planId'),
    intakeId: parseRequiredNonBlankString(raw, 'intakeId'),
    projectId: parseRequiredNonBlankString(raw, 'projectId'),
    leadAgentId: parseRequiredNonBlankString(raw, 'leadAgentId'),
    currentVersion,
    state: snapshotEnum(raw.state, 'state', PLAN_STATES, 'MALFORMED_PLAN'),
    current: snapshotPlanVersionDto(raw.current),
    tasks: Object.freeze(raw.tasks.map((item) => snapshotPlanTaskRuntimeDto(item))),
    dependencies: Object.freeze(raw.dependencies.map((item) => snapshotPlanDependencyDto(item))),
    decisions: Object.freeze(raw.decisions.map((item) => snapshotPlanApprovalDecisionDto(item))),
    aggregate: snapshotPlanAggregateDto(raw.aggregate),
    startedVersion,
    startedAt: parseRequiredNullableString(raw, 'startedAt'),
    createdAt: parseRequiredNonBlankString(raw, 'createdAt'),
    updatedAt: parseRequiredNonBlankString(raw, 'updatedAt'),
    completedAt: parseRequiredNullableString(raw, 'completedAt')
  });
}

export function snapshotLifecycleStateFields(raw: Record<string, unknown>): {
  readonly intakes: readonly IntakeDto[];
  readonly plans: readonly PlanDto[];
  readonly planTasks: readonly PlanTaskRuntimeDto[];
  readonly planDependencies: readonly PlanDependencyDto[];
} {
  return {
    intakes: snapshotDtoArray(raw.intakes, 'intakes', snapshotIntakeDto),
    plans: snapshotDtoArray(raw.plans, 'plans', snapshotPlanDto),
    planTasks: snapshotDtoArray(raw.planTasks, 'planTasks', snapshotPlanTaskRuntimeDto),
    planDependencies: snapshotDtoArray(raw.planDependencies, 'planDependencies', snapshotPlanDependencyDto)
  };
}

export function leadAgentLifecycleReferences(
  agentId: string,
  snapshot: {
    readonly intakes: readonly IntakeDto[];
    readonly plans: readonly PlanDto[];
  }
): { readonly intakeIds: readonly string[]; readonly planIds: readonly string[] } {
  return {
    intakeIds: snapshot.intakes.filter((intake) => intake.leadAgentId === agentId).map((intake) => intake.intakeId),
    planIds: snapshot.plans.filter((plan) => plan.leadAgentId === agentId).map((plan) => plan.planId)
  };
}

export function shortenProposalHash(hash: string): string {
  if (hash.length < 8) return hash;
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}
