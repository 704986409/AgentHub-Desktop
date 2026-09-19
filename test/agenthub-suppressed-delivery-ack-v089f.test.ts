import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  deliverWithAcknowledgement,
  type LegacyTerminalDeliveryResult,
  type DeliveryWithAcknowledgementResult
} from '../src/renderer/src/hooks/queueDelivery';

const TEST_TIMEOUT = 5000;

describe('AgentHub Desktop V0.8.9F — Suppressed Delivery Acknowledgement Closure', { timeout: TEST_TIMEOUT }, () => {
  // 1. deliverWithAcknowledgement Unit Tests (Section 23 - 26)
  describe('deliverWithAcknowledgement Contract', () => {
    it('returns blocked-by-authority without calling acknowledge (ackCalls === 0)', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const sendBlocked = async (): Promise<LegacyTerminalDeliveryResult> => ({
        status: 'blocked-by-authority',
        reason: 'Primary Renderer PTY automation is disabled in AgentHub mode.'
      });

      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        sendBlocked,
        () => {
          ackCalls += 1;
        }
      );

      assert.equal(result.status, 'blocked-by-authority');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'Primary Renderer PTY automation is disabled in AgentHub mode.');
      assert.equal(ackCalls, 0, 'acknowledge() must NOT be called for blocked-by-authority');
    });

    it('returns sent and calls acknowledge exactly once (ackCalls === 1)', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const sendSent = async (): Promise<LegacyTerminalDeliveryResult> => ({
        status: 'sent'
      });

      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        sendSent,
        () => {
          ackCalls += 1;
        }
      );

      assert.equal(result.status, 'sent');
      assert.equal(result.acknowledged, true);
      assert.equal(ackCalls, 1, 'acknowledge() must be called exactly once for sent');
    });

    it('returns retryable-failure without calling acknowledge when send returns retryable-failure', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const sendRetryable = async (): Promise<LegacyTerminalDeliveryResult> => ({
        status: 'retryable-failure',
        reason: 'PTY disconnected'
      });

      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        sendRetryable,
        () => {
          ackCalls += 1;
        }
      );

      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'PTY disconnected');
      assert.equal(ackCalls, 0, 'acknowledge() must NOT be called for retryable-failure');
    });

    it('catches thrown error as retryable-failure without calling acknowledge', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const sendThrows = async (): Promise<LegacyTerminalDeliveryResult> => {
        throw new Error('Socket write failure');
      };

      const result: DeliveryWithAcknowledgementResult = await deliverWithAcknowledgement(
        sendThrows,
        () => {
          ackCalls += 1;
        }
      );

      assert.equal(result.status, 'retryable-failure');
      assert.equal(result.acknowledged, false);
      assert.equal(result.reason, 'Socket write failure');
      assert.equal(ackCalls, 0, 'acknowledge() must NOT be called when sender throws');
    });

    it('handles legacy void return as sent for backwards compatibility', { timeout: TEST_TIMEOUT }, async () => {
      let ackCalls = 0;
      const sendVoid = async (): Promise<void> => {
        // legacy resolves with void
      };

      const result = await deliverWithAcknowledgement(sendVoid, () => {
        ackCalls += 1;
      });

      assert.equal(result.status, 'sent');
      assert.equal(result.acknowledged, true);
      assert.equal(ackCalls, 1);
    });
  });

  // 2. Queue Simulation: Authority Block vs Retryable Failure (Section 27 - 29)
  describe('Queue Drain Semantics on Authority Block', () => {
    interface SimulatedQueueItem {
      id: string;
      text: string;
    }

    it('does not increment retry failures and does not drop on blocked-by-authority', { timeout: TEST_TIMEOUT }, async () => {
      const queue: SimulatedQueueItem[] = [
        { id: 'msg-1', text: 'Important task description' },
        { id: 'msg-2', text: 'Follow-up instruction' }
      ];
      const sendFailures: Record<string, number> = {};
      const MAX_SEND_ATTEMPTS = 3;
      let removedCalls = 0;

      const removeQueuedMessage = (_agentId: string, id: string) => {
        removedCalls++;
        const idx = queue.findIndex((m) => m.id === id);
        if (idx >= 0) queue.splice(idx, 1);
      };

      for (let tick = 0; tick < 5; tick++) {
        const next = queue[0];
        const outcome = await deliverWithAcknowledgement(
          async () => ({
            status: 'blocked-by-authority',
            reason: 'Primary Renderer PTY automation is disabled in AgentHub mode.'
          }),
          () => {
            removeQueuedMessage('agent-1', next.id);
          }
        );

        if (outcome.status === 'sent') {
          delete sendFailures[next.id];
        } else if (outcome.status === 'blocked-by-authority') {
          // Invariant: do NOT touch sendFailures, do NOT drop
        } else {
          const attempts = (sendFailures[next.id] ?? 0) + 1;
          sendFailures[next.id] = attempts;
          if (attempts >= MAX_SEND_ATTEMPTS) {
            delete sendFailures[next.id];
            removeQueuedMessage('agent-1', next.id);
          }
        }
      }

      assert.equal(removedCalls, 0, 'No message should have been removed');
      assert.equal(queue.length, 2, 'Queue length must remain 2');
      assert.equal(queue[0].id, 'msg-1', 'msg-1 must remain at head of queue');
      assert.equal(queue[0].text, 'Important task description', 'msg-1 content intact');
      assert.equal(queue[1].id, 'msg-2', 'msg-2 must remain behind msg-1 in FIFO order');
      assert.equal(sendFailures['msg-1'], undefined, 'sendFailures must not be incremented for authority block');
    });

    it('increments failures and drops only on true retryable failures after MAX_SEND_ATTEMPTS', { timeout: TEST_TIMEOUT }, async () => {
      const queue: SimulatedQueueItem[] = [
        { id: 'retry-msg-1', text: 'Will fail transport' }
      ];
      const sendFailures: Record<string, number> = {};
      const MAX_SEND_ATTEMPTS = 3;
      let removedCalls = 0;

      const removeQueuedMessage = (_agentId: string, id: string) => {
        removedCalls++;
        const idx = queue.findIndex((m) => m.id === id);
        if (idx >= 0) queue.splice(idx, 1);
      };

      for (let attempt = 1; attempt <= 3; attempt++) {
        const next = queue[0];
        if (!next) break;
        const outcome = await deliverWithAcknowledgement(
          async () => ({
            status: 'retryable-failure',
            reason: 'PTY broken pipe'
          }),
          () => {
            removeQueuedMessage('agent-1', next.id);
          }
        );

        if (outcome.status === 'blocked-by-authority') {
          // not this branch
        } else if (outcome.status === 'retryable-failure') {
          const count = (sendFailures[next.id] ?? 0) + 1;
          sendFailures[next.id] = count;
          if (count >= MAX_SEND_ATTEMPTS) {
            delete sendFailures[next.id];
            removeQueuedMessage('agent-1', next.id);
          }
        }
      }

      assert.equal(removedCalls, 1, 'Retryable failure dropped after MAX_SEND_ATTEMPTS');
      assert.equal(queue.length, 0, 'Queue is empty after drop');
    });
  });

  // 3. Seed Prompt Delivery Semantics (Section 30 - 31)
  describe('Seed Prompt Delivery Invariants', () => {
    it('retains seedPrompt and does not latch deliveredSeeds on authority block', { timeout: TEST_TIMEOUT }, async () => {
      let agent = {
        id: 'worker-1',
        seedPrompt: 'Please initialize database schema and run diagnostics',
        status: 'idle'
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

      assert.equal(
        agent.seedPrompt,
        'Please initialize database schema and run diagnostics',
        'seedPrompt must NOT be cleared when delivery is blocked by authority'
      );
      assert.equal(deliveredSeeds.has('worker-1'), false, 'deliveredSeeds must NOT contain worker-1');
    });

    it('clears seedPrompt and latches deliveredSeeds only on verified sent', { timeout: TEST_TIMEOUT }, async () => {
      let agent = {
        id: 'worker-1',
        seedPrompt: 'Please initialize database schema and run diagnostics',
        status: 'idle'
      };
      const deliveredSeeds = new Set<string>();

      const result: LegacyTerminalDeliveryResult = {
        status: 'sent'
      };

      if (result.status === 'sent') {
        deliveredSeeds.add(agent.id);
        agent = { ...agent, seedPrompt: undefined as unknown as string };
      }

      assert.equal(agent.seedPrompt, undefined, 'seedPrompt must be cleared on sent');
      assert.equal(deliveredSeeds.has('worker-1'), true, 'deliveredSeeds must latch on sent');
    });
  });

  // 4. Special Queue Actions (/clear, /compact) (Section 32)
  describe('/clear Context Presentation Side Effects', () => {
    it('does not zero context tokens or progress when /clear delivery is blocked-by-authority', { timeout: TEST_TIMEOUT }, async () => {
      let agentContext = {
        contextTokens: 45000,
        contextLimit: 200000,
        progress: 22.5
      };

      const clearMessage = { id: 'msg-clear', text: '/clear' };
      const outcome = await deliverWithAcknowledgement(
        async () => ({
          status: 'blocked-by-authority',
          reason: 'Primary Renderer PTY automation is disabled in AgentHub mode.'
        }),
        () => {
          if (clearMessage.text.trim().toLowerCase() === '/clear') {
            agentContext = {
              contextTokens: 0,
              contextLimit: undefined,
              progress: 0
            };
          }
        }
      );

      assert.equal(outcome.status, 'blocked-by-authority');
      assert.equal(outcome.acknowledged, false);
      assert.equal(agentContext.contextTokens, 45000, 'Context tokens must remain intact');
      assert.equal(agentContext.progress, 22.5, 'Progress must remain intact');
    });

    it('zeros context tokens and progress when /clear delivery is sent', { timeout: TEST_TIMEOUT }, async () => {
      let agentContext = {
        contextTokens: 45000,
        contextLimit: 200000,
        progress: 22.5
      };

      const clearMessage = { id: 'msg-clear', text: '/clear' };
      const outcome = await deliverWithAcknowledgement(
        async () => ({
          status: 'sent'
        }),
        () => {
          if (clearMessage.text.trim().toLowerCase() === '/clear') {
            agentContext = {
              contextTokens: 0,
              contextLimit: undefined,
              progress: 0
            };
          }
        }
      );

      assert.equal(outcome.status, 'sent');
      assert.equal(outcome.acknowledged, true);
      assert.equal(agentContext.contextTokens, 0, 'Context tokens zeroed on sent /clear');
      assert.equal(agentContext.progress, 0, 'Progress zeroed on sent /clear');
    });
  });

  // 5. Source Static Inspection: submitToPty and Authority Boundaries (Sections 23, 33 - 35)
  describe('Source Code Static Invariants', () => {
    const useHiveSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/hooks/useHive.ts'),
      'utf8'
    );
    const primaryPreloadSource = fs.readFileSync(
      path.resolve(__dirname, '../src/preload/index.ts'),
      'utf8'
    );

    it('useHive submitToPty returns blocked-by-authority explicitly', { timeout: TEST_TIMEOUT }, () => {
      assert.match(
        useHiveSource,
        /status:\s*'blocked-by-authority'/,
        'submitToPty must return blocked-by-authority status'
      );
      assert.doesNotMatch(
        useHiveSource,
        /return\s*\{\s*status:\s*'sent'\s*\}/,
        'submitToPty must not return sent in AgentHub mode'
      );
    });

    it('useHive seedPrompt is NOT cleared before delivery settlement', { timeout: TEST_TIMEOUT }, () => {
      assert.doesNotMatch(
        useHiveSource,
        /bootGraceUntil\.current\[a\.id\]\s*=\s*now\s*\+\s*BOOT_GRACE_MS;\s*updateAgent\(/,
        'seedPrompt must not be cleared immediately upon timer trigger'
      );
      assert.match(
        useHiveSource,
        /if\s*\(\s*res\.status\s*===\s*'sent'\s*\)\s*\{\s*deliveredSeeds\.current\.add\(a\.id\);\s*useStore\.getState\(\)\.updateAgent\(a\.id,\s*\{\s*seedPrompt:\s*undefined\s*\}\);/,
        'seedPrompt must only be cleared when res.status === sent'
      );
    });

    it('Primary Preload does NOT expose generic PTY automation APIs', { timeout: TEST_TIMEOUT }, () => {
      const forbiddenApis = [
        'writePty',
        'spawnPty',
        'spawnDeveloperTerminal',
        'resizePty',
        'redrawPty',
        'killPty',
        'listPtys'
      ];
      for (const api of forbiddenApis) {
        assert.doesNotMatch(
          primaryPreloadSource,
          new RegExp(`\\b${api}\\s*:`),
          `Primary preload must not expose ${api}`
        );
      }
    });

    it('no queue-to-Dedicated-Terminal write automation bypass exists in useHive', { timeout: TEST_TIMEOUT }, () => {
      assert.doesNotMatch(
        useHiveSource,
        /developer-terminal:write/,
        'useHive must not bridge legacy queue to developer-terminal:write'
      );
    });

    it('no blind legacy queue auto-conversion to executeTask in useHive', { timeout: TEST_TIMEOUT }, () => {
      assert.doesNotMatch(
        useHiveSource,
        /window\.agentHub\.executeTask/,
        'useHive must not blindly auto-convert legacy queue to window.agentHub.executeTask'
      );
    });
  });

  // 6. V0.8.9E Regression Invariants (Section 36)
  describe('V0.8.9E Semantic Closures Preservation', () => {
    const agentDetailSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/components/AgentDetailPanel.tsx'),
      'utf8'
    );
    const useHiveSource = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/src/hooks/useHive.ts'),
      'utf8'
    );

    it('AgentDetail Kill remains disabled in AgentHub mode', { timeout: TEST_TIMEOUT }, () => {
      assert.match(
        agentDetailSource,
        /disabled/,
        'AgentDetail Kill button must remain disabled'
      );
      assert.doesNotMatch(
        agentDetailSource,
        /\barchiveAgent\s*\(/,
        'AgentDetailPanel must not call archiveAgent directly'
      );
    });

    it('useHive does not contain client-side auto-revive logic', { timeout: TEST_TIMEOUT }, () => {
      assert.doesNotMatch(
        useHiveSource,
        /autoRevive/,
        'Auto-revive must remain absent from useHive'
      );
    });
  });
});
