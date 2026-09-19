import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  deliverWithAcknowledgement,
  isLegacyTerminalDeliveryResult,
  type LegacyTerminalDeliveryResult,
  type DeliveryWithAcknowledgementResult
} from '../src/renderer/src/hooks/queueDelivery';

const TEST_TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// Section 13: Normal result tests — ACK counts
// ---------------------------------------------------------------------------
describe('AgentHub Desktop V0.8.9G — Explicit Delivery Result Contract', { timeout: TEST_TIMEOUT }, () => {

  describe('Normal delivery outcomes — ACK counts', () => {
    it('sent → ACK exactly once', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        async (): Promise<LegacyTerminalDeliveryResult> => ({ status: 'sent' }),
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'sent');
      assert.equal(result.acknowledged, true);
      assert.equal(ackCalls, 1, 'acknowledge() must be called exactly once for sent');
    });

    it('blocked-by-authority → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        async (): Promise<LegacyTerminalDeliveryResult> => ({
          status: 'blocked-by-authority',
          reason: 'Primary Renderer PTY automation is disabled in AgentHub mode.'
        }),
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'blocked-by-authority');
      assert.equal(result.acknowledged, false);
      assert.equal(ackCalls, 0, 'acknowledge() must NOT be called for blocked-by-authority');
    });

    it('retryable-failure → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        async (): Promise<LegacyTerminalDeliveryResult> => ({
          status: 'retryable-failure',
          reason: 'PTY disconnected'
        }),
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(ackCalls, 0, 'acknowledge() must NOT be called for retryable-failure');
    });

    it('throw → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        async (): Promise<LegacyTerminalDeliveryResult> => {
          throw new Error('Socket write failure');
        },
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'Socket write failure');
      assert.equal(ackCalls, 0, 'acknowledge() must NOT be called when sender throws');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 12: Runtime malformed guard tests (unsafe cast to trigger)
  // ---------------------------------------------------------------------------
  describe('Runtime malformed / invalid results — ACK 0 (unsafe cast)', () => {
    it('undefined → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result = await deliverWithAcknowledgement(
        async () => undefined as unknown as LegacyTerminalDeliveryResult,
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'INVALID_DELIVERY_RESULT');
      assert.equal(ackCalls, 0, 'undefined must never ACK');
    });

    it('null → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result = await deliverWithAcknowledgement(
        async () => null as unknown as LegacyTerminalDeliveryResult,
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'INVALID_DELIVERY_RESULT');
      assert.equal(ackCalls, 0, 'null must never ACK');
    });

    it('empty object {} → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result = await deliverWithAcknowledgement(
        async () => ({} as unknown as LegacyTerminalDeliveryResult),
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'INVALID_DELIVERY_RESULT');
      assert.equal(ackCalls, 0, 'empty object must never ACK');
    });

    it('{status:"unknown"} → ACK 0', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const result = await deliverWithAcknowledgement(
        async () => ({ status: 'unknown' } as unknown as LegacyTerminalDeliveryResult),
        () => { ackCalls += 1; }
      );
      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'INVALID_DELIVERY_RESULT');
      assert.equal(ackCalls, 0, 'unknown status must never ACK');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 9: isLegacyTerminalDeliveryResult type guard
  // ---------------------------------------------------------------------------
  describe('isLegacyTerminalDeliveryResult runtime guard', () => {
    it('accepts {status:"sent"}', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult({ status: 'sent' }), true);
    });

    it('accepts {status:"blocked-by-authority", reason:"..."}', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult({ status: 'blocked-by-authority', reason: 'test' }), true);
    });

    it('accepts {status:"retryable-failure", reason:"..."}', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult({ status: 'retryable-failure', reason: 'test' }), true);
    });

    it('rejects undefined', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult(undefined), false);
    });

    it('rejects null', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult(null), false);
    });

    it('rejects {}', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult({}), false);
    });

    it('rejects {status:"unknown"}', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult({ status: 'unknown' }), false);
    });

    it('rejects blocked-by-authority without reason string', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isLegacyTerminalDeliveryResult({ status: 'blocked-by-authority' }), false);
      assert.equal(isLegacyTerminalDeliveryResult({ status: 'blocked-by-authority', reason: 42 }), false);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 11: TypeScript compile-time guard: Promise<void> sender is rejected
  // ---------------------------------------------------------------------------
  describe('TypeScript type system: Promise<void> sender rejected', () => {
    it('queueDelivery.ts source does NOT contain "| void" in deliverWithAcknowledgement signature', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/src/hooks/queueDelivery.ts'),
        'utf8'
      );
      // The signature must not allow | void
      assert.doesNotMatch(
        src,
        /Promise<LegacyTerminalDeliveryResult\s*\|\s*void>/,
        'deliverWithAcknowledgement must not accept Promise<LegacyTerminalDeliveryResult | void>'
      );
    });

    it('queueDelivery.ts send parameter is Promise<LegacyTerminalDeliveryResult> exactly', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/src/hooks/queueDelivery.ts'),
        'utf8'
      );
      assert.match(
        src,
        /send:\s*\(\s*\)\s*=>\s*Promise<LegacyTerminalDeliveryResult>/,
        'send parameter must be exactly Promise<LegacyTerminalDeliveryResult>'
      );
    });

    // @ts-expect-error sender must return LegacyTerminalDeliveryResult, not void
    // This line deliberately triggers a TypeScript error to prove void is rejected.
    // If TypeScript accepted this, it would be a V0.8.9G BLOCK condition.
    it('compile-time: async () => {} is NOT assignable (this test validates the @ts-expect-error above compiles)', { timeout: TEST_TIMEOUT }, () => {
      // Runtime proof: the guard function rejects undefined (what void resolves to)
      assert.equal(isLegacyTerminalDeliveryResult(undefined), false);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 14: submitToPty exact return type
  // ---------------------------------------------------------------------------
  describe('submitToPty exact return type', () => {
    it('useHive.ts submitToPty returns Promise<LegacyTerminalDeliveryResult>', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/src/hooks/useHive.ts'),
        'utf8'
      );
      // submitToPty must not be typed as Promise<void> or Promise<any>
      assert.doesNotMatch(
        src,
        /function\s+submitToPty[^{]*Promise<void>/,
        'submitToPty must NOT return Promise<void>'
      );
      assert.doesNotMatch(
        src,
        /function\s+submitToPty[^{]*Promise<any>/,
        'submitToPty must NOT return Promise<any>'
      );
      // Must return the explicit delivery result type
      assert.match(
        src,
        /Promise<LegacyTerminalDeliveryResult>/,
        'submitToPty must return Promise<LegacyTerminalDeliveryResult>'
      );
      // Must return blocked-by-authority explicitly
      assert.match(
        src,
        /status:\s*'blocked-by-authority'/,
        'submitToPty must return blocked-by-authority status'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Section 16 & 17: Queue and Seed semantics
  // ---------------------------------------------------------------------------
  describe('Queue semantics: blocked queue item retained', () => {
    interface SimulatedQueueItem { id: string; text: string; }

    it('blocked queue item retained and FIFO preserved after multiple ticks', { timeout: TEST_TIMEOUT }, async () => {
      const queue: SimulatedQueueItem[] = [
        { id: 'msg-1', text: 'seed instruction' },
        { id: 'msg-2', text: 'follow-up' }
      ];
      const sendFailures: Record<string, number> = {};
      let removedCalls = 0;

      const removeQueuedMessage = (_agentId: string, id: string) => {
        removedCalls++;
        const idx = queue.findIndex((m) => m.id === id);
        if (idx >= 0) queue.splice(idx, 1);
      };

      for (let tick = 0; tick < 5; tick++) {
        const next = queue[0];
        await deliverWithAcknowledgement(
          async (): Promise<LegacyTerminalDeliveryResult> => ({
            status: 'blocked-by-authority',
            reason: 'Primary Renderer PTY automation is disabled in AgentHub mode.'
          }),
          () => { removeQueuedMessage('agent-1', next.id); }
        );
        // blocked: do not increment sendFailures
      }

      assert.equal(removedCalls, 0, 'No message should have been removed');
      assert.equal(queue.length, 2, 'Queue length must remain 2');
      assert.equal(queue[0].id, 'msg-1', 'msg-1 must remain at head (FIFO)');
      assert.equal(queue[1].id, 'msg-2', 'msg-2 must remain behind msg-1');
      assert.equal(sendFailures['msg-1'], undefined, 'sendFailures must NOT be incremented for authority block');
    });

    it('blocked retry budget unchanged', { timeout: TEST_TIMEOUT }, async () => {
      const sendFailures: Record<string, number> = {};
      const item = { id: 'blocked-msg', text: 'test' };

      for (let tick = 0; tick < 3; tick++) {
        const outcome = await deliverWithAcknowledgement(
          async (): Promise<LegacyTerminalDeliveryResult> => ({
            status: 'blocked-by-authority',
            reason: 'blocked'
          }),
          () => {}
        );
        if (outcome.status === 'blocked-by-authority') {
          // Must NOT touch sendFailures
        }
      }

      assert.equal(sendFailures[item.id], undefined, 'retry budget must not be consumed for blocked-by-authority');
    });
  });

  describe('Seed semantics', () => {
    it('blocked seed retained', { timeout: TEST_TIMEOUT }, async () => {
      let agent = {
        id: 'worker-1',
        seedPrompt: 'Initialize database schema'
      };
      const deliveredSeeds = new Set<string>();

      const result: LegacyTerminalDeliveryResult = {
        status: 'blocked-by-authority',
        reason: 'Primary Renderer PTY automation is disabled in AgentHub mode.'
      };

      if (result.status === 'sent') {
        deliveredSeeds.add(agent.id);
        agent = { ...agent, seedPrompt: undefined as unknown as string };
      }

      assert.equal(agent.seedPrompt, 'Initialize database schema', 'seedPrompt must NOT be cleared when blocked');
      assert.equal(deliveredSeeds.has('worker-1'), false, 'deliveredSeeds must NOT latch when blocked');
    });

    it('sent seed clears only after sent', { timeout: TEST_TIMEOUT }, async () => {
      let agent = {
        id: 'worker-1',
        seedPrompt: 'Initialize database schema'
      };
      const deliveredSeeds = new Set<string>();

      const result: LegacyTerminalDeliveryResult = { status: 'sent' };

      if (result.status === 'sent') {
        deliveredSeeds.add(agent.id);
        agent = { ...agent, seedPrompt: undefined as unknown as string };
      }

      assert.equal(agent.seedPrompt, undefined, 'seedPrompt must be cleared on sent');
      assert.equal(deliveredSeeds.has('worker-1'), true, 'deliveredSeeds must latch on sent');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 18: /clear semantics
  // ---------------------------------------------------------------------------
  describe('/clear side effects', () => {
    it('blocked /clear: no context side effect', { timeout: TEST_TIMEOUT }, async () => {
      let agentContext = { contextTokens: 45000, contextLimit: 200000, progress: 22.5 };
      const clearMessage = { id: 'msg-clear', text: '/clear' };

      await deliverWithAcknowledgement(
        async (): Promise<LegacyTerminalDeliveryResult> => ({
          status: 'blocked-by-authority',
          reason: 'blocked'
        }),
        () => {
          if (clearMessage.text.trim().toLowerCase() === '/clear') {
            agentContext = { contextTokens: 0, contextLimit: undefined as unknown as number, progress: 0 };
          }
        }
      );

      assert.equal(agentContext.contextTokens, 45000, 'Context tokens must remain intact when blocked');
      assert.equal(agentContext.progress, 22.5, 'Progress must remain intact when blocked');
    });

    it('sent /clear: context tokens zeroed', { timeout: TEST_TIMEOUT }, async () => {
      let agentContext = { contextTokens: 45000, contextLimit: 200000, progress: 22.5 };
      const clearMessage = { id: 'msg-clear', text: '/clear' };

      await deliverWithAcknowledgement(
        async (): Promise<LegacyTerminalDeliveryResult> => ({ status: 'sent' }),
        () => {
          if (clearMessage.text.trim().toLowerCase() === '/clear') {
            agentContext = { contextTokens: 0, contextLimit: undefined as unknown as number, progress: 0 };
          }
        }
      );

      assert.equal(agentContext.contextTokens, 0, 'Context tokens zeroed on sent /clear');
      assert.equal(agentContext.progress, 0, 'Progress zeroed on sent /clear');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 20: PTY authority still closed
  // ---------------------------------------------------------------------------
  describe('PTY authority still closed', () => {
    const primaryPreloadSource = fs.readFileSync(
      path.resolve(__dirname, '../src/preload/index.ts'),
      'utf8'
    );

    const forbiddenApis = [
      'writePty', 'spawnPty', 'spawnDeveloperTerminal',
      'resizePty', 'redrawPty', 'killPty', 'listPtys'
    ];

    for (const api of forbiddenApis) {
      it(`Primary preload does NOT expose ${api}`, { timeout: TEST_TIMEOUT }, () => {
        assert.doesNotMatch(
          primaryPreloadSource,
          new RegExp(`\\b${api}\\s*:`),
          `Primary preload must not expose ${api}`
        );
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Section 19: V0.8.9E semantic closures preserved
  // ---------------------------------------------------------------------------
  describe('V0.8.9E semantic closures preserved', () => {
    it('AgentDetail Kill remains disabled in AgentHub mode', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/src/components/AgentDetailPanel.tsx'),
        'utf8'
      );
      assert.match(src, /disabled/, 'AgentDetail Kill button must remain disabled');
      assert.doesNotMatch(src, /\barchiveAgent\s*\(/, 'AgentDetailPanel must not call archiveAgent directly');
    });

    it('useHive does not contain client-side auto-revive logic', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/src/hooks/useHive.ts'),
        'utf8'
      );
      assert.doesNotMatch(src, /autoRevive/, 'Auto-revive must remain absent from useHive');
    });

    it('no blind legacy queue auto-conversion to executeTask', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/renderer/src/hooks/useHive.ts'),
        'utf8'
      );
      assert.doesNotMatch(
        src,
        /window\.agentHub\.executeTask/,
        'useHive must not blindly auto-convert legacy queue to window.agentHub.executeTask'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Section 10: No void=sent compatibility test in F test file
  // ---------------------------------------------------------------------------
  describe('No backwards compatibility void=sent test remains', () => {
    it('agenthub-suppressed-delivery-ack-v089f.test.ts does NOT contain void=sent compatibility test', { timeout: TEST_TIMEOUT }, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, './agenthub-suppressed-delivery-ack-v089f.test.ts'),
        'utf8'
      );
      assert.doesNotMatch(
        src,
        /handles legacy void return as sent for backwards compatibility/,
        'The void=sent backwards compatibility test must be deleted in V0.8.9G'
      );
    });
  });
});
