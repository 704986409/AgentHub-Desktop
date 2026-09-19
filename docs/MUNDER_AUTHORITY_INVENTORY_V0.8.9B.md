# Munder Authority Inventory — AgentHub Desktop V0.8.9B

## 1. Executive Authority Status

In AgentHub Desktop V0.8.9B, the capability to select or launch an arbitrary executable process is completely removed from the Renderer layer.

**Core Rule**:
> **Renderer can request "open developer terminal", but Renderer can NEVER choose the executable or arguments.**
> **Renderer can no longer select process executable.**

The official AgentHub provider execution route remains strictly:
`window.agentHub.executeTask` → Preload Bridge → Desktop Main → AgentHub Backend (0.7.2E) → `AgentProvider` / `WorkerSession`.

---

## 2. Symbol & Subsystem Authority Matrix

| Symbol / Area | V0.8.9A Status | V0.8.9B Status | Final Authority |
|---|---|---|---|
| `DeveloperTerminalSpawnOptions` | Contained `command?: string`, `args?: string[]` | Strictly `{ id, cwd, cols?, rows? }` (zero executable fields) | None (Developer terminal only) |
| `spawnDeveloperTerminal` | Renderer could specify arbitrary executable/CLI | Renderer can request default shell only | None for AgentHub |
| `spawnPty` alias | Narrowed in V0.8.9A but still accepted command/args | Narrow deprecated alias to `DeveloperTerminalSpawnOptions` | None |
| `spawnDeveloperTerminalCore` | Executed Renderer-supplied executable if provided | Main-selected default OS shell only (`ComSpec` / `SHELL`) | None |
| `AddAgentModal.tsx` | Spawned provider CLI via `spawnPty` / `tokenizeCommand` | Disabled / fail-closed with user warning banner; no PTY spawn | None (Managed via Backend Agent Management) |
| `CommandCenterPanel.tsx` | Model switch spawned provider CLI via PTY | Updates agent state in store directly; no PTY spawn | None |
| `useHive.ts` (God/Michael) | Spawned provider CLI via PTY | Presentation-only agent in store; no PTY spawn | None |
| `useHive.ts` (autoRevive) | Respawned dead agent via PTY | Restores store status directly; no PTY spawn | None |
| `useRestoreTeam.ts` | Spawned each restorable agent CLI via PTY | Restores agent cards to store as idle; no PTY spawn | None |
| `spawnAgentCore` | Main-only internal helper | Main-only legacy internal helper (zero IPC exposure) | None (Legacy internal compat only) |
| AgentHub provider execution | Backend official, but terminal executable bypass existed | Backend only (`window.agentHub.executeTask`) | Backend `WorkerSession` |
| AgentHub Agent runtime | Local CLI spawn path remained via terminal | No local programmatic provider spawn | Backend |
| Human Presence | Non-agent (`kind: 'human'`) | Non-agent (`kind: 'human'`) | Human Boss (Decider) |
| Lead Agent | Backend Agent DTO projection | Backend Agent DTO projection | Backend Agent DTO |
| Office Projection | Visual projection only | Visual projection only | None |

---

## 3. Defense-in-Depth & Fail-Closed Guard

1. **Type-Level Exclusion**:
   `DeveloperTerminalSpawnOptions` does not define `command` or `args`. Any TypeScript caller attempting to supply them fails compilation.
2. **Main Shell Pinning**:
   `spawnDeveloperTerminalCore` unconditionally fixes the executable:
   - Windows: `process.env.ComSpec || 'powershell.exe'`
   - Unix: `process.env.SHELL || '/bin/bash'`
   - Args: `[]`
3. **IPC Sanitization**:
   Even if a raw IPC payload contains injected `command` or `args` properties, `ipcMain.handle('pty:spawn')` extracts only `id`, `cwd`, `cols`, and `rows`, completely discarding any executable parameters.
4. **No Command Blacklist**:
   Security is achieved structurally through capability elimination, rather than fragile string-matching blacklists against provider binary names.
