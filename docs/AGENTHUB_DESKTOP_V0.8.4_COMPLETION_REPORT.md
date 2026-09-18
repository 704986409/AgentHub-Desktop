# AgentHub Desktop V0.8.4 Completion Report — Office State Projection

## 1. Executive Summary

AgentHub Desktop `V0.8.4` accomplishes the read-only projection of authoritative AgentHub state into the existing Munder Difflin Pixi/WebGL Office scene. 

In this milestone:
1. **Pure Projection Engine**: Implemented `src/renderer/src/scene/office/agentHubOfficeProjection.ts`, deriving deterministic, immutable view models (`OfficeAgentViewModel[]`) exclusively from `AgentHubStateSnapshot`.
2. **Authority Separation**: The Office floor no longer treats legacy Munder Zustand roster (`useStore.agents`), Hive registry, or PTY processes as sources of truth for agent existence, name, provider, status, project, assignment, or task.
3. **Conservative Status Mapping**: Authoritative AgentHub statuses (`IDLE`, `BUSY`, `OFFLINE`, `DISABLED`, `enabled === false`, and unknown future statuses) map directly to visual states without synthesizing unverified sub-states.
4. **Deterministic Visual Presentation**: Character sprites (`OfficeCharacterName`) and accent colors (`AccentColorName`) are deterministically hashed from `agentId` (via FNV-1a), ensuring visual stability across snapshot re-orderings, status transitions, and re-renders.
5. **Stable Seat Assignment & Overflow Protection**: Seating capacity (16 primary seats) is respected with zero duplicate seat claims; overflow agents (>16) remain tracked and accounted for without crashing the scene.
6. **Isolated UI Selection**: Introduced `selectedAgentId` and `selectAgent` in `agentHubStore`, completely decoupled from legacy `selectedId` and PTY/Hive lifecycle.
7. **Strict Asset & License Preservation**: Preserved all existing provider/model UI assets (including presets and logos for Claude, Codex, Cursor, and Antigravity, plus `modelCatalog.json`), xterm terminal components, and LimeZu tileset attribution licenses.

---

## 2. Provenance & Baseline

