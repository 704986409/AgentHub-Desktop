# AgentHub Desktop V0.8.3D — Long-Running Execute Transport & Evidence Preview Contract Closure Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.3D**. V0.8.3C established the final mutation safety and strict contract closure set for task creation and execution. This narrow correctness closure fixes two specific gaps discovered during real pinned backend execution path auditing:
1. **Long-running execute transport timeout**: Separated the long-running task execution REST timeout (`DEFAULT_EXECUTE_TIMEOUT_MS = 5 * 60_000` ms) from the generic control-plane REST timeout (`DEFAULT_TIMEOUT_MS = 5000` ms), ensuring healthy backend model/evidence execution is not prematurely aborted into ambiguity while keeping control plane requests strictly bounded.
2. **Public build/test preview NUL allowance**: Allowed and preserved NUL (`\0`) in `buildTest.commands[].stdoutPreview` and `buildTest.commands[].stderrPreview` to match the backend's UTF-8 `StringDecoder` raw process output capturing without loosening NUL prohibitions on input or path fields.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model/provider calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.3C`
- **Base Commit**: `ab1fc0518dda81d9136342d839459365e38cba65`
- **V0.8.3C GitHub CI Run**: `35281800177` (PASS)
- **Target Tag**: `V0.8.3D`
- **Suggested Commit**: `fix(desktop): close execute transport and preview contract gaps`

Historical tags `V0.8.2`, `V0.8.2A`, `V0.8.2B`, `V0.8.3`, `V0.8.3A`, `V0.8.3B`, and `V0.8.3C` are not moved.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model/provider calls |
| Tag `V0.8.3C` | `ab1fc0518dda81d9136342d839459365e38cba65` | Sealed; CI run 35281800177 PASS |
| Desktop V0.8.3D commit | this landing on `main` | `fix(desktop): close execute transport and preview contract gaps` |
| Target Tag | `V0.8.3D` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 Execute Transport Timeout Separation (`AgentHubRestClient`)
- Introduced `DEFAULT_EXECUTE_TIMEOUT_MS = 300_000` (5 minutes) while preserving `DEFAULT_TIMEOUT_MS = 5_000` (5 seconds).
- Bounded configurable timeout options with `validateTimeoutMs()` ensuring positive safe integers `<= 24` hours (`86_400_000` ms).
- Control-plane methods (`health`, `state`, `events`, `createTask`) continue to use the 5-second generic deadline.
- `executeTask` uses `this.#executeTimeoutMs`.
- Internal `#request` accurately reports `timeoutMs` in the `TIMEOUT` error message.
- External `AbortSignal` (such as shutdown) aborts requests immediately as before.
- Execute transport timeout after request dispatch remains classified as `ambiguous`, `retryable: true`, reusing the same derived `desktop-execute:${executionId}` idempotency key on explicit Retry.
- Renderer has zero ability to choose transport timeouts.

### 3.2 Public Build/Test Preview NUL Semantics (`agenthubTypes`)
- Narrowly updated `buildTest.commands[].stdoutPreview` and `buildTest.commands[].stderrPreview` via `snapshotCommandPreviewText()`:
  - String type required.
  - Max 1 MiB (`1024 * 1024` bytes) UTF-8 bound enforced.
  - NUL allowed and preserved exactly without silent modification or truncation.
- `snapshotBoundedText()` remains unchanged with `rejectIfContainsNul()` strictly intact for input and path fields:
  - `CreateTask` input strings.
  - `Execute` `taskId`, `baseRef`, `prompt`.
  - `source.branchName`, `source.changedPaths`.
- Mutation boundary parsing for `review-ready` accepts NUL-bearing previews without failing closed or producing `MALFORMED_EXECUTE_RESULT` / ambiguous.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| backend unchanged | PASS | PASS (`03bc7824d732e740a88f9aa2c0122f3cf5df75ab`) |
| real model/provider calls = 0 | PASS | PASS (0 real model calls) |
| V0.8.3D main/tag same SHA | PASS | PASS (tag `V0.8.3D` on this commit) |
| generic REST timeout remains short | PASS | PASS (5000 ms default) |
| execute has separate long-running timeout | PASS | PASS (300,000 ms default) |
| Renderer cannot choose execute timeout | PASS | PASS (no IPC/preload parameter) |
| execute beyond generic timeout succeeds | PASS | PASS (tested with 50ms server response when executeTimeoutMs=200ms and timeoutMs=20ms) |
| execute-specific timeout after dispatch is ambiguous | PASS | PASS (tested with 50ms server response when executeTimeoutMs=20ms) |
| timeout Retry reuses same executionId/key | PASS | PASS (`desktop-execute:${executionId}`) |
| stdoutPreview NUL accepted/preserved | PASS | PASS (`a\0b` and `before\0after` preserved exactly) |
| stderrPreview NUL accepted/preserved | PASS | PASS (`\0` preserved exactly) |
| NUL-preview review-ready is executed | PASS | PASS (status: 'executed', stateSynchronized: true) |
| input/path NUL prohibitions unchanged | PASS | PASS (baseRef, prompt, branchName, changedPaths reject NUL) |
| strict C review-ready invariants unchanged | PASS | PASS |
| status/envelope certainty unchanged | PASS | PASS |
| redirect prohibition unchanged | PASS | PASS |
| settled replay unchanged | PASS | PASS |
| Connection sole snapshot commit owner | PASS | PASS |
| V0.8.2B state barrier unchanged | PASS | PASS |
| no review/merge mutation | PASS | PASS |
| no Munder fallback | PASS | PASS |
| focused tests PASS | PASS | PASS (134/134 PASS) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| git diff --check PASS | PASS | PASS |
| GitHub CI PASS | pending | Observe Actions on the tagged SHA; do not pre-claim PASS |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 3
Failure paths reviewed: 18
Regression paths reviewed: 24
Same-root-cause issues intentionally deferred: 0
Unresolved code blockers: NONE
```

1. **Execute generic timeout ambiguity**: Execute previously inherited generic 5s REST timeout, causing healthy long-running Claude turns and build/evidence execution to be aborted as ambiguous. Fixed by introducing dedicated `executeTimeoutMs` default of 5 minutes.
2. **Evidence preview NUL rejection**: Child process stdout/stderr can contain NUL bytes (`\0`) when decoded via UTF-8 `StringDecoder`. Desktop previously rejected NUL on preview text. Fixed by implementing `snapshotCommandPreviewText` specifically for preview fields.
3. **TIMEOUT error message parameter leak**: The internal `#request()` method was reporting `this.#timeoutMs` in the `TIMEOUT` message string instead of the per-request `timeoutMs`. Fixed to accurately reflect the actual timeout applied.

---

## 6. Local Verification

```text
Version: V0.8.3D
Base V0.8.3C:
ab1fc0518dda81d9136342d839459365e38cba65

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model/provider calls: 0

Local:
test:agenthub: PASS (134 tests, 0 fail)
typecheck: PASS
check:links: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 134
# suites 23
# pass 134
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

GitHub Actions Run ID is recorded after the tagged push is actually observed.

---

## 7. After PASS

Seal after independent review:

```text
V0.8.3
V0.8.3A
V0.8.3B
V0.8.3C
V0.8.3D
-> SEALED + UNCHANGED
```

Then proceed to:

```text
V0.8.4 — Office State Projection
```
