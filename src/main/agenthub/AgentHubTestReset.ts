import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const TEST_DATABASE_LABEL = 'agenthub-test.db';
export const TEST_DATABASE_FILE = 'agenthub.db';

export type ResetTestDatabaseResult =
  | { ok: true; databaseName: string }
  | { ok: false; error: string };

export interface TestResetDependencies {
  readonly testMode: boolean;
  readonly localAppData: string;
  readonly backendRoot: string;
  readonly port: number;
  readonly starterPath: string;
  probePort: (port: number) => Promise<boolean>;
  stopOwnedProcess: () => Promise<void>;
  ownsPort: () => Promise<boolean>;
  startProcess: () => Promise<void>;
  deleteDatabaseFiles: (databasePath: string) => void;
  health: (port: number) => Promise<void>;
  stateCounts: (port: number) => Promise<{
    projects: number;
    agents: number;
    plans: number;
    tasks: number;
    assignments: number;
    reviews: number;
  }>;
}

let ownedChild: ChildProcess | null = null;
let resetInFlight = false;

export function isAgentHubTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTHUB_TEST_MODE === '1';
}

export function testDataDirectory(localAppData: string): string {
  return path.resolve(localAppData, 'AgentHub', 'test-data');
}

export function testDatabasePath(localAppData: string): string {
  return path.resolve(testDataDirectory(localAppData), TEST_DATABASE_FILE);
}

export function assertDeletableTestDatabase(candidate: string, localAppData: string): void {
  const allowed = testDatabasePath(localAppData);
  const resolved = path.resolve(candidate);
  if (resolved.toLowerCase() !== allowed.toLowerCase()) {
    throw new Error('当前不是 test DB');
  }
  if (path.basename(resolved).toLowerCase() !== TEST_DATABASE_FILE) {
    throw new Error('当前不是 test DB');
  }
  if (!resolved.toLowerCase().includes(`${path.sep}test-data${path.sep}`.toLowerCase())) {
    throw new Error('当前不是 test DB');
  }
  const production = path.resolve(localAppData, 'AgentHub', 'data', 'agenthub.db');
  if (resolved.toLowerCase() === production.toLowerCase()) {
    throw new Error('正式数据库不能删除');
  }
}

export async function resetTestDatabase(deps: TestResetDependencies): Promise<ResetTestDatabaseResult> {
  if (!deps.testMode) return { ok: false, error: '当前不是测试模式' };
  if (resetInFlight) return { ok: false, error: '正在清空' };
  resetInFlight = true;
  try {
    const databasePath = testDatabasePath(deps.localAppData);
    assertDeletableTestDatabase(databasePath, deps.localAppData);
    const portBusy = await deps.probePort(deps.port);
    if (portBusy && !(await deps.ownsPort())) {
      return { ok: false, error: '测试端口被非测试 Backend 占用，已拒绝清空' };
    }
    if (!deps.backendRoot || !existsSync(path.join(deps.backendRoot, 'dist', 'cli.js'))) {
      return { ok: false, error: '找不到测试 Backend' };
    }
    await deps.stopOwnedProcess();
    if (await deps.probePort(deps.port)) {
      return { ok: false, error: '测试 Backend 未退出' };
    }
    deps.deleteDatabaseFiles(databasePath);
    await deps.startProcess();
    await deps.health(deps.port);
    const counts = await deps.stateCounts(deps.port);
    const empty = counts.projects === 0 && counts.agents === 0 && counts.plans === 0
      && counts.tasks === 0 && counts.assignments === 0 && counts.reviews === 0;
    if (!empty) return { ok: false, error: '/state 校验失败，测试数据未清空' };
    return { ok: true, databaseName: TEST_DATABASE_LABEL };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '清空失败' };
  } finally {
    resetInFlight = false;
  }
}

