import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AgentHubRestClient, AgentHubContractError } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubAgentManagement } from '../src/main/agenthub/AgentHubAgentManagement';
import type { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import {
  snapshotAgentDto,
  snapshotCreateAgentInput,
  snapshotUpdateAgentInput,
  snapshotCreateAgentRequest,
  snapshotUpdateAgentRequest,
  snapshotAgentDeleteDto,
  AgentHubValidationError,
  type AgentDto,
  type CreateAgentInputDto
} from '../src/shared/agenthubTypes';
import { useAgentHubAgentMutationStore } from '../src/renderer/src/stores/agentHubAgentMutationStore';

const TIMEOUT = 8000;

const validAgent: AgentDto = {
  agentId: 'agent-1',
  projectId: null,
  name: 'Worker',
  providerId: 'claude',
  modelId: 'claude-sonnet-4',
  position: 'Developer',
  status: 'IDLE',
  allowedComplexities: ['SIMPLE'],
  allowedRiskLevels: ['LOW'],
  capabilities: ['coding'],
  specialties: ['ts'],
  authority: 'STANDARD',
  routingPriority: 1,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const validCreate: CreateAgentInputDto = {
  projectId: null,
  name: 'Worker',
  providerId: 'claude',
  modelId: 'claude-sonnet-4',
  position: 'Developer',
  allowedComplexities: ['SIMPLE'],
  allowedRiskLevels: ['LOW'],
  capabilities: ['coding'],
  specialties: ['ts'],
  authority: 'STANDARD',
  routingPriority: 1,
  enabled: true
};

function envelope(data: unknown, status = 200): string {
  return JSON.stringify({ ok: true, requestId: 'req-1', data });
}

function listen(handler: http.RequestListener): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

describe('AgentHub V0.8.7 Agent DTO and request validation', () => {
  test('AgentDto requires exact modelId and rejects blank/missing/raw model-only payloads', { timeout: 5000 }, () => {
    assert.equal(snapshotAgentDto(validAgent).modelId, 'claude-sonnet-4');
    assert.throws(() => snapshotAgentDto({ ...validAgent, modelId: undefined }), AgentHubValidationError);
    assert.throws(() => snapshotAgentDto({ ...validAgent, modelId: '   ' }), AgentHubValidationError);
    const { modelId: _ignored, ...withoutModelId } = validAgent as AgentDto & { model?: string };
    assert.throws(() => snapshotAgentDto({ ...withoutModelId, model: 'legacy' }), AgentHubValidationError);
  });

  test('CreateAgent rejects extra keys; UpdateAgent rejects status/enabled/projectId', { timeout: 5000 }, () => {
    assert.equal(snapshotCreateAgentInput(validCreate).modelId, 'claude-sonnet-4');
    assert.throws(() => snapshotCreateAgentInput({ ...validCreate, extra: true }), AgentHubValidationError);
    assert.throws(() => snapshotCreateAgentRequest({ mutationId: '', input: validCreate, method: 'POST' }), AgentHubValidationError);
    const update = snapshotUpdateAgentInput({
      name: 'Worker', providerId: 'claude', modelId: 'claude-sonnet-4', position: 'Developer',
      allowedComplexities: ['SIMPLE'], allowedRiskLevels: ['LOW'], capabilities: ['coding'],
      specialties: ['ts'], authority: 'STANDARD', routingPriority: 1
    });
    assert.throws(() => snapshotUpdateAgentInput({ ...update, status: 'IDLE' }), AgentHubValidationError);
    assert.throws(() => snapshotUpdateAgentInput({ ...update, enabled: true }), AgentHubValidationError);
    assert.throws(() => snapshotUpdateAgentInput({ ...update, projectId: null }), AgentHubValidationError);
    assert.throws(() => snapshotUpdateAgentRequest({ mutationId: 'id', agentId: '', input: update }), AgentHubValidationError);
  });
});

describe('AgentHub V0.8.7 RestClient agent routes', () => {
  test('createAgent POSTs exact route/body/key and preserves modelId', { timeout: TIMEOUT }, async () => {
    let captured = { method: '', url: '', key: '', body: '' };
    const { server, baseUrl } = await listen((req, res) => {
      captured = { method: req.method ?? '', url: req.url ?? '', key: String(req.headers['idempotency-key'] ?? ''), body: '' };
      req.on('data', (chunk) => { captured.body += chunk; });
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(envelope(validAgent, 201));
      });
    });
    try {
      const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
      const agent = await client.createAgent(validCreate, 'desktop-agent-create:mut-1');
      assert.equal(captured.method, 'POST');
      assert.equal(captured.url, '/api/v1/agents');
      assert.equal(captured.key, 'desktop-agent-create:mut-1');
      assert.deepEqual(JSON.parse(captured.body), validCreate);
      assert.equal(agent.modelId, 'claude-sonnet-4');
    } finally {
      server.close();
    }
  });

  test('update/enable/disable/delete use exact methods, empty enable body, and exact delete DTO', { timeout: TIMEOUT }, async () => {
    const seen: Array<{ method: string; url: string; body: string; key: string }> = [];
    const { server, baseUrl } = await listen((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', body, key: String(req.headers['idempotency-key'] ?? '') });
        if (req.method === 'DELETE') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(envelope({ agentId: 'agent-1', deleted: true }));
          return;
        }
        res.writeHead(req.url === '/api/v1/agents' ? 201 : 200, { 'Content-Type': 'application/json' });
        res.end(envelope(validAgent));
      });
    });
    const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
    try {
      await client.updateAgent('agent-1', {
        name: 'Worker', providerId: 'claude', modelId: 'claude-opus-4', position: 'Developer',
        allowedComplexities: ['SIMPLE'], allowedRiskLevels: ['LOW'], capabilities: ['coding'],
        specialties: ['ts'], authority: 'STANDARD', routingPriority: 1
      }, 'desktop-agent-update:mut-2');
      await client.enableAgent('agent-1', 'desktop-agent-enable:mut-3');
      await client.disableAgent('agent-1', 'desktop-agent-disable:mut-4');
      const deleted = await client.deleteAgent('agent-1', 'desktop-agent-delete:mut-5');
      assert.equal(seen[0]?.method, 'PUT');
      assert.equal(seen[0]?.url, '/api/v1/agents/agent-1');
      assert.equal(seen[1]?.method, 'POST');
      assert.equal(seen[1]?.url, '/api/v1/agents/agent-1/enable');
      assert.equal(seen[1]?.body, '{}');
      assert.equal(seen[2]?.url, '/api/v1/agents/agent-1/disable');
      assert.equal(seen[3]?.method, 'DELETE');
      assert.equal(seen[3]?.url, '/api/v1/agents/agent-1');
      assert.deepEqual(deleted, { agentId: 'agent-1', deleted: true });
      assert.throws(() => snapshotAgentDeleteDto({ agentId: 'agent-1', deleted: true, extra: 1 }), AgentHubValidationError);
    } finally {
      server.close();
    }
  });

  test('redirects are never followed and response overflow is rejected', { timeout: TIMEOUT }, async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(302, { Location: '/elsewhere', 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
    try {
      await assert.rejects(() => client.createAgent(validCreate, 'k'), (err: AgentHubContractError) => err.code === 'REDIRECT_FORBIDDEN');
    } finally {
      server.close();
    }
  });
});

