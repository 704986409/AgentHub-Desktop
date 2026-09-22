import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIFECYCLE_SUPPORTED_BACKEND_VERSIONS,
  isLifecycleCompatibleBackendVersion
} from '../src/shared/agenthubLifecycle';

const workspace = fs.readFileSync(
  path.join(process.cwd(), 'src/renderer/src/components/AgentHubLifecycleWorkspace.tsx'),
  'utf8'
);

describe('Desktop V0.8.10H lifecycle backend compatibility', () => {
  test('H-T1 current Backend 0.7.4C is compatible', () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C'), true);
    assert.deepEqual(LIFECYCLE_SUPPORTED_BACKEND_VERSIONS, ['0.7.4C']);
    assert.match(workspace, /lifecycleCompatible = health !== null && isLifecycleCompatibleBackendVersion\(health\.version\)/);
    assert.equal(workspace.includes('Backend upgrade required') && workspace.includes('!lifecycleCompatible'), true);
  });

  test('H-T2 old Backend 0.7.3K is rejected with the version banner', () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), false);
    assert.match(workspace, /Lifecycle unavailable\. Backend upgrade required\./);
    assert.match(workspace, /Current version: \$\{health\.version\}\. Supported: 0\.7\.4C\./);
    assert.match(workspace, /This is not an empty plan list\./);
  });

  test('H-T3 unknown versions are incompatible', () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4B'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.5'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4c'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('v0.7.4C'), false);
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C '), false);
  });

  test('H-T4 missing version fails closed', () => {
    assert.equal(isLifecycleCompatibleBackendVersion(''), false);
    assert.equal(isLifecycleCompatibleBackendVersion(undefined as unknown as string), false);
    assert.match(workspace, /health !== null && isLifecycleCompatibleBackendVersion/);
    assert.match(workspace, /Health is unknown\./);
  });

  test('H-T5 0.7.4C empty plans stay in the compatible empty-plan state', () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C'), true);
    const compatibleBlock = workspace.slice(workspace.indexOf('{lifecycleCompatible && snapshot && !reviewReconciliationRequired && ('));
    assert.match(compatibleBlock, /No plans on this compatible Backend\./);
    const banner = workspace.slice(
      workspace.indexOf('{!lifecycleCompatible && ('),
      workspace.indexOf('{lifecycleCompatible && connection === \'disconnected\'')
    );
    assert.match(banner, /Backend upgrade required/);
    assert.equal(banner.includes('No plans on this compatible Backend.'), false);
  });

  test('H-T6 0.7.4C renders the authoritative plan inside the compatible block', () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.4C'), true);
    const compatibleBlock = workspace.slice(workspace.indexOf('{lifecycleCompatible && snapshot && !reviewReconciliationRequired && ('));
    assert.match(compatibleBlock, /plan\.current\.summary/);
    assert.match(compatibleBlock, /plan\.state/);
  });

  test('H-T7 0.7.3K with empty plans remains a version error', () => {
    assert.equal(isLifecycleCompatibleBackendVersion('0.7.3K'), false);
    const banner = workspace.slice(0, workspace.indexOf('{lifecycleCompatible && snapshot && !reviewReconciliationRequired && ('));
    assert.match(banner, /Backend upgrade required/);
    assert.match(banner, /This is not an empty plan list\./);
    assert.equal(banner.includes('No plans on this compatible Backend.'), false);
  });

  test('H-T8 supported version text is 0.7.4C', () => {
    assert.match(workspace, /Supported: 0\.7\.4C\./);
    assert.equal(workspace.includes('Supported: 0.7.3K.'), false);
  });
});
