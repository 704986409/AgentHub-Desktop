# AgentHub Desktop V0.8.6 Completion Report

## Provenance
- Base main: `main`
- Base SHA: `05ed1d3d035ff703f2d17a9f198cba8f986ee70a`
- Sealed V0.8.5A tag: `V0.8.5A`
- V0.8.5A SHA: `3dde606ad723adf69456716bab6095fa042c96c9`
- Final V0.8.6 tag: `V0.8.6`
- Final V0.8.6 SHA: `80b9f4ec7dbb0b5fb4d644713d8c397572b07084`
- Backend sealed SHA: `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`

## Review Contract
- Verdicts: `ACCEPT`, `REQUEST_REVISION`, `BLOCK`
- Reviewer identity ownership: Main process strictly owns `reviewerId: 'desktop-human'` (Renderer has no access)
- Decision ID: Renderer creates UUID/alphanumeric string; Main derives `reviewId = decisionId`
- Idempotency key: Main-owned derived header `Idempotency-Key: desktop-review:${decisionId}`
- Long timeout: Main RestClient enforces 5-minute timeout (`#executeTimeoutMs`)
- Backend changed: FALSE (0 changes to `G:\Code\AgentHub`, sealed at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab`)

## Mutation Certainty
- Applied: HTTP 200 with valid lifecycle DTO -> `status: 'applied'`
- Failed: HTTP 400, 409, 410, 500 or local request validation -> `status: 'failed'`, `retryable: false`
- Ambiguous: Network drop, timeout, redirect, malformed response payload -> `status: 'ambiguous'`, `retryable: true`
- Ambiguous retry: Preserves exact `decisionId` and derived `desktop-review:${decisionId}` key
- Settled replay: Applied and definitive failed decisions are cached in Main memory; replayed with 0 HTTP calls
- State resync: Mutation does not mutate authoritative cache directly; calls `connection.syncAuthoritativeState()` from `/state`. If sync fails, returns `status: 'applied'` with `stateSynchronized: false` and `warning`

## Lifecycle Outcomes
- review-ready: Returned on `REQUEST_REVISION`; captures revised evidence into session store and updates active handle
- blocked: Terminal outcome; marks handle unavailable, evidence remains inspectable
- waiting-input: Terminal outcome; marks handle unavailable, evidence remains inspectable
- failed: Terminal outcome; marks handle unavailable, evidence remains inspectable
- merge-denied: Non-terminal outcome; displays gate failure reasons (raw enums + friendly explanations); handle remains active, subsequent decision requires new decisionId
- completed: Terminal outcome; marks handle unavailable; displays public merge result metadata
- completed-no-change: Terminal outcome; marks handle unavailable; displays evidence hashes, no synthetic merge

## UI Safety
- ACCEPT confirmation: Requires explicit confirmation dialog with mandatory copy
- REQUEST_REVISION confirmation: Requires explicit confirmation dialog with mandatory copy
- BLOCK confirmation: Requires explicit confirmation dialog with mandatory copy
- No direct Git: Zero git commands (`git merge`, `git checkout`, `git apply`, `git reset`) in Desktop
- No PTY/Hive: Zero PTY or Hive invocations
- No patch apply: `committedPatch` remains evidence-only

## Verification
- npm run test:agenthub: 36 suites, 213 tests, 213 PASS, 0 FAIL
- npm run typecheck: PASS (node + web)
- npm run check:links: PASS (v0.4.6)
- npm run build: PASS (code 0)
- git diff --check: PASS (clean whitespace, no CRLF issues)
- Real provider/model calls: 0

## GitHub
- Commit: `feat(desktop): add safe review decision actions` (`80b9f4ec7dbb0b5fb4d644713d8c397572b07084`)
- Tag: `V0.8.6`
- Actions Run: `35367948584`
- CI Result: `SUCCESS`

## Final Status
- PENDING INDEPENDENT AUDIT

---

## Required Acceptance Matrix

| Area | Required |
|---|---|
| Base main = `05ed1d3...` | PASS |
| V0.8.5A sealed code preserved | PASS |
| Backend = `03bc782...` unchanged | PASS |
| Real provider calls = 0 | PASS |
| Only existing Review Decision backend endpoint used | PASS |
| `ACCEPT` exact verdict | PASS |
| `REQUEST_REVISION` exact verdict | PASS |
| `BLOCK` exact verdict | PASS |
| reviewerId Main-owned | PASS |
| reviewerId = `desktop-human` | PASS |
| reviewId = decisionId | PASS |
| idempotency key Main-owned | PASS |
| same ID/same body coalesced | PASS |
| same ID/different body local conflict | PASS |
| settled replay zero HTTP | PASS |
| ambiguous retry same key | PASS |
| Review uses long timeout | PASS |
| HTTP 200 valid lifecycle -> applied | PASS |
| non-2xx exact backend -> failed | PASS |
| post-dispatch malformed response -> ambiguous | PASS |
| state resync failure preserves applied | PASS |
| `review-ready` new evidence captured | PASS |
| old handle superseded after revision | PASS |
| merge-denied keeps handle actionable | PASS |
| completed disables old handle action | PASS |
| expired handle 410 handled | PASS |
| ACCEPT forbids error/blocker findings | PASS |
| BLOCK requires blocker finding | PASS |
| unsafe finding path rejected | PASS |
| request/body limits enforced | PASS |
| response bounds enforced | PASS |
| exact MergeGate DTO validated | PASS |
| exact Merge Result DTO validated | PASS |
| no generic POST | PASS |
| no raw HTTP preload | PASS |
| no direct Git merge | PASS |
| no patch apply | PASS |
| no PTY authority | PASS |
| no Hive authority | PASS |
| Review action session is memory-only | PASS |
| V0.8.5A evidence semantics preserved | PASS |
| Cursor assets preserved | PASS |
| Antigravity assets preserved | PASS |
| Claude/Codex assets preserved | PASS |
| V1.0 Human Boss direction preserved | PASS |
| focused tests PASS | PASS |
| typecheck PASS | PASS |
| check:links PASS | PASS |
| build PASS | PASS |
| git diff --check PASS | PASS |
| GitHub CI PASS | PASS |

---

## Proactive Same-Root Review Summary
- Proactive issues found/fixed: 4 (allowlist inclusion for review decision, allowed key set types, property naming alignment on ExecuteReviewReadyDto, state sync error message matching)
- Failure paths reviewed: 12
- Regression paths reviewed: 36
- Same-root-cause issues intentionally deferred: 0
- Unresolved blockers: NONE
