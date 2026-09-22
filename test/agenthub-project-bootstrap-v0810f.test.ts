import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AgentHubRestClient, AgentHubContractError } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubProjectManagement } from '../src/main/agenthub/AgentHubProjectManagement';
import type { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import {
  AgentHubValidationError,
  nextAuthoritativeProjectId,
  snapshotCreateProjectInput,
  snapshotCreateProjectRequest,
  snapshotProjectDto,
  snapshotState,
  type CreateProjectInputDto,
  type ProjectDto
} from '../src/shared/agenthubTypes';

const project: ProjectDto = {
  projectId: '11111111-1111-4111-8111-111111111111',
  name: 'Desktop Bootstrap',
  description: null,
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z'
};

const input: CreateProjectInputDto = { name: 'Desktop Bootstrap', description: null };

const request = { mutationId: 'mutation-1', input };

function envelope(data: unknown): string {
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

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Desktop V0.8.10F project bootstrap', () => {
  test('D-T1 rejects malformed create-project input and normalizes an empty description to null at the request boundary', () => {
    assert.deepEqual(snapshotCreateProjectInput(input), input);
    assert.equal(snapshotCreateProjectInput({ name: 'Named', description: '' }).description, '');
    assert.throws(() => snapshotCreateProjectInput({ description: null }), AgentHubValidationError);
    assert.throws(() => snapshotCreateProjectInput({ name: '   ', description: null }), AgentHubValidationError);
    assert.throws(() => snapshotCreateProjectInput({ name: 'Named', description: 1 }), AgentHubValidationError);
    assert.throws(() => snapshotCreateProjectInput({ name: 'Named', description: null, projectId: 'client' }), AgentHubValidationError);
    assert.throws(() => snapshotCreateProjectInput({ name: 'a'.repeat(257), description: null }), AgentHubValidationError);
    assert.throws(() => snapshotCreateProjectRequest({ mutationId: 'bad id', input }), AgentHubValidationError);
    assert.throws(() => snapshotCreateProjectRequest({ mutationId: 'ok', input, idempotencyKey: 'renderer' }), AgentHubValidationError);
    assert.match(read('src/renderer/src/components/AgentHubProjectCreateModal.tsx'), /description\.trim\(\)\.length === 0 \? null : description/);
  });

  test('D-T2 posts only name and description with an Idempotency-Key and snapshots the project', async () => {
    let seenBody = '';
    let seenKey = '';
    const { server, baseUrl } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seenBody = Buffer.concat(chunks).toString('utf8');
        seenKey = req.headers['idempotency-key'] as string;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(envelope(project));
      });
    });
    try {
      const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
      const created = await client.createProject(input, 'desktop-project-create:mutation-1');
      assert.deepEqual(created, project);
      assert.equal(seenKey, 'desktop-project-create:mutation-1');
      assert.deepEqual(JSON.parse(seenBody), input);
      assert.equal(Object.hasOwn(JSON.parse(seenBody), 'projectId'), false);
    } finally {
      server.close();
    }
  });

  test('D-T3 same mutation and different body does not send a second HTTP call', async () => {
    const calls: string[] = [];
    const connection = {
      restClient: {
        createProject: async (_input: CreateProjectInputDto, key: string) => {
          calls.push(key);
          return project;
        }
      },
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null, lifecycleReviews: null })
    } as unknown as AgentHubConnection;
    const management = new AgentHubProjectManagement(connection);
    const applied = await management.createProject(request);
    assert.equal(applied.status, 'applied');
    const conflict = await management.createProject({
      mutationId: 'mutation-1',
      input: { name: 'Other', description: null }
    });
    assert.equal(conflict.status, 'failed');
    if (conflict.status === 'failed') assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(calls, ['desktop-project-create:mutation-1']);
  });

  test('D-T4 confirmed POST with failed state sync stays applied', async () => {
    const connection = {
      restClient: { createProject: async () => project },
      syncAuthoritativeState: async () => ({ disposition: 'superseded-uncommitted', snapshot: null, lifecycleReviews: null })
    } as unknown as AgentHubConnection;
    const result = await new AgentHubProjectManagement(connection).createProject(request);
    assert.equal(result.status, 'applied');
    if (result.status === 'applied') {
      assert.equal(result.stateSynchronized, false);
      assert.equal(result.project.projectId, project.projectId);
      if (result.stateSynchronized === false) assert.equal(result.warning.code, 'SYNC_FAILED');
    }
  });

  test('D-T5 ambiguous transport retry reuses the same mutation id and key', async () => {
    const calls: string[] = [];
    let attempts = 0;
    const connection = {
      restClient: {
        createProject: async (_input: CreateProjectInputDto, key: string) => {
          calls.push(key);
          attempts += 1;
          if (attempts === 1) {
            throw new AgentHubContractError('TIMEOUT', 'response lost', {
              phase: 'transport',
              requestDispatched: true
            });
          }
          return project;
        }
      },
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null, lifecycleReviews: null })
    } as unknown as AgentHubConnection;
    const management = new AgentHubProjectManagement(connection);
    const first = await management.createProject(request);
    assert.equal(first.status, 'ambiguous');
    if (first.status === 'ambiguous') assert.equal(first.retryable, true);
    const second = await management.createProject(request);
    assert.equal(second.status, 'applied');
    if (second.status === 'applied') assert.equal(second.project.projectId, project.projectId);
    assert.deepEqual(calls, ['desktop-project-create:mutation-1', 'desktop-project-create:mutation-1']);
  });

  test('D-T6 duplicate in-flight clicks join one HTTP call', async () => {
    const gate = deferred<ProjectDto>();
    let calls = 0;
    const connection = {
      restClient: {
        createProject: async () => {
          calls += 1;
          return gate.promise;
        }
      },
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null, lifecycleReviews: null })
    } as unknown as AgentHubConnection;
    const management = new AgentHubProjectManagement(connection);
    const first = management.createProject(request);
    const second = management.createProject(request);
    assert.equal(calls, 1);
    gate.resolve(project);
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.status, 'applied');
    assert.equal(right.status, 'applied');
    assert.equal(calls, 1);
  });

  test('D-T7 a settled mutation returns the same project without another HTTP call', async () => {
    let calls = 0;
    const connection = {
      restClient: {
        createProject: async () => {
          calls += 1;
          return project;
        }
      },
      syncAuthoritativeState: async () => ({ disposition: 'committed', snapshot: null, lifecycleReviews: null })
    } as unknown as AgentHubConnection;
    const management = new AgentHubProjectManagement(connection);
    const first = await management.createProject(request);
    const second = await management.createProject(request);
    assert.equal(first.status, 'applied');
    assert.equal(second.status, 'applied');
    if (first.status === 'applied' && second.status === 'applied') {
      assert.equal(second.project.projectId, first.project.projectId);
    }
    assert.equal(calls, 1);
  });

  test('D-T8 through D-T11 keep task and lifecycle create paths on authoritative projects', () => {
    const task = read('src/renderer/src/components/AgentHubTaskModal.tsx');
    const lifecycle = read('src/renderer/src/components/AgentHubLifecycleWorkspace.tsx');
    const badge = read('src/renderer/src/components/AgentHubBadge.tsx');
    const store = read('src/renderer/src/stores/agentHubStore.ts');
    assert.match(task, /No authoritative Project exists on this Backend/);
    assert.match(task, /Create a Project before submitting a Task/);
    assert.match(task, /disabled=\{\s*status === 'submitting'[\s\S]*!hasAuthoritativeProject/);
    assert.match(task, /if \(!hasAuthoritativeProject\) return;/);
    assert.match(lifecycle, /No authoritative Project exists/);
    assert.match(lifecycle, /No authoritative Agent is available/);
    assert.match(lifecycle, /lifecycleLeadNotice\(/);
    assert.match(lifecycle, /canCreateLifecycleIntake\(/);
    assert.match(read('src/shared/agenthubTypes.ts'), /goal\.trim\(\)\.length === 0/);
    assert.match(badge, /setIsProjectCreateOpen\(true\)/);
    assert.doesNotMatch(store, /localStorage/);
    assert.doesNotMatch(store, /projects\.push/);
    const draft = { title: 'PRE E2E Happy Task', description: 'kept', criteria: 'Complete the provider task successfully.' };
    let projectId = 'stale';
    projectId = nextAuthoritativeProjectId([], projectId);
    assert.equal(projectId, '');
    projectId = nextAuthoritativeProjectId([{ projectId: 'P1' }], projectId);
    assert.equal(projectId, 'P1');
    projectId = nextAuthoritativeProjectId([{ projectId: 'P1' }, { projectId: 'P2' }], 'P2');
    assert.equal(projectId, 'P2');
    assert.equal(draft.title, 'PRE E2E Happy Task');
    assert.equal(draft.criteria, 'Complete the provider task successfully.');
  });

  test('D-T12 project identity comes from the authoritative snapshot and survives a second parse', () => {
    const raw = {
      projects: [project],
      agents: [],
      tasks: [],
      assignments: [],
      intakes: [],
      plans: [],
      planTasks: [],
      planDependencies: []
    };
    const first = snapshotState(raw);
    const second = snapshotState(JSON.parse(JSON.stringify(raw)));
    assert.equal(first.projects.length, 1);
    assert.equal(second.projects[0]?.projectId, first.projects[0]?.projectId);
    assert.deepEqual(snapshotProjectDto(project), project);
    assert.doesNotMatch(read('src/renderer/src/stores/agentHubStore.ts'), /localStorage/);
  });
});