export function defaultLocalAppData(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

export function defaultBackendRoot(): string {
  if (process.env.AGENTHUB_BACKEND_ROOT) return process.env.AGENTHUB_BACKEND_ROOT;
  return path.resolve(process.cwd(), '..', 'AgentHub');
}

export function probeLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function deleteTestDatabaseFiles(databasePath: string, localAppData: string): void {
  assertDeletableTestDatabase(databasePath, localAppData);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${databasePath}${suffix}`;
    if (existsSync(file)) rmSync(file, { force: true });
  }
}

function readOwnedPid(dataDir: string): number | null {
  const pidFile = path.join(dataDir, 'test-backend.pid');
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopOwnedTestBackend(localAppData: string, port = 3210): Promise<void> {
  const dataDir = testDataDirectory(localAppData);
  const pid = ownedChild?.pid ?? readOwnedPid(dataDir);
  const child = ownedChild;
  ownedChild = null;
  if (child && !child.killed) child.kill();
  else if (pid) {
    try { process.kill(pid); } catch { /* already exited */ }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const open = await probeLocalPort(port);
    if (!open && (pid === undefined || pid === null || !pidAlive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (pid) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  if (await probeLocalPort(port)) throw new Error('测试 Backend 未退出');
}

export function ownsTestBackendProcess(): boolean {
  return ownedChild !== null && !ownedChild.killed;
}

export function startOwnedTestBackend(options: {
  backendRoot: string;
  localAppData: string;
  port: number;
  starterPath: string;
}): Promise<void> {
  const dataDir = testDataDirectory(options.localAppData);
  mkdirSync(dataDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [options.starterPath], {
      cwd: options.backendRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AGENTHUB_BACKEND_ROOT: options.backendRoot,
        AGENTHUB_TEST_DATA_DIR: dataDir,
        AGENTHUB_TEST_PORT: String(options.port)
      },
      stdio: 'ignore',
      windowsHide: true
    });
    ownedChild = child;
    child.once('error', reject);
    child.once('exit', (code) => {
      if (ownedChild === child) ownedChild = null;
      reject(new Error(`测试 Backend 退出，代码 ${String(code)}`));
    });
    const started = Date.now();
    const timer = setInterval(() => {
      void probeLocalPort(options.port).then((open) => {
        if (!open) {
          if (Date.now() - started > 15000) {
            clearInterval(timer);
            reject(new Error('/health 超时'));
          }
          return;
        }
        clearInterval(timer);
        child.removeAllListeners('exit');
        child.once('exit', () => {
          if (ownedChild === child) ownedChild = null;
        });
        resolve();
      });
    }, 200);
  });
}

export function fetchJson(port: number, requestPath: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}${requestPath}`, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(8000, () => {
      request.destroy(new Error('/health 超时'));
    });
    request.on('error', reject);
  });
}

function listeningPid(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
        const pid = Number(line.trim().split(/\s+/).at(-1));
        resolve(Number.isInteger(pid) ? pid : null);
        return;
      }
      resolve(null);
    });
  });
}

export async function resetOwnedTestDatabase(): Promise<ResetTestDatabaseResult> {
  const localAppData = defaultLocalAppData();
  const port = 3210;
  return resetTestDatabase({
    testMode: isAgentHubTestMode(),
    localAppData,
    backendRoot: defaultBackendRoot(),
    port,
    starterPath: path.join(process.cwd(), 'src', 'main', 'agenthub', 'start-test-backend.mjs'),
    probePort: probeLocalPort,
    ownsPort: async () => {
      if (ownsTestBackendProcess()) return true;
      const pid = readOwnedPid(testDataDirectory(localAppData));
      if (!pid) return false;
      return (await listeningPid(port)) === pid;
    },
    stopOwnedProcess: () => stopOwnedTestBackend(localAppData),
    startProcess: () => startOwnedTestBackend({
      backendRoot: defaultBackendRoot(),
      localAppData,
      port,
      starterPath: path.join(process.cwd(), 'src', 'main', 'agenthub', 'start-test-backend.mjs')
    }),
    deleteDatabaseFiles: (databasePath) => deleteTestDatabaseFiles(databasePath, localAppData),
    health: async (targetPort) => {
      const response = await fetchJson(targetPort, '/api/v1/health');
      const data = (response.body as { data?: { status?: string } }).data;
      if (response.status !== 200 || data?.status !== 'ok') throw new Error('/health 超时');
    },
    stateCounts: async (targetPort) => {
      const response = await fetchJson(targetPort, '/api/v1/state');
      if (response.status !== 200) throw new Error('/state 校验失败');
      const data = (response.body as { data?: Record<string, unknown[]> }).data ?? {};
      const reviews = await fetchJson(targetPort, '/api/v1/reviews');
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
  });
}
