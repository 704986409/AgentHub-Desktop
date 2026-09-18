import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  OfficeSceneSeatPlanner,
  mapAgentToSceneVisual,
  type OfficeAgentViewModel
} from '../src/renderer/src/scene/office/agentHubOfficeProjection';

describe('AgentHub Office Scene Adapter and Seat Planner', () => {
  const makeAgent = (
    id: string,
    visualStatus: 'idle' | 'working' | 'ghost' = 'idle',
    activityText = 'Idle'
  ): OfficeAgentViewModel => ({
    agentId: id,
    name: `Agent ${id}`,
    providerId: 'claude',
    position: 'engineer',
    projectId: 'proj-1',
    projectName: 'Alpha',
    backendStatus: visualStatus === 'working' ? 'BUSY' : visualStatus === 'ghost' ? 'OFFLINE' : 'IDLE',
    enabled: visualStatus !== 'ghost',
    visualStatus,
    statusLabel: visualStatus === 'working' ? 'working' : visualStatus === 'ghost' ? 'offline' : 'idle',
    currentAssignmentId: null,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskStatus: null,
    activityText,
    character: 'jim',
    accent: 'sky'
  });

  test('scene visual adapter: BUSY maps to working desk state with thought', { timeout: 5000 }, () => {
    const agent = makeAgent('a-1', 'working', 'Working on compilation');
    const visual = mapAgentToSceneVisual(agent);

    assert.equal(visual.visualStatus, 'working');
    assert.equal(visual.isSittingAtDesk, true);
    assert.equal(visual.alpha, 1.0);
    assert.equal(visual.thoughtText, 'Working on compilation');
    assert.equal(visual.canCheer, false);
  });

  test('scene visual adapter: IDLE maps to roaming state', { timeout: 5000 }, () => {
    const agent = makeAgent('a-1', 'idle', 'Idle');
    const visual = mapAgentToSceneVisual(agent);

    assert.equal(visual.visualStatus, 'idle');
    assert.equal(visual.isSittingAtDesk, false);
    assert.equal(visual.alpha, 1.0);
    assert.equal(visual.thoughtText, 'Idle');
    assert.equal(visual.canCheer, true);
  });

  test('scene visual adapter: OFFLINE/DISABLED do not appear as working', { timeout: 5000 }, () => {
    const ghostAgent = makeAgent('a-ghost', 'ghost', 'Offline');
    const visual = mapAgentToSceneVisual(ghostAgent);

    assert.equal(visual.visualStatus, 'ghost');
    assert.equal(visual.isSittingAtDesk, false);
    assert.equal(visual.alpha, 0.5);
    assert.equal(visual.thoughtText, null);
    assert.equal(visual.canCheer, false);
  });

  test('seat planner: claims first free seat in order', { timeout: 5000 }, () => {
    const planner = new OfficeSceneSeatPlanner(16);
    const agents = [makeAgent('a-1'), makeAgent('a-2'), makeAgent('a-3')];

    const result = planner.sync(agents);
    assert.deepEqual(result.added, ['a-1', 'a-2', 'a-3']);
    assert.equal(planner.getSeat('a-1'), 0);
    assert.equal(planner.getSeat('a-2'), 1);
    assert.equal(planner.getSeat('a-3'), 2);
    assert.equal(planner.getClaimedCount(), 3);
  });

  test('seat planner: seat assignment remains stable during status and property changes', { timeout: 5000 }, () => {
    const planner = new OfficeSceneSeatPlanner(16);
    const initialAgents = [makeAgent('a-1', 'idle'), makeAgent('a-2', 'idle')];
    planner.sync(initialAgents);

    assert.equal(planner.getSeat('a-1'), 0);
    assert.equal(planner.getSeat('a-2'), 1);

    // a-1 flips to working, a-2 flips to offline
    const updatedAgents = [
      makeAgent('a-1', 'working', 'Working on test'),
      makeAgent('a-2', 'ghost', 'Offline')
    ];
    const updateResult = planner.sync(updatedAgents);

    assert.equal(updateResult.added.length, 0);
    assert.equal(updateResult.removed.length, 0);
    assert.equal(planner.getSeat('a-1'), 0);
    assert.equal(planner.getSeat('a-2'), 1);

    // a-1 flips back to idle
    const idleAgain = [makeAgent('a-1', 'idle'), makeAgent('a-2', 'idle')];
    planner.sync(idleAgain);
    assert.equal(planner.getSeat('a-1'), 0);
    assert.equal(planner.getSeat('a-2'), 1);
  });

  test('seat planner: removing agent releases seat and subsequent agent claims freed seat', { timeout: 5000 }, () => {
    const planner = new OfficeSceneSeatPlanner(16);
    planner.sync([makeAgent('a-1'), makeAgent('a-2'), makeAgent('a-3')]);

    assert.equal(planner.getSeat('a-2'), 1);
    assert.equal(planner.isClaimed(1), true);

    // Remove a-2
    const removeResult = planner.sync([makeAgent('a-1'), makeAgent('a-3')]);
    assert.deepEqual(removeResult.removed, ['a-2']);
    assert.equal(planner.getSeat('a-2'), undefined);
    assert.equal(planner.isClaimed(1), false);
    assert.equal(planner.getSeat('a-1'), 0);
    assert.equal(planner.getSeat('a-3'), 2);

    // Add new agent a-4 -> claims freed seat 1
    const addResult = planner.sync([makeAgent('a-1'), makeAgent('a-3'), makeAgent('a-4')]);
    assert.deepEqual(addResult.added, ['a-4']);
    assert.equal(planner.getSeat('a-4'), 1);
    assert.equal(planner.getSeat('a-1'), 0);
    assert.equal(planner.getSeat('a-3'), 2);
  });

  test('seat planner: overflow never duplicates an occupied seat', { timeout: 5000 }, () => {
    const planner = new OfficeSceneSeatPlanner(4); // 4-seat capacity test
    const fiveAgents = [
      makeAgent('a-1'),
      makeAgent('a-2'),
      makeAgent('a-3'),
      makeAgent('a-4'),
      makeAgent('a-5')
    ];

    const result = planner.sync(fiveAgents);
    assert.equal(planner.getClaimedCount(), 4);
    assert.deepEqual(result.unseated, ['a-5']);
    assert.equal(planner.getSeat('a-5'), undefined);

    // Verify all 4 seats are unique
    const claimedSeats = new Set<number>();
    for (const id of ['a-1', 'a-2', 'a-3', 'a-4']) {
      const s = planner.getSeat(id);
      assert.ok(s !== undefined);
      assert.ok(!claimedSeats.has(s), `Seat ${s} was duplicated!`);
      claimedSeats.add(s);
    }
  });
});
