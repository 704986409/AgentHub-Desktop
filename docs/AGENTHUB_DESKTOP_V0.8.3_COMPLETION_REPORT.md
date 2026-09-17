# AgentHub Desktop V0.8.3 — Task Execution Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.3**. The sealed V0.8.2B baseline already owned authoritative `/state` commits, the latest-issued barrier, and idempotent `POST /api/v1/tasks`. This stage adds the smallest safe execution mutation: Desktop may ask AgentHub to execute an existing task with a Main-owned idempotency identity, then resync through Connection. Desktop still has no scheduler, provider, worktree, review-decision, or merge authority.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model/provider calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.2B`
- **Base Commit**: `3399f9ba73820bf99e47848b9c2516a8dd1f4877`
- **Target Tag**: `V0.8.3`
- **Suggested commit**: `feat(desktop): add idempotent task execution`

Historical tags `V0.8.2`, `V0.8.2A`, and `V0.8.2B` are not moved.

V0.8.4+ is not included.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model/provider calls |
| Tag `V0.8.2B` | `3399f9ba73820bf99e47848b9c2516a8dd1f4877` | Sealed |
| Desktop V0.8.3 commit | this landing on `main` | `feat(desktop): add idempotent task execution` |
| Target Tag | `V0.8.3` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 Narrow execute mutation (`AgentHubRestClient`)

Public mutation methods are exactly `createTask` and `executeTask`. Execute sends:

```text
POST /api/v1/tasks/<encodeURIComponent(taskId)>/execute
Idempotency-Key: desktop-execute:<executionId>
{"baseRef","prompt"}
```

Success status is HTTP 200. Create remains HTTP 201. Generic POST/review/merge helpers are not exposed. Serialized execute JSON is bounded to 1 MiB before any HTTP.

### 3.2 Main-owned execution lifecycle (`AgentHubTaskExecution`)

Renderer supplies `{executionId, taskId, input}` only. Main validates the exact envelope, binds `executionId → fingerprint(taskId, baseRef, prompt)`, coalesces in-flight duplicates, and classifies:

- HTTP 200 review-ready / blocked / waiting-input / failed lifecycle → `executed`
- valid non-2xx envelope → `failed` / not retryable
- timeout / network / abort-after-send → `ambiguous` / retryable with the same executionId

Follow-up snapshot writes go only through `connection.syncAuthoritativeState()`. `superseded-by-committed` counts as synchronized; `superseded-uncommitted` does not. Execute success plus `/state` failure keeps the execute result and reports `stateSynchronized: false`.

### 3.3 Renderer execution UI

Authoritative snapshot tasks are selected from cache. Base Ref placeholder `main` is not injected. Ambiguous retry preserves `executionId`. Executed/failed rotate the ID. No review Accept / Request Revision / Block / Merge / Approve actions.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| AgentHub backend unchanged | PASS | PASS |
| real model/provider calls = 0 | PASS | PASS |
| V0.8.3 main/tag same SHA | PASS | PASS after tag `V0.8.3` is applied to this landing |
| only new mutation is execute | PASS | PASS |
| createTask regression preserved | PASS | PASS |
| exact execute IPC envelope | PASS | PASS |
| Renderer cannot select URL/path/header | PASS | PASS |
| taskId validated + encoded in Main | PASS | PASS |
| baseRef exact validation | PASS | PASS |
| prompt exact validation | PASS | PASS |
| NUL rejection aligned backend | PASS | PASS |
| serialized request <= backend body limit | PASS | PASS |
| stable Main-owned Idempotency-Key | PASS | PASS |
| same ambiguous retry reuses execute key | PASS | PASS |
| changed task/body with same ID rejected | PASS | PASS |
| duplicate in-flight execute coalesced | PASS | PASS |
| no automatic retry | PASS | PASS |
| review-ready strict DTO validation | PASS | PASS |
| blocked strict DTO validation | PASS | PASS |
| waiting-input strict DTO validation | PASS | PASS |
| failed lifecycle strict DTO validation | PASS | PASS |
| lifecycle `failed` is not transport failure | PASS | PASS |
| malformed success fails closed | PASS | PASS |
| execute result never directly mutates TaskDto cache | PASS | PASS |
| Connection owns follow-up `/state` | PASS | PASS |
| V0.8.2B state barrier preserved | PASS | PASS |
| POST success + state failure distinguished | PASS | PASS |
| timeout/network failure ambiguous | PASS | PASS |
| stop abort ambiguous | PASS | PASS |
| ambiguous retry preserves executionId | PASS | PASS |
| definitive result rotates executionId | PASS | PASS |
| no review decision POST | PASS | PASS |
| no merge authority | PASS | PASS |
| no Munder execution fallback | PASS | PASS |
| focused tests PASS | PASS | PASS (103/103) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| git diff --check PASS | PASS | PASS |
| GitHub CI PASS | pending | Observe Actions on the tagged SHA; do not pre-claim PASS |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 4
Failure paths reviewed: 16
Regression paths reviewed: 8
Same-root-cause issues intentionally deferred: 0
Unresolved blockers: NONE
```

1. RestClient POST success was hardcoded to HTTP 201. Execute would have been rejected on the pinned 200 contract. Mutation helper now takes an explicit expected status per allowlisted route.
2. Prompt field limit is 1 MiB, but JSON framing can still exceed the backend whole-body 1 MiB limit. Desktop now rejects oversize serialized bodies locally with zero HTTP.
3. Pinned `lifecycleDto` may emit optional `reviewEvidenceSha256` / `merge` / `mergeGate`. Terminal snapshot allows those backend-optional keys instead of failing closed on a real execute result.
4. Existing preload/IPC allowlist tests forbade any `execute` surface. They now allow only `executeTask` and still forbid review/merge/generic transport.

Failure paths reviewed: extra IPC keys, invalid taskId, baseRef NUL/CR/LF, prompt NUL, body overflow, unknown outcome, malformed review-ready, non-integer exitCode, non-2xx, timeout, network, stop abort, idempotency conflict, in-flight coalesce, `/state` failure, superseded-uncommitted.

Regression paths reviewed: createTask 201, V0.8.2B newer committed/pending/failed barrier, submissionId lifecycle, Connection-only snapshot commit, GET health/state/events, 8 MiB response bound, no review/merge POST, no Munder fallback.

Not in this patch: review decision mutation, merge, office projection, packaging.

---

## 6. Local Verification

```text
Version: V0.8.3
Base V0.8.2B:
3399f9ba73820bf99e47848b9c2516a8dd1f4877

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model/provider calls: 0

Local:
test:agenthub: PASS (103 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 103
# suites 19
# pass 103
# fail 0
```

GitHub Actions Run ID is recorded after the tagged push is actually observed. It is not fabricated here.

---

## 7. After PASS

Seal after independent review:

```text
V0.8.2
V0.8.2A
V0.8.2B
V0.8.3
```

Then proceed to:

```text
V0.8.4 — Office State Projection
```

Do not pull review mutation, merge, packaging, or E2E into this patch.
