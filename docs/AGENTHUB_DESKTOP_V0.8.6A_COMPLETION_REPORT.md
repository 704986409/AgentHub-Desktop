# AgentHub Desktop V0.8.6A Completion Report

## Git identity

- Base Desktop SHA: `0801626b51933cdeeda5a1af827e93540fb2e2a9`
- V0.8.6A code/tag SHA: `5107a2e212804edb00b9b741b05911ee4d01d7e1`
- Tag: `V0.8.6A`
- Main SHA before this documentation-only report commit: `5107a2e212804edb00b9b741b05911ee4d01d7e1`
- Backend SHA: `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` (unchanged)

The release tag points to the code commit above. This report is the subsequent documentation-only commit on `main`.

## Changed files

- `src/renderer/src/components/AgentHubReviewDecisionSection.tsx`
- `src/renderer/src/components/agentHubReviewActionValidation.ts`
- `src/renderer/src/stores/agentHubReviewActionStore.ts`
- `test/agenthub-review-action.test.ts`
- `docs/AGENTHUB_DESKTOP_V0.8.6A_COMPLETION_REPORT.md`

## State-machine closure

- `merge-denied` keeps the review handle usable and exposes `Start New Decision`, which rotates to a new `decisionId` without posting automatically.
- Definitive non-expiration failures lock the settled form until `Start New Decision` creates a new `decisionId` on the same handle.
- Ambiguous requests retain the original `decisionId`; only `Retry Same Decision` can reuse it.
- Editing after ambiguity rotates the `decisionId` and returns the session to `idle`.
- Expired handles remain unavailable; evidence is retained and no new decision can be started.
- Settled `applied` and definitive `failed` forms are locked so a changed body cannot accidentally reuse a settled identity.

## Form-contract closure

- Blank or whitespace-only optional finding paths are omitted from canonical action state and DTOs.
- Non-empty finding paths are preserved and remain subject to strict safe-relative-path validation.
- `allowNoChangeCompletion` is enabled only for `ACCEPT` and is forced to `false` for `REQUEST_REVISION` and `BLOCK`.
- Findings UI and guards use the public `0..256` limit.
- Summary display uses UTF-8 byte count against the `16384` byte limit.
- Review Evidence remains session-only; review-ready revision results continue to replace the active task evidence and handle.

## Verification

Every command below was run through an external PowerShell process with a hard timeout; command stdout/stderr was captured while producing this report.

| Command | Timeout | Exit | Result |
| --- | ---: | ---: | --- |
| `npm run test:agenthub` | 120000 ms | 0 | PASS — 36 suites, 218 tests, 218 passed, 0 failed |
| `npm run typecheck` | 120000 ms | 0 | PASS |
| `npm run check:links` | 120000 ms | 0 | PASS |
| `npm run build` | 180000 ms | 0 | PASS — Electron/Vite build and main asset copy completed; existing dynamic-import warning only |
| `git diff --check` | 30000 ms | 0 | PASS |

Focused regression coverage includes merge-denied new-decision POST identity, settled replay and idempotency conflict preservation, definitive failure rotation, expired-handle closure, ambiguous retry/edit behavior, path omission and safe path preservation, verdict normalization, 255/256/257 finding limits, Unicode UTF-8 byte counting, and renderer authority guards.

## GitHub Actions

- Run: [35371201245](https://github.com/704986409/AgentHub-Desktop/actions/runs/35371201245)
- Head SHA: `5107a2e212804edb00b9b741b05911ee4d01d7e1`
- Status: `completed`
- Conclusion: `success`
- Build job `105685315196`: `success`
- Typecheck job `105685315479`: `success`

## Backend seal

Backend remains at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` and was not modified.

Real Provider/model calls: `0`.