describe('AgentHub V0.8.7 Main agent management', () => {
  test('same mutationId coalesces; different body or operation conflicts with zero extra HTTP', { timeout: TIMEOUT }, async () => {
    let calls = 0;
    const { server, baseUrl } = await listen((req, res) => {
      calls += 1;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(req.method === 'POST' && req.url === '/api/v1/agents' ? 201 : 200, { 'Content-Type': 'application/json' });
        res.end(envelope(validAgent, 201));
      });
    });
    const connection = {
      restClient: new AgentHubRestClient({ baseUrl, timeoutMs: 3000 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection;
    const service = new AgentHubAgentManagement(connection);
    try {
      const req = { mutationId: 'mut-same', input: validCreate };
      const [one, two] = await Promise.all([service.createAgent(req), service.createAgent(req)]);
      assert.equal(one.status, 'applied');
      assert.equal(two.status, 'applied');
      assert.equal(calls, 1);
      const replay = await service.createAgent(req);
      assert.equal(replay.status, 'applied');
      assert.equal(calls, 1);
      const conflictBody = await service.createAgent({ mutationId: 'mut-same', input: { ...validCreate, name: 'Other' } });
      assert.equal(conflictBody.status, 'failed');
      if (conflictBody.status === 'failed') assert.equal(conflictBody.error.code, 'IDEMPOTENCY_CONFLICT');
      const conflictOp = await service.enableAgent({ mutationId: 'mut-same', agentId: 'agent-1' });
      assert.equal(conflictOp.status, 'failed');
      assert.equal(calls, 1);
    } finally {
      service.stop();
      server.close();
    }
  });

  test('definitive backend failures are failed; timeout/network/reconciliation are classified correctly', { timeout: TIMEOUT }, async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false, requestId: 'e', error: { code: 'AGENTHUB_API_CONFLICT', message: 'busy' }
      }));
    });
    const connection = {
      restClient: new AgentHubRestClient({ baseUrl, timeoutMs: 3000 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection;
    const service = new AgentHubAgentManagement(connection);
    try {
      const failed = await service.createAgent({ mutationId: 'mut-fail', input: validCreate });
      assert.equal(failed.status, 'failed');
      if (failed.status === 'failed') assert.equal(failed.retryable, false);
    } finally {
      service.stop();
      server.close();
    }

    const hung = await listen((_req) => { /* never respond */ });
    const timeoutConn = {
      restClient: new AgentHubRestClient({ baseUrl: hung.baseUrl, timeoutMs: 50 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection;
    const timeoutService = new AgentHubAgentManagement(timeoutConn);
    try {
      const timed = await timeoutService.createAgent({ mutationId: 'mut-timeout', input: validCreate });
      assert.equal(timed.status, 'ambiguous');
      if (timed.status === 'ambiguous') assert.equal(timed.retryable, true);
    } finally {
      timeoutService.stop();
      hung.server.close();
    }

    const recon = await listen((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false, requestId: 'r',
        error: { code: 'AGENTHUB_API_RUNTIME_RECONCILIATION_REQUIRED', message: 'reconcile' }
      }));
    });
    const reconConn = {
      restClient: new AgentHubRestClient({ baseUrl: recon.baseUrl, timeoutMs: 3000 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection;
    const reconService = new AgentHubAgentManagement(reconConn);
    try {
      const result = await reconService.createAgent({ mutationId: 'mut-recon', input: validCreate });
      assert.equal(result.status, 'ambiguous');
      if (result.status === 'ambiguous') assert.equal(result.retryable, false);
    } finally {
      reconService.stop();
      recon.server.close();
    }
  });

  test('applied mutation with /state failure stays applied and unsynchronized', { timeout: TIMEOUT }, async () => {
    const { server, baseUrl } = await listen((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(envelope(validAgent, 201));
      });
    });
    const connection = {
      restClient: new AgentHubRestClient({ baseUrl, timeoutMs: 3000 }),
      syncAuthoritativeState: async () => { throw new AgentHubContractError('SYNC_FAILED', 'state failed'); }
    } as unknown as AgentHubConnection;
    const service = new AgentHubAgentManagement(connection);
    try {
      const result = await service.createAgent({ mutationId: 'mut-sync', input: validCreate });
      assert.equal(result.status, 'applied');
      if (result.status === 'applied') assert.equal(result.stateSynchronized, false);
    } finally {
      service.stop();
      server.close();
    }
  });
});

