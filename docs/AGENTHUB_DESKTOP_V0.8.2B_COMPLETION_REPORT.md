# AgentHub Desktop V0.8.2B — State-Issue Barrier & CreateTask Contract Closure Completion Report

## 1. Executive Summary

This report documents **AgentHub Desktop V0.8.2B**. V0.8.2A already owned snapshot commits and blocked older responses after a newer commit. That was not enough when a newer `/state` failed or was still pending: an older successful response could still install a pre-mutation snapshot and clear `degraded`. This patch also aligns Desktop CreateTask string validation with backend `boundedText()` NUL rejection.

- **Desktop Repository**: `704986409/AgentHub-Desktop`
- **Backend Repository**: `704986409/AgentHub` (UNCHANGED, real model calls = 0, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)
- **Base Tag**: `V0.8.2A`
- **Base Commit**: `b70056d4ac6249fbacd6317c39530fa194705848`
- **V0.8.2A GitHub CI Run**: `35273174907` (Typecheck / test:agenthub / Build PASS)
- **Target Tag**: `V0.8.2B`
- **Suggested commit**: `fix(desktop): close state issue barrier and task input contract`

Historical tags `V0.8.2` and `V0.8.2A` are not moved.

V0.8.3 is not included.

---

## 2. Provenance

| Item | SHA / Value | Notes |
|---|---|---|
| Pinned AgentHub Backend | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` | Unchanged, 0 model calls |
| Tag `V0.8.2` | `923483e3946cd0b4b6bcb1b63e4b082ff91d9109` | Sealed |
| Tag `V0.8.2A` | `b70056d4ac6249fbacd6317c39530fa194705848` | Sealed; CI run 35273174907 PASS |
| Desktop V0.8.2B commit | this landing on `main` | `fix(desktop): close state issue barrier and task input contract` |
| Target Tag | `V0.8.2B` | Same commit SHA as `main` after this landing |

---

## 3. Closures

### 3.1 Latest issued vs latest committed (`AgentHubConnection`)

`#commitSnapshotIfCurrent` now returns an explicit `StateCommitResult`:

- `committed` — this response is the current newest issued request and may update cache
- `superseded-by-committed` — a newer snapshot is already committed; mutation follow-up may count as synchronized
- `superseded-uncommitted` — a newer request exists (or this newest request failed) and there is no newer safe commit; do not install this snapshot and do not report synchronized

An older `/state` cannot commit when `S < stateRequestSequence`, even if `latestCommittedSequence` has not advanced. `#doSync` applies health/`connected` only on `committed`, so a stale success cannot clear a newer `degraded` status.

### 3.2 CreateTask NUL contract (`snapshotCreateTaskInput`)

Aligned with pinned backend `boundedText()`: any bounded CreateTask string containing `\0` is `MALFORMED_INPUT`. NUL is not stripped. Invalid input never reaches `POST /api/v1/tasks`.

---

## 4. Failure Matrix

| Check | Required | Actual |
|---|---|---|
| backend unchanged | PASS | PASS |
| real model calls = 0 | PASS | PASS |
| main/tag same SHA | PASS | PASS after tag `V0.8.2B` is applied to this landing |
| only POST `/api/v1/tasks` | PASS | PASS |
| no execute/review/merge | PASS | PASS |
| single Connection snapshot commit owner | PASS | PASS |
| newer committed blocks older response | PASS | PASS |
| newer pending blocks older response | PASS | PASS |
| newer failed blocks older response | PASS | PASS |
| old response cannot clear newer degraded state | PASS | PASS |
| mutation sync failure remains `created + stateSynchronized:false` | PASS | PASS |
| mutation sync superseded by newer committed snapshot may report synchronized | PASS | PASS |
| no stale pre-mutation snapshot install | PASS | PASS |
| projectId NUL rejected | PASS | PASS |
| title NUL rejected | PASS | PASS |
| description NUL rejected | PASS | PASS |
| capability NUL rejected | PASS | PASS |
| specialty NUL rejected | PASS | PASS |
| acceptance criterion NUL rejected | PASS | PASS |
| NUL invalid request sends no HTTP | PASS | PASS |
| submissionId lifecycle regression unchanged | PASS | PASS |
| exact IPC envelope regression unchanged | PASS | PASS |
| duplicate in-flight coalescing unchanged | PASS | PASS |
| shutdown ambiguous abort unchanged | PASS | PASS |
| focused tests PASS | PASS | PASS (67/67) |
| typecheck PASS | PASS | PASS |
| build PASS | PASS | PASS |
| GitHub CI PASS | PASS | V0.8.2A run 35273174907 PASS; V0.8.2B uses the same CI gates on this push |

---

## 5. Proactive Same-Root Review

```text
Proactive issues found/fixed: 3
Failure paths reviewed: 10
Regression paths reviewed: 8
Same-root-cause issues intentionally deferred: 0
Unresolved blockers: NONE
```

1. `latestCommittedSequence` alone allowed an older `/state` to commit after a newer mutation sync failed. Commit now requires the response to be the current newest issued request, or to be older than an already committed newer snapshot.
2. `#doSync` used to set `connected` after any successful body parse, which could heal `degraded` from a stale pre-mutation response. Status/health updates now happen only on `committed`.
3. Desktop CreateTask validation accepted `\0` that backend `boundedText()` rejects. NUL now fails closed locally with no HTTP.

Failure paths reviewed: newer committed vs old, newer pending vs old, newer failed vs old, mutation created+unsync, degraded healing, NUL in projectId/title/description/capabilities/specialties/criteria, NUL no POST.

Regression paths reviewed: older blocked after newer commit, POST+WS overlap, submissionId lifecycle, IPC envelope, in-flight coalesce, shutdown abort, GET health/state/events, mutation allowlist.

Not in this patch: execute/review/merge.

---

## 6. Local Verification

```text
Version: V0.8.2B
Base V0.8.2A:
b70056d4ac6249fbacd6317c39530fa194705848

Backend:
03bc7824d732e740a88f9aa2c0122f3cf5df75ab
changed: NO
real model calls: 0

Local:
test:agenthub: PASS (67 tests, 0 fail)
typecheck: PASS
build: PASS
git diff --check: PASS
```

```text
# tests 67
# suites 12
# pass 67
# fail 0
```

---

## 7. After PASS

Seal:

```text
V0.8.2
V0.8.2A
V0.8.2B
```

Then proceed to:

```text
V0.8.3 — Task Execution
```

Do not pull execute/review/merge into this patch.
