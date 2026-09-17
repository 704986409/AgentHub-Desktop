# AgentHub Desktop V0.8.3C — Final Mutation Safety & Strict Contract Closure Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.3C**. V0.8.3B already shared create/execute certainty and preserved backend-legal worker NUL. This final closure pass tightens remaining mutation-safety and strict-contract gaps before V0.8.4: worker nonblank semantics, execute endpoint invariants, HTTP status/envelope cross-validation, loopback redirect refusal, Create ambiguous UI, IPC lost-result handling, same-session settled replay, and authoritative selector membership.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model/provider calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.3B`
- **Base Commit**: `0cf7449c4c0e4a9a21d08842aa87200d6e0bec39`
- **V0.8.3B GitHub CI Run**: `35278905312` (PASS)
- **Target Tag**: `V0.8.3C`
- **Suggested commit**: `fix(desktop): close final mutation safety contract gaps`

Historical tags `V0.8.2`, `V0.8.2A`, `V0.8.2B`, `V0.8.3`, `V0.8.3A`, and `V0.8.3B` are not moved.

V0.8.4 is not included. No V0.8.3D is planned in advance.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model/provider calls |
| Tag `V0.8.3B` | `0cf7449c4c0e4a9a21d08842aa87200d6e0bec39` | Sealed; CI run 35278905312 PASS |
| Desktop V0.8.3C commit | this landing on `main` | `fix(desktop): close final mutation safety contract gaps` |
| Target Tag | `V0.8.3C` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 Worker semantic parity (`agenthubTypes`)

Worker public strings still allow and preserve NUL. They now also require `trim()`-nonblank content without silently trimming. Review-ready additionally requires empty `blockers` and `questions`.

### 3.2 Execute response endpoint invariants

- `reviewHandle` is 64 lowercase hex and equals `reviewBundleSha256`
- review-ready / terminal `taskId` matches the pinned managed-task pattern
- review-ready `source.branchName === agenthub/<taskId>`
- `changedPaths` are nonempty, unique, NUL-free, and already in backend lexical order
- command IDs match `^[A-Za-z0-9._-]{1,64}$` and are unique
- `exitCode`, when present, is a safe int32
- execute terminal DTOs reject `reviewEvidenceSha256` / `merge` / `mergeGate`

### 3.3 HTTP status/envelope certainty and redirects

Exact `4xx/5xx + ok:false + {code,message}` is a definitive backend failure. `2xx + ok:false`, `non-2xx + ok:true`, extra nested error keys, and wrong mutation success status remain `response-contract` / ambiguous. RestClient uses `redirect: 'manual'` and rejects every 3xx without contacting the Location target.

### 3.4 Create lifecycle, IPC, settled replay, selectors

Create now matches Execute: `beginSubmit()` rejects ambiguous; only `beginRetry()` reuses the ID. Renderer store maps mutation IPC rejection to `ambiguous` while `NO_PRELOAD` stays definitive. Main retains immutable settled `created`/`executed`/`failed` results for the session and returns them with zero HTTP. Create/Execute selectors require current snapshot membership; empty projects no longer expose a free-text `projectId`.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| AgentHub backend unchanged | PASS | PASS |
| real model/provider calls = 0 | PASS | PASS |
| V0.8.3C main/tag same SHA | PASS | PASS after tag `V0.8.3C` is applied to this landing |
| only create + execute POST allowed | PASS | PASS |
| no review/merge POST | PASS | PASS |
| worker NUL preserved | PASS | PASS |
| blank worker summary rejected | PASS | PASS |
| blank worker list items rejected | PASS | PASS |
| review-ready blockers empty | PASS | PASS |
| review-ready questions empty | PASS | PASS |
| reviewHandle valid SHA | PASS | PASS |
| reviewHandle equals reviewBundleSha256 | PASS | PASS |
| review-ready managed taskId valid | PASS | PASS |
| source branch matches agenthub/taskId | PASS | PASS |
| changedPaths unique | PASS | PASS |
| changedPaths sorted | PASS | PASS |
| command IDs exact backend pattern | PASS | PASS |
| command IDs unique | PASS | PASS |
| command exitCode int32 bounded | PASS | PASS |
| execute terminal rejects reviewEvidenceSha256 | PASS | PASS |
| execute terminal rejects merge | PASS | PASS |
| execute terminal rejects mergeGate | PASS | PASS |
| HTTP 2xx + ok:false is ambiguous | PASS | PASS |
| HTTP non-2xx + ok:true is ambiguous | PASS | PASS |
| exact 4xx/5xx ok:false is definitive | PASS | PASS |
| nested error envelope exact | PASS | PASS |
| redirects never followed | PASS | PASS |
| redirected mutation is ambiguous | PASS | PASS |
| Create ambiguous normal Submit blocked | PASS | PASS |
| Create explicit Retry reuses same ID | PASS | PASS |
| Create lifecycle transitions fail closed | PASS | PASS |
| mutation IPC rejection is ambiguous | PASS | PASS |
| execute IPC rejection cannot stick in executing | PASS | PASS |
| same-session created replay sends zero second POST | PASS | PASS |
| same-session executed replay sends zero second POST | PASS | PASS |
| same-session definitive failure sends zero second POST | PASS | PASS |
| ambiguous retry still sends same-key POST | PASS | PASS |
| no arbitrary Create projectId fallback | PASS | PASS |
| Create project must be current snapshot member | PASS | PASS |
| Execute task must be current snapshot member | PASS | PASS |
| Connection sole snapshot commit owner | PASS | PASS |
| V0.8.2B state barrier preserved | PASS | PASS |
| no Munder fallback | PASS | PASS |
| focused tests PASS | PASS | PASS (125/125) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| git diff --check PASS | PASS | PASS |
| GitHub CI PASS | pending | Observe Actions on the tagged SHA; do not pre-claim PASS |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 8
Failure paths reviewed: 22
Regression paths reviewed: 10
Same-root-cause issues intentionally deferred: 0
Unresolved code blockers: NONE
```

1. Worker NUL allowance had dropped `trim()`-nonblank, so backend-invalid blank worker text was accepted. Restored nonblank without forbidding NUL.
2. Review-ready accepted nonempty blockers/questions, which the pinned COMPLETED worker cannot emit. Rejected at the execute parser.
3. `reviewHandle` was an arbitrary string and was not bound to `reviewBundleSha256`.
4. Review-ready branch/task identity and changedPaths uniqueness/order were looser than pinned Git capture.
5. Execute terminal still accepted later review/merge-only fields.
6. `2xx + ok:false` and extra nested error keys were classified as definitive backend failures.
7. Fetch followed redirects off the validated loopback endpoint.
8. Create UI still submitted the ambiguous ID; IPC rejection rotated IDs or stuck Execute in `executing`; Main replayed settled IDs as a second POST; empty-project UI invented `projectId`.

The documented backend idempotency TTL/eviction limit remains an API limitation, not a deferred Desktop code bug.

---

## 6. Local Verification

```text
Version: V0.8.3C
Base V0.8.3B:
0cf7449c4c0e4a9a21d08842aa87200d6e0bec39

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model/provider calls: 0

Local:
test:agenthub: PASS (125 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 125
# suites 20
# pass 125
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
V0.8.3C
```

Then proceed to:

```text
V0.8.4 — Office State Projection
```

Do not pull review mutation, merge, packaging, or E2E into this patch.
