# Munder Authority Inventory — AgentHub Desktop V0.8.9D (PTY Lifecycle & Ownership Closure)

## 1. Provenance & Authority Context

- **Version Role**: V0.8.9C independent code audit P0 authority closure.
- **Sole Objective**: Completely close Primary AgentHub Renderer's generic PTY lifecycle control authority (`spawn`, `resize`, `redraw`, `kill`, `list`), enforce Dedicated Terminal security-domain isolation with sender-bound sessions, and eliminate residual PTY control callsites in Primary Renderer components.
- **Backend Integrity**: Backend 0.7.2E (`G:\Code\AgentHub`) is `SEALED` and `UNCHANGED`.
- **Historical Tags**: `V0.8.9`, `V0.8.9A`, `V0.8.9B`, `V0.8.9C` strictly untouched and sealed.

---

## 2. Core Authority Principles

> [!IMPORTANT]
> **Primary AgentHub Renderer has zero generic PTY lifecycle authority.**  
> 
> Primary AgentHub Renderer can only request:  
> `openDeveloperTerminal(intent)`  
> 
> All PTY process identity and lifecycle ownership remains in Main.  
> 
> Dedicated Terminal Renderer can operate only its own sender-bound session.

---

## 3. Capability Boundary Comparison Matrix

| Capability | V0.8.9C | V0.8.9D | Final Authority |
|---|---|---|---|
| Primary `writePty` | removed | removed | none |
| Primary `spawnPty` | exposed | removed | none |
| Primary `spawnDeveloperTerminal` | exposed | removed | none |
| Primary `resizePty` | exposed | removed | none |
| Primary `redrawPty` | exposed | removed | none |
| Primary `killPty` | exposed | removed | none |
| Primary `listPtys` | exposed | removed | none |
| Primary `openDeveloperTerminal` | exposed | exposed | intent only (`{ ok, error }`) |
| Primary PTY identity knowledge (`ptyId`, `pid`, `command`) | leaked via `listPtys` / return | zero exposure | Main only |
| Dedicated Terminal write | sender-bound | sender-bound | own session |
| Dedicated Terminal resize | sender-bound | sender-bound | own session |
| Dedicated Terminal close | sender-bound | sender-bound | own session |
| Dedicated Terminal renderer `ptyId` parameter | rejected | rejected | sender-bound (`evt.sender.id`) |
| Generic Renderer IPC (`pty:resize`, `pty:redraw`, `pty:kill`, `pty:list`) | exposed | removed | Main only |
| PTY runtime authority | shared legacy surface | Main only | Main |
| AgentHub provider execution | Backend | Backend | Backend (`executeTask` only) |

---

## 4. Security Domain Architecture

```text
┌───────────────────────────────────────────┐
│ Primary AgentHub Renderer                 │
│                                           │
│ Office / Tasks / Agents / Review          │
│ Backend projection / UI                   │
│                                           │
│ NO PTY spawn authority                    │
│ NO PTY write authority                    │
│ NO PTY resize authority                   │
│ NO PTY redraw authority                   │
│ NO PTY kill authority                     │
│ NO PTY enumeration authority              │
│                                           │
│ only: openDeveloperTerminal(intent)       │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│ Main Process                              │
│                                           │
│ create terminal window                    │
│ choose OS default shell                   │
│ generate PTY id (isolated)                │
│ bind WebContents -> PTY session           │
│ own all PTY lifecycle authority           │
│ auto-cleanup session on natural exit/kill │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│ Dedicated Terminal Renderer               │
│                                           │
│ write(data)                               │
│ resize(cols, rows)                        │
│ close()                                   │
│ onData / onExit                           │
│                                           │
│ all strictly scoped to own sender/session │
│ NO cross-session control                  │
│ NO window.agentHub                        │
└───────────────────────────────────────────┘
```

---

## 5. Defense-in-Depth & Cleanup Safeguards

1. **Primary Preload Denylist**:
   - `spawnPty`, `spawnDeveloperTerminal`, `resizePty`, `redrawPty`, `killPty`, `listPtys` completely removed from `src/preload/index.ts`.
   - Only `openDeveloperTerminal` intent is exposed, sanitized to `{ cwd?, cols?, rows? }`.
   - Preload retains `rejectAgentHubPtyExecution(opts)` as fail-closed validation.
2. **Main Generic IPC Excision**:
   - `pty:resize`, `pty:redraw`, `pty:kill`, and `pty:list` IPC channels removed from `src/main/index.ts`.
   - `developer-terminal:write`, `developer-terminal:resize`, `developer-terminal:close` exclusively bound to `evt.sender.id`.
3. **Session Lifecycle Cleanup**:
   - `removeSessionByPtyId` added to `src/main/terminalSession.ts`.
   - `teardownPty` in `src/main/index.ts` automatically invokes `removeSessionByPtyId`, ensuring both explicit window close and natural PTY process exit immediately unmap the session.
4. **Primary Renderer Callsite Purge**:
   - All legacy callsites targeting PTY lifecycle management in `App.tsx`, `useHive.ts`, `AgentDetailPanel.tsx`, `CommandCenterPanel.tsx`, `FullscreenTerminal.tsx`, `OfficeThemePicker.tsx`, `PtyTerminalView.tsx`, and `terminalPool.ts` completely removed or migrated.
