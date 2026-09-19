# AgentHub Desktop V0.8.9F — Suppressed Delivery Acknowledgement Closure

## 1. Executive Summary

In AgentHub Desktop V0.8.9C and V0.8.9D, Primary Renderer PTY write authority was completely removed in accordance with the capability security boundary. Programmatic agent execution is exclusively routed via Backend `window.agentHub.executeTask`.

However, legacy queue delivery (`deliverWithAcknowledgement`) treated any resolved Promise from `submitToPty()` as delivery success. Because `submitToPty()` suppressed PTY writing with a warning and returned `Promise.resolve()`, the queue delivery pipeline acknowledged the send and removed the queued message (`removeQueuedMessage`), and the one-time worker `seedPrompt` was cleared prematurely. This created a **False Delivery Acknowledgement / Silent Data Loss** defect:
```text
Suppressed Delivery → False ACK → Silent Message Eviction / Seed Data Loss
```

AgentHub Desktop V0.8.9F closes this semantic gap by enforcing the invariant:
```text
No Actual Delivery → No Acknowledgement → No Data Loss
```

---

## 2. Core Invariants & Semantic Model

### 2.1 Explicit Delivery Outcome Classification
The legacy binary model (`resolved = delivered`, `rejected = failed`) is replaced by explicit delivery outcome typing:

```ts
export type LegacyTerminalDeliveryResult =
  | { readonly status: 'sent' }
  | { readonly status: 'blocked-by-authority'; readonly reason: string }
  | { readonly status: 'retryable-failure'; readonly reason: string };

export interface DeliveryWithAcknowledgementResult {
  readonly status: 'sent' | 'blocked-by-authority' | 'retryable-failure';
  readonly acknowledged: boolean;
  readonly reason?: string;
}
```

### 2.2 Semantic Invariants
1. **Verified ACK Invariant**:
   - `acknowledge()` is called **ONLY** when `status === 'sent'` (ACK call count = 1).
   - For `blocked-by-authority` and `retryable-failure`, `acknowledge()` is **NEVER** called (ACK call count = 0).
2. **Authority Blocking vs Retry Budget**:
   - When a delivery is `blocked-by-authority`:
     - The queued item remains intact at the head of the queue.
     - `removeQueuedMessage` is NOT called.
     - `sendFailures` is NOT incremented.
     - `MAX_SEND_ATTEMPTS` is NOT consumed.
     - Delivery success is NOT claimed to the UI or store.
     - Synthetic statuses (such as fake idle or working) are NOT generated.
3. **Head-of-Line Retention & Ordering**:
   - The blocked message remains at the queue head.
   - FIFO order is strictly preserved; later messages are not skipped or delivered ahead of earlier blocked messages.
4. **Seed Prompt Retention**:
   - `seedPrompt` is strictly cleared only after verified delivery success (`status === 'sent'`).
   - For `blocked-by-authority`, `seedPrompt` remains intact in the store, and `deliveredSeeds` does not latch. A presentation cooldown timestamp prevents hot polling.
5. **Special Presentation Side Effects**:
   - Context gauge zeroing on `/clear` and compaction latch updates occur ONLY after verified `sent`.

---

## 3. Delivery Outcome Matrix

| Result Status | Queue Removed | Retry Count Incremented | Claimed Delivered | Seed Cleared | Delivered Latch |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sent` | **YES** | NO (cleared) | **YES** | **YES** | **YES** |
| `blocked-by-authority` | **NO** | **NO** | **NO** | **NO** | **NO** |
| `retryable-failure` | **NO** (unless exhausted) | **YES** | **NO** | **NO** | **NO** |

---

## 4. Architectural & Authority Boundary Assertions

1. **Primary Renderer PTY Automation Remains Disabled**:
   - Primary preload exposes NO generic PTY automation APIs (`spawnPty`, `spawnDeveloperTerminal`, `writePty`, `resizePty`, `redrawPty`, `killPty`, `listPtys`).
   - V0.8.9F does NOT restore PTY authority to the Primary Renderer.
2. **Dedicated Terminal Input Remains Isolated**:
   - Dedicated Developer Terminal operates in a separate WebContents with a separate preload.
   - All operations are strictly sender-bound and session-owner-bound.
   - Automated queue delivery does NOT borrow or bypass into `developer-terminal:write`.
3. **No Blind Queue Migration**:
   - Legacy queue drain does NOT blindly convert raw legacy messages to `window.agentHub.executeTask`.
   - Formal task execution requires verified task identity and business context through AgentHub surfaces.
4. **Preservation of V0.8.9E Closures**:
   - AgentDetail Kill, Fullscreen Kill, Restart, and Provider Switch remain disabled (fail-closed) in legacy surfaces.
   - Client-side auto-revive remains absent.
   - Office theme remains strictly presentation-only.
   - `archiveAgent` is triggered strictly in response to Main process confirmed archive events.

---

## 5. Verification Summary

- **Focused Test Suite**: `test/agenthub-suppressed-delivery-ack-v089f.test.ts` (18 passing tests).
- **Full Regression Suite**: `npm run test:agenthub` (54 suites, 324 tests passing, 0 failed, 0 skipped).
- **Typecheck & Build**: `npm run typecheck`, `npm run build`, `npm run check:links`, `git diff --check` all passed with 0 errors.
