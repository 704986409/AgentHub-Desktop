# AgentHub Desktop V0.8.7A Completion Report

## Release Summary

- Baseline commit: `4dab83a24f221734f2988f80dacc29f2f6db4c0f`
- Release tag: `V0.8.7A`
- Backend paired fix SHA: `2c245205d385bc5ea5e2df14ddc6011a3c5a246a` (Tag `0.7.1A`)
- Target: Desktop Agent Management Closure Fix (Blockers 1, 2, 3, 4)

## Audit Blockers Closed

### Blocker 1: Definitive-Failed & Applied Mutation ID Lifecycle
- Added explicit mutation lifecycle helpers to `agentHubAgentMutationStore`:
  - `startFreshCreate`: Always generates a new `mutationId` for logical create attempts.
  - `startFreshUpdate`: Always generates a new `mutationId` for logical update attempts.
  - `startFreshAction`: Always generates a new `mutationId` for logical enable/disable/delete attempts.
  - `abandonAmbiguous`: Clears uncertain pending state.
- Guarded `createRequest`, `updateRequest`, and `actionRequest` against settled sessions (`status === 'applied' || status === 'failed'`), preventing accidental replay of settled states.
- Re-executing an action after a definitive failure (409) or applied success now always starts with a new `mutationId`, triggering fresh HTTP calls instead of local 409 replays.

### Blocker 2: Ambiguous Form Edit Reachability & Reconciliation Guard
- Removed global `ambiguous` disablement from Create/Update forms in `AgentHubAgentManagementModal`. Forms remain interactive when a mutation outcome is uncertain.
- Editing any semantic field triggers `rotateAfterEdit`, creating a new `mutationId`, resetting state to `idle`, clearing the ambiguous error banner, and re-enabling normal review/submit workflows.
- Retrying without editing preserves the exact same `mutationId` and idempotency key.
- If an ambiguous error code contains `RECONCILIATION` (`retryable === false`), "Retry Same Mutation" is hidden/disabled, prompting the user to refresh or restart AgentHub before another mutation.

### Blocker 3: Unsupported Legacy Provider Enable Guard
- Enforced actionable runtime provider whitelist (`claude`, `codex`).
- Agents with unsupported legacy runtime providers (such as `cursor` or `antigravity`) strictly disable the "Enable" button, displaying "Runtime provider unavailable".
- Editing unsupported agents to `claude` or `codex` is supported and encouraged.

### Blocker 4: Fail-Closed Enable, Disable, and BUSY Guards
- Hardened Enable button availability:
  - Requires `selected.enabled === false`.
  - Requires `selected.status !== 'BUSY'`.
  - Requires `providerSupported(selected.providerId)`.
  - Requires `mutationsUsable && !submitting`.
  - Already-enabled agents have their Enable button disabled.
- Hardened Disable button availability:
  - Requires `selected.enabled === true`.
  - Requires `selected.status !== 'BUSY'`.
  - Requires `mutationsUsable && !submitting`.
  - Already-disabled agents have their Disable button disabled.
- Comprehensive BUSY lockout:
  - Agents with `status === 'BUSY'` lock out Edit, Enable, Disable, and Delete actions.

## Verification & Tests

### Commands
```bash
npm run test:agenthub
npm run typecheck
npm run check:links
npm run build
git diff --check
```

### Results
- `npm run test:agenthub`: 41 suites / 234 passed (0 failed, 0 skipped)
- `npm run typecheck`: PASS (0 errors)
- `npm run check:links`: PASS (consistent at v0.4.6)
- `npm run build`: PASS
- `git diff --check`: PASS
- All async tests bounded with explicit timeouts.

## Git Information

- Tag: `V0.8.7A`
- Commit message: `fix(desktop): close agent management lifecycle and guard gaps`

## Final Status

```text
PENDING INDEPENDENT AUDIT
```
