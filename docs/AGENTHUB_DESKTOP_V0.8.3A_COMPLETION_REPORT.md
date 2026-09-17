# AgentHub Desktop V0.8.3A — Execute Response Contract & Ambiguity Closure Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.3A**. V0.8.3 already owned the execute mutation, Main-derived idempotency, and Connection-only `/state` follow-up. This closure pass fixes three direct V0.8.3 blockers: Desktop response bounds that were narrower than the sealed backend, post-dispatch protocol failures classified as definitive `failed`, and ambiguous UI still allowing ordinary Execute to reuse the same executionId.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model/provider calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.3`
- **Base Commit**: `310a7f9a3a128d5b0e006a6d664a69ed65a48d20`
- **V0.8.3 GitHub CI Run**: `35276110783` (PASS)
- **Target Tag**: `V0.8.3A`
- **Suggested commit**: `fix(desktop): close execute response and ambiguity contract`

Historical tags `V0.8.2`, `V0.8.2A`, `V0.8.2B`, and `V0.8.3` are not moved.

V0.8.4 is not included.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model/provider calls |
| Tag `V0.8.3` | `310a7f9a3a128d5b0e006a6d664a69ed65a48d20` | Sealed; CI run 35276110783 PASS |
| Desktop V0.8.3A commit | this landing on `main` | `fix(desktop): close execute response and ambiguity contract` |
| Target Tag | `V0.8.3A` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 Review-ready consumer bounds (`agenthubTypes`)

Aligned with pinned backend public values:

- `changedPaths` max items `4096`, preserved exactly, no silent slice
- worker `summary` / list items use JavaScript character length, not a stricter UTF-8 byte cap
- blockers/questions/risks 64 items, notes 128 items, each item 4096 characters
- command stdout/stderr preview bound raised to the backend 1 MiB evidence preview
- `branchName` bound raised to 4096 UTF-8 bytes
- changed-path strings have no extra Desktop-only per-item cap beyond NUL rejection and the 8 MiB envelope
- enum / SHA256 / Git OID validation is unchanged

### 3.2 Execute certainty provenance (`AgentHubContractError`)

Errors now carry `phase` (`preflight` | `transport` | `response-contract` | `backend`) and `requestDispatched`. `AgentHubTaskExecution` classifies from that provenance:

- not dispatched, or validated backend `ok:false` → `failed` / not retryable
- dispatched without a valid execute DTO or valid backend error → `ambiguous` / retryable with the same executionId

`BODY_OVERFLOW` is no longer guessed from the code string: local request overflow stays preflight; response overflow is response-contract after POST.

### 3.3 Ambiguous Execute UI (`TaskExecutionIdLifecycle` + modal)

While ambiguous, ordinary Execute is disabled and `beginExecute()` rejects the transition. Only `beginRetry()` may reuse the current executionId. Editing task/baseRef/prompt rotates to a fresh idle ID.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| AgentHub backend unchanged | PASS | PASS |
| real model/provider calls = 0 | PASS | PASS |
| V0.8.3A main/tag same SHA | PASS | PASS after tag `V0.8.3A` is applied to this landing |
| only create + execute POST allowed | PASS | PASS |
| no review/merge POST | PASS | PASS |
| changedPaths 4096 valid payload accepted | PASS | PASS |
| no silent changedPaths truncation | PASS | PASS |
| worker summary exact backend length semantics | PASS | PASS |
| worker list exact backend length semantics | PASS | PASS |
| Unicode backend-valid worker result accepted | PASS | PASS |
| all new response limits audited against pinned backend | PASS | PASS |
| valid backend review-ready never rejected by narrower Desktop-only bound | PASS | PASS |
| local malformed execute input = definitive failed | PASS | PASS |
| local request-body overflow = definitive failed + zero HTTP | PASS | PASS |
| valid backend error envelope = definitive failed | PASS | PASS |
| timeout/network/abort after dispatch = ambiguous | PASS | PASS |
| malformed JSON after POST = ambiguous | PASS | PASS |
| malformed envelope after POST = ambiguous | PASS | PASS |
| malformed HTTP 200 execute DTO = ambiguous | PASS | PASS |
| response BODY_OVERFLOW after POST = ambiguous | PASS | PASS |
| ambiguous protocol retry reuses same executionId | PASS | PASS |
| ambiguous protocol retry reuses same Idempotency-Key | PASS | PASS |
| ambiguous normal Execute blocked | PASS | PASS |
| ambiguous explicit Retry allowed | PASS | PASS |
| edit after ambiguous rotates ID | PASS | PASS |
| executed/failed definitive result rotates ID | PASS | PASS |
| Connection remains sole snapshot commit owner | PASS | PASS |
| V0.8.2B state barrier unchanged | PASS | PASS |
| no Munder fallback | PASS | PASS |
| focused tests PASS | PASS | PASS (109/109) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| git diff --check PASS | PASS | PASS |
| GitHub CI PASS | pending | Observe Actions on the tagged SHA; do not pre-claim PASS |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 4
Failure paths reviewed: 14
Regression paths reviewed: 8
Same-root-cause issues intentionally deferred: 0
Unresolved blockers: NONE
```

1. `changedPaths` 1024 and worker UTF-8 byte caps rejected valid pinned backend review-ready payloads. Bounds now match backend item counts and character semantics.
2. stdout/stderr preview 64 KiB and `branchName` 256 bytes were also stricter than backend evidence/lifecycle bounds. Raised to the backend limits; path strings lost the extra Desktop-only per-item byte cap.
3. `MALFORMED_JSON` / `MALFORMED_ENVELOPE` / `MALFORMED_EXECUTE_RESULT` / response `BODY_OVERFLOW` after POST were classified `failed` and rotated the executionId. Provenance now keeps those ambiguous.
4. Ambiguous Execute still submitted the same ID via ordinary Execute / Enter. Lifecycle `beginExecute()` now rejects that transition; only explicit Retry reuses the ID.

Failure paths reviewed: 4096/4097 changedPaths, CJK summary/list items, local vs response BODY_OVERFLOW, malformed JSON/envelope/DTO after POST, backend error envelope, timeout/network/abort, ambiguous retry key reuse, beginExecute while ambiguous, edit-after-ambiguous.

Regression paths reviewed: createTask 201, execute HTTP 200 lifecycle outcomes, V0.8.2B barrier, Connection-only snapshot commit, in-flight coalesce, IDEMPOTENCY_CONFLICT, no review/merge POST, 8 MiB envelope bound.

Not in this patch: review decision mutation, merge, office projection.

---

## 6. Local Verification

```text
Version: V0.8.3A
Base V0.8.3:
310a7f9a3a128d5b0e006a6d664a69ed65a48d20

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model/provider calls: 0

Local:
test:agenthub: PASS (109 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 109
# suites 19
# pass 109
# fail 0
```

GitHub Actions Run ID is recorded after the tagged push is actually observed. It is not fabricated here.

---

## 7. After PASS

Seal after independent review:

```text
V0.8.3
V0.8.3A
```

Then proceed to:

```text
V0.8.4 — Office State Projection
```

Do not pull review mutation, merge, packaging, or E2E into this patch.
