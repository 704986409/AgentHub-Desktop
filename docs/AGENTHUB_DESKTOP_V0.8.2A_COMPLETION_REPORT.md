# AgentHub Desktop V0.8.2A — Authoritative Resync & Submission Lifecycle Closure Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.2A**. V0.8.2 remained the only allowed mutation (`POST /api/v1/tasks`) and its focused tests/CI passed. Review then found two lifecycle blockers plus one trust-boundary gap. This patch closes those without starting V0.8.3.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.2`
- **Base Commit**: `923483e3946cd0b4b6bcb1b63e4b082ff91d9109`
- **V0.8.2 GitHub CI Run**: `35271690610` (Typecheck / test:agenthub / Build PASS)
- **Target Tag**: `V0.8.2A`
- **Suggested commit**: `fix(desktop): close task submission resync lifecycle gaps`

Historical tag `V0.8.2` is not moved or rewritten.

Historical CI addendum (this `main` copy only; tag `V0.8.2A` blob is not rewritten): GitHub Actions run `35273174907` later completed with Typecheck PASS, AgentHub focused tests PASS, and Build PASS. Tag `V0.8.2A` and `main` both pointed at `b70056d4ac6249fbacd6317c39530fa194705848`.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model calls |
| Tag `V0.8.2` | `923483e3946cd0b4b6bcb1b63e4b082ff91d9109` | Sealed; CI run 35271690610 PASS |
| Desktop V0.8.2A commit | this landing on `main` | `fix(desktop): close task submission resync lifecycle gaps` |
| Target Tag | `V0.8.2A` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 One snapshot commit owner (`AgentHubConnection`)

`AgentHubTaskSubmission` no longer calls `restClient.state()` plus `cache.updateSnapshot()`. After POST it requests `connection.syncAuthoritativeState()`. Connection assigns a monotonic sequence **before** each `/state` request (initial connect, `#doSync` hello/event/manual refresh, and mutation follow-up) and commits only if `sequence >= latestCommittedSequence`.

If a later request B commits first, an older in-flight request A is discarded for cache writes. Mutation follow-up still returns `stateSynchronized: true` when an equal/newer snapshot is already committed. Sync failure still yields `created` + `stateSynchronized: false` without retrying POST.

### 3.2 Renderer submission ID lifecycle (`TaskSubmissionIdLifecycle`)

- Ambiguous: keep `submissionId`; Retry uses the same ID and body
- Created: logical submission complete; next normal Submit uses a fresh ID
- Definitive failed: complete; next normal Submit uses a fresh ID
- Edit after ambiguous: mint a new ID

The helper is used from a React ref so the next Submit does not depend on stale `setState`.

### 3.3 Exact IPC request envelope (`snapshotCreateTaskRequest`)

Allowed keys are only `submissionId` and `input`. Extra keys including `idempotencyKey`, `path`, `headers`, `url`, `method`, `execute`, `review`, and `merge` fail closed before any HTTP.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| AgentHub backend unchanged | PASS | PASS |
| real model calls = 0 | PASS | PASS |
| V0.8.2A main/tag same SHA | PASS | PASS after tag `V0.8.2A` is applied to this landing |
| only POST `/api/v1/tasks` | PASS | PASS |
| no execute/review/merge | PASS | PASS |
| one authoritative snapshot commit owner | PASS | PASS |
| TaskSubmission no direct cache snapshot write | PASS | PASS |
| older state response cannot overwrite newer state | PASS | PASS |
| mutation + WS resync race deterministic test | PASS | PASS |
| successful create still triggers authoritative resync | PASS | PASS |
| POST success + resync failure remains `created` | PASS | PASS |
| ambiguous result preserves submission ID | PASS | PASS |
| created result completes submission ID | PASS | PASS |
| definitive failure completes submission ID | PASS | PASS |
| next normal submit after created gets fresh ID | PASS | PASS |
| next normal submit after failed gets fresh ID | PASS | PASS |
| edit after ambiguous gets fresh ID | PASS | PASS |
| exact IPC request envelope | PASS | PASS |
| renderer header/path/idempotency injection rejected | PASS | PASS |
| duplicate in-flight request coalesced | PASS | PASS |
| same ID + changed body rejected | PASS | PASS |
| shutdown abort remains ambiguous | PASS | PASS |
| narrow preload unchanged | PASS | PASS |
| focused tests PASS | PASS | PASS (63/63) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| GitHub CI PASS | PASS | V0.8.2 run 35271690610 PASS; V0.8.2A uses the same CI gates on this push |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 4
Failure paths reviewed: 12
Regression paths reviewed: 8
Same-root-cause issues intentionally deferred: 0
Unresolved blockers: NONE
```

1. Independent mutation `/state` write could commit an older snapshot after a newer WS resync. All production snapshot commits now go through Connection sequence ownership.
2. Returning `stateSynchronized: true` for a discarded older response is allowed only when an equal/newer snapshot is already committed.
3. Definitive created/failed kept the same Renderer `submissionId`, so a later Submit without edits replayed the old logical submission. The lifecycle helper rotates immediately.
4. Extra IPC keys were silently ignored. The request envelope now fails closed.

Failure paths reviewed: stale `/state` rollback, POST + WS overlap, POST + `/state` failure, shutdown abort, extra IPC keys, null/array request, injected idempotency/path/headers, created/failed/ambiguous ID lifecycle, edit after ambiguous, in-flight coalesce, idempotency conflict.

Regression paths reviewed: GET health/state/events, WS hello/resync, stop-race, degraded resync, mutation allowlist, narrow preload, cache not taken from POST TaskDto, connection lifecycle.

Not in this patch: `POST /api/v1/tasks/:taskId/execute`, review, merge, provider turns.

---

## 6. Local Verification

```text
Version: V0.8.2A
Base V0.8.2:
923483e3946cd0b4b6bcb1b63e4b082ff91d9109

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model calls: 0

Local:
test:agenthub: PASS (63 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 63
# suites 12
# pass 63
# fail 0
```

---

## 7. After PASS

Seal:

```text
V0.8.2
V0.8.2A
```

Then proceed to:

```text
V0.8.3 — Task Execution
```

Do not pull execute/review/merge into this patch.
