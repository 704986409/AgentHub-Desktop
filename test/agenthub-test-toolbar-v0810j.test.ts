import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  assertDeletableTestDatabase,
  deleteTestDatabaseFiles,
  isAgentHubTestMode,
  resetTestDatabase,
  testDatabasePath,
  type TestResetDependencies
} from '../src/main/agenthub/AgentHubTestReset';

const empty = {
  projects: 0,
  agents: 0,
  plans: 0,
  tasks: 0,
  assignments: 0,
  reviews: 0
};

function deps(overrides: Partial<TestResetDependencies> = {}): TestResetDependencies {
  const localAppData = path.join(os.tmpdir(), 'agenthub-reset-unit');
  const backendRoot = path.join(localAppData, 'backend');
  fs.mkdirSync(path.join(backendRoot, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(backendRoot, 'dist', 'cli.js'), '');
  return {
    testMode: true,
    localAppData,
    backendRoot: path.join(localAppData, 'backend'),
    port: 3210,
    starterPath: 'starter.mjs',
    probePort: async () => false,
    stopOwnedProcess: async () => undefined,
    ownsPort: async () => false,
    startProcess: async () => undefined,
    deleteDatabaseFiles: () => undefined,
    health: async () => undefined,
    stateCounts: async () => empty,
    ...overrides
  };
}

describe('AgentHub test database reset', () => {
  test('test mode is only the explicit flag', () => {
    assert.equal(isAgentHubTestMode({ AGENTHUB_TEST_MODE: '1' }), true);
    assert.equal(isAgentHubTestMode({ AGENTHUB_TEST_MODE: 'true', NODE_ENV: 'development' }), false);
    assert.equal(isAgentHubTestMode({ NODE_ENV: 'development' }), false);
  });

  test('non-test mode rejects and does not delete', async () => {
    let deleted = 0;
    const result = await resetTestDatabase(deps({
      testMode: false,
      deleteDatabaseFiles: () => { deleted += 1; }
    }));
    assert.deepEqual(result, { ok: false, error: '当前不是测试模式' });
    assert.equal(deleted, 0);
  });

  test('a production database path is rejected before deletion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-prod-'));
    const production = path.join(root, 'AgentHub', 'data', 'agenthub.db');
    fs.mkdirSync(path.dirname(production), { recursive: true });
    fs.writeFileSync(production, 'production');
    assert.throws(() => assertDeletableTestDatabase(production, root), /当前不是 test DB|正式数据库不能删除/);
    assert.throws(() => deleteTestDatabaseFiles(production, root), /当前不是 test DB|正式数据库不能删除/);
    assert.equal(fs.readFileSync(production, 'utf8'), 'production');
    const allowed = testDatabasePath(root);
    fs.mkdirSync(path.dirname(allowed), { recursive: true });
    fs.writeFileSync(allowed, 'test');
    fs.writeFileSync(`${allowed}-wal`, 'wal');
    deleteTestDatabaseFiles(allowed, root);
    assert.equal(fs.existsSync(allowed), false);
    assert.equal(fs.existsSync(`${allowed}-wal`), false);
    assert.equal(fs.readFileSync(production, 'utf8'), 'production');
  });

  test('a foreign listener is refused and the database is not deleted', async () => {
    let deleted = 0;
    const result = await resetTestDatabase(deps({
      probePort: async () => true,
      ownsPort: async () => false,
      deleteDatabaseFiles: () => { deleted += 1; }
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /已拒绝清空/);
    assert.equal(deleted, 0);
  });

  test('a second reset during the first does not start another clear', async () => {
    let starts = 0;
    let release: (open: boolean) => void = () => undefined;
    const probe = new Promise<boolean>((resolve) => { release = resolve; });
    const options = deps({
      probePort: () => probe,
      startProcess: async () => { starts += 1; }
    });
    const first = resetTestDatabase(options);
    const second = await resetTestDatabase(options);
    assert.deepEqual(second, { ok: false, error: '正在清空' });
    release(false);
    const completed = await first;
    assert.deepEqual(completed, { ok: true, databaseName: 'agenthub-test.db' });
    assert.equal(starts, 1);
  });

  test('health failure and a non-empty state are errors', async () => {
    const unhealthy = await resetTestDatabase(deps({
      health: async () => { throw new Error('/health 超时'); }
    }));
    assert.deepEqual(unhealthy, { ok: false, error: '/health 超时' });
    const remaining = await resetTestDatabase(deps({
      stateCounts: async () => ({ ...empty, projects: 2 })
    }));
    assert.deepEqual(remaining, { ok: false, error: '/state 校验失败，测试数据未清空' });
  });

  test('bridge copy is Chinese and the toolbar is test-mode only', () => {
    const badge = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/components/AgentHubBadge.tsx'), 'utf8');
    const app = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8');
    const preload = fs.readFileSync(path.join(process.cwd(), 'src/preload/index.ts'), 'utf8');
    assert.match(app, /自动模式：开启/);
    assert.match(app, /自动模式：关闭/);
    assert.match(badge, /AgentHub 桌面连接/);
    assert.match(badge, /后端地址：/);
    assert.match(badge, /连接状态：/);
    assert.match(badge, /后端版本：/);
    assert.match(badge, /（兼容）/);
    assert.match(badge, /\+ 提交新任务/);
    assert.match(badge, /\+ 创建项目/);
    assert.match(badge, /管理 Agent/);
    assert.match(badge, /计划与生命周期/);
    assert.match(badge, /执行任务/);
    assert.match(badge, /审查结果/);
    assert.match(badge, /点击顶部状态栏刷新数据/);
    assert.match(badge, /\{testMode && \([\s\S]*data-testid="agenthub-test-toolbar"/);
    assert.match(badge, /🗑 一键清空测试数据/);
    assert.match(badge, /🔄 刷新状态/);
    assert.match(badge, /确认清空测试数据库？/);
    assert.match(badge, /正式数据库不会受到影响/);
    assert.equal(badge.includes('deleteFile'), false);
    assert.equal(badge.includes('runSql'), false);
    const api = preload.slice(preload.indexOf('const agentHubApi'), preload.indexOf("exposeInMainWorld('agentHub'"));
    assert.match(api, /isTestMode:/);
    assert.match(api, /resetTestDatabase:/);
    assert.equal(api.includes('deleteFile'), false);
    assert.equal(api.includes('runSql'), false);
    assert.equal(api.includes('fetch:'), false);
  });
});

describe('AgentHub test backend isolation', () => {
  test('clearing the isolated test database returns every business count to zero', async () => {
    const backendRoot = path.resolve(process.cwd(), '..', 'AgentHub');
    const cli = path.join(backendRoot, 'dist', 'cli.js');
    if (!fs.existsSync(cli)) return;
    const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-live-'));
    const port = await freePort();
    const {
      startOwnedTestBackend,
      stopOwnedTestBackend,
      fetchJson,
      probeLocalPort
    } = await import('../src/main/agenthub/AgentHubTestReset');
    const starterPath = path.join(process.cwd(), 'src', 'main', 'agenthub', 'start-test-backend.mjs');
    try {
      await startOwnedTestBackend({ backendRoot, localAppData, port, starterPath });
      const created = await postJson(port, '/api/v1/projects', { name: 'Clear Me', description: null });
      assert.equal(created.status, 201);
      const before = await businessCounts(port);
      assert.equal(before.projects, 1);
      const result = await resetTestDatabase({
        testMode: true,
        localAppData,
        backendRoot,
        port,
        starterPath,
        probePort: probeLocalPort,
        ownsPort: async () => true,
        stopOwnedProcess: () => stopOwnedTestBackend(localAppData, port),
        startProcess: () => startOwnedTestBackend({ backendRoot, localAppData, port, starterPath }),
        deleteDatabaseFiles: (databasePath) => deleteTestDatabaseFiles(databasePath, localAppData),
        health: async (targetPort) => {
          const response = await fetchJson(targetPort, '/api/v1/health');
          const data = (response.body as { data?: { status?: string } }).data;
          if (response.status !== 200 || data?.status !== 'ok') throw new Error('/health 超时');
        },
        stateCounts: (targetPort) => businessCounts(targetPort)
      });
      assert.deepEqual(result, { ok: true, databaseName: 'agenthub-test.db' });
      assert.deepEqual(await businessCounts(port), empty);
      const production = path.resolve(process.env.LOCALAPPDATA || '', 'AgentHub', 'data', 'agenthub.db');
      if (fs.existsSync(production)) assert.equal(fs.existsSync(production), true);
    } finally {
      await stopOwnedTestBackend(localAppData, port);
    }
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      listener.close(() => resolve(port));
    });
    listener.on('error', reject);
  });
}

function postJson(port: number, requestPath: string, body: unknown): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'idempotency-key': `test-${Date.now()}`
      }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function businessCounts(port: number) {
  const { fetchJson } = await import('../src/main/agenthub/AgentHubTestReset');
  const response = await fetchJson(port, '/api/v1/state');
  const data = (response.body as { data?: Record<string, unknown[]> }).data ?? {};
  const reviews = await fetchJson(port, '/api/v1/reviews');
  const reviewData = (reviews.body as { data?: unknown[] }).data;
  return {
    projects: data.projects?.length ?? -1,
    agents: data.agents?.length ?? -1,
    plans: data.plans?.length ?? -1,
    tasks: data.tasks?.length ?? -1,
    assignments: data.assignments?.length ?? -1,
    reviews: Array.isArray(reviewData) ? reviewData.length : -1
  };
}
