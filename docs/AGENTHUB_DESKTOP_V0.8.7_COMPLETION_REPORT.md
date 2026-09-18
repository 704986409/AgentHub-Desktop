# AgentHub Desktop V0.8.7 Completion Report

## Provenance

```text
Repository: 704986409/AgentHub-Desktop
Desktop baseline: fd7fb9888b308eb60daba54551886ed70e011a08
Sealed V0.8.6A tag: 5107a2e212804edb00b9b741b05911ee4d01d7e1 (unchanged)
Pinned backend: AgentHub 0.7.1
Backend SHA: 6662f89876c511eee0711e370e98cf068db060ac
Backend tag: 0.7.1
Desktop tag: V0.8.7
```

Historical tags were not moved.

## Contract

Desktop is pinned to AgentHub 0.7.1 public contracts.

`AgentDto.modelId` is required. Office projection does not copy or synthesize `model`/`modelId` from legacy Munder state.

Dedicated Main-owned mutations:

```text
createAgent  POST   /api/v1/agents
updateAgent  PUT    /api/v1/agents/:agentId
enableAgent  POST   /api/v1/agents/:agentId/enable
disableAgent POST   /api/v1/agents/:agentId/disable
deleteAgent  DELETE /api/v1/agents/:agentId
```

Main derives Idempotency-Key as `desktop-agent-<operation>:<mutationId>` and owns the 5 second timeout. Renderer cannot choose method, path, headers, or keys.

Mutation certainty:

```text
2xx exact envelope → applied
400/404/409/422 → failed retryable=false
timeout/network/abort/malformed/redirect/overflow → ambiguous retryable=true
reconciliation-required → ambiguous retryable=false
applied + /state failure → applied stateSynchronized=false
```

Authoritative snapshots are committed only by `AgentHubConnection.syncAuthoritativeState()`. Mutation responses never write `snapshot.agents`.

## UI

AgentHub-native management surface:

```text
AgentHubAgentManagementModal
AgentHubAgentForm
```

Empty Office CTA `CREATE AGENT` and Badge `Manage Agents (N)` open that surface. They do not open legacy `AddAgentModal`.

Actionable providers: `claude`, `codex`. Cursor and Antigravity are shown as planned for V0.8.8. Model catalog rows are suggestions only; exact `modelId` is preserved and no spawn command is constructed.

## Verification

```bash
npm run test:agenthub
npm run typecheck
npm run check:links
npm run build
git diff --check
```

Results:

```text
typecheck PASS
check:links PASS (v0.4.6)
build PASS
git diff --check PASS
test:agenthub  40 suites / 229 passed / 0 failed
async tests bounded:
  node:test timeout 5000–8000ms on AgentHub suites
  RestClient timeoutMs 50–3000ms in management tests
  hung-server cases abort via Main-owned timeout
```

Real provider/CLI calls during management verification:

```text
Claude = 0
Codex = 0
Cursor = 0
Antigravity = 0
```

## Git

```text
Commit: feat(desktop): add AgentHub agent management
Tag: V0.8.7
```

## Final Status

```text
PENDING INDEPENDENT AUDIT
```
