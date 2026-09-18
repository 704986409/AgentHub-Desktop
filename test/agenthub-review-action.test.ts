import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';
import { AgentHubRestClient } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubReviewDecision } from '../src/main/agenthub/AgentHubReviewDecision';
import {
  snapshotReviewFindingInput,
  snapshotReviewDecisionInput,
  snapshotReviewDecisionRequest,
  snapshotReviewDecisionLifecycleResult,
  toBackendReviewDecisionBody,
  AgentHubValidationError,
  type ReviewDecisionRequestDto,
  type ReviewDecisionInputDto,
  type ExecuteReviewReadyDto,
  type ReviewDecisionCompletedDto,
  type ReviewDecisionCompletedNoChangeDto,
  type ReviewDecisionMergeDeniedDto,
  type ReviewDecisionTerminalLifecycleDto
} from '../src/shared/agenthubTypes';
import { validateReviewDecisionInput } from '../src/renderer/src/components/agentHubReviewActionValidation';
import { useAgentHubReviewActionStore } from '../src/renderer/src/stores/agentHubReviewActionStore';
import { useAgentHubReviewSessionStore } from '../src/renderer/src/stores/agentHubReviewSessionStore';

const HEX64 = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);
const OID40 = 'c'.repeat(40);

function envelope(data: unknown): string {
  return JSON.stringify({ ok: true, requestId: 'r-1', data });
}

function errorEnvelope(code: string, message: string): string {
  return JSON.stringify({ ok: false, requestId: 'r-err', error: { code, message } });
}

function makeReviewReadyDto(handle = HEX64): ExecuteReviewReadyDto {
  return {
    outcome: 'review-ready',
    reviewHandle: handle,
    reviewBundleSha256: handle,
    taskId: 'task-1',
    assignmentId: 'asg-1',
    agentId: 'agent-1',
    providerId: 'codex',
    workerResult: { summary: 'Revision done', blockers: [], questions: [], risks: [], notes: [] },
    source: {
      branchName: 'agenthub/task-1',
      baseCommit: OID40,
      headCommit: HEX64,
      changedPaths: ['src/index.ts'],
      changeSetSha256: HEX64
    },
    buildTest: {
      build: 'passed',
      test: 'passed',
      outcome: 'passed',
      commands: [{
        id: 'cmd-1',
        phase: 'build',
        outcome: 'passed',
        stdoutPreview: '',
        stderrPreview: ''
      }]
    },
    evidenceSha256: HEX64
  };
}

function makeCompletedDto(): ReviewDecisionCompletedDto {
  return {
    outcome: 'completed',
    taskId: 'task-1',
    lifecycleSha256: HEX64,
    reviewEvidenceSha256: HEX64,
    mergeGate: {
      version: 1,
      taskId: 'task-1',
      branchName: 'agenthub/task-1',
      baseCommit: OID40,
      headCommit: HEX64,
      changeSetSha256: HEX64,
      sourceVisibilitySha256: HEX64,
      buildTestEvidenceSha256: HEX64,
      reviewEvidenceSha256: HEX64,
      eligible: true,
      reasons: [],
      mergeGateSha256: HEX64
    },
    merge: {
      version: 1,
      taskId: 'task-1',
      targetBranch: 'main',
      baseCommit: OID40,
      taskHeadCommit: HEX64,
      targetHeadBefore: OID40,
      targetHeadAfter: HEX64,
      changeSetSha256: HEX64,
      sourceVisibilitySha256: HEX64,
      buildTestEvidenceSha256: HEX64,
      reviewEvidenceSha256: HEX64,
      mergeGateSha256: HEX64,
      outcome: 'merged',
      mergeResultSha256: HEX64
    }
  };
}

function makeCompletedNoChangeDto(): ReviewDecisionCompletedNoChangeDto {
  return {
    outcome: 'completed-no-change',
    taskId: 'task-1',
    lifecycleSha256: HEX64,
    reviewEvidenceSha256: HEX64
  };
}

