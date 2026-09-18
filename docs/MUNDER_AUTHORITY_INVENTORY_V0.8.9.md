# Munder Authority Inventory — AgentHub Desktop V0.8.9

V0.8.9 reduces leftover Munder authority so AgentHub Backend is the only business truth. Desktop Main is a narrow bridge. Renderer / Pixi Office are projection.

| Symbol / Area | Before | V0.8.9 | Final authority |
|---|---|---|---|
| Hive | legacy orchestration + registry/tasks/inbox | compatibility shell for Munder UI only; AgentHub agents/tasks come from Backend `/state` | none |
| Michael | manager / voice orchestrator persona | presentation / legacy character; not Human Boss, not Lead Agent | none |
| GOD / isGod / godMode | special orchestration authority | presentation/compatibility flag only; Human Boss is `HumanPresenceActor` | Human UI only |
| PTY provider execution | node-pty spawn of Claude/Codex/Cursor/Antigravity as AgentHub execution | rejected when `purpose=agenthub-execution` or AgentHub execution intent is set | Backend WorkerSession |
| workerLaunch | runtime argv builder for god-hired workers | compatibility helper; not AgentHub execute path | Backend |
| wake / workerWake | inbox-nudge of live PTYs | Munder compatibility; not AgentHub Agent wake | Backend |
| control | ControlRegistry | Munder compatibility | none for AgentHub |
| hire / hire manifests | local spawn/import | compatibility import into Munder Add Agent UI; AgentHub create is `agentHub.createAgent` | Backend for AgentHub |
| roster | local floor-card persistence | compatibility snapshot; not AgentHub roster truth | Backend `/api/v1/agents` |
| old task store (`hive/tasks.json`) | local lifecycle | compatibility kanban; AgentHub TaskStatus is Backend-only | Backend |
| worktree / git IPC | Munder git/worktree controls | developer/compat IDE; AgentHub git lifecycle is Backend | Backend |
| Renderer store | mixed | cache/projection + local UI selection | Backend for business fields |
| Human Presence | implied via GOD/Michael | explicit `kind: 'human'` actor, no agentId/providerId/modelId | none |
| Lead Agent | often confused with GOD | must be Agent DTO (`agentId`, `providerId`, `modelId`, `status`) | Backend |

## Search notes

- `Hive` / `hive:*` IPC remain as COMPATIBILITY ONLY. They must not create AgentHub Agents, mutate AgentHub TaskStatus, or approve Review.
- `Michael` sprite/name remain PRESENTATION ONLY.
- `isGod` remains on Munder hive meta as a visual/orchestrator flag. It does not mean Human Boss.
- `spawnPty` remains for developer terminal and legacy Munder sessions. AgentHub provider execution is `window.agentHub.executeTask` only.
- Generic `exec` / `spawn` / `fetch` IPC channels are not exposed on preload.
