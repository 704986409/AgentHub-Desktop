# AgentHub Desktop V0.8.2 — Idempotent Task Submission Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.2 — Idempotent Task Submission** for `704986409/AgentHub-Desktop`. Desktop now has exactly one mutation:

```text
POST /api/v1/tasks
```

The flow is:

```text
Renderer task form
  → narrow Preload API
  → typed IPC `agenthub:createTask`
  → Electron Main validation + submission/body binding
  → AgentHub POST /api/v1/tasks
  → snapshotTaskDto(response.data)
  → authoritative GET /api/v1/state
  → atomic cache replace + Renderer update
```

AgentHub remains the sole authority for task ID, lifecycle status, assignment, routing, providers, worktrees, review, merge, and events. Desktop only submits a task request. V0.8.3 (task execution) is not pulled into this stage.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.1D`
- **Base Commit**: `db06002da92771121f77008a21bd3dbcbb9bd84c`
- **Target Tag**: `V0.8.2`
- **Status**: Local verification PASS. GitHub CI requires push of this commit.

---

## 2. Commit & Provenance Lineage

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model calls |
| Historical Tag `V0.8.1D` | `db06002da92771121f77008a21bd3dbcbb9bd84c` | Sealed baseline |
| Desktop V0.8.2 commit | recorded by `git rev-parse HEAD` on this landing | Suggested message: `feat(desktop): add idempotent task submission` |
| Target Tag | `V0.8.2` | Apply to the same SHA as `main` after this landing |

Crash/restart recovery of ambiguous submissions is deferred. The next Desktop startup still uses authoritative `GET /state`. No persistent Desktop idempotency database was added.

---

## 3. Key Implementations

### 3.1 Runtime input (`src/shared/agenthubTypes.ts`)

`snapshotCreateTaskInput()` produces a new frozen object. Extra top-level keys are rejected. UTF-8 byte limits are enforced for `projectId` (256), `title` (16 KiB), `description` (128 KiB), capabilities/specialties items (512, max 256), and acceptance-criteria items (8192, max 256). Complexity and risk must be exact backend enums. User text is not silently trimmed except for nonblank checks, and is never truncated.

### 3.2 REST mutation (`src/main/agenthub/AgentHubRestClient.ts`)

Public mutation surface is only `createTask(input, idempotencyKey, signal?)`. Private `#post` allows only `POST /api/v1/tasks`. Required headers:

```text
Content-Type: application/json
Accept: application/json
Idempotency-Key: desktop-task:<submissionId>
```

Success requires HTTP 201 and `snapshotTaskDto(data)`. Malformed Task DTOs fail closed and do not update cache. Existing loopback URL, timeout, AbortSignal, 8 MiB response bound, and strict envelopes remain.

### 3.3 Idempotency and authority (`src/main/agenthub/AgentHubTaskSubmission.ts`)

Main derives `Idempotency-Key: desktop-task:<submissionId>`. Renderer cannot supply raw headers. Session map binds `submissionId → body fingerprint`:

- same ID + same body → same key (retry of one logical submit)
- same ID + different body → local `IDEMPOTENCY_CONFLICT`, no HTTP
- in-flight double submit → one POST
- TIMEOUT / NETWORK_ERROR / ABORTED → `ambiguous` + retryable
- definitive 4xx/validation → `failed`, not retryable
- POST succeeds + GET `/state` fails → `created` with `stateSynchronized: false`; connection becomes `degraded`
- POST TaskDto is never inserted into cache

### 3.4 IPC / Preload / Renderer

- IPC channel: `agenthub:createTask` only (plus existing read-only channels)
- Preload: `window.agentHub.createTask(request)`
- UI: title-bar badge → Submit New Task modal
- Required fields: Project (from snapshot), Title, Description, Complexity, Risk, capabilities, specialties, acceptance criteria
- UX states: idle / submitting / created / ambiguous / definitive error
- Duplicate button disabled while in flight; Retry reuses the same `submissionId` and normalized body; editing after an ambiguous attempt mints a new `submissionId`

### 3.5 Shutdown

