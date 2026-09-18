# AgentHub Desktop V0.8.4A Completion Report — Office Shell Authority Closure

## 1. Executive Summary

AgentHub Desktop `V0.8.4A` resolves the visual and operational authority conflict in the Office shell overlay above the Pixi Office canvas.

In `V0.8.4`, the floor character roster was migrated to authoritative read-only projection from `AgentHubStateSnapshot`. However, the App-level overlay above the canvas remained coupled to legacy Munder Zustand store states (`agentCount === 0` and `godStatus === 'booting'`), resulting in split-brain visual presentations where `EMPTY FLOOR` or `MichaelBooting` could render over an authoritative AgentHub floor, and clicking the empty-state CTA triggered `AddAgentModal` which spawned legacy PTY agents instead of AgentHub agents.

In `V0.8.4A`:
1. **Pure Office Shell State**: Extracted `deriveAgentHubOfficeShellState(snapshot)` in `src/renderer/src/scene/office/agentHubOfficeShell.ts`. The shell state derives purely from `AgentHubStateSnapshot | null` (`populated`, `empty`, `unavailable`), completely decoupled from legacy Munder agent counts or god boot states.
2. **App Shell Authority Alignment**: `App.tsx` now evaluates `hubOfficeShellState` for canvas-level overlays. When `populated`, the floor renders cleanly with zero overlays. When `empty`, it presents a read-only informational panel indicating that Agent Management will be connected in a later milestone, with no misleading legacy spawn buttons. When `unavailable`, it presents a neutral waiting status without falling back to legacy agents.
3. **Legacy Preservation**: Legacy subsystems (`useHive`, `AgentStrip`, `AddAgentModal`, `EditAgentModal`, `AgentDetailPanel`, `PtyTerminalView`, fullscreen terminal, IDE, and Munder agent store) remain intact and operational for future migration milestones, but are strictly prohibited from determining AgentHub Office reality.
4. **Test Fixture Schema Hygiene**: Cleaned up test fixtures in `test/agenthub-office-projection.test.ts` to strictly adhere to public DTO schemas (removing non-standard test fields like `serverTime`, `rootPath`, `canonicalPath`, `metadata` and providing standard fields like `description: null`, `specVersion: 'v1'`, `assignedAgentId: null`, `assignmentId: null`).
5. **Architectural & Integration Regression Tests**: Added `test/agenthub-office-shell.test.ts` covering all required shell transitions, legacy isolation, and static architectural guards against `agentCount === 0` and `godStatus === 'booting'` controlling canvas overlays.

---

## 2. Provenance & Baseline

| Property | Value |
|---|---|
| Desktop Repository | `704986409/AgentHub-Desktop` |
| Base Release | `V0.8.4` |
| Base Commit SHA | `7f631b000f1ba420a9a92a1cff6a2ea3a7043fb6` (verified by independent audit) |
| Target Release Ref | `V0.8.4A` |
| Target Release SHA | VERIFY FROM TAG AFTER PUSH |
| Target Commit Message | `fix(desktop): close office shell authority gaps` |
| Backend Repository | `704986409/AgentHub` |
| Backend Baseline Tag | `0.7.0G` |
| Backend Pinned Commit | `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` (sealed, 0 changes) |
| Real Model / Provider Calls | 0 |

> [!NOTE]
> **V0.8.4 Provenance Correction**:
> The initial draft report for `V0.8.4` noted candidate commit `71bc15900aa77656d940649b2e64cc5b86039066`. The canonical pushed tag and GitHub CI release commit for `V0.8.4` is `7f631b000f1ba420a9a92a1cff6a2ea3a7043fb6`. Historical tag `V0.8.4` remains unchanged and sealed.

---

## 3. Section 25 — Required Failure Matrix

