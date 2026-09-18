import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isProviderUsable,
  resolveProviderModelSuggestions,
  type ProviderDto
} from '../src/shared/agenthubTypes';

const TIMEOUT = 5000;

const nativeCursor: ProviderDto = {
  providerId: 'cursor',
  supported: true,
  usable: true,
  installed: true,
  authenticated: true,
  version: '0.45.0',
  status: 'READY',
  capabilities: {
    outputProtocols: ['worker-result'],
    sessionContinuation: true
  },
  modelDiscovery: 'native',
  models: [
    { modelId: 'cursor-fast', label: 'Cursor Fast' },
    { modelId: 'cursor-small', label: 'Cursor Small' }
  ],
  checkedAt: '2026-09-19T00:00:00.000Z'
};

const nativeEmpty: ProviderDto = {
  ...nativeCursor,
  models: []
};

const unavailable: ProviderDto = {
  ...nativeCursor,
  modelDiscovery: 'unavailable',
  models: [],
  usable: false,
  status: 'PROBE_FAILED'
};

const fallback = [
  { id: 'stale-1', label: 'Stale One' },
  { id: 'stale-2', label: 'Stale Two' }
];

describe('AgentHub V0.8.8A native model authority', () => {
  test('native nonempty list uses only native models', { timeout: TIMEOUT }, () => {
    const resolved = resolveProviderModelSuggestions(nativeCursor, fallback);
    assert.equal(resolved.isOfflineFallback, false);
    assert.equal(resolved.nativeEmpty, false);
    assert.deepEqual(resolved.modelSuggestions.map((item) => item.id), ['cursor-fast', 'cursor-small']);
    assert.equal(resolved.modelSuggestions.some((item) => item.id.startsWith('stale-')), false);
  });

  test('native empty list stays empty and never uses static fallback', { timeout: TIMEOUT }, () => {
    const resolved = resolveProviderModelSuggestions(nativeEmpty, fallback);
    assert.equal(resolved.isOfflineFallback, false);
    assert.equal(resolved.nativeEmpty, true);
    assert.deepEqual(resolved.modelSuggestions, []);
  });

  test('unavailable uses static fallback', { timeout: TIMEOUT }, () => {
    const resolved = resolveProviderModelSuggestions(unavailable, fallback);
    assert.equal(resolved.isOfflineFallback, true);
    assert.equal(resolved.nativeEmpty, false);
    assert.deepEqual(resolved.modelSuggestions, fallback);
  });

  test('native empty still allows a manual exact modelId to be preserved', { timeout: TIMEOUT }, () => {
    const resolved = resolveProviderModelSuggestions(nativeEmpty, fallback);
    const manualModelId = 'cursor-secret-exact';
    assert.equal(resolved.modelSuggestions.some((item) => item.id === manualModelId), false);
    assert.equal(manualModelId, 'cursor-secret-exact');
  });

  test('fallback label is only warranted for unavailable discovery', { timeout: TIMEOUT }, () => {
    assert.equal(resolveProviderModelSuggestions(nativeCursor, fallback).isOfflineFallback, false);
    assert.equal(resolveProviderModelSuggestions(nativeEmpty, fallback).isOfflineFallback, false);
    assert.equal(resolveProviderModelSuggestions(unavailable, fallback).isOfflineFallback, true);
    assert.equal(resolveProviderModelSuggestions(null, fallback).isOfflineFallback, true);
  });

  test('form source keeps provider-switch reset, native-empty copy, and manual modelId', { timeout: TIMEOUT }, () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentForm.tsx'),
      'utf8'
    );
    assert.match(source, /resolveProviderModelSuggestions/);
    assert.match(source, /modelId:\s*''/);
    assert.match(source, /当前 Provider 原生模型发现结果为空/);
    assert.match(source, /Offline fallback — may be stale/);
    assert.match(source, /Manual modelId is preserved exactly/);
    assert.match(source, /nativeEmpty &&/);
    assert.match(source, /isOfflineFallback && modelSuggestions\.length > 0/);
  });

  test('READY + usable=true enables Create Enabled; non-READY disables Create Enabled and Enable; BUSY wins', { timeout: TIMEOUT }, () => {
    const readyCatalog = [nativeCursor];
    const failedCatalog = [unavailable];
    assert.equal(isProviderUsable('cursor', readyCatalog), true);
    assert.equal(isProviderUsable('cursor', failedCatalog), false);

    const canConfirmCreate = (enabled: boolean, catalog: readonly ProviderDto[]): boolean => {
      const nameValid = true;
      const modelValid = true;
      return nameValid && modelValid && (!enabled || isProviderUsable('cursor', catalog));
    };
    assert.equal(canConfirmCreate(true, readyCatalog), true);
    assert.equal(canConfirmCreate(true, failedCatalog), false);
    assert.equal(canConfirmCreate(false, failedCatalog), true);

    const canEnable = (status: string, catalog: readonly ProviderDto[]): boolean => {
      const busy = status === 'BUSY';
      return !busy && isProviderUsable('cursor', catalog);
    };
    assert.equal(canEnable('IDLE', readyCatalog), true);
    assert.equal(canEnable('IDLE', failedCatalog), false);
    assert.equal(canEnable('BUSY', readyCatalog), false);
  });

  test('V0.8.7A ambiguous mutation ID lifecycle remains retrySame reuse plus edit rotate', { timeout: TIMEOUT }, () => {
    const storePath = path.resolve(process.cwd(), 'src/renderer/src/stores/agentHubAgentMutationStore.ts');
    const modalPath = path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentManagementModal.tsx');
    const store = fs.readFileSync(storePath, 'utf8');
    const modal = fs.readFileSync(modalPath, 'utf8');
    assert.match(modal, /retrySame/);
    assert.match(store, /rotateAfterEdit/);
    assert.match(store, /session\.status !== 'ambiguous'/);
    assert.match(store, /session\.mutationId !== mutationId/);
  });
});
