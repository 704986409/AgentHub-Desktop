import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  snapshotProviderCatalog,
  AgentHubValidationError,
  type ProviderDto
} from '../src/shared/agenthubTypes';
import { AgentHubRestClient, AgentHubContractError } from '../src/main/agenthub/AgentHubRestClient';
import { AgentHubConnection } from '../src/main/agenthub/AgentHubConnection';

const TIMEOUT = 5000;

function envelope(data: unknown, ok = true, error?: unknown): string {
  if (ok) {
    return JSON.stringify({ ok: true, requestId: 'req-provider-catalog', data });
  }
  return JSON.stringify({ ok: false, requestId: 'req-provider-catalog', error });
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

const sampleCatalog: ProviderDto[] = [
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
      { modelId: 'claude-sonnet-4', label: 'Claude Sonnet 4' }
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
  }
];

describe('AgentHub V0.8.8 Provider Catalog Schema Validation', () => {
  test('valid provider catalog snapshot produces deep frozen structures', { timeout: TIMEOUT }, () => {
    const validated = snapshotProviderCatalog(sampleCatalog);
    assert.equal(validated.length, 3);
    assert.equal(validated[0].providerId, 'claude');
    assert.equal(validated[1].providerId, 'cursor');
    assert.equal(validated[2].providerId, 'antigravity');
    assert.equal(validated[2].status, 'AUTH_REQUIRED');
    assert.equal(validated[2].authenticated, false);

    assert.ok(Object.isFrozen(validated));
    assert.ok(Object.isFrozen(validated[0]));
    assert.ok(Object.isFrozen(validated[0].capabilities));
    assert.ok(Object.isFrozen(validated[0].capabilities.outputProtocols));
    assert.ok(Object.isFrozen(validated[0].models));
    assert.ok(Object.isFrozen(validated[0].models[0]));
  });

  test('snapshotProviderCatalog rejects invalid top-level type or non-array', { timeout: TIMEOUT }, () => {
    assert.throws(() => snapshotProviderCatalog(null), AgentHubValidationError);
    assert.throws(() => snapshotProviderCatalog({}), AgentHubValidationError);
    assert.throws(() => snapshotProviderCatalog('string'), AgentHubValidationError);
  });

  test('snapshotProviderCatalog rejects blank providerId or invalid status', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], providerId: '' }]),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], providerId: '   ' }]),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], status: 'ONLINE' as any }]),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], status: 'AVAILABLE' as any }]),
      AgentHubValidationError
    );
  });

  test('snapshotProviderCatalog strictly forbids leaked private fields (token, secret, apiKey, env)', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], token: 'secret-token' } as any]),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], apiKey: 'sk-1234' } as any]),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotProviderCatalog([{ ...sampleCatalog[0], env: { PATH: '/usr/bin' } } as any]),
      AgentHubValidationError
    );
  });

  test('snapshotProviderCatalog enforces valid model items and capabilities flags', { timeout: TIMEOUT }, () => {
    assert.throws(
      () => snapshotProviderCatalog([{
        ...sampleCatalog[0],
        capabilities: { ...sampleCatalog[0].capabilities, sessionContinuation: 'true' as any }
      }]),
      AgentHubValidationError
    );
    assert.throws(
      () => snapshotProviderCatalog([{
        ...sampleCatalog[0],
        models: [{ modelId: '', label: 'Invalid' }]
      }]),
      AgentHubValidationError
    );
  });
});

describe('AgentHub V0.8.8 RestClient getProviders Endpoint', () => {
  test('GET /api/v1/providers sends no body, no idempotency key, and unpacks envelope', { timeout: TIMEOUT }, async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    let capturedKey: string | undefined;
    let capturedBody = '';

    const { server, baseUrl } = await listen((req, res) => {
      capturedMethod = req.method ?? '';
      capturedUrl = req.url ?? '';
      capturedKey = req.headers['idempotency-key'] as string | undefined;
      req.on('data', (chunk) => { capturedBody += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(sampleCatalog));
      });
    });

    const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
    try {
      const catalog = await client.getProviders();
      assert.equal(capturedMethod, 'GET');
      assert.equal(capturedUrl, '/api/v1/providers');
      assert.equal(capturedKey, undefined);
      assert.equal(capturedBody, '');
      assert.equal(catalog.length, 3);
      assert.equal(catalog[0].providerId, 'claude');
      assert.equal(catalog[1].providerId, 'cursor');
    } finally {
      server.close();
    }
  });

  test('getProviders forbids HTTP 301/302 redirects', { timeout: TIMEOUT }, async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(302, { Location: '/somewhere-else' });
      res.end('{}');
    });

    const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
    try {
      await assert.rejects(
        () => client.getProviders(),
        (err: AgentHubContractError) => err.code === 'REDIRECT_FORBIDDEN'
      );
    } finally {
      server.close();
    }
  });

  test('getProviders rejects response exceeding max body limit', { timeout: TIMEOUT }, async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(9 * 1024 * 1024)
      });
      res.end('{}');
    });

    const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
    try {
      await assert.rejects(
        () => client.getProviders(),
        (err: AgentHubContractError) => err.code === 'BODY_OVERFLOW'
      );
    } finally {
      server.close();
    }
  });

  test('getProviders parses backend contract error correctly', { timeout: TIMEOUT }, async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        requestId: 'err-1',
        error: { code: 'PROVIDER_DISCOVERY_FAILED', message: 'Failed to discover providers' }
      }));
    });

    const client = new AgentHubRestClient({ baseUrl, timeoutMs: 3000 });
    try {
      await assert.rejects(
        () => client.getProviders(),
        (err: AgentHubContractError) => err.code === 'PROVIDER_DISCOVERY_FAILED' && err.message === 'Failed to discover providers'
      );
    } finally {
      server.close();
    }
  });
});

describe('AgentHub V0.8.8 Connection Provider Catalog Coalescing', () => {
  test('concurrent getProviders coalesces into a single REST call', { timeout: TIMEOUT }, async () => {
    let callCount = 0;
    const { server, baseUrl } = await listen((_req, res) => {
      callCount += 1;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(envelope(sampleCatalog));
      }, 50);
    });

    const conn = new AgentHubConnection({ baseUrl, heartbeatIntervalMs: 60000, statePollIntervalMs: 60000 });
    try {
      const [res1, res2, res3] = await Promise.all([
        conn.getProviders(),
        conn.getProviders(),
        conn.getProviders()
      ]);

      assert.equal(callCount, 1);
      assert.equal(res1.length, 3);
      assert.equal(res2.length, 3);
      assert.equal(res3.length, 3);
      assert.equal(res1[0].providerId, 'claude');
    } finally {
      conn.stop();
      server.close();
    }
  });
});
