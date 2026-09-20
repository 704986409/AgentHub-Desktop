# AgentHub Desktop V0.8.10 Lifecycle Contract

Permanent Desktop rules for this release:

- Backend owns lifecycle truth
- Human owns approval/start decisions
- Lead is a Backend Agent
- Michael is presentation-only
- Desktop never schedules dependencies
- Desktop never materializes PlanTasks
- Desktop never dispatches Specialists
- Desktop never infers final completion
- Mutation response is not final truth
- Realtime is invalidation only
- `/state` resync is authoritative
- No autonomous planner claim exists in V0.8.10

## Compatibility

Lifecycle UI and lifecycle mutations require health version exactly `0.7.3D`.
Unknown or older versions are `Lifecycle unavailable / Backend upgrade required`, not an empty plan list.

## Authority split

- Human Boss (`human-boss`) is the only Desktop decision actor for Intake/Plan approval, request-changes, reject, and start.
- Lead Agent identity is `AgentDto.agentId` chosen from the authoritative snapshot.
- PresentationActor / Michael remains office visualization only.

## State and mutations

- Strict `AgentHubStateSnapshot` requires `intakes`, `plans`, `planTasks`, and `planDependencies`.
- Main owns HTTP, `Idempotency-Key`, and allowlisted routes.
- Renderer uses narrow `agenthub:lifecycle:*` IPC only.
- After every lifecycle mutation Desktop resyncs `GET /api/v1/state`.
- Ambiguous outcomes show `正在确认后端状态…` and resync; they do not invent success.
- Review of materialized tasks reuses the existing Review Evidence / review-decision transport.
