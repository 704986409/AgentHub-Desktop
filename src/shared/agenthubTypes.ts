/**
 * Public Data Transfer Objects (DTOs) and client state models for AgentHub Desktop.
 * 
 * Strict Invariants:
 * - Mirrors only public HTTP/WS API contracts pinned to AgentHub 0.7.0G.
 * - ZERO backend-private fields (no repositoryRoot, worktreePath, cwd, env, secrets).
 * - Read-only types for client presentation only.
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
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentDto {
  readonly agentId: string;
  readonly projectId: string;
  readonly name: string;
  readonly providerId: string;
  readonly position?: string;
  readonly status: string;
  readonly allowedComplexities?: readonly string[];
  readonly allowedRiskLevels?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly specialties?: readonly string[];
  readonly authority?: string;
  readonly routingPriority?: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskDto {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly requiredCapabilities?: readonly string[];
  readonly requiredSpecialties?: readonly string[];
  readonly acceptanceCriteria?: readonly string[];
  readonly complexity?: string;
  readonly risk?: string;
  readonly status: string;
  readonly assignedAgentId?: string | null;
  readonly assignmentId?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssignmentDto {
  readonly assignmentId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly specVersion?: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentHubEventDto {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly projectId?: string;
  readonly agentId?: string;
  readonly taskId?: string;
  readonly assignmentId?: string;
  readonly actor?: string;
  readonly oldStatus?: string;
  readonly newStatus?: string;
  readonly payload?: Record<string, unknown>;
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
  readonly apiVersion: string;
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
