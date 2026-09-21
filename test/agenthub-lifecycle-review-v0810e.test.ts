import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TaskSubmissionIdLifecycle,
  InvalidSubmissionTransitionError
} from '../src/shared/agenthubSubmissionLifecycle';
import type { LifecycleMutationResult } from '../src/shared/agenthubTypes';

const TIMEOUT = 8_000;
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('AgentHub Desktop V0.8.10E — Lifecycle Submission State Settlement', () => {
  test('E1. Reproduction: onEdit during submitting does NOT settle lifecycle and blocks next submit', { timeout: TIMEOUT }, () => {
    let count = 0;
    const bugLifecycle = new TaskSubmissionIdLifecycle(() => `id-${++count}`);
    assert.equal(bugLifecycle.id, 'id-1');

    // Step 1: Create Intake beginSubmit
    const intakeId = bugLifecycle.beginSubmit();
    assert.equal(intakeId, 'id-1');
    assert.equal(bugLifecycle.phase, 'submitting');

    // In old code: bugLifecycle.onEdit() was called directly on success
    bugLifecycle.onEdit();

    // Verify bug: phase remains submitting!
    assert.equal(bugLifecycle.phase, 'submitting');

    // Step 2: Next mutation (Create Plan) triggers beginSubmit -> throws "Submit is already in flight"
    assert.throws(
      () => bugLifecycle.beginSubmit(),
      (err: Error) => {
        assert.ok(err instanceof InvalidSubmissionTransitionError);
        assert.equal(err.message, 'Submit is already in flight');
        return true;
      }
    );
  });

  test('E2. Fix verification: onResult("applied") settles phase and rotates ID for next mutation', { timeout: TIMEOUT }, () => {
    let count = 0;
    const fixedLifecycle = new TaskSubmissionIdLifecycle(() => `id-${++count}`);
    assert.equal(fixedLifecycle.id, 'id-1');

    // Step 1: Create Intake
    const intakeId = fixedLifecycle.beginSubmit();
    assert.equal(intakeId, 'id-1');
    assert.equal(fixedLifecycle.phase, 'submitting');

    // Settled on success
    const nextId = fixedLifecycle.onResult('applied');
    assert.equal(fixedLifecycle.phase, 'applied');
    assert.equal(nextId, 'id-2');
    assert.equal(fixedLifecycle.id, 'id-2');

    // Step 2: Create Plan (Sequential mutation)
    const planId = fixedLifecycle.beginSubmit();
    assert.equal(planId, 'id-2');
    assert.equal(fixedLifecycle.phase, 'submitting');

    // Settle Create Plan
    const nextId3 = fixedLifecycle.onResult('applied');
    assert.equal(fixedLifecycle.phase, 'applied');
    assert.equal(nextId3, 'id-3');
  });

  test('E3. Sequential mutation pipeline: Create Intake -> Create Plan -> Approve Plan -> Start Plan', { timeout: TIMEOUT }, async () => {
    let count = 0;
    const lifecycle = new TaskSubmissionIdLifecycle(() => `sub-${++count}`);

    // Simulation of AgentHubLifecycleWorkspace runMutation flow
    const runWorkspaceMutation = async (
      fn: (id: string) => Promise<LifecycleMutationResult>
    ): Promise<{ status: string; id: string }> => {
      const id = lifecycle.beginSubmit();
      const result = await fn(id);
      if (result.status === 'applied') {
        lifecycle.onResult('applied');
      } else if (result.status === 'failed') {
        lifecycle.onResult('failed');
      } else {
        lifecycle.onResult('ambiguous');
      }
      return { status: result.status, id: lifecycle.id };
    };

    // 1. Create Intake
    const res1 = await runWorkspaceMutation(async (id) => {
      assert.equal(id, 'sub-1');
      return { status: 'applied', stateSynchronized: true };
    });
    assert.equal(res1.status, 'applied');
    assert.equal(lifecycle.phase, 'applied');
    assert.equal(lifecycle.id, 'sub-2');

    // 2. Create Plan
    const res2 = await runWorkspaceMutation(async (id) => {
      assert.equal(id, 'sub-2');
      return { status: 'applied', stateSynchronized: true };
    });
    assert.equal(res2.status, 'applied');
    assert.equal(lifecycle.phase, 'applied');
    assert.equal(lifecycle.id, 'sub-3');

    // 3. Approve Plan
    const res3 = await runWorkspaceMutation(async (id) => {
      assert.equal(id, 'sub-3');
      return { status: 'applied', stateSynchronized: true };
    });
    assert.equal(res3.status, 'applied');
    assert.equal(lifecycle.phase, 'applied');
    assert.equal(lifecycle.id, 'sub-4');

    // 4. Start Plan
    const res4 = await runWorkspaceMutation(async (id) => {
      assert.equal(id, 'sub-4');
      return { status: 'applied', stateSynchronized: true };
    });
    assert.equal(res4.status, 'applied');
    assert.equal(lifecycle.phase, 'applied');
    assert.equal(lifecycle.id, 'sub-5');
  });

  test('E4. Failure settlement: backend error allows user retry or correction without getting stuck in flight', { timeout: TIMEOUT }, () => {
    let count = 0;
    const lifecycle = new TaskSubmissionIdLifecycle(() => `id-${++count}`);

    const firstId = lifecycle.beginSubmit();
    assert.equal(firstId, 'id-1');
    assert.equal(lifecycle.phase, 'submitting');

    // Backend returns failure (e.g. 409 or validation error)
    lifecycle.onResult('failed');
    assert.equal(lifecycle.phase, 'failed');
    assert.equal(lifecycle.id, 'id-2');

    // User can retry submit without being blocked by in-flight error
    const retryId = lifecycle.beginSubmit();
    assert.equal(retryId, 'id-2');
    assert.equal(lifecycle.phase, 'submitting');

    // Settle retry
    lifecycle.onResult('applied');
    assert.equal(lifecycle.phase, 'applied');
    assert.equal(lifecycle.id, 'id-3');
  });

  test('E5. Ambiguous settlement: fail-closed prevents normal submit; allows beginRetry with exact same ID', { timeout: TIMEOUT }, () => {
    let count = 0;
    const lifecycle = new TaskSubmissionIdLifecycle(() => `id-${++count}`);

    const inFlightId = lifecycle.beginSubmit();
    assert.equal(inFlightId, 'id-1');

    // Ambiguous outcome (network drop/timeout)
    lifecycle.onResult('ambiguous');
    assert.equal(lifecycle.phase, 'ambiguous');
    assert.equal(lifecycle.id, 'id-1'); // Must preserve exact ID for retry

    // Normal submit is forbidden in ambiguous state
    assert.throws(
      () => lifecycle.beginSubmit(),
      (err: Error) => {
        assert.ok(err instanceof InvalidSubmissionTransitionError);
        assert.match(err.message, /outcome is ambiguous/);
        return true;
      }
    );

    // beginRetry is allowed and reuses the exact same ID
    const retriedId = lifecycle.beginRetry();
    assert.equal(retriedId, 'id-1');
    assert.equal(lifecycle.phase, 'submitting');

    // Settle after retry
    lifecycle.onResult('applied');
    assert.equal(lifecycle.phase, 'applied');
    assert.equal(lifecycle.id, 'id-2');
  });

  test('E6. Edit form resets applied/failed/ambiguous state to idle with fresh ID', { timeout: TIMEOUT }, () => {
    let count = 0;
    const lifecycle = new TaskSubmissionIdLifecycle(() => `id-${++count}`);

    // Applied -> Edit -> idle
    lifecycle.beginSubmit();
    lifecycle.onResult('applied');
    assert.equal(lifecycle.phase, 'applied');
    const idAfterEdit1 = lifecycle.onEdit();
    assert.equal(lifecycle.phase, 'idle');
    assert.equal(idAfterEdit1, 'id-3');

    // Failed -> Edit -> idle
    lifecycle.beginSubmit();
    lifecycle.onResult('failed');
    assert.equal(lifecycle.phase, 'failed');
    const idAfterEdit2 = lifecycle.onEdit();
    assert.equal(lifecycle.phase, 'idle');
    assert.equal(idAfterEdit2, 'id-5');

    // Ambiguous -> Edit -> idle
    lifecycle.beginSubmit();
    lifecycle.onResult('ambiguous');
    assert.equal(lifecycle.phase, 'ambiguous');
    const idAfterEdit3 = lifecycle.onEdit();
    assert.equal(lifecycle.phase, 'idle');
    assert.equal(idAfterEdit3, 'id-6');
  });

  test('E7. Workspace source verification: applyResult and runMutation correctly call onResult', { timeout: TIMEOUT }, () => {
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');

    // Verify onResult calls
    assert.match(workspace, /lifecycleRef\.current\.onResult\('applied'\)/);
    assert.match(workspace, /lifecycleRef\.current\.onResult\('failed'\)/);
    assert.match(workspace, /lifecycleRef\.current\.onResult\('ambiguous'\)/);

    // Verify no erroneous onEdit on applied branch
    assert.doesNotMatch(workspace, /if\s*\(result\.status\s*===\s*'applied'\)\s*\{[^}]*lifecycleRef\.current\.onEdit\(\)/s);

    // Verify catch block in runMutation calls onResult('ambiguous')
    assert.match(workspace, /catch\s*\(err:\s*any\)\s*\{[^}]*lifecycleRef\.current\.onResult\('ambiguous'\)/s);

    // Prohibit automatic retries
    assert.doesNotMatch(workspace, /setTimeout\([^)]*runMutation/);
  });
});
