import type {
  AgentDto,
  AgentHubStateSnapshot,
  AssignmentDto,
  ProjectDto,
  TaskDto
} from '@shared/agenthubTypes';
import {
  composeOfficeActors,
  HUMAN_BOSS_PRESENCE,
  type HumanPresenceActor,
  type OfficeActor
} from '../../../../shared/officeActors';

export type OfficeCharacterName =
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith';

export type AccentColorName =
  | 'coral' | 'mint' | 'sky' | 'lemon' | 'lilac' | 'peach';

export interface OfficeAgentViewModel {
  readonly agentId: string;
  readonly name: string;
  readonly providerId: string;
  readonly position: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly backendStatus: string;
  readonly enabled: boolean;
  readonly visualStatus: 'idle' | 'working' | 'ghost';
  readonly statusLabel: 'idle' | 'working' | 'offline' | 'disabled' | 'unknown';
  readonly currentAssignmentId: string | null;
  readonly currentTaskId: string | null;
  readonly currentTaskTitle: string | null;
  readonly currentTaskStatus: string | null;
  readonly activityText: string;
  readonly character: OfficeCharacterName;
  readonly accent: AccentColorName;
}

export interface AgentHubOfficeProjection {
  readonly human: HumanPresenceActor;
  readonly actors: readonly OfficeActor[];
  readonly agents: readonly OfficeAgentViewModel[];
  readonly visibleAgents: readonly OfficeAgentViewModel[];
  readonly overflowAgents: readonly OfficeAgentViewModel[];
  readonly overflowCount: number;
}

export const CAST_NAMES: readonly OfficeCharacterName[] = Object.freeze([
  'michael', 'jim', 'pam', 'dwight', 'kevin', 'angela',
  'oscar', 'stanley', 'phyllis', 'andy', 'kelly', 'ryan',
  'toby', 'creed', 'meredith'
]);

export const ACCENT_NAMES: readonly AccentColorName[] = Object.freeze([
  'coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'
]);

export function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveOfficeDecoration(agentId: string): {
  character: OfficeCharacterName;
  accent: AccentColorName;
} {
  const h = fnv1a(agentId);
  const character = CAST_NAMES[h % CAST_NAMES.length];
  const accent = ACCENT_NAMES[Math.floor(h / CAST_NAMES.length) % ACCENT_NAMES.length];
  return { character, accent };
}

export function mapAgentHubStatus(agent: { status?: string | null; enabled?: boolean | null }): {
  visualStatus: 'idle' | 'working' | 'ghost';
  statusLabel: 'idle' | 'working' | 'offline' | 'disabled' | 'unknown';
} {
  if (agent.enabled === false) {
    return { visualStatus: 'ghost', statusLabel: 'disabled' };
  }
  const s = (agent.status || '').trim().toUpperCase();
  if (s === 'IDLE') {
    return { visualStatus: 'idle', statusLabel: 'idle' };
  }
  if (s === 'BUSY') {
    return { visualStatus: 'working', statusLabel: 'working' };
  }
  if (s === 'OFFLINE') {
    return { visualStatus: 'ghost', statusLabel: 'offline' };
  }
  if (s === 'DISABLED') {
    return { visualStatus: 'ghost', statusLabel: 'disabled' };
  }
  return { visualStatus: 'ghost', statusLabel: 'unknown' };
}

export function resolveProjectName(
  projectId: string | null | undefined,
  projects?: readonly ProjectDto[] | null
): string | null {
  if (!projectId || !projects) return null;
  const found = projects.find((p) => p.projectId === projectId);
  return found ? found.name : null;
}

const ASSIGNMENT_STATUS_PRIORITY: Record<string, number> = {
  ACTIVE: 4,
  ACCEPTED: 3,
  DISPATCHING: 2,
  PENDING: 1
};