function makeMergeDeniedDto(): ReviewDecisionMergeDeniedDto {
  return {
    outcome: 'merge-denied',
    taskId: 'task-1',
    lifecycleSha256: HEX64,
    reviewEvidenceSha256: HEX64,
    mergeGate: {
      version: 1,
      taskId: 'task-1',
      branchName: 'agenthub/task-1',
      baseCommit: OID40,
      headCommit: HEX64,
      changeSetSha256: HEX64,
      sourceVisibilitySha256: HEX64,
      buildTestEvidenceSha256: HEX64,
      reviewEvidenceSha256: HEX64,
      eligible: false,
      reasons: ['STALE_SOURCE'],
      mergeGateSha256: HEX64
    }
  };
}

function makeTerminalDto(outcome: 'failed' | 'blocked' | 'waiting-input'): ReviewDecisionTerminalLifecycleDto {
  return {
    outcome,
    taskId: 'task-1',
    assignmentId: 'asg-1',
    lifecycleSha256: HEX64,
    reviewEvidenceSha256: HEX64
  };
}

describe('AgentHub Review Actions — RestClient Method & Protocol (Section 83)', () => {
  test('reviewDecision POST path URL-encodes handle, headers and body match backend contract', { timeout: 5000 }, async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    let capturedHeaders: http.IncomingHttpHeaders = {};
    let capturedBody = '';

    const server = http.createServer((req, res) => {
      capturedMethod = req.method ?? '';
      capturedUrl = req.url ?? '';
      capturedHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capturedBody = Buffer.concat(chunks).toString('utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(makeCompletedDto()));
      });
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const handle = HEX64;
      const backendBody = toBackendReviewDecisionBody(
        'dec-1',
        snapshotReviewDecisionInput({
          verdict: 'ACCEPT',
          summary: 'All looks good',
          findings: [{ code: 'SEC-1', severity: 'info', message: 'Note' }],
          allowNoChangeCompletion: false
        })
      );

      const res = await client.reviewDecision(handle, backendBody, 'desktop-review:dec-1');
      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedUrl, `/api/v1/reviews/${encodeURIComponent(handle)}/decision`);
      assert.equal(capturedHeaders['idempotency-key'], 'desktop-review:dec-1');
      assert.equal(capturedHeaders['content-type'], 'application/json');

      const parsedBody = JSON.parse(capturedBody);
      assert.equal(parsedBody.decisionId, undefined);
      assert.equal(parsedBody.reviewId, 'dec-1');
      assert.equal(parsedBody.reviewerId, 'desktop-human');
      assert.equal(parsedBody.verdict, 'ACCEPT');
      assert.equal(parsedBody.summary, 'All looks good');
      assert.equal(parsedBody.findings.length, 1);
      assert.equal(parsedBody.findings[0].code, 'SEC-1');
      assert.equal(parsedBody.allowNoChangeCompletion, false);

      assert.equal(res.outcome, 'completed');
    } finally {
      server.close();
    }
  });

  test('all 7 HTTP 200 lifecycle outcomes correctly parsed by RestClient', { timeout: 5000 }, async () => {
    const outcomes = [
      makeReviewReadyDto(),
      makeCompletedDto(),
      makeCompletedNoChangeDto(),
      makeMergeDeniedDto(),
      makeTerminalDto('failed'),
      makeTerminalDto('blocked'),
      makeTerminalDto('waiting-input')
    ];

    for (const outcome of outcomes) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(outcome));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };
      const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

      try {
        const body = toBackendReviewDecisionBody('dec-test', {
          verdict: 'ACCEPT',
          summary: 'test',
          findings: [],
          allowNoChangeCompletion: true
        });
        const res = await client.reviewDecision(HEX64, body, 'desktop-review:dec-test');
        assert.equal(res.outcome, outcome.outcome);
      } finally {
        server.close();
      }
    }
  });

  test('malformed lifecycle outcome, unexpected keys, or invalid hash rejected with MALFORMED_REVIEW_DECISION_RESULT', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Extra key in completed result
      res.end(envelope({ ...makeCompletedDto(), rogueKey: 'unexpected' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const body = toBackendReviewDecisionBody('dec-err', {
        verdict: 'ACCEPT',
        summary: '',
        findings: [],
        allowNoChangeCompletion: false
      });
      await assert.rejects(
        () => client.reviewDecision(HEX64, body, 'desktop-review:dec-err'),
        (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_RESULT'
      );
    } finally {
      server.close();
    }
  });

  test('redirect 301/302 is never followed and throws error', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { Location: '/somewhere-else' });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    const client = new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` });

    try {
      const body = toBackendReviewDecisionBody('dec-redir', {
        verdict: 'BLOCK',
        summary: 'blocking',
        findings: [{ code: 'B1', severity: 'blocker', message: 'fatal' }],
        allowNoChangeCompletion: false
      });
      await assert.rejects(
        () => client.reviewDecision(HEX64, body, 'desktop-review:dec-redir')
      );
    } finally {
      server.close();
    }
  });

  test('1 MiB request limit enforced locally in RestClient', { timeout: 5000 }, async () => {
    const client = new AgentHubRestClient({ baseUrl: 'http://127.0.0.1:9999' });
    const hugeSummary = 'x'.repeat(1024 * 1024 + 100);
    const body = {
      decisionId: 'dec-huge',
      reviewId: 'dec-huge',
      reviewerId: 'desktop-human',
      verdict: 'ACCEPT',
      summary: hugeSummary,
      findings: [],
      allowNoChangeCompletion: false
    } as any;

    await assert.rejects(
      () => client.reviewDecision(HEX64, body, 'desktop-review:dec-huge'),
      (err: any) => err.code === 'BODY_OVERFLOW'
    );
  });
});

describe('AgentHub Review Actions — Input & Finding Validation (Section 84)', () => {
  test('valid ACCEPT, REQUEST_REVISION, BLOCK requests are frozen snapshots', { timeout: 5000 }, () => {
    const validReq: ReviewDecisionRequestDto = {
      decisionId: 'decision-uuid-1',
      reviewHandle: HEX64,
      input: {
        verdict: 'ACCEPT',
        summary: 'Accepting task changes',
        findings: [{ code: 'PERF-1', severity: 'warning', message: 'Check allocation', path: 'src/perf.ts' }],
        allowNoChangeCompletion: false
      }
    };

    const snap = snapshotReviewDecisionRequest(validReq);
    assert.equal(snap.decisionId, 'decision-uuid-1');
    assert.equal(snap.reviewHandle, HEX64);
    assert.equal(snap.input.verdict, 'ACCEPT');
    assert.ok(Object.isFrozen(snap));
    assert.ok(Object.isFrozen(snap.input));
    assert.ok(Object.isFrozen(snap.input.findings));
  });

  test('unknown verdict rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotReviewDecisionInput({ verdict: 'REJECT' as any, summary: '', findings: [], allowNoChangeCompletion: false }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });

  test('extra request or input keys rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotReviewDecisionRequest({
        decisionId: 'dec-1',
        reviewHandle: HEX64,
        input: { verdict: 'ACCEPT', summary: '', findings: [], allowNoChangeCompletion: false },
        extra: 'rogue'
      } as any),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewDecisionInput({
        verdict: 'ACCEPT',
        summary: '',
        findings: [],
        allowNoChangeCompletion: false,
        extraKey: 123
      } as any),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });

  test('invalid decisionId or reviewHandle rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotReviewDecisionRequest({ decisionId: '', reviewHandle: HEX64, input: { verdict: 'ACCEPT', summary: '', findings: [], allowNoChangeCompletion: false } }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewDecisionRequest({ decisionId: 'dec\n1', reviewHandle: HEX64, input: { verdict: 'ACCEPT', summary: '', findings: [], allowNoChangeCompletion: false } }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewDecisionRequest({ decisionId: 'dec-1', reviewHandle: 'short', input: { verdict: 'ACCEPT', summary: '', findings: [], allowNoChangeCompletion: false } }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });

  test('summary oversized (>16 KiB) or containing NUL rejected', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotReviewDecisionInput({ verdict: 'ACCEPT', summary: 'a'.repeat(16385), findings: [], allowNoChangeCompletion: false }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewDecisionInput({ verdict: 'ACCEPT', summary: 'hello\0world', findings: [], allowNoChangeCompletion: false }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });

  test('findings > 256 items rejected', { timeout: 5000 }, () => {
    const manyFindings = Array.from({ length: 257 }, (_, i) => ({
      code: `CODE-${i}`,
      severity: 'info' as const,
      message: 'msg'
    }));
    assert.throws(
      () => snapshotReviewDecisionInput({ verdict: 'ACCEPT', summary: '', findings: manyFindings, allowNoChangeCompletion: false }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });

  test('finding code, severity, message bounds and NUL rejection', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'INVALID CODE WITH SPACES', severity: 'info', message: 'm' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'fatal' as any, message: 'm' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm'.repeat(8193) }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'has\0null' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });

  test('unsafe paths rejected (absolute, drive letter, .., ., empty segment, >4096 bytes)', { timeout: 5000 }, () => {
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm', path: '/etc/passwd' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm', path: 'C:\\Windows\\win.ini' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm', path: 'src/../../secret' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm', path: 'src/./opt.ts' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm', path: 'src//opt.ts' }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
    assert.throws(
      () => snapshotReviewFindingInput({ code: 'C1', severity: 'info', message: 'm', path: 'a'.repeat(4097) }),
      (err: AgentHubValidationError) => err.code === 'MALFORMED_REVIEW_DECISION_REQUEST'
    );
  });
});

describe('AgentHub Review Actions — Verdict Semantics (Section 85)', () => {
  test('ACCEPT + no findings or info/warning is valid', { timeout: 5000 }, () => {
    assert.equal(validateReviewDecisionInput({ verdict: 'ACCEPT', summary: '', findings: [], allowNoChangeCompletion: false }), null);
    assert.equal(validateReviewDecisionInput({
      verdict: 'ACCEPT',
      summary: '',
      findings: [
        { code: 'I1', severity: 'info', message: 'info message' },
        { code: 'W1', severity: 'warning', message: 'warning message' }
      ],
      allowNoChangeCompletion: false
    }), null);
  });

  test('ACCEPT + error or blocker is rejected locally', { timeout: 5000 }, () => {
    const withError = validateReviewDecisionInput({
      verdict: 'ACCEPT',
      summary: '',
      findings: [{ code: 'E1', severity: 'error', message: 'error message' }],
      allowNoChangeCompletion: false
    });
    assert.match(withError ?? '', /ACCEPT verdict cannot contain 'error' or 'blocker'/);

    const withBlocker = validateReviewDecisionInput({
      verdict: 'ACCEPT',
      summary: '',
      findings: [{ code: 'B1', severity: 'blocker', message: 'blocker message' }],
      allowNoChangeCompletion: false
    });
    assert.match(withBlocker ?? '', /ACCEPT verdict cannot contain 'error' or 'blocker'/);
  });

  test('BLOCK requires at least one blocker finding', { timeout: 5000 }, () => {
    const noFindings = validateReviewDecisionInput({
      verdict: 'BLOCK',
      summary: '',
      findings: [],
      allowNoChangeCompletion: false
    });
    assert.match(noFindings ?? '', /BLOCK verdict requires at least one finding with severity 'blocker'/);

    const onlyError = validateReviewDecisionInput({
      verdict: 'BLOCK',
      summary: '',
      findings: [{ code: 'E1', severity: 'error', message: 'err' }],
      allowNoChangeCompletion: false
    });
    assert.match(onlyError ?? '', /BLOCK verdict requires at least one finding with severity 'blocker'/);

    const withBlocker = validateReviewDecisionInput({
      verdict: 'BLOCK',
      summary: '',
      findings: [{ code: 'B1', severity: 'blocker', message: 'fatal issue' }],
      allowNoChangeCompletion: false
    });
    assert.equal(withBlocker, null);
  });

  test('REQUEST_REVISION with or without error/blocker is valid', { timeout: 5000 }, () => {
    assert.equal(validateReviewDecisionInput({ verdict: 'REQUEST_REVISION', summary: '', findings: [], allowNoChangeCompletion: false }), null);
    assert.equal(validateReviewDecisionInput({
      verdict: 'REQUEST_REVISION',
      summary: '',
      findings: [
        { code: 'E1', severity: 'error', message: 'fix tests' },
        { code: 'B1', severity: 'blocker', message: 'bad syntax' }
      ],
      allowNoChangeCompletion: false
    }), null);
  });
});

describe('AgentHub Review Actions — Main Service Idempotency & In-Flight Coalescing (Sections 86, 87, 90)', () => {
  test('same decisionId with modified fields throws local IDEMPOTENCY_CONFLICT with 0 HTTP calls', { timeout: 5000 }, async () => {
    let httpCalls = 0;
    const server = http.createServer((_req, res) => {
      httpCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(makeCompletedDto()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => ({ disposition: 'committed' })
    } as unknown as AgentHubConnection;

    const service = new AgentHubReviewDecision(connection);

    try {
      const baseReq: ReviewDecisionRequestDto = {
        decisionId: 'dec-idempotent-1',
        reviewHandle: HEX64,
        input: {
          verdict: 'ACCEPT',
          summary: 'Original summary',
          findings: [],
          allowNoChangeCompletion: false
        }
      };

      const first = await service.reviewDecision(baseReq);
      assert.equal(first.status, 'applied');
      assert.equal(httpCalls, 1);

      // Mutated verdict
      const changedVerdict = await service.reviewDecision({
        ...baseReq,
        input: { ...baseReq.input, verdict: 'REQUEST_REVISION' }
      });
      assert.equal(changedVerdict.status, 'failed');
      assert.equal(changedVerdict.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(httpCalls, 1, 'Zero additional HTTP calls on idempotency conflict');

      // Mutated summary
      const changedSummary = await service.reviewDecision({
        ...baseReq,
        input: { ...baseReq.input, summary: 'Different summary' }
      });
      assert.equal(changedSummary.status, 'failed');
      assert.equal(changedSummary.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(httpCalls, 1);

      // Mutated allowNoChangeCompletion
      const changedNoChange = await service.reviewDecision({
        ...baseReq,
        input: { ...baseReq.input, allowNoChangeCompletion: true }
      });
      assert.equal(changedNoChange.status, 'failed');
      assert.equal(changedNoChange.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(httpCalls, 1);

      // Mutated reviewHandle
      const changedHandle = await service.reviewDecision({
        ...baseReq,
        reviewHandle: HEX64_B
      });
      assert.equal(changedHandle.status, 'failed');
      assert.equal(changedHandle.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(httpCalls, 1);
    } finally {
      service.stop();
      server.close();
    }
  });

  test('in-flight coalescing: concurrent duplicate calls issue exactly one HTTP POST', { timeout: 5000 }, async () => {
    let httpCalls = 0;
    const server = http.createServer((_req, res) => {
      httpCalls++;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(makeCompletedDto()));
      }, 50);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => ({ disposition: 'committed' })
    } as unknown as AgentHubConnection;

    const service = new AgentHubReviewDecision(connection);

    try {
      const req: ReviewDecisionRequestDto = {
        decisionId: 'dec-coalesce-1',
        reviewHandle: HEX64,
        input: { verdict: 'ACCEPT', summary: 'ok', findings: [], allowNoChangeCompletion: false }
      };

      const [res1, res2] = await Promise.all([
        service.reviewDecision(req),
        service.reviewDecision(req)
      ]);

      assert.equal(httpCalls, 1, 'In-flight calls must coalesce into a single HTTP POST');
      assert.equal(res1.status, 'applied');
      assert.equal(res2.status, 'applied');
      assert.equal(res1.result.outcome, 'completed');
      assert.equal(res2.result.outcome, 'completed');
    } finally {
      service.stop();
      server.close();
    }
  });

  test('settled replay returns identical result with 0 HTTP calls', { timeout: 5000 }, async () => {
    let httpCalls = 0;
    const server = http.createServer((_req, res) => {
      httpCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(makeCompletedDto()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => ({ disposition: 'committed' })
    } as unknown as AgentHubConnection;

    const service = new AgentHubReviewDecision(connection);

    try {
      const req: ReviewDecisionRequestDto = {
        decisionId: 'dec-replay-1',
        reviewHandle: HEX64,
        input: { verdict: 'ACCEPT', summary: 'ok', findings: [], allowNoChangeCompletion: false }
      };

      const first = await service.reviewDecision(req);
      assert.equal(first.status, 'applied');
      assert.equal(httpCalls, 1);

      const second = await service.reviewDecision(req);
      assert.equal(second.status, 'applied');
      assert.equal(httpCalls, 1, 'Settled result must replay from cache with 0 HTTP calls');
    } finally {
      service.stop();
      server.close();
    }
  });
});

describe('AgentHub Review Actions — Certainty Classification & Retry (Sections 88, 89)', () => {
  test('definitive backend failures (400, 409, 410, 500) return status=failed, retryable=false and are settled', { timeout: 5000 }, async () => {
    let httpCalls = 0;
    const server = http.createServer((_req, res) => {
      httpCalls++;
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(errorEnvelope('TASK_STATE_CONFLICT', 'Task is not in reviewable state'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => ({ disposition: 'committed' })
    } as unknown as AgentHubConnection;

    const service = new AgentHubReviewDecision(connection);

    try {
      const req: ReviewDecisionRequestDto = {
        decisionId: 'dec-fail-409',
        reviewHandle: HEX64,
        input: { verdict: 'ACCEPT', summary: '', findings: [], allowNoChangeCompletion: false }
      };

      const res = await service.reviewDecision(req);
      assert.equal(res.status, 'failed');
      assert.equal(res.retryable, false);
      assert.equal(res.error.code, 'TASK_STATE_CONFLICT');

      // Settled replay test
      const replay = await service.reviewDecision(req);
      assert.equal(replay.status, 'failed');
      assert.equal(replay.retryable, false);
      assert.equal(httpCalls, 1, 'Definitive failure is settled and cached');
    } finally {
      service.stop();
      server.close();
    }
  });

  test('ambiguous result on network crash/timeout; retry with same decisionId makes a new attempt with same key', { timeout: 5000 }, async () => {
    let callCount = 0;
    let capturedKey1 = '';
    let capturedKey2 = '';

    const server = http.createServer((req, res) => {
      callCount++;
      if (callCount === 1) {
        capturedKey1 = req.headers['idempotency-key'] as string;
        // Destroy connection to simulate network drop
        req.destroy();
        return;
      }
      capturedKey2 = req.headers['idempotency-key'] as string;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(makeCompletedDto()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => ({ disposition: 'committed' })
    } as unknown as AgentHubConnection;

    const service = new AgentHubReviewDecision(connection);

    try {
      const req: ReviewDecisionRequestDto = {
        decisionId: 'dec-ambig-1',
        reviewHandle: HEX64,
        input: { verdict: 'ACCEPT', summary: 'retry test', findings: [], allowNoChangeCompletion: false }
      };

      const res1 = await service.reviewDecision(req);
      assert.equal(res1.status, 'ambiguous');
      assert.equal(res1.retryable, true);
      assert.equal(callCount, 1);
      assert.equal(capturedKey1, 'desktop-review:dec-ambig-1');

      // Retry same decision
      const res2 = await service.reviewDecision(req);
      assert.equal(res2.status, 'applied');
      assert.equal(callCount, 2);
      assert.equal(capturedKey2, 'desktop-review:dec-ambig-1', 'Retry must use exact same idempotency key');
    } finally {
      service.stop();
      server.close();
    }
  });
});

describe('AgentHub Review Actions — State Resync & Warning (Section 91)', () => {
  test('state sync failure returns applied status with stateSynchronized=false and warning', { timeout: 5000 }, async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(envelope(makeCompletedDto()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };

    const connection = {
      restClient: new AgentHubRestClient({ baseUrl: `http://127.0.0.1:${addr.port}` }),
      syncAuthoritativeState: async () => {
        throw new Error('Connection lost during sync');
      }
    } as unknown as AgentHubConnection;

    const service = new AgentHubReviewDecision(connection);

    try {
      const req: ReviewDecisionRequestDto = {
        decisionId: 'dec-sync-warn',
        reviewHandle: HEX64,
        input: { verdict: 'ACCEPT', summary: 'ok', findings: [], allowNoChangeCompletion: false }
      };

      const res = await service.reviewDecision(req);
      assert.equal(res.status, 'applied');
      assert.equal(res.stateSynchronized, false);
      assert.ok('warning' in res);
      assert.equal(res.warning?.code, 'SYNC_FAILED');
      assert.match(res.warning?.message ?? '', /Connection lost during sync/);
    } finally {
      service.stop();
      server.close();
    }
  });
});

