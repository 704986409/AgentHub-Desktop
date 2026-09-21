import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isLifecycleCompatibleBackendVersion,
  isPlanReviewReconciliationError
} from '../src/shared/agenthubLifecycle';

const TIMEOUT = 8_000;
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('AgentHub Desktop V0.8.10B lifecycle compatibility', () => {
  test('compatibility gate historical V0.8.10B pin is superseded by current contract tests', { timeout: TIMEOUT }, () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), true);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3F'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3E'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3D'), false);
  });

  test('review DTO parser is unchanged and still exact', { timeout: TIMEOUT }, () => {
    const lifecycle = read('src/shared/agenthubLifecycle.ts');
    assert.match(lifecycle, /export function snapshotLifecycleReviewDto/);
    assert.match(lifecycle, /rejectUnexpectedKeys\(raw, LIFECYCLE_REVIEW_DTO_KEYS/);
  });

  test('workspace fail-closes reconciliation-required without fake review fallback', { timeout: TIMEOUT }, () => {
    assert.equal(isPlanReviewReconciliationError('AGENTHUB_API_PLAN_REVIEW_RECONCILIATION_REQUIRED'), true);
    assert.equal(isPlanReviewReconciliationError('PLAN_REVIEW_RECONCILIATION_REQUIRED'), true);
    assert.equal(isPlanReviewReconciliationError('SYNC_FAILED'), false);
    const workspace = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    assert.match(workspace, /Backend review reconciliation required/);
    assert.match(workspace, /Supported: 0\.7\.3K\./);
    assert.equal(workspace.includes('openReviewModal()'), false);
    assert.equal(workspace.includes('fabricateReview'), false);
  });
});
