# AgentHub Desktop V0.8.10 Public Backend Contract Audit

**Audit status:** `BLOCKED — BACKEND CONTRACT GAP`

**Audit date:** 2026-09-20  
**Desktop base:** `47fe2ab09117df919dc7d269204244c41f2b54dc`  
**Backend audited:** `dd27fd7f84732b72e0e23516ee35d1824f5676e9` (`0.7.2E`, sealed)

## Scope and method

This audit considers only contracts visible to Desktop: the Backend HTTP DTOs/endpoints and realtime event envelope, plus the already typed Desktop REST/IPC boundary. Backend private services, repositories, database tables, and internal coordinator class names are not treated as capabilities.

Evidence reviewed:

- Desktop `src/shared/agenthubTypes.ts`, `src/main/agenthub/AgentHubRestClient.ts`, `src/main/agenthub/AgentHubIpc.ts`.
- Backend public `src/api/ApiDtos.ts`, `src/api/AgentHubHttpServer.ts`, and public API tests at `tests/api-v0.7.test.ts` and `tests/api-v0.7.2.test.ts`.

## Public contract inventory

The public API exposes `GET /api/v1/health`, `GET /api/v1/state`, `GET /api/v1/events`, and `GET /api/v1/providers`. Mutations are limited to task creation, task execution, review decision, and Agent management. State contains arrays of `projects`, `agents`, `tasks`, and `assignments`; events expose generic entity/status fields and a redacted public payload. The typed Desktop DTOs contain no plan, approval, dependency, parent/child, eligibility, aggregate, or completion fields.

| Capability | Public DTO | Public mutation | Realtime/state evidence | Backend owner | Desktop may mutate? | Result |
|---|---|---|---|---|---|---|
| Lead intake identity / ownership | `AgentDto` has identity/configuration only; no lead/intake role | None | Agent snapshot/events only | Backend (not represented) | Intent only if a future contract exists | **GAP** |
| Plan proposal | None | None | None | Not publicly represented | No | **GAP** |
| Plan lifecycle state | None; `TaskDto.status` is task execution status and cannot be overloaded | None | No plan event | Not publicly represented | No | **GAP** |
| Human approval / rejection | None | None | None | Not publicly represented | No | **GAP** |
| Task decomposition | `TaskDto` has no parent/child or decomposition version | Only creates one independent task | No relationship evidence | Backend task manager, not public lifecycle contract | No local child truth | **GAP** |
| Parent/child relationship | None | None | None | Not publicly represented | No | **GAP** |
| Dependency graph / satisfaction | None | None | None | Not publicly represented | No local scheduler | **GAP** |
| Dispatch / assignment ownership | `AssignmentDto` (`assignmentId`, `taskId`, `agentId`, `status`) | No Desktop dispatch/assignment mutation endpoint | Assignment snapshot/events expose current records only | Backend | No local dispatch | **GAP** |
| Specialist execution | `TaskDto`, `ExecuteTaskResultDto` | `POST /api/v1/tasks/:taskId/execute` | Task/assignment event fields | Backend/provider | Explicit execution intent only | **SUPPORTED (execution only)** |
| Review-ready result | `ExecuteReviewReadyDto` with review handle/evidence hash | Returned by execute | Review-ready result, not plan lifecycle | Backend | No local review truth | **SUPPORTED (review preparation)** |
| Review decision | `ReviewDecisionRequestDto` / lifecycle result | `POST /api/v1/reviews/:reviewHandle/decision` | Review result plus normal state/events | Backend | Explicit human decision only | **SUPPORTED (review decision)** |
| Review revision | No distinct plan-revision DTO or mutation; review `REQUEST_REVISION` is scoped to a review handle | Review decision only | No separate plan revision event | Backend (review only) | No conflation | **GAP** |
| Human-requested plan revision | None | None | None | Not publicly represented | No | **GAP** |
| Execution retry | No lifecycle-specific retry contract; only repeatable execute mutation semantics | Execute endpoint only | No retry classification DTO/event | Backend execution | No invented retry state | **GAP** |
| Provider transport retry | None in public DTO/event contract | None | None | Provider/backend internal | No | **GAP** |
| Aggregate status/result | None; state has independent task records only | None | No aggregate event | Not publicly represented | No local aggregate truth | **GAP** |
| Final completion | No authoritative lifecycle completion DTO/event | None | Generic task status is insufficient to prove plan completion | Not publicly represented | No inferred completion | **GAP** |

## Gate decision

The required Human → Lead → Specialist lifecycle cannot be represented by the sealed public Backend contract. In particular, plan approval, decomposition, dependency satisfaction, human plan revision, aggregate ownership, and final completion are absent. Existing task execution and review contracts do not supply those semantics and may not be overloaded.

Therefore the V0.8.10 contract gate is **BLOCKED — BACKEND CONTRACT GAP**. No lifecycle UI, local business state, scheduler, fake approval, or new mutation was implemented. Backend `0.7.2E` was not modified.