describe('AgentHub Review Actions — Review Session Store & Revision Capture (Section 92)', () => {
  test('capturing revised review evidence updates session store under taskId with new handle', { timeout: 5000 }, () => {
    useAgentHubReviewSessionStore.getState().clearSession();
    const handleA = HEX64;
    const handleB = HEX64_B;

    // Capture initial review
    const initialReview = makeReviewReadyDto(handleA);
    useAgentHubReviewSessionStore.getState().captureReviewReady(initialReview, true, null);

    let storeState = useAgentHubReviewSessionStore.getState();
    assert.ok(storeState.reviewReadyByTaskId['task-1']);
    assert.equal(storeState.reviewReadyByTaskId['task-1'].review.reviewHandle, handleA);

    // Capture revision review
    const revisedReview = makeReviewReadyDto(handleB);
    useAgentHubReviewSessionStore.getState().captureReviewReady(revisedReview, true, null);

    storeState = useAgentHubReviewSessionStore.getState();
    assert.equal(storeState.reviewReadyByTaskId['task-1'].review.reviewHandle, handleB, 'Store must reflect new review handle');
  });
});

describe('AgentHub Review Actions — Action Store Lifecycle & Handle Expiration (Sections 94, 95)', () => {
  test('store: editing after ambiguous generates new decisionId and resets to idle', { timeout: 5000 }, () => {
    useAgentHubReviewActionStore.getState().clearSession();
    const store = useAgentHubReviewActionStore.getState();

    const session = store.getOrCreateSession('task-42', HEX64);
    const initialDecId = session.decisionId;

    store.setAmbiguous('task-42', { code: 'NETWORK_TIMEOUT', message: 'Timed out' });
    let updated = useAgentHubReviewActionStore.getState().sessionsByTaskId['task-42'];
    assert.equal(updated.status, 'ambiguous');
    assert.equal(updated.decisionId, initialDecId);

    // Edit input after ambiguous
    store.updateDraftInput('task-42', { summary: 'New adjusted summary' });
    updated = useAgentHubReviewActionStore.getState().sessionsByTaskId['task-42'];
    assert.equal(updated.status, 'idle');
    assert.notEqual(updated.decisionId, initialDecId, 'Decision ID must rotate when editing after ambiguous');
    assert.equal(updated.input.summary, 'New adjusted summary');
  });

  test('store: AGENTHUB_API_REVIEW_HANDLE_EXPIRED marks handle unavailable', { timeout: 5000 }, () => {
    useAgentHubReviewActionStore.getState().clearSession();
    const store = useAgentHubReviewActionStore.getState();

    store.getOrCreateSession('task-exp', HEX64);
    assert.equal(store.isHandleUnavailable(HEX64), false);

    store.setFailed('task-exp', {
      code: 'AGENTHUB_API_REVIEW_HANDLE_EXPIRED',
      message: 'Review handle expired'
    });

    assert.equal(store.isHandleUnavailable(HEX64), true, 'Handle must be marked unavailable on expiration error');
  });

  test('store: applied terminal results mark review handle unavailable', { timeout: 5000 }, () => {
    useAgentHubReviewActionStore.getState().clearSession();
    const store = useAgentHubReviewActionStore.getState();

    store.getOrCreateSession('task-term', HEX64);
    assert.equal(store.isHandleUnavailable(HEX64), false);

    store.setApplied('task-term', makeCompletedDto(), true);
    assert.equal(store.isHandleUnavailable(HEX64), true, 'Handle must be marked unavailable after completion');
  });
});

