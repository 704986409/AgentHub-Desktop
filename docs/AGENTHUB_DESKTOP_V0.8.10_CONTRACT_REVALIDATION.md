# AgentHub Desktop V0.8.10 Contract Revalidation

Desktop base:
`7fd726c6102c55447ed15b4444f2568b18b6f89d` (`main`)

Backend 0.7.3D Production SHA:
`3422f732df18ee0df291421d712105d0a57e9b95`

Backend 0.7.3D tag object:
`d5d7aba2d9030dd4e1de66666a4946485d40681a` (annotated tag `0.7.3D`)

Backend 0.7.3D tag peeled:
`3422f732df18ee0df291421d712105d0a57e9b95`

Previous V0.8.10 gap status:
`BLOCKED — BACKEND CONTRACT GAP` against sealed Backend `0.7.2E`

## Public endpoints inspected

- `GET /api/v1/health` — version string `0.7.3D`
- `GET /api/v1/state` — `projects`, `agents`, `tasks`, `assignments`, `intakes`, `plans`, `planTasks`, `planDependencies`
- `GET /api/v1/intakes`, `GET /api/v1/plans`, `GET /api/v1/plans/:id`
- `POST /api/v1/intakes`
- `POST /api/v1/plans`
- `POST /api/v1/plans/:id/revisions`
- `POST /api/v1/plans/:id/approve`
- `POST /api/v1/plans/:id/request-changes`
- `POST /api/v1/plans/:id/reject`
- `POST /api/v1/plans/:id/start`
- Existing task execute / review decision / Agent management endpoints remain unchanged

## Public DTOs inspected

- `IntakeDto`, `CreateIntakeInput`
- `PlanDto`, `PlanVersionDto`, `PlanTaskDefinition`, `PlanTaskRuntimeDto`
- `PlanDependencyDto`, `PlanAggregateDto`, `PlanApprovalDecisionDto`
- `CreatePlanInput`, `CreatePlanRevisionInput`, `PlanDecisionInput`, `PlanStartInput`
- Plan states: `WAITING_APPROVAL | APPROVED | CHANGES_REQUESTED | REJECTED | EXECUTING | REVIEWING | COMPLETED | FAILED`
- Lead-delete conflict: `AGENT_DELETE_LIFECYCLE_REFERENCE_CONFLICT` → HTTP 409

## Required lifecycle matrix

| Capability | Public DTO | Public mutation | Backend owner | Desktop role |
|---|---|---|---|---|
| Intake / Lead identity | `IntakeDto.leadAgentId` from Agent DTO | `POST /intakes` | Backend | Human submits intent |
| Plan proposal | `PlanDto` / `PlanVersionDto.proposalHash` | `POST /plans` | Backend | Human composes structured proposal |
| Human approval | `PlanApprovalDecisionDto` | approve / request-changes / reject | Backend | Human decision bound to version+hash |
| Revision | new `PlanVersionDto` | `POST /plans/:id/revisions` | Backend | Human composes replacement version |
| Start | `PlanStartInput` | `POST /plans/:id/start` | Backend | Human start intent only |
| Eligibility | `PlanTaskRuntimeDto.dependencyState` | none | Backend | Display only |
| Aggregate / completion | `PlanAggregateDto`, `PlanDto.state` | none | Backend | Display only |
| Review | existing review handle/decision | existing review IPC | Backend | Reuse Review Evidence |

## Gate result

Backend `0.7.3D` now publishes the lifecycle contract previously missing from `0.7.2E`. Desktop V0.8.10 can consume that contract without inventing local planner/scheduler/materialization truth.

V0.8.10 CONTRACT REVALIDATION: PASS
