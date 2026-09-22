import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubTaskExecution } from '../src/main/agenthub/AgentHubTaskExecution';
import { TaskExecutionIdLifecycle } from '../src/shared/agenthubExecutionLifecycle';
import {
  DEFAULT_EXECUTE_BASE_REF,
  EXECUTE_VALIDATION_MESSAGE,
  buildExecuteHttpBody,
  validateExecuteDraft
} from '../src/shared/agenthubExecuteDraft';

const modalPath = path.join(process.cwd(), 'src/renderer/src/components/AgentHubExecuteModal.tsx');
const executionPath = path.join(process.cwd(), 'src/main/agenthub/AgentHubTaskExecution.ts');
const restPath = path.join(process.cwd(), 'src/main/agenthub/AgentHubRestClient.ts');

describe('execute draft contract', () => {
  test('D-01 default base ref is the real value main', () => {
    const ui = fs.readFileSync(modalPath, 'utf8');
    assert.equal(DEFAULT_EXECUTE_BASE_REF, 'main');
    assert.match(ui, /useState\(DEFAULT_EXECUTE_BASE_REF\)/);
    assert.equal(ui.includes('placeholder="main"'), false);
    assert.equal(validateExecuteDraft(DEFAULT_EXECUTE_BASE_REF, 'ship it').ok, true);
  });

  test('D-02 D-03 blank fields stay local and do not mint an execution id', () => {
    const ids = ['id-1', 'id-2'];
    const lifecycle = new TaskExecutionIdLifecycle(() => ids.shift() ?? 'id-x');
    const before = lifecycle.id;
    for (const draft of [
      validateExecuteDraft('   ', 'prompt'),
      validateExecuteDraft('main', '   ')
    ]) {
      assert.equal(draft.ok, false);
      if (!draft.ok) {
        assert.ok(
          draft.message === EXECUTE_VALIDATION_MESSAGE.baseRefRequired
          || draft.message === EXECUTE_VALIDATION_MESSAGE.promptRequired
        );
      }
    }
    assert.equal(lifecycle.id, before);
    assert.equal(lifecycle.phase, 'idle');
    const ui = fs.readFileSync(modalPath, 'utf8');
    assert.ok(ui.indexOf('validateExecuteDraft') < ui.indexOf('beginExecute()'));
  });

  test('D-04 D-05 D-06 body keys are exactly baseRef and prompt', () => {
    const body = buildExecuteHttpBody({ baseRef: '  main  ', prompt: '  do the work  ' });
    assert.deepEqual(Object.keys(body).sort(), ['baseRef', 'prompt']);
    assert.equal(body.baseRef, 'main');
    assert.equal(body.prompt, 'do the work');
    assert.equal('taskId' in body, false);
    assert.equal('executionId' in body, false);
    const rest = fs.readFileSync(restPath, 'utf8');
    const execution = fs.readFileSync(executionPath, 'utf8');
    assert.match(execution, /buildExecuteHttpBody\(input\)/);
    assert.equal(rest.includes('body: { ...input }'), false);
    assert.match(rest, /baseRef: validatedInput\.baseRef\.trim\(\)/);
    assert.match(rest, /prompt: validatedInput\.prompt\.trim\(\)/);
  });

  test('length limits use the required Chinese messages', () => {
    const longRef = validateExecuteDraft('a'.repeat(257), 'ok');
    const longPrompt = validateExecuteDraft('main', 'p'.repeat(20_001));
    assert.deepEqual(longRef, { ok: false, message: EXECUTE_VALIDATION_MESSAGE.baseRefTooLong });
    assert.deepEqual(longPrompt, { ok: false, message: EXECUTE_VALIDATION_MESSAGE.promptTooLong });
  });

  test('D-10 plan-owned tasks do not offer a normal Execute action', () => {
    const ui = fs.readFileSync(modalPath, 'utf8');
    const zh = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/i18n/locales/zh-CN.json'), 'utf8');
    assert.equal(EXECUTE_VALIDATION_MESSAGE.planOwned, '该任务由计划生命周期自动调度，无需手动执行。');
    assert.match(ui, /EXECUTE_VALIDATION_MESSAGE\.planOwned/);
    assert.match(zh, /该任务由计划生命周期自动调度，无需手动执行。/);
    assert.match(ui, /!planOwnedTask/);
    assert.match(ui, /runtimeTaskId === taskId/);
  });
});

describe('execute transport cleanup', () => {
  test('D-04 through D-07 trimmed body is posted and a 400 does not stay in flight', async () => {
    const bodies: unknown[] = [];
    let posts = 0;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        posts += 1;
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          requestId: 'bad-request',
          error: { code: 'AGENTHUB_API_INVALID_REQUEST', message: 'Request is invalid' }
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const execution = new AgentHubTaskExecution({
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${address.port}` }),
      syncAuthoritativeState: async () => {
        throw new Error('resync must not run after a definitive 400');
      }
    } as unknown as AgentHubConnection);
    try {
      const first = await execution.executeTask({
        executionId: 'exec-400',
        taskId: 'task-1',
        input: { baseRef: '  main  ', prompt: '  hello  ' }
      });
      assert.equal(first.status, 'failed');
      if (first.status === 'failed') {
        assert.equal(first.retryable, false);
        assert.equal(first.error.code, 'AGENTHUB_API_INVALID_REQUEST');
      }
      assert.deepEqual(bodies[0], { baseRef: 'main', prompt: 'hello' });
      const replay = await execution.executeTask({
        executionId: 'exec-400',
        taskId: 'task-1',
        input: { baseRef: 'main', prompt: 'hello' }
      });
      assert.equal(replay.status, 'failed');
      assert.equal(posts, 1);
      const retry = await execution.executeTask({
        executionId: 'exec-401',
        taskId: 'task-1',
        input: { baseRef: 'main', prompt: 'hello again' }
      });
      assert.equal(retry.status, 'failed');
      assert.equal(posts, 2);
    } finally {
      execution.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