describe('AgentHub Review Actions — Architecture Guards (Sections 97, 98, 99, 100)', () => {
  test('Renderer review components and stores do not import forbidden modules or direct Git', { timeout: 5000 }, () => {
    const filesToCheck = [
      'src/renderer/src/components/AgentHubReviewDecisionSection.tsx',
      'src/renderer/src/components/agentHubReviewActionValidation.ts',
      'src/renderer/src/stores/agentHubReviewActionStore.ts'
    ];

    const forbiddenTokens = [
      'child_process',
      'spawnPty',
      'writePty',
      'workerLaunch',
      'useHive',
      'hiveTasks',
      'git merge',
      'git apply',
      'git checkout',
      'ipcRenderer',
      'window.cth'
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(__dirname, '..', relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      for (const token of forbiddenTokens) {
        assert.ok(
          !content.includes(token),
          `File ${relPath} must not contain forbidden token '${token}'`
        );
      }
    }
  });

  test('Main review service does not run Git merge or import workerLaunch/Hive', { timeout: 5000 }, () => {
    const mainServicePath = path.resolve(__dirname, '../src/main/agenthub/AgentHubReviewDecision.ts');
    const content = fs.readFileSync(mainServicePath, 'utf-8');

    const forbidden = [
      'git merge',
      'git checkout',
      'git reset',
      'git apply',
      'workerLaunch',
      'hiveTasks'
    ];

    for (const token of forbidden) {
      assert.ok(!content.includes(token), `AgentHubReviewDecision.ts must not contain '${token}'`);
    }
  });
});
