# AgentHub Desktop V0.8.10F Completion Report

Implementation is complete for the V0.8.10F authoritative project bootstrap flow. The release remains **PENDING INDEPENDENT AUDIT**. Tag `V0.8.10E` was not moved.

```text
Production SHA
c4cc7a76031123e460c480e171ccc3929b6dad1b

Docs/Main SHA
this docs-only commit (annotated tag V0.8.10F peels to it)

Annotated Tag Object SHA
recorded in the annotated tag after this commit

Tag Peeled SHA
this docs-only commit

CI Run ID
35705911466
url: https://github.com/704986409/AgentHub-Desktop/actions/runs/35705911466

CI Head SHA
c4cc7a76031123e460c480e171ccc3929b6dad1b

CI conclusion
not awaited
status at lookup: in_progress
event: push

Narrow createProject IPC: YES
Generic fetch IPC added: NO
Renderer direct HTTP added: NO
Project local authority added: NO

Main idempotency owner: YES
Ambiguous retry uses same mutationId: YES
POST success + sync failure classified applied: YES

Task zero-project recoverable UI: YES
Task submit disabled without Project: YES
Task draft preserved while Project modal opens: YES

Lifecycle zero-project guard: YES
Lifecycle zero-agent guard: YES
Lifecycle blank-goal guard: YES

registeredRepos mapped to Project: NO
production fake Provider added: NO
Desktop lifecycle authority changed: NO

D-T1..D-T12 PASS
existing submission/lifecycle regressions PASS
full Desktop CI: not awaited
```

---

## 1. Production change

Main owns `POST /api/v1/projects`. The renderer calls the narrow `agenthub:createProject` IPC with `mutationId` and `{ name, description }`. Main derives `Idempotency-Key` as `desktop-project-create:<mutationId>`. An empty description is sent as `null`. The created project is not appended in the renderer; the next authoritative `/state` snapshot is the project truth.

Task and Lifecycle stay mounted when the project modal opens. Submit and Create Intake stay disabled until an authoritative project, and for Lifecycle also an authoritative lead agent and a nonblank goal, are present.

## 2. Local verification

```text
test/agenthub-project-bootstrap-v0810f.test.ts                         PASS (D-T1..D-T12)
agent management, lifecycle, submission, rest client, ipc, preload     PASS (96)
npm run typecheck                                                       PASS
npm run build                                                           PASS
npm run lint                                                            no lint script
GUI E2E-B1..B10                                                         not run; spec places it after independent seal
```

## 3. Final

```text
PENDING INDEPENDENT AUDIT
```