describe('AgentHub V0.8.7 mutation store and UI authority', () => {
  test('memory-only store rotates ID after ambiguous edit and retries reuse the same ID', { timeout: 5000 }, () => {
    const store = useAgentHubAgentMutationStore.getState();
    store.clearSession();
    const createId = useAgentHubAgentMutationStore.getState().beginCreate();
    useAgentHubAgentMutationStore.getState().markAmbiguous(createId, { code: 'TIMEOUT', message: 'unknown' });
    const same = useAgentHubAgentMutationStore.getState().session?.mutationId;
    assert.equal(same, createId);
    const rotated = useAgentHubAgentMutationStore.getState().rotateAfterEdit(createId, validCreate);
    assert.notEqual(rotated, createId);
    const actionId = useAgentHubAgentMutationStore.getState().beginAction('delete', 'agent-1');
    useAgentHubAgentMutationStore.getState().markAmbiguous(actionId, { code: 'TIMEOUT', message: 'unknown' });
    assert.equal(useAgentHubAgentMutationStore.getState().session?.mutationId, actionId);
    useAgentHubAgentMutationStore.getState().clearSession();
    assert.equal(useAgentHubAgentMutationStore.getState().session, null);
  });

  test('AgentHub management UI does not use legacy roster, spawn, or Force Delete', { timeout: 5000 }, () => {
    const files = [
      'src/renderer/src/components/AgentHubAgentManagementModal.tsx',
      'src/renderer/src/components/AgentHubAgentForm.tsx',
      'src/renderer/src/stores/agentHubAgentMutationStore.ts'
    ];
    for (const relative of files) {
      const source = fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8');
      assert.equal(source.includes('useStore.agents'), false, relative);
      assert.equal(source.includes('addAgent'), false, relative);
      assert.equal(source.includes('spawnPty'), false, relative);
      assert.equal(source.includes('child_process'), false, relative);
      assert.equal(source.includes('Force Delete'), false, relative);
      assert.equal(source.includes('--model'), false, relative);
    }
    const form = fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentForm.tsx'), 'utf8');
    assert.match(form, /Claude Code/);
    assert.match(form, /Codex/);
    assert.match(form, /Cursor/);
    assert.match(form, /Antigravity/);
    assert.equal(form.includes('planned for V0.8.8'), false);
    assert.match(form, /Manual modelId is preserved exactly/);
    const modal = fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentManagementModal.tsx'), 'utf8');
    assert.match(modal, /Retry Same Mutation/);
    assert.match(modal, /AGENT MUTATION OUTCOME UNKNOWN/);
    assert.match(modal, /busy/);
    assert.match(modal, /Only Agents with no Assignment history can be deleted/);
    const app = fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8');
    const emptyIndex = app.indexOf("hubOfficeShellState.kind === 'empty'");
    const unavailableIndex = app.indexOf("hubOfficeShellState.kind === 'unavailable'");
    const emptyBlock = app.slice(emptyIndex, unavailableIndex);
    assert.match(emptyBlock, /CREATE AGENT/);
    assert.match(emptyBlock, /setAgentHubManageOpen\(true\)/);
    assert.equal(emptyBlock.includes('AddAgentModal'), false);
    assert.equal(emptyBlock.includes('setAddAgentOpen'), false);
  });

  test('backend modelId flows into Desktop snapshotAgentDto without legacy synthesis', { timeout: 5000 }, () => {
    const dto = snapshotAgentDto({
      ...validAgent,
      modelId: 'claude-opus-4'
    });
    assert.equal(dto.modelId, 'claude-opus-4');
    assert.equal(JSON.stringify(dto).includes('"model"'), false);
  });
});

