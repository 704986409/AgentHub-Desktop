# AgentHub Desktop V0.8.10 Backend Contract Gap

**Status:** `BLOCKED — BACKEND CONTRACT GAP`  
**Backend:** `dd27fd7f84732b72e0e23516ee35d1824f5676e9` (`0.7.2E`, sealed)

## Missing semantics

The public API has task/assignment execution records and review decisions, but no public lifecycle contract for:

1. Lead intake identity and ownership;
2. plan proposal identity/version and plan lifecycle;
3. human approve, request-changes, reject, or cancel actions;
4. decomposition with durable parent/child identity;
5. dependency edges and Backend-computed eligibility;
6. dispatch/assignment ownership for a proposed plan;
7. distinct human plan revision, execution retry, and provider transport retry;
8. aggregate status/result ownership; and
9. authoritative final completion.

## Why existing contracts cannot safely represent this

`TaskDto.status` is an execution/task field, while `AssignmentDto.status` is an assignment field. Neither carries proposal version, approval authority, dependency edges, parent identity, or aggregate completion. The generic event envelope has entity/status fields but no lifecycle-specific DTO or transition semantics. The existing `POST /api/v1/tasks`, `/execute`, and review decision endpoints therefore cannot prove an approved plan, legally dispatch a dependency graph, or establish parent completion. Mapping these facts into renderer state or overloading task statuses would create a second Backend and violate the V0.8.10 authority rules.

## Minimum Backend contract required before Desktop work

The separately reviewed Backend release should expose versioned public DTOs and idempotent mutations for:

- Lead/intake and plan proposal identity, owner, version, and lifecycle state;
- approval decisions bound to an exact proposal/version, including reject/request-changes;
- decomposition parent/child identities and dependency edges;
- Backend-computed dependency satisfaction and dispatch eligibility;
- assignment/dispatch ownership and specialist execution linkage;
- separate operation identities and outcomes for plan revision, execution retry, and provider transport retry;
- review revision linkage without collapsing it into execution failure;
- aggregate state/result and authoritative final completion;
- realtime events and `GET /state` fields for every durable lifecycle transition; and
- documented ambiguity/idempotency and reconnect/resync behavior for each mutation.

## Authority and migration impact

Backend remains the sole owner of the above business truth. Desktop can then add narrow typed IPC/REST methods and a pure projection over authoritative snapshots. No Desktop local store, Office actor, PTY, provider process, or legacy queue can substitute for the missing contract. The migration must preserve existing task creation/execution/review DTOs and historical tags, and must not reopen or edit sealed Backend `0.7.2E` in this release.

## Required Backend tests

The Backend contract release must add deterministic tests for proposal/version concurrency, approval idempotency and ambiguity, decomposition/dependency eligibility, dispatch ownership, distinct revision/retry semantics, aggregate versus child status, final completion, event ordering, reconnect snapshot replacement, stale-version rejection, and malformed/unknown-state fail-closed behavior. Tests must use fake providers and must not invoke paid models or provider CLIs.

## Release consequence

Desktop V0.8.10 implementation is intentionally stopped at the contract gate. No Backend files were changed, no lifecycle behavior was fabricated, and **no `V0.8.10` tag may be created**. V0.8.11 must not start until a separately reviewed Backend contract closes these gaps.
