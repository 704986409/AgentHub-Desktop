# AgentHub Desktop V0.8.3B — Public Response Parity & Shared Mutation Certainty Closure Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.3B**. V0.8.3A already aligned execute response bounds and execute certainty provenance. This closure pass fixes two remaining direct dependents of that contract: Desktop still rejected backend-legal NUL in public worker strings, and TaskSubmission still classified create certainty from a transport-code list instead of shared RestClient provenance.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model/provider calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.3A`
- **Base Commit**: `3df310454dd73f41bc4f832b947e39b30c032c93`
- **V0.8.3A GitHub CI Run**: `35277640761` (PASS)
- **Target Tag**: `V0.8.3B`
- **Suggested commit**: `fix(desktop): close public response parity and mutation certainty`

Historical tags `V0.8.2`, `V0.8.2A`, `V0.8.2B`, `V0.8.3`, and `V0.8.3A` are not moved.

V0.8.4 is not included.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model/provider calls |
| Tag `V0.8.3A` | `3df310454dd73f41bc4f832b947e39b30c032c93` | Sealed; CI run 35277640761 PASS |
| Desktop V0.8.3B commit | this landing on `main` | `fix(desktop): close public response parity and mutation certainty` |
| Target Tag | `V0.8.3B` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 Worker public-string parity (`agenthubTypes`)

Pinned backend worker schema does not forbid NUL on:

- `workerResult.summary` (8192 JS characters, preserved exactly)
- `workerResult.blockers` / `questions` / `risks` / `notes` (item-count limits unchanged, 4096 JS characters/item)

Desktop now snapshots those **response-only** fields with `forbidNul = false`. NUL is not stripped. Exact string content is preserved.

CreateTask input, Execute input, `taskId` / `baseRef` / `prompt`, evidence strings, and `changedPaths` retain existing NUL rejection.

### 3.2 Shared mutation certainty (`isDefinitiveMutationFailure`)

`AgentHubRestClient` exports one Main-only helper:

```ts
export function isDefinitiveMutationFailure(error: AgentHubContractError): boolean {
  return error.phase === 'backend' || !error.requestDispatched;
}
```

`AgentHubTaskSubmission` and `AgentHubTaskExecution` both use it. Classification is no longer a hardcoded `TIMEOUT` / `NETWORK_ERROR` / `ABORTED` list.

`createTask()` wraps a malformed TaskDto after HTTP 201 as:

- `code = MALFORMED_TASK`
- `phase = response-contract`
- `requestDispatched = true`

so the create mutation stays ambiguous and retries the same `desktop-task:<submissionId>`.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| AgentHub backend unchanged | PASS | PASS |
| real model/provider calls = 0 | PASS | PASS |
| V0.8.3B main/tag same SHA | PASS | PASS after tag `V0.8.3B` is applied to this landing |
| only create + execute POST allowed | PASS | PASS |
| no review/merge POST | PASS | PASS |
| backend-valid worker summary NUL preserved | PASS | PASS |
| backend-valid blocker NUL preserved | PASS | PASS |
| backend-valid question NUL preserved | PASS | PASS |
| backend-valid risk NUL preserved | PASS | PASS |
| backend-valid note NUL preserved | PASS | PASS |
| worker length/item-count limits unchanged | PASS | PASS |
| valid NUL worker review-ready executes successfully | PASS | PASS |
| execute malformed post-dispatch response remains ambiguous | PASS | PASS (V0.8.3A retained) |
| create malformed TaskDto after POST is ambiguous | PASS | PASS |
| create malformed JSON after POST is ambiguous | PASS | PASS |
| create malformed envelope after POST is ambiguous | PASS | PASS |
| create response BODY_OVERFLOW after POST is ambiguous | PASS | PASS |
| create ambiguous retry uses same submissionId | PASS | PASS |
| create ambiguous retry uses same idempotency key | PASS | PASS |
| local create validation failure remains definitive | PASS | PASS |
| local create body overflow remains definitive | PASS | PASS |
| valid create backend ok:false remains definitive | PASS | PASS |
| valid create success remains created | PASS | PASS |
| execute certainty semantics unchanged | PASS | PASS |
| Connection remains sole snapshot commit owner | PASS | PASS |
| V0.8.2B barrier unchanged | PASS | PASS |
| no Munder fallback | PASS | PASS |
| focused tests PASS | PASS | PASS (113/113) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| git diff --check PASS | PASS | PASS |
| GitHub CI PASS | pending | Observe Actions on the tagged SHA; do not pre-claim PASS |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 3
Failure paths reviewed: 12
Regression paths reviewed: 8
Same-root-cause issues intentionally deferred: 0
Unresolved blockers: NONE
```

1. Worker `summary` / list items still called `rejectIfContainsNul`, so a valid review-ready execute with backend-legal NUL became forever-ambiguous. Response-only worker strings now preserve NUL; input fields keep NUL rejection.
2. `createTask()` wrapped malformed TaskDto without response provenance, defaulting to `preflight` / not-dispatched. It now carries `phase = response-contract` and `requestDispatched = true`.
3. `AgentHubTaskSubmission` still classified certainty from a transport-code list, so malformed JSON/envelope/DTO/response overflow after POST was `failed` and rotated `submissionId`. Both mutations now share `isDefinitiveMutationFailure`.

Failure paths reviewed: worker NUL on summary/blockers/questions/risks/notes, HTTP 200 review-ready with `summary: "done\0with marker"`, create malformed TaskDto/JSON/envelope/response overflow, same-key create retry, local CreateTask validation, local request BODY_OVERFLOW, backend `ok:false`, execute certainty helper reuse.

Regression paths reviewed: input NUL still rejected, worker length/item-count limits, createTask 201 success, execute HTTP 200 lifecycle, Connection-only snapshot commit, V0.8.2B barrier, POST allowlist (create + execute only), no Renderer exposure of the certainty helper.

Not in this patch: review decision mutation, merge, office projection, automatic retry.

---

## 6. Local Verification

```text
Version: V0.8.3B
Base V0.8.3A:
3df310454dd73f41bc4f832b947e39b30c032c93

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model/provider calls: 0

Local:
test:agenthub: PASS (113 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 113
# suites 19
# pass 113
# fail 0
```

GitHub Actions Run ID is recorded after the tagged push is actually observed. It is not fabricated here.

---

## 7. After PASS

Seal after independent review:

```text
V0.8.3
V0.8.3A
V0.8.3B
```

Then proceed to:

```text
V0.8.4 — Office State Projection
```

Do not pull review mutation, merge, packaging, or E2E into this patch.
