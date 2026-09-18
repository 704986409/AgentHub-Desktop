import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isProviderUsable,
  formatProviderStatus,
  type ProviderDto
} from '../src/shared/agenthubTypes';

const TIMEOUT = 5000;

const mockCatalog: ProviderDto[] = [
  {
    providerId: 'claude',
    supported: true,
    usable: true,
    installed: true,
    authenticated: true,
    version: '1.2.3',
    status: 'READY',
    capabilities: {
      outputProtocols: ['worker-result'],
      sessionContinuation: true
    },
    modelDiscovery: 'native',
    models: [
      { modelId: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { modelId: 'claude-opus-4-20250514', label: 'Claude Opus 4' }
    ],
    checkedAt: '2026-09-19T00:00:00.000Z'
  },
  {
    providerId: 'cursor',
    supported: true,
    usable: true,
    installed: true,
    authenticated: true,
    version: '0.45.0',
    status: 'READY',
    capabilities: {
      outputProtocols: ['worker-result'],
      sessionContinuation: false
    },
    modelDiscovery: 'native',
    models: [
      { modelId: 'cursor-fast', label: 'Cursor Fast' }
    ],
    checkedAt: '2026-09-19T00:00:00.000Z'
  },
  {
    providerId: 'antigravity',
    supported: true,
    usable: false,
    installed: true,
    authenticated: false,
    version: '2.0.0',
    status: 'AUTH_REQUIRED',
    capabilities: {
      outputProtocols: ['worker-result'],
      sessionContinuation: false
    },
    modelDiscovery: 'unavailable',
    models: [],
    checkedAt: '2026-09-19T00:00:00.000Z'
  },
  {
    providerId: 'codex',
    supported: true,
    usable: false,
    installed: false,
    authenticated: null,
    version: null,
    status: 'EXECUTABLE_NOT_FOUND',
    capabilities: {
      outputProtocols: ['worker-result'],
      sessionContinuation: false
    },
    modelDiscovery: 'unavailable',
    models: [],
    checkedAt: '2026-09-19T00:00:00.000Z'
  }
];

describe('AgentHub V0.8.8 Form & Modal UI Static Verification', () => {
  test('AgentHubAgentForm includes all 4 official providers and planned text is removed', { timeout: TIMEOUT }, () => {
    const formPath = path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentForm.tsx');
    const source = fs.readFileSync(formPath, 'utf8');

    // 4 official providers
    assert.match(source, /Claude Code/);
    assert.match(source, /Codex/);
    assert.match(source, /Cursor/);
    assert.match(source, /Antigravity/);

    // Completely remove planned text
    assert.equal(source.includes('planned for V0.8.8'), false, 'planned for V0.8.8 must be completely removed');
    assert.equal(source.includes('PLANNED_PROVIDERS'), false, 'PLANNED_PROVIDERS must be removed');

    // 3-tier model selection and offline fallback
    assert.match(source, /catalogModels/);
    assert.match(source, /resolveProviderModelSuggestions/);
    assert.match(source, /modelSuggestions/);
    assert.match(source, /isOfflineFallback/);
    assert.match(source, /nativeEmpty/);
    assert.match(source, /Manual modelId is preserved exactly/);
    assert.match(source, /Offline fallback — may be stale/);
    assert.match(source, /当前 Provider 原生模型发现结果为空/);

    // Provider switch resets modelId
    assert.match(source, /modelId:\s*''/);
  });

  test('AgentHubAgentManagementModal wires provider catalog and gates actions fail-closed', { timeout: TIMEOUT }, () => {
    const modalPath = path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentManagementModal.tsx');
    const source = fs.readFileSync(modalPath, 'utf8');

    assert.match(source, /refreshProviderCatalog/);
    assert.match(source, /isProviderUsable/);
    assert.match(source, /providerCatalog/);
    assert.match(source, /canEnable/);
    assert.match(source, /canConfirmCreate/);
    assert.match(source, /Runtime provider unavailable/);
  });
});

describe('AgentHub V0.8.8 Provider Usability and Gate Logic', () => {
  test('isProviderUsable evaluates READY and usable flags strictly', { timeout: TIMEOUT }, () => {
    // With catalog
    assert.equal(isProviderUsable('claude', mockCatalog), true);
    assert.equal(isProviderUsable('cursor', mockCatalog), true);
    assert.equal(isProviderUsable('antigravity', mockCatalog), false);
    assert.equal(isProviderUsable('codex', mockCatalog), false);
    assert.equal(isProviderUsable('unknown' as any, mockCatalog), false);

    // Fallback when catalog is null: claude/codex default to true, cursor/antigravity default to false
    assert.equal(isProviderUsable('claude', null), true);
    assert.equal(isProviderUsable('codex', null), true);
    assert.equal(isProviderUsable('cursor', null), false);
    assert.equal(isProviderUsable('antigravity', null), false);
  });

  test('formatProviderStatus formats runtime status human-readably', { timeout: TIMEOUT }, () => {
    assert.equal(formatProviderStatus('READY'), 'Ready');
    assert.equal(formatProviderStatus('EXECUTABLE_NOT_FOUND'), 'CLI Not Found');
    assert.equal(formatProviderStatus('AUTH_REQUIRED'), 'Login Required');
    assert.equal(formatProviderStatus('PROBE_FAILED'), 'Probe Failed');
  });

  test('canEnable guard logic honors usable status and BUSY priority', { timeout: TIMEOUT }, () => {
    function computeCanEnable(
      agent: { enabled: boolean; status: string; providerId: string } | null,
      catalog: readonly ProviderDto[] | null,
      mutationsUsable: boolean,
      submitting: boolean
    ): boolean {
      if (!agent) return false;
      const busy = agent.status === 'BUSY';
      const providerUsable = isProviderUsable(agent.providerId, catalog);
      return Boolean(
        mutationsUsable &&
        !submitting &&
        !busy &&
        !agent.enabled &&
        providerUsable
      );
    }

    // Usable + disabled + IDLE -> canEnable = true
    assert.equal(
      computeCanEnable({ enabled: false, status: 'DISABLED', providerId: 'cursor' }, mockCatalog, true, false),
      true
    );

    // Unusable (AUTH_REQUIRED) + disabled + IDLE -> canEnable = false
    assert.equal(
      computeCanEnable({ enabled: false, status: 'DISABLED', providerId: 'antigravity' }, mockCatalog, true, false),
      false
    );

    // Usable + BUSY -> canEnable = false (BUSY overrides usable)
    assert.equal(
      computeCanEnable({ enabled: false, status: 'BUSY', providerId: 'cursor' }, mockCatalog, true, false),
      false
    );

    // Already enabled -> canEnable = false
    assert.equal(
      computeCanEnable({ enabled: true, status: 'IDLE', providerId: 'cursor' }, mockCatalog, true, false),
      false
    );
  });

  test('canConfirmCreate gates immediate enabled creation on provider usability', { timeout: TIMEOUT }, () => {
    function computeCanConfirmCreate(
      form: { name: string; modelId: string; enabled: boolean; providerId: string },
      catalog: readonly ProviderDto[] | null,
      mutationsUsable: boolean,
      submitting: boolean
    ): boolean {
      const isFormCreateEnabledUsable = isProviderUsable(form.providerId, catalog);
      const isNameValid = form.name.trim().length > 0;
      const isModelValid = form.modelId.trim().length > 0;
      return Boolean(
        mutationsUsable &&
        !submitting &&
        isNameValid &&
        isModelValid &&
        (!form.enabled || isFormCreateEnabledUsable)
      );
    }

    // Creating disabled agent with unusable provider is allowed
    assert.equal(
      computeCanConfirmCreate(
        { name: 'Worker', modelId: 'gemini-2.5-pro', enabled: false, providerId: 'antigravity' },
        mockCatalog, true, false
      ),
      true
    );

    // Creating enabled agent with unusable provider is blocked (fail-closed)
    assert.equal(
      computeCanConfirmCreate(
        { name: 'Worker', modelId: 'gemini-2.5-pro', enabled: true, providerId: 'antigravity' },
        mockCatalog, true, false
      ),
      false
    );

    // Creating enabled agent with usable provider is allowed
    assert.equal(
      computeCanConfirmCreate(
        { name: 'Worker', modelId: 'cursor-fast', enabled: true, providerId: 'cursor' },
        mockCatalog, true, false
      ),
      true
    );
  });
});