describe('AgentHub V0.8.7A Closure Fix — Mutation Lifecycle and Guards', () => {
  test('definitive failed Delete generates fresh mutationId on next logical attempt', { timeout: TIMEOUT }, async () => {
    let callCount = 0;
    const seenKeys: string[] = [];
    const { server, baseUrl } = await listen((req, res) => {
      seenKeys.push(String(req.headers['idempotency-key'] ?? ''));
      callCount += 1;
      if (callCount === 1) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          requestId: 'req-fail',
          error: { code: 'AGENTHUB_API_CONFLICT', message: 'Agent runtime is busy' }
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope({ agentId: 'agent-1', deleted: true }));
    });

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl, timeoutMs: 3000 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection;
    const service = new AgentHubAgentManagement(connection);

    try {
      const store = useAgentHubAgentMutationStore.getState();
      store.clearSession();

      // First logical delete attempt
      const idA = store.startFreshAction('delete', 'agent-1');
      store.markSubmitting(idA);
      const res1 = await service.deleteAgent({ mutationId: idA, agentId: 'agent-1' });
      assert.equal(res1.status, 'failed');
      store.markFailed(idA, res1.error!);

      // actionRequest prevents reusing settled failed session
      assert.equal(store.actionRequest(idA, 'agent-1'), null);

      // Second logical delete attempt: fresh ID
      const idB = store.startFreshAction('delete', 'agent-1');
      assert.notEqual(idB, idA);
      store.markSubmitting(idB);
      const res2 = await service.deleteAgent({ mutationId: idB, agentId: 'agent-1' });
      assert.equal(res2.status, 'applied');
      store.markApplied(idB);

      assert.equal(callCount, 2);
      assert.notEqual(seenKeys[0], seenKeys[1]);
    } finally {
      service.stop();
      server.close();
    }
  });

  test('definitive failed Update generates fresh mutationId on next logical attempt', { timeout: TIMEOUT }, async () => {
    let callCount = 0;
    const seenKeys: string[] = [];
    const updateInput = {
      name: 'Worker Renamed', providerId: 'claude', modelId: 'claude-sonnet-4', position: 'Developer',
      allowedComplexities: ['SIMPLE'] as const, allowedRiskLevels: ['LOW'] as const,
      capabilities: ['coding'], specialties: ['ts'], authority: 'STANDARD' as const, routingPriority: 1
    };
    const { server, baseUrl } = await listen((req, res) => {
      seenKeys.push(String(req.headers['idempotency-key'] ?? ''));
      callCount += 1;
      if (callCount === 1) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          requestId: 'req-fail',
          error: { code: 'AGENTHUB_API_CONFLICT', message: 'Agent runtime is busy' }
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope({ ...validAgent, name: 'Worker Renamed' }));
    });

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl, timeoutMs: 3000 }),
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null })
    } as unknown as AgentHubConnection;
    const service = new AgentHubAgentManagement(connection);

    try {
      const store = useAgentHubAgentMutationStore.getState();
      store.clearSession();

      const idA = store.startFreshUpdate('agent-1', updateInput);
      store.markSubmitting(idA);
      const res1 = await service.updateAgent({ mutationId: idA, agentId: 'agent-1', input: updateInput });
      assert.equal(res1.status, 'failed');
      store.markFailed(idA, res1.error!);

      assert.equal(store.updateRequest(idA, 'agent-1', updateInput), null);

      const idB = store.startFreshUpdate('agent-1', updateInput);
      assert.notEqual(idB, idA);
      store.markSubmitting(idB);
      const res2 = await service.updateAgent({ mutationId: idB, agentId: 'agent-1', input: updateInput });
      assert.equal(res2.status, 'applied');
      store.markApplied(idB);

      assert.equal(callCount, 2);
      assert.notEqual(seenKeys[0], seenKeys[1]);
    } finally {
      service.stop();
      server.close();
    }
  });

  test('ambiguous session reuses ID on retrySame, but rotates and clears on edit', { timeout: 5000 }, () => {
    useAgentHubAgentMutationStore.getState().clearSession();

    const idA = useAgentHubAgentMutationStore.getState().startFreshCreate();
    useAgentHubAgentMutationStore.getState().markSubmitting(idA);
    useAgentHubAgentMutationStore.getState().markAmbiguous(idA, { code: 'NETWORK_TIMEOUT', message: 'timeout' });
    assert.equal(useAgentHubAgentMutationStore.getState().session?.status, 'ambiguous');
    assert.equal(useAgentHubAgentMutationStore.getState().session?.mutationId, idA);

    // retrySame keeps the exact same mutationId
    const sameId = useAgentHubAgentMutationStore.getState().session?.mutationId;
    assert.equal(sameId, idA);

    // User edits form in ambiguous state: rotateAfterEdit generates idB, clears error and restores idle
    const idB = useAgentHubAgentMutationStore.getState().rotateAfterEdit(idA, { ...validCreate, name: 'Renamed Worker' });
    assert.notEqual(idB, idA);
    assert.equal(useAgentHubAgentMutationStore.getState().session?.status, 'idle');
    assert.equal(useAgentHubAgentMutationStore.getState().session?.error, undefined);
    assert.equal(useAgentHubAgentMutationStore.getState().session?.mutationId, idB);
  });

  test('Enable guard logic is fail-closed across supported, unsupported, already-enabled, and BUSY agents', { timeout: 5000 }, () => {
    const supportedProviders = ['claude', 'codex'];
    function checkCanEnable(selected: { enabled: boolean; status: string; providerId: string } | null, mutationsUsable: boolean, submitting: boolean): boolean {
      if (!selected) return false;
      const busy = selected.status === 'BUSY';
      return (
        mutationsUsable &&
        !submitting &&
        !busy &&
        !selected.enabled &&
        supportedProviders.includes(selected.providerId)
      );
    }

    function checkCanDisable(selected: { enabled: boolean; status: string; providerId: string } | null, mutationsUsable: boolean, submitting: boolean): boolean {
      if (!selected) return false;
      const busy = selected.status === 'BUSY';
      return (
        mutationsUsable &&
        !submitting &&
        !busy &&
        selected.enabled
      );
    }

    // supported + disabled + IDLE -> canEnable = true
    assert.equal(checkCanEnable({ enabled: false, status: 'DISABLED', providerId: 'claude' }, true, false), true);

    // unsupported + disabled -> canEnable = false
    assert.equal(checkCanEnable({ enabled: false, status: 'DISABLED', providerId: 'cursor' }, true, false), false);
    assert.equal(checkCanEnable({ enabled: false, status: 'DISABLED', providerId: 'antigravity' }, true, false), false);

    // already enabled -> canEnable = false
    assert.equal(checkCanEnable({ enabled: true, status: 'IDLE', providerId: 'claude' }, true, false), false);

    // BUSY -> canEnable = false, canDisable = false
    assert.equal(checkCanEnable({ enabled: false, status: 'BUSY', providerId: 'claude' }, true, false), false);
    assert.equal(checkCanDisable({ enabled: true, status: 'BUSY', providerId: 'claude' }, true, false), false);

    // already disabled -> canDisable = false
    assert.equal(checkCanDisable({ enabled: false, status: 'DISABLED', providerId: 'claude' }, true, false), false);

    // enabled + IDLE -> canDisable = true
    assert.equal(checkCanDisable({ enabled: true, status: 'IDLE', providerId: 'claude' }, true, false), true);
  });

  test('Modal UI enforces ambiguous form edit reachability, reconciliation guard, and fail-closed buttons', { timeout: 5000 }, () => {
    const modal = fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/src/components/AgentHubAgentManagementModal.tsx'), 'utf8');

    // Ambiguous form is not globally disabled
    assert.equal(modal.includes('disabled={formDisabled || ambiguous}'), false, 'Create form should not disable on ambiguous');
    assert.equal(modal.includes('disabled={formDisabled || ambiguous || busy}'), false, 'Edit form should not disable on ambiguous');
    assert.match(modal, /disabled=\{formDisabled\}/, 'Create form disabled depends only on formDisabled');
    assert.match(modal, /disabled=\{formDisabled \|\| busy\}/, 'Edit form disabled depends on formDisabled || busy');

    // Reconciliation disables Retry Same Mutation
    assert.match(modal, /isReconciliation/);
    assert.match(modal, /Refresh or restart AgentHub before another Agent mutation\./);

    // Fail-closed guards for Enable and Disable
    assert.match(modal, /canEnable/);
    assert.match(modal, /canDisable/);
    assert.match(modal, /!selected\.enabled/);
    assert.match(modal, /providerSupported\(selected\.providerId\)/);

    // Fresh mutation lifecycle used on modal open/create
    assert.match(modal, /startFreshCreate/);
    assert.match(modal, /startFreshUpdate/);
    assert.match(modal, /startFreshAction/);
  });
});
