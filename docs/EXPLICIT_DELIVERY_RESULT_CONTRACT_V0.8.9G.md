# Explicit Delivery Result Contract — AgentHub Desktop V0.8.9G

## Core Invariant

```
Only an explicit { status: 'sent' } result may acknowledge delivery.

void, undefined, null, malformed objects, unknown statuses,
exceptions, authority blocks, and retryable failures never acknowledge.

No explicit delivery proof means no acknowledgement.
```

## Background

V0.8.9F established explicit delivery result types and suppressed false ACKs for
authority-blocked deliveries. However, the `deliverWithAcknowledgement()` function
still accepted `Promise<LegacyTerminalDeliveryResult | void>` as the sender type,
meaning any `void`/`undefined` return was silently treated as `sent + ACK`.

V0.8.9G closes this final loophole.

## Changes

### `src/renderer/src/hooks/queueDelivery.ts`

**Before (V0.8.9F):**
```ts
export async function deliverWithAcknowledgement(
  send: () => Promise<LegacyTerminalDeliveryResult | void>,
  acknowledge: () => void
): Promise<DeliveryWithAcknowledgementResult> {
  const outcome = await send();
  if (outcome && outcome.status !== 'sent') {
    // blocked/retryable handled here
  }
  acknowledge();  // ← void/undefined fell through here → false ACK
  return { status: 'sent', acknowledged: true };
}
```

**After (V0.8.9G):**
```ts
export async function deliverWithAcknowledgement(
  send: () => Promise<LegacyTerminalDeliveryResult>,  // no | void
  acknowledge: () => void
): Promise<DeliveryWithAcknowledgementResult>
```

- `| void` removed from sender type — TypeScript now rejects `Promise<void>` senders at compile time.
- Runtime `isLegacyTerminalDeliveryResult()` guard added — `void`/`undefined`/`null`/malformed objects
  result in `retryable-failure` with reason `INVALID_DELIVERY_RESULT`, never ACK.
- `switch` on `outcome.status` exhaustively handles all three valid statuses.

## Delivery Contract Table

| Sender returns              | ACK | Status             |
| :-------------------------- | :-- | :----------------- |
| `{ status: 'sent' }`        | 1   | `sent`             |
| `{ status: 'blocked-by-authority', reason }` | 0 | `blocked-by-authority` |
| `{ status: 'retryable-failure', reason }` | 0 | `retryable-failure` |
| throws                      | 0   | `retryable-failure` |
| `undefined`                 | 0   | `retryable-failure` (INVALID_DELIVERY_RESULT) |
| `null`                      | 0   | `retryable-failure` (INVALID_DELIVERY_RESULT) |
| `{}`                        | 0   | `retryable-failure` (INVALID_DELIVERY_RESULT) |
| `{ status: 'unknown' }`     | 0   | `retryable-failure` (INVALID_DELIVERY_RESULT) |

## Preserved Invariants (from V0.8.9F and earlier)

- Queue: blocked item retained, retry budget unchanged, FIFO preserved
- Seed: `seedPrompt` cleared only on `sent`; retained on blocked/retryable
- `/clear`: side effect only on `sent`
- Primary generic PTY APIs remain absent from primary preload
- Dedicated Terminal sender-bound isolation unchanged
- V0.8.9E semantic closures preserved

## What V0.8.9G Does NOT Do

- Does not modify Backend (sealed at 0.7.2E)
- Does not restore any generic PTY authority
- Does not enter V0.8.10
- Does not move historical tags
- Does not do V0.8.9H Legacy Consolidation / Dead-Code Cleanup

## V0.8.9F CI Suite Count Correction

The V0.8.9F Completion Report documented `54 suites / 324 tests`.
The actual GitHub Actions run `35446387814` shows:

```
60 suites / 324 tests / 324 pass / 0 fail / 0 skip / 0 todo
```

This document corrects the record.