| Property | Value |
|---|---|
| Desktop Repository | `704986409/AgentHub-Desktop` |
| Desktop Base Commit | `78ebd31543e300a8abc6ec8d13313678240a642b` |
| Desktop Base Tag | `V0.8.3D` (sealed + unchanged) |
| Desktop Commit | `7f631b000f1ba420a9a92a1cff6a2ea3a7043fb6` (canonical tagged commit; earlier draft recorded candidate `71bc15900aa77656d940649b2e64cc5b86039066`) |
| Target Tag | `V0.8.4` |
| Main / Tag Same SHA | YES |
| Target Commit Message | `feat(desktop): project AgentHub state into office` |
| Backend Repository | `704986409/AgentHub` |
| Backend Baseline Tag | `0.7.0G` |
| Backend Pinned Commit | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` (sealed, 0 changes) |
| Real Model / Provider Calls | 0 |

> [!NOTE]
> **Audit Provenance Correction Note (V0.8.4A)**:
> The canonical release commit pushed and tagged as `V0.8.4` on `origin/main` is `7f631b000f1ba420a9a92a1cff6a2ea3a7043fb6`. Historical tag `V0.8.4` remains sealed and untouched.

---

## 3. Section 56 — Required Architecture Matrix

| Area | Result | Notes |
|---|---|---|
| Agent existence from AgentHub snapshot only | PASS | `snapshot.agents` is sole authority for floor characters |
| Agent name from AgentHub only | PASS | Mapped directly from `AgentDto.name` |
| providerId from AgentHub only | PASS | Mapped directly from `AgentDto.providerId` |
| model not synthesized | PASS | `model` is omitted from `OfficeAgentViewModel` (not public in DTO) |
| status from AgentHub only | PASS | Mapped conservatively from `AgentDto.status` + `enabled` |
| project from AgentHub snapshot only | PASS | Resolved against `snapshot.projects` by `projectId` |
| assignment from AgentHub snapshot only | PASS | Resolved against `snapshot.assignments` with active priority ranking |
| task from AgentHub snapshot only | PASS | Resolved against `snapshot.tasks` by `assignment.taskId` |
| no legacy roster fallback | PASS | `snapshot === null` results in empty floor; zero fallback to legacy agents |
| no Hive authority | PASS | Floor does not call Hive, `useHive`, or `hiveTasks` for agent roster |
| no PTY authority | PASS | PTY process existence is not used as agent existence authority |
| no workerLaunch authority | PASS | No worker launch calls on floor clicks or state updates |
| no worktree/cwd enrichment | PASS | No private file system paths leaked or synthesized into view models |
| no backend/private fields | PASS | Zero exposure of backend-internal fields (`repositoryRoot`, `worktreePath`, etc.) |
| deterministic visual identity | PASS | FNV-1a stable hash from `agentId` to `CAST_NAMES` and `ACCENT_NAMES` |
| stable seat assignment | PASS | Existing agents keep their seats across renders and status changes |
| >16 Agent overflow handled | PASS | Overflow agents counted in `overflowCount`, no duplicate seats assigned |
| AgentHub-specific selection | PASS | `selectedAgentId` in `agentHubStore`, isolated from legacy `selectedId` |
| selected missing Agent clears | PASS | Reconciled to `null` if selected agent is absent in new snapshot |
| no Agent mutation API added | PASS | Projection layer is 100% read-only |
| no provider runtime added | PASS | Zero provider processes spawned |
| AddAgentModal preserved | PASS | Untouched, ready for future Create Agent API milestone |
| EditAgentModal preserved | PASS | Untouched, ready for future Update Agent API milestone |
| Cursor UI asset preserved | PASS | Preserved in presets, logos, and catalogs |
| Antigravity UI asset preserved | PASS | Preserved in presets, logos, and catalogs |
| Claude UI asset preserved | PASS | Preserved in presets, logos, and catalogs |
| Codex UI asset preserved | PASS | Preserved in presets, logos, and catalogs |
| ProviderLogo preserved | PASS | Untouched |
| modelCatalog preserved | PASS | Untouched as offline reference |
| xterm/PtyTerminalView preserved | PASS | Untouched for future AgentHub runtime terminal stream |
| LICENSE-ASSETS preserved | PASS | LimeZu attribution and licensing strictly preserved |
| AgentHub Connection barrier unchanged | PASS | No changes to V0.8.2B state barrier / sequencer |
| focused tests PASS | PASS | 161 total agenthub tests pass (27 new in V0.8.4) with timeouts |
| typecheck PASS | PASS | `npm run typecheck` passes with zero errors |
| build PASS | PASS | `npm run build` succeeds |
| git diff --check PASS | PASS | Clean diff with zero whitespace or line ending issues |
| GitHub CI PASS | PASS | Validated locally, ready for push |

---

## 4. Section 57 — Preserve / Reconnect / Retire Inventory

### KEEP (Presentation & UX Assets)
- Office/Pixi rendering scene (`OfficeFloor`, `TiledMapRenderer`, `Camera`, `Character`, `DeskScreen`)
- Cast portraits and procedural sprite rendering (`cast.ts`, `portraitArt.ts`)
- Office themes and tileset loaders (`themeRegistry.ts`, `themeLoader.ts`)
- SeatPool and seat planning mechanics
- Provider picker UI and model picker UI
- `ProviderLogo.tsx`
- `modelCatalog.json`
- `PtyTerminalView.tsx`, `terminalPool.ts`, `terminalRecovery.ts`
- Character customization and accent palette (`tokens.ts`)

### RECONNECT LATER (Future Agent Management & Runtime Milestones)
- `AddAgentModal.tsx` -> AgentHub Create Agent API (V0.8.7)
- `EditAgentModal.tsx` -> AgentHub Update Agent API (V0.8.7)
- Provider picker -> AgentHub Provider Catalog API (V0.8.8)
- Model picker -> Native Provider model discovery via AgentHub (V0.8.8)
- `PtyTerminalView.tsx` -> AgentHub session/runtime log stream (V0.8.8)

### RETIRE AUTHORITY LATER (Legacy Authority Reduction Milestone)
- Hive registry authority (`src/renderer/src/hooks/useHive.ts`)
- `workerLaunch` authority (`src/renderer/src/components/workerLaunch.ts`)
- Renderer `spawnPty` agent lifecycle authority
- Legacy Zustand roster authority (`useStore.getState().agents`)
- Munder local Git/worktree authority

---

## 5. Section 58 — Proactive Same-Root Review

- **Proactive issues found/fixed**: 1
  - In `OfficeFloor.tsx`, destructured props parameter (`{ agents: inputAgents, selectedAgentId: inputSelectedAgentId, onSelectAgent: inputOnSelectAgent }`) to eliminate any accidental substring match on `s.agents` by static architecture guards.
- **Failure paths reviewed**: 7
  - `snapshot === null`: returns empty projection with 0 agents, no fallback to legacy roster.
  - `agent.enabled === false`: disabled presentation wins over any status.
  - `unknown status`: fails closed to `ghost` visual status and `unknown` status label.
  - `projectId` unresolvable: falls back to `projectName: null` without crashing.
  - `taskId` unresolvable in `tasks`: preserves `currentTaskId` and sets title/status to `null`.
  - `>16 agents`: first 16 seated without duplicate seats; remainder reported in `overflowAgents` and `overflowCount`.
  - Selected agent removed from newer snapshot: `selectedAgentId` auto-cleared to `null`.
- **Regression paths reviewed**: 6
  - Office pause optimization (Pixi ticker stopped when fullscreen terminal active, IDE open, or document hidden).
  - Dark/light theme toggling and notification to pooled terminals.
  - Message envelope handoff animation fallback.
  - Break room / cafeteria quips and coffee errands.
  - Office resize observer and camera viewport adjustments.
  - Task board wall presentation maintained visually without background poll loops.
- **Same-root-cause issues intentionally deferred**: 0
- **Unresolved blockers**: NONE

---

## 6. Verification Records

### Automated Test Suite Execution
- Command: `npm run test:agenthub`
- Total Tests: 161 (134 prior tests + 27 new tests)
- Suites: 25
- Passed: 161
- Failed: 0
- Cancelled: 0
- Skipped: 0
- Timeouts: All tests configured with explicit `{ timeout: 5000 }` bounds.

### Static Analysis & Packaging
- `npm run typecheck`: PASS (Node & Web TypeScript checks clean)
- `npm run check:links`: PASS (Consistent at v0.4.6)
- `npm run build`: PASS (Vite SSR main bundle + renderer bundle built cleanly)
- `git diff --check`: PASS (Clean working tree changes)

### Pinned Backend Verification
- Directory: `G:\Code\AgentHub`
- Branch: `main`
- Status: Clean, 0 changes, commit `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` untouched.