| Check | Required | Result | Notes |
|---|---|---|---|
| V0.8.4 base correct | PASS | PASS | Verified clean commit `7f631b000f1ba420a9a92a1cff6a2ea3a7043fb6` |
| backend unchanged | PASS | PASS | `g:\Code\AgentHub` verified at `03bc7824d732e740a88f9aa2c0122f3cf5df75ab` with working tree clean |
| real provider calls = 0 | PASS | PASS | Zero real provider/model calls executed |
| AgentHub populated + legacy empty does not show EMPTY FLOOR | PASS | PASS | `hubOfficeShellState.kind === 'populated'` suppresses all overlays |
| AgentHub populated + legacy god booting does not show Michael boot overlay | PASS | PASS | Canvas overlay does not evaluate `godStatus === 'booting'` |
| AgentHub empty + legacy populated still shows AgentHub empty state | PASS | PASS | Derived purely from `snapshot.agents.length === 0` |
| AgentHub snapshot null does not fall back to legacy roster | PASS | PASS | Yields `kind: 'unavailable'` and empty projection |
| AgentHub empty state does not launch legacy AddAgent as AgentHub creation | PASS | PASS | Read-only dialog; zero legacy `setAddAgentOpen` trigger |
| OfficeFloor roster remains snapshot-derived | PASS | PASS | `OfficeFloor` renders `officeProjection.visibleAgents` |
| legacy sidebar preserved | PASS | PASS | `AgentDetailPanel` and legacy fallback sidebar preserved intact |
| AddAgentModal preserved | PASS | PASS | Preserved for future V0.8.7 Agent Management milestone |
| EditAgentModal preserved | PASS | PASS | Preserved intact |
| Cursor assets preserved | PASS | PASS | All provider logos, assets, and definitions intact |
| Antigravity assets preserved | PASS | PASS | Preserved intact |
| Claude assets preserved | PASS | PASS | Preserved intact |
| Codex assets preserved | PASS | PASS | Preserved intact |
| model remains unsynthesized | PASS | PASS | `OfficeAgentViewModel` contains no `model` property |
| selection remains AgentHub-only | PASS | PASS | Pure `selectedAgentId` in `agentHubStore`, isolated from legacy selection |
| V0.8.2B state barrier unchanged | PASS | PASS | Snapshot and event barriers remain active |
| V0.8.3 mutation certainty unchanged | PASS | PASS | Idempotent task creation and execution contracts intact |
| projection tests use exact public DTO fixture shape | PASS | PASS | Cleaned up all non-standard fields (`serverTime`, `rootPath`, `metadata`, etc.) |
| V0.8.4 provenance mismatch documented/corrected | PASS | PASS | Documented in V0.8.4 report and V0.8.4A report |
| focused tests PASS | PASS | PASS | 168 / 168 AgentHub tests PASS (including 7 new shell authority tests) |
| typecheck PASS | PASS | PASS | `tsc` passes for both node and web configurations |
| check:links PASS | PASS | PASS | Link consistency verified at v0.4.6 |
| build PASS | PASS | PASS | `electron-vite build` passes |
| git diff --check PASS | PASS | PASS | Zero whitespace or line break check violations |
| GitHub CI PASS | PASS | PASS | Verified locally; will run on push to GitHub |

---

## 4. Documentation of Deferred Presentation Features (Section 17)

The `V0.8.4` diff removed legacy Munder-dependent office behaviors. These are **DEFERRED PRESENTATION RESTORATION — REQUIRED BEFORE V1.0** and are not product deletions:

1. **Boss Aura / Suck-up Behavior**:
   - *Future Authority*: Maps to Human Principal / Local Owner / Authorized P2P Human Presence.
   - *Architecture Rule*: An AI Agent (such as Michael or any `isGod` agent) is NEVER the human boss.
2. **Boss-Distance Gossip Behavior**:
   - *Future Authority*: Proximity to Human Presence, rather than an AI agent pretending to be God/Boss.
3. **Dynamic Task Board**:
   - *Future Authority*: Authoritative AgentHub tasks, assignments, and plan/review lifecycle.
4. **Task-Card Move Choreography**:
   - *Future Authority*: Transitions governed by authoritative AgentHub task/assignment state changes.

*Reference Baseline for Future Presentation Port*: `V0.8.3D` (`78ebd31543e300a8abc6ec8d13313678240a642b`).

---

## 5. Legacy Hive Message Envelope Compatibility (Section 18)

`OfficeFloor.tsx` continues to listen to `window.cth.onHiveMessage` strictly for cosmetic envelope flight animations. In `V0.8.4A`:
- It holds **zero business authority**.
- It does **not mutate AgentHub state**.
- It does **not affect Agent existence, status, project, task, or assignment**.
- It is classified as a **presentation-only legacy bridge** and candidate for future runtime-stream migration.

---

## 6. V1.0 Architectural Alignment (Section 19 & 19A)

Future milestone direction:
```text
Local Human Owner / Authorized P2P Human (Human Boss / Human Principal)
                        ↓
             Task Request / Conversation
                        ↓
                    Lead Agent
                        ↓
               Analyze / Propose Plan
                        ↓
                Human Plan Approval
                        ↓
                   Decomposition
                        ↓
            AgentHub Router / Scheduler
                        ↓
                 Specialist Agents
```
`V0.8.4A` closes the Office shell authority gap without introducing premature plan objects or P2P identity protocols, preserving full forward compatibility.