`teardownAndQuit` calls `agentHubTaskSubmission.stop()` before `agentHubConnection.stop()`. In-flight POST is aborted and classified as ambiguous. No background retries. AgentHub backend is not stopped.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| AgentHub backend unchanged | PASS | PASS |
| real model calls = 0 | PASS | PASS |
| main/tag same SHA | PASS | PASS after tag `V0.8.2` is applied to this landing |
| create input strict runtime validation | PASS | PASS |
| UTF-8 byte limits | PASS | PASS |
| POST only `/api/v1/tasks` | PASS | PASS |
| no execute/review/merge POST | PASS | PASS |
| Content-Type correct | PASS | PASS |
| stable derived Idempotency-Key | PASS | PASS |
| same submission retry reuses key | PASS | PASS |
| same ID + changed body rejected | PASS | PASS |
| returned TaskDto runtime validated | PASS | PASS |
| malformed success fails closed | PASS | PASS |
| successful create triggers `/state` | PASS | PASS |
| cache not mutated from POST response | PASS | PASS |
| POST success + resync failure distinguished | PASS | PASS |
| ambiguous transport failure retryable | PASS | PASS |
| duplicate in-flight submission prevented | PASS | PASS |
| Renderer has no generic HTTP/WS | PASS | PASS |
| preload exposes only narrow create method | PASS | PASS |
| no Munder fallback authority | PASS | PASS |
| shutdown aborts mutation | PASS | PASS |
| focused tests PASS | PASS | PASS (57/57) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| `git diff --check` | PASS | PASS |
| GitHub CI PASS | PASS | pending push (local gates identical to CI: typecheck, test:agenthub, check:links, build) |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 6
Failure paths reviewed: 16
Regression paths reviewed: 8
Same-root-cause issues intentionally deferred: 0
Unresolved blockers: NONE
```

Issues found and fixed while completing V0.8.2:

1. Quit path only stopped the connection, so an in-flight POST was not aborted. Main now stops `AgentHubTaskSubmission` first.
2. Coalesced `refresh()` could return null while another sync was in flight and falsely report unsynchronized state. Create now performs a dedicated `GET /api/v1/state` and atomically replaces the cache.
3. A resync throw after a successful POST must remain `created`, not `ambiguous`.
4. Local validation / idempotency conflict now returns a serializable `failed` result instead of throwing across IPC (which could leave the form stuck on Submitting).
5. Renderer submit/retry is wrapped so unexpected IPC failures still leave a definitive UI error.
6. `git diff --check` EOF blank line in `test/agenthub-rest-client.test.ts`.

Failure paths reviewed: extra keys, blank projectId/title, UTF-8 limits, array limits, invalid complexity/risk, blank Idempotency-Key, non-201, backend error envelope, malformed TaskDto, body overflow (existing), TIMEOUT retry, NETWORK_ERROR, ABORTED shutdown, POST + `/state` failure, idempotency conflict, post-stop submit.

Regression paths reviewed: GET health/state/events, WS hello/resync, stop-race, degraded resync, no execute/review/merge methods, no generic REST/IPC, cache authority, connection lifecycle unchanged.

Intentionally not in V0.8.2: `POST /api/v1/tasks/:taskId/execute`, review, merge, provider turns, persistent idempotency store.

---

## 6. Local Verification

```text
Version: V0.8.2
Base V0.8.1D:
db06002da92771121f77008a21bd3dbcbb9bd84c

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model calls: 0

Local:
test:agenthub: PASS (57 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

`npm run test:agenthub` summary:

```text
# tests 57
# suites 10
# pass 57
# fail 0
# duration_ms 5883.0892
```

New focused coverage includes runtime create-task validation, REST POST allowlist, derived Idempotency-Key reuse, local conflict, in-flight coalescing, POST-then-`/state` authority, resync-failure distinction, shutdown abort, and narrow IPC/preload surface.

---

## 7. After PASS

Seal:

```text
V0.8.2
```

Then proceed to:

```text
V0.8.3 — Task Execution
```

V0.8.3 is the first Desktop stage allowed to call `POST /api/v1/tasks/:taskId/execute`. That work is not in V0.8.2.