export function resolveCurrentAssignment(
  agentId: string,
  assignments?: readonly AssignmentDto[] | null
): AssignmentDto | null {
  if (!assignments || assignments.length === 0) return null;
  const candidates = assignments.filter((a) => {
    if (a.agentId !== agentId) return false;
    const status = (a.status || '').trim().toUpperCase();
    return (ASSIGNMENT_STATUS_PRIORITY[status] ?? 0) > 0;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  return [...candidates].sort((a, b) => {
    const prioA = ASSIGNMENT_STATUS_PRIORITY[(a.status || '').trim().toUpperCase()] ?? 0;
    const prioB = ASSIGNMENT_STATUS_PRIORITY[(b.status || '').trim().toUpperCase()] ?? 0;
    if (prioB !== prioA) {
      return prioB - prioA;
    }

    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }

    return (a.assignmentId || '').localeCompare(b.assignmentId || '');
  })[0];
}

export function resolveCurrentTask(
  assignment: AssignmentDto | null,
  tasks?: readonly TaskDto[] | null
): {
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskStatus: string | null;
} {
  if (!assignment || !assignment.taskId) {
    return {
      currentTaskId: null,
      currentTaskTitle: null,
      currentTaskStatus: null
    };
  }

  const taskId = assignment.taskId;
  if (tasks && tasks.length > 0) {
    const task = tasks.find((t) => t.taskId === taskId);
    if (task) {
      return {
        currentTaskId: task.taskId,
        currentTaskTitle: task.title ?? null,
        currentTaskStatus: task.status ?? null
      };
    }
  }

  return {
    currentTaskId: taskId,
    currentTaskTitle: null,
    currentTaskStatus: null
  };
}

export function deriveActivityText(
  visualStatus: 'idle' | 'working' | 'ghost',
  statusLabel: 'idle' | 'working' | 'offline' | 'disabled' | 'unknown',
  taskTitle: string | null
): string {
  if (statusLabel === 'disabled') return 'Disabled';
  if (statusLabel === 'offline') return 'Offline';
  if (statusLabel === 'working' || visualStatus === 'working') {
    return taskTitle ? `Working on ${taskTitle}` : 'Working';
  }
  if (statusLabel === 'idle' || visualStatus === 'idle') {
    return 'Idle';
  }
  return 'Unknown';
}

export function planOfficeVisibility(
  agents: readonly OfficeAgentViewModel[],
  seatCapacity = 16
): {
  visibleAgents: readonly OfficeAgentViewModel[];
  overflowAgents: readonly OfficeAgentViewModel[];
  overflowCount: number;
} {
  const sorted = [...agents].sort((a, b) => a.agentId.localeCompare(b.agentId));
  const capacity = Math.max(0, seatCapacity);
  const visibleAgents = Object.freeze(sorted.slice(0, capacity));
  const overflowAgents = Object.freeze(sorted.slice(capacity));
  return {
    visibleAgents,
    overflowAgents,
    overflowCount: overflowAgents.length
  };
}

export function projectAgentHubOffice(
  snapshot: AgentHubStateSnapshot | null,
  options?: { seatCapacity?: number }
): AgentHubOfficeProjection {
  const human = HUMAN_BOSS_PRESENCE;
  if (!snapshot || !snapshot.agents || !Array.isArray(snapshot.agents)) {
    return Object.freeze({
      human,
      actors: composeOfficeActors([]),
      agents: Object.freeze([]),
      visibleAgents: Object.freeze([]),
      overflowAgents: Object.freeze([]),
      overflowCount: 0
    });
  }

  const projects = snapshot.projects ?? [];
  const assignments = snapshot.assignments ?? [];
  const tasks = snapshot.tasks ?? [];

  const rawViewModels: OfficeAgentViewModel[] = snapshot.agents.map((agent: AgentDto) => {
    const { visualStatus, statusLabel } = mapAgentHubStatus(agent);
    const assignment = resolveCurrentAssignment(agent.agentId, assignments);
    const { currentTaskId, currentTaskTitle, currentTaskStatus } = resolveCurrentTask(assignment, tasks);
    const projectName = resolveProjectName(agent.projectId, projects);
    const activityText = deriveActivityText(visualStatus, statusLabel, currentTaskTitle);
    const { character, accent } = resolveOfficeDecoration(agent.agentId);

    const vm: OfficeAgentViewModel = {
      agentId: agent.agentId,
      name: agent.name,
      providerId: agent.providerId,
      position: agent.position,
      projectId: agent.projectId ?? null,
      projectName,
      backendStatus: agent.status,
      enabled: agent.enabled !== false,
      visualStatus,
      statusLabel,
      currentAssignmentId: assignment?.assignmentId ?? null,
      currentTaskId,
      currentTaskTitle,
      currentTaskStatus,
      activityText,
      character,
      accent
    };

    return Object.freeze(vm);
  });

  const sortedViewModels = Object.freeze(
    rawViewModels.sort((a, b) => a.agentId.localeCompare(b.agentId))
  );

  const { visibleAgents, overflowAgents, overflowCount } = planOfficeVisibility(
    sortedViewModels,
    options?.seatCapacity ?? 16
  );

  return Object.freeze({
    human,
    actors: composeOfficeActors(snapshot.agents),
    agents: sortedViewModels,
    visibleAgents,
    overflowAgents,
    overflowCount
  });
}

export class OfficeSceneSeatPlanner {
  private readonly totalSeats: number;
  private readonly agentSeats = new Map<string, number>();
  private readonly seatClaims = new Set<number>();

  constructor(totalSeats = 16) {
    this.totalSeats = totalSeats;
  }

  sync(agents: readonly OfficeAgentViewModel[]): {
    readonly seated: ReadonlyMap<string, number>;
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly unseated: readonly string[];
  } {
    const present = new Set(agents.map((a) => a.agentId));
    const removed: string[] = [];
    const added: string[] = [];
    const unseated: string[] = [];

    // 1. Release removed agents
    for (const [id, seat] of Array.from(this.agentSeats.entries())) {
      if (!present.has(id)) {
        this.agentSeats.delete(id);
        this.seatClaims.delete(seat);
        removed.push(id);
      }
    }

    // 2. Existing agents keep their seats, new agents claim next free seat
    for (const agent of agents) {
      if (this.agentSeats.has(agent.agentId)) {
        continue;
      }
      let freeSeat: number | null = null;
      for (let i = 0; i < this.totalSeats; i++) {
        if (!this.seatClaims.has(i)) {
          freeSeat = i;
          break;
        }
      }
      if (freeSeat !== null) {
        this.seatClaims.add(freeSeat);
        this.agentSeats.set(agent.agentId, freeSeat);
        added.push(agent.agentId);
      } else {
        unseated.push(agent.agentId);
      }
    }

    return {
      seated: new Map(this.agentSeats),
      added,
      removed,
      unseated
    };
  }

  getSeat(agentId: string): number | undefined {
    return this.agentSeats.get(agentId);
  }

  isClaimed(seatIndex: number): boolean {
    return this.seatClaims.has(seatIndex);
  }

  getClaimedCount(): number {
    return this.seatClaims.size;
  }
}

export interface OfficeSceneVisualState {
  readonly visualStatus: 'idle' | 'working' | 'ghost';
  readonly isSittingAtDesk: boolean;
  readonly alpha: number;
  readonly thoughtText: string | null;
  readonly canCheer: boolean;
}

export function mapAgentToSceneVisual(agent: OfficeAgentViewModel): OfficeSceneVisualState {
  switch (agent.visualStatus) {
    case 'working':
      return {
        visualStatus: 'working',
        isSittingAtDesk: true,
        alpha: 1.0,
        thoughtText: agent.activityText || 'Working',
        canCheer: false
      };
    case 'ghost':
      return {
        visualStatus: 'ghost',
        isSittingAtDesk: false,
        alpha: 0.5,
        thoughtText: null,
        canCheer: false
      };
    case 'idle':
    default:
      return {
        visualStatus: 'idle',
        isSittingAtDesk: false,
        alpha: 1.0,
        thoughtText: agent.activityText || 'Idle',
        canCheer: true
      };
  }
}
