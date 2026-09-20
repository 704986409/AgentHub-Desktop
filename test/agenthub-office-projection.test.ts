import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  projectAgentHubOffice,
  mapAgentHubStatus,
  resolveCurrentAssignment,
  resolveCurrentTask,
  resolveProjectName,
  resolveOfficeDecoration,
  deriveActivityText,
  planOfficeVisibility,
  type OfficeAgentViewModel
} from '../src/renderer/src/scene/office/agentHubOfficeProjection';
import { useAgentHubStore } from '../src/renderer/src/stores/agentHubStore';
import type {
  AgentDto,
  AgentHubStateSnapshot,
  AssignmentDto,
  ProjectDto,
  TaskDto
} from '../src/shared/agenthubTypes';

describe('AgentHub Office State Projection', () => {
  const baseAgent: AgentDto = {
    agentId: 'agent-1',
    projectId: 'proj-1',
    name: 'Ada Lovelace',
    providerId: 'claude',
    modelId: 'claude-sonnet-4',
    position: 'engineer',
    status: 'IDLE',
    allowedComplexities: ['MEDIUM'],
    allowedRiskLevels: ['LOW'],
    capabilities: ['code'],
    specialties: ['compiler'],
    authority: 'standard',
    routingPriority: 10,
    enabled: true,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z'
  };

  const baseProject: ProjectDto = {
    projectId: 'proj-1',
    name: 'Alpha Project',
    description: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z'
  };

  test('all snapshot agents are projected into view models', { timeout: 5000 }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [
        { ...baseAgent, agentId: 'agent-1', name: 'Agent One' },
        { ...baseAgent, agentId: 'agent-2', name: 'Agent Two' }
      ],
      projects: [baseProject],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const projection = projectAgentHubOffice(snapshot);
    assert.equal(projection.agents.length, 2);
    assert.equal(projection.visibleAgents.length, 2);
    assert.equal(projection.overflowCount, 0);

    const first = projection.agents[0];
    assert.equal(first.agentId, 'agent-1');
    assert.equal(first.name, 'Agent One');
    assert.equal(first.providerId, 'claude');
    assert.equal(first.position, 'engineer');
    assert.equal(first.projectId, 'proj-1');
    assert.equal(first.projectName, 'Alpha Project');
    assert.equal(first.visualStatus, 'idle');
    assert.equal(first.statusLabel, 'idle');
    assert.equal(first.activityText, 'Idle');
  });

  test('legacy Munder roster is irrelevant and not merged', { timeout: 5000 }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [{ ...baseAgent, agentId: 'hub-agent-1', name: 'Hub Agent' }],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const projection = projectAgentHubOffice(snapshot);
    assert.equal(projection.agents.length, 1);
    assert.equal(projection.agents[0].agentId, 'hub-agent-1');
  });

  test('status mapping: IDLE -> visualStatus idle, statusLabel idle', { timeout: 5000 }, () => {
    const res = mapAgentHubStatus({ status: 'IDLE', enabled: true });
    assert.equal(res.visualStatus, 'idle');
    assert.equal(res.statusLabel, 'idle');
  });

  test('status mapping: BUSY -> visualStatus working, statusLabel working', { timeout: 5000 }, () => {
    const res = mapAgentHubStatus({ status: 'BUSY', enabled: true });
    assert.equal(res.visualStatus, 'working');
    assert.equal(res.statusLabel, 'working');
  });

  test('status mapping: OFFLINE -> visualStatus ghost, statusLabel offline', { timeout: 5000 }, () => {
    const res = mapAgentHubStatus({ status: 'OFFLINE', enabled: true });
    assert.equal(res.visualStatus, 'ghost');
    assert.equal(res.statusLabel, 'offline');
  });

  test('status mapping: DISABLED -> visualStatus ghost, statusLabel disabled', { timeout: 5000 }, () => {
    const res = mapAgentHubStatus({ status: 'DISABLED', enabled: true });
    assert.equal(res.visualStatus, 'ghost');
    assert.equal(res.statusLabel, 'disabled');
  });

  test('status mapping: enabled=false wins over any status -> disabled', { timeout: 5000 }, () => {
    const resBusy = mapAgentHubStatus({ status: 'BUSY', enabled: false });
    assert.equal(resBusy.visualStatus, 'ghost');
    assert.equal(resBusy.statusLabel, 'disabled');

    const resIdle = mapAgentHubStatus({ status: 'IDLE', enabled: false });
    assert.equal(resIdle.visualStatus, 'ghost');
    assert.equal(resIdle.statusLabel, 'disabled');
  });

  test('status mapping: unknown future backend status fails closed to ghost/unknown', { timeout: 5000 }, () => {
    const res = mapAgentHubStatus({ status: 'REBOOTING_SYNCHRONIZING' as any, enabled: true });
    assert.equal(res.visualStatus, 'ghost');
    assert.equal(res.statusLabel, 'unknown');
  });

  test('project resolves by projectId, missing project resolves to null', { timeout: 5000 }, () => {
    const projects: ProjectDto[] = [
      { ...baseProject, projectId: 'p-alpha', name: 'Alpha Suite' }
    ];

    assert.equal(resolveProjectName('p-alpha', projects), 'Alpha Suite');
    assert.equal(resolveProjectName('p-unknown', projects), null);
    assert.equal(resolveProjectName(null, projects), null);
    assert.equal(resolveProjectName(undefined, projects), null);
    assert.equal(resolveProjectName('p-alpha', null), null);
  });

  test('assignment projection resolves ACTIVE and ACCEPTED, ignores terminal assignments', { timeout: 5000 }, () => {
    const assignments: AssignmentDto[] = [
      {
        assignmentId: 'asg-term-1',
        agentId: 'agent-1',
        taskId: 'task-1',
        specVersion: 'v1',
        status: 'COMPLETED',
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z'
      },
      {
        assignmentId: 'asg-term-2',
        agentId: 'agent-1',
        taskId: 'task-2',
        specVersion: 'v1',
        status: 'RELEASED',
        createdAt: '2026-09-18T10:01:00.000Z',
        updatedAt: '2026-09-18T10:01:00.000Z'
      },
      {
        assignmentId: 'asg-active',
        agentId: 'agent-1',
        taskId: 'task-active',
        specVersion: 'v1',
        status: 'ACTIVE',
        createdAt: '2026-09-18T10:02:00.000Z',
        updatedAt: '2026-09-18T10:02:00.000Z'
      }
    ];

    const current = resolveCurrentAssignment('agent-1', assignments);
    assert.ok(current);
    assert.equal(current.assignmentId, 'asg-active');
  });

  test('assignment tie-breaking: status priority ACTIVE > ACCEPTED > DISPATCHING > PENDING, newer createdAt, lexical ID', { timeout: 5000 }, () => {
    const asgPending: AssignmentDto = {
      assignmentId: 'asg-1',
      agentId: 'agent-1',
      taskId: 'task-1',
      specVersion: 'v1',
      status: 'PENDING',
      createdAt: '2026-09-18T10:10:00.000Z',
      updatedAt: '2026-09-18T10:10:00.000Z'
    };
    const asgAccepted: AssignmentDto = {
      assignmentId: 'asg-2',
      agentId: 'agent-1',
      taskId: 'task-2',
      specVersion: 'v1',
      status: 'ACCEPTED',
      createdAt: '2026-09-18T10:05:00.000Z',
      updatedAt: '2026-09-18T10:05:00.000Z'
    };
    const asgActiveOlder: AssignmentDto = {
      assignmentId: 'asg-b',
      agentId: 'agent-1',
      taskId: 'task-3',
      specVersion: 'v1',
      status: 'ACTIVE',
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z'
    };
    const asgActiveNewer: AssignmentDto = {
      assignmentId: 'asg-a',
      agentId: 'agent-1',
      taskId: 'task-4',
      specVersion: 'v1',
      status: 'ACTIVE',
      createdAt: '2026-09-18T10:01:00.000Z',
      updatedAt: '2026-09-18T10:01:00.000Z'
    };

    // ACCEPTED beats PENDING
    assert.equal(resolveCurrentAssignment('agent-1', [asgPending, asgAccepted])?.assignmentId, 'asg-2');

    // ACTIVE beats ACCEPTED
    assert.equal(resolveCurrentAssignment('agent-1', [asgAccepted, asgActiveOlder])?.assignmentId, 'asg-b');

    // Newer ACTIVE beats older ACTIVE
    assert.equal(resolveCurrentAssignment('agent-1', [asgActiveOlder, asgActiveNewer])?.assignmentId, 'asg-a');

    // Equal timestamp tie-break: lexical assignmentId
    const asgTie1: AssignmentDto = { ...asgActiveNewer, assignmentId: 'asg-x' };
    const asgTie2: AssignmentDto = { ...asgActiveNewer, assignmentId: 'asg-m' };
    assert.equal(resolveCurrentAssignment('agent-1', [asgTie1, asgTie2])?.assignmentId, 'asg-m');
  });

  test('task projection: resolves task title and status, missing task does not crash', { timeout: 5000 }, () => {
    const tasks: TaskDto[] = [
      {
        taskId: 'task-100',
        projectId: 'proj-1',
        title: 'Fix authentication leak',
        description: 'Detail',
        requiredCapabilities: [],
        requiredSpecialties: [],
        acceptanceCriteria: [],
        complexity: 'MEDIUM',
        risk: 'LOW',
        status: 'IN_PROGRESS',
        assignedAgentId: 'agent-1',
        assignmentId: 'asg-1',
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z'
      }
    ];

    const asgWithKnownTask: AssignmentDto = {
      assignmentId: 'asg-1',
      agentId: 'agent-1',
      taskId: 'task-100',
      specVersion: 'v1',
      status: 'ACTIVE',
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z'
    };

    const resolved = resolveCurrentTask(asgWithKnownTask, tasks);
    assert.equal(resolved.currentTaskId, 'task-100');
    assert.equal(resolved.currentTaskTitle, 'Fix authentication leak');
    assert.equal(resolved.currentTaskStatus, 'IN_PROGRESS');

    const asgWithMissingTask: AssignmentDto = {
      ...asgWithKnownTask,
      taskId: 'task-missing-999'
    };
    const missingResolved = resolveCurrentTask(asgWithMissingTask, tasks);
    assert.equal(missingResolved.currentTaskId, 'task-missing-999');
    assert.equal(missingResolved.currentTaskTitle, null);
    assert.equal(missingResolved.currentTaskStatus, null);
  });

  test('activityText: derived from authoritative status and task title without Munder prompt leak', { timeout: 5000 }, () => {
    assert.equal(deriveActivityText('working', 'working', 'Refactor parser'), 'Working on Refactor parser');
    assert.equal(deriveActivityText('working', 'working', null), 'Working');
    assert.equal(deriveActivityText('idle', 'idle', null), 'Idle');
    assert.equal(deriveActivityText('ghost', 'offline', null), 'Offline');
    assert.equal(deriveActivityText('ghost', 'disabled', null), 'Disabled');
    assert.equal(deriveActivityText('ghost', 'unknown', null), 'Unknown');
  });

  test('providerId preserved for known and arbitrary future providers', { timeout: 5000 }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [
        { ...baseAgent, agentId: 'a-1', providerId: 'claude' },
        { ...baseAgent, agentId: 'a-2', providerId: 'codex' },
        { ...baseAgent, agentId: 'a-3', providerId: 'cursor' },
        { ...baseAgent, agentId: 'a-4', providerId: 'antigravity' },
        { ...baseAgent, agentId: 'a-5', providerId: 'custom-future-provider' }
      ],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const projection = projectAgentHubOffice(snapshot);
    const providers = projection.agents.map((a) => a.providerId);
    assert.deepEqual(providers, [
      'claude',
      'codex',
      'cursor',
      'antigravity',
      'custom-future-provider'
    ]);
  });

  test('modelId is a genuine AgentHub DTO field and Office does not synthesize legacy model', { timeout: 5000 }, () => {
    const snapshot: AgentHubStateSnapshot = {
      agents: [{ ...baseAgent, agentId: 'a-nomodel', modelId: 'claude-sonnet-4' }],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const projection = projectAgentHubOffice(snapshot);
    const vm = projection.agents[0];
    assert.equal(baseAgent.modelId, 'claude-sonnet-4');
    assert.equal((vm as any).model, undefined);
    assert.ok(!('model' in vm));
    assert.ok(!('modelId' in vm), 'Office view model must not copy or synthesize modelId');
  });

  test('deterministic decoration: same agentId gives same character and accent regardless of order', { timeout: 5000 }, () => {
    const deco1 = resolveOfficeDecoration('agent-charlie');
    const deco2 = resolveOfficeDecoration('agent-charlie');
    assert.deepEqual(deco1, deco2);

    const snapshot1: AgentHubStateSnapshot = {
      agents: [
        { ...baseAgent, agentId: 'agent-z' },
        { ...baseAgent, agentId: 'agent-a' }
      ],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const snapshot2: AgentHubStateSnapshot = {
      agents: [
        { ...baseAgent, agentId: 'agent-a' },
        { ...baseAgent, agentId: 'agent-z' }
      ],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    const proj1 = projectAgentHubOffice(snapshot1);
    const proj2 = projectAgentHubOffice(snapshot2);

    assert.equal(
      proj1.agents.find((a) => a.agentId === 'agent-a')?.character,
      proj2.agents.find((a) => a.agentId === 'agent-a')?.character
    );
    assert.equal(
      proj1.agents.find((a) => a.agentId === 'agent-z')?.accent,
      proj2.agents.find((a) => a.agentId === 'agent-z')?.accent
    );
  });

  test('planOfficeVisibility: sorted by agentId, overflowCount correct for >16 agents', { timeout: 5000 }, () => {
    const agentList: OfficeAgentViewModel[] = [];
    for (let i = 20; i >= 1; i--) {
      const id = `agent-${String(i).padStart(2, '0')}`;
      agentList.push({
        agentId: id,
        name: `Agent ${i}`,
        providerId: 'claude',
        position: 'dev',
        projectId: null,
        projectName: null,
        backendStatus: 'IDLE',
        enabled: true,
        visualStatus: 'idle',
        statusLabel: 'idle',
        currentAssignmentId: null,
        currentTaskId: null,
        currentTaskTitle: null,
        currentTaskStatus: null,
        activityText: 'Idle',
        character: 'jim',
        accent: 'sky'
      });
    }

    const { visibleAgents, overflowAgents, overflowCount } = planOfficeVisibility(agentList, 16);
    assert.equal(visibleAgents.length, 16);
    assert.equal(overflowAgents.length, 4);
    assert.equal(overflowCount, 4);

    // Sorted by agentId
    assert.equal(visibleAgents[0].agentId, 'agent-01');
    assert.equal(visibleAgents[15].agentId, 'agent-16');
    assert.equal(overflowAgents[0].agentId, 'agent-17');
    assert.equal(overflowAgents[3].agentId, 'agent-20');
  });

  test('snapshot null does NOT fall back to legacy roster and yields empty projection', { timeout: 5000 }, () => {
    const projection = projectAgentHubOffice(null);
    assert.equal(projection.agents.length, 0);
    assert.equal(projection.visibleAgents.length, 0);
    assert.equal(projection.overflowCount, 0);
  });

  test('authority boundary: forbidden source patterns absent in projection and OfficeFloor', { timeout: 5000 }, () => {
    const projectionSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/scene/office/agentHubOfficeProjection.ts'),
      'utf-8'
    );
    const floorSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/scene/office/OfficeFloor.tsx'),
      'utf-8'
    );

    const forbidden = [
      'getState().agents',
      's.agents',
      'spawnPty',
      'useHive',
      'workerLaunch',
      'worktreePath',
      'cwd'
    ];

    for (const pattern of forbidden) {
      assert.ok(
        !projectionSource.includes(pattern),
        `agentHubOfficeProjection.ts contains forbidden pattern: ${pattern}`
      );
      assert.ok(
        !floorSource.includes(pattern),
        `OfficeFloor.tsx contains forbidden pattern: ${pattern}`
      );
    }
  });

  test('selection: selectAgent stores AgentHub ID without mutating snapshot or legacy roster', { timeout: 5000 }, () => {
    const initialSnapshot: AgentHubStateSnapshot = {
      agents: [
        { ...baseAgent, agentId: 'hub-1' },
        { ...baseAgent, agentId: 'hub-2' }
      ],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    useAgentHubStore.setState({
      snapshot: initialSnapshot,
      selectedAgentId: null
    });

    // Select hub-1
    useAgentHubStore.getState().selectAgent('hub-1');
    assert.equal(useAgentHubStore.getState().selectedAgentId, 'hub-1');

    // Selection does not mutate snapshot
    assert.equal(useAgentHubStore.getState().snapshot?.agents.length, 2);

    // If new snapshot arrives without hub-1, selectedAgentId is cleared
    const updatedSnapshot: AgentHubStateSnapshot = {
      agents: [{ ...baseAgent, agentId: 'hub-2' }],
      projects: [],
      assignments: [], intakes: [], plans: [], planTasks: [], planDependencies: [],
      tasks: []
    };

    useAgentHubStore.setState((s) => ({
      snapshot: updatedSnapshot,
      selectedAgentId: updatedSnapshot.agents.some((a) => a.agentId === s.selectedAgentId)
        ? s.selectedAgentId
        : null
    }));

    assert.equal(useAgentHubStore.getState().selectedAgentId, null);
  });
});
