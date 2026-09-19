# Munder Authority Inventory — AgentHub Desktop V0.8.9A

V0.8.9A closes the P0 authority blocker discovered during V0.8.9 audit. Renderer-visible PTY capability is structurally separated from legacy provider orchestration. `spawnAgentCore` is Main-internal only and unreachable from Renderer. AgentHub Backend is the sole business and provider execution authority.

| Symbol / Area | Before V0.8.9A | V0.8.9A state | Final authority |
|---|---|---|---|
| PTY Renderer API (`pty:spawn`) | called `spawnAgentCore`, checked purpose tag | developer terminal only (`spawnDeveloperTerminalCore`); no provider/hive/isolate/resume fields | none for AgentHub |
| `spawnAgentCore` | accessible via Renderer `pty:spawn` | Main-only legacy compatibility; inaccessible from Renderer | none for AgentHub |
| AgentHub provider execution | PTY guard relied on purpose marker | Backend only (`window.agentHub.executeTask` -> Backend) | Backend WorkerSession |
| Hive | compatibility shell | compatibility only; no AgentHub agent/task/roster authority | none |
| Michael | presentation/legacy character | presentation only; not Human Boss, not Lead Agent | none |
| GOD / isGod / godMode | presentation/compatibility flag | presentation only; Human Boss is `HumanPresenceActor` | none |
| workerLaunch | compatibility helper | Main-only compatibility; disabled from preload | none for AgentHub |
| wake / workerWake | inbox-nudge of live PTYs | compatibility only; not AgentHub Agent wake | none |
| control | ControlRegistry | compatibility only | none for AgentHub |
| roster | compatibility snapshot | compatibility snapshot only; Backend `/state` owns AgentHub roster | Backend `/api/v1/agents` |
| AgentHub Task lifecycle | local mutation was possible in legacy | no local mutation authority | Backend |
| AgentHub Agent runtime | legacy PTY spawn could trigger CLI | no local spawn authority | Backend |
| Human Presence | explicit `kind: 'human'` actor | UI/presentation only; no agentId/providerId/modelId | none |
| Lead Agent | projection of Backend Agent DTO | projection of Backend Agent DTO (`agentId`, `providerId`, `modelId`, `status`) | Backend |

## Architectural Boundaries

- **Renderer PTY Capability**: Exposes strictly terminal capabilities (`DeveloperTerminalSpawnOptions`: `id`, `cwd`, `command`, `args`, `cols`, `rows`). Zero exposure of `provider`, `hive`, `isolate`, `resume`, `executionIntent`, `agenthubTaskId`.
- **Capability-Level Cutoff**: `ipcMain.handle('pty:spawn')` calls `spawnDeveloperTerminalCore` exclusively. It never invokes `spawnAgentCore`. Marker omission or custom `purpose` strings cannot bypass this boundary.
- **AgentHub Provider Execution**: Sole official route is `window.agentHub.executeTask` -> preload narrow bridge -> Main REST -> Backend `POST /api/v1/tasks/:taskId/execute` -> WorkerSession.
- **Human Boss Separation**: Human Presence remains `presentationId: 'human-boss'` with `kind: 'human'`, explicitly not an Agent, not a Provider, not Michael, not God, not Lead Agent.
