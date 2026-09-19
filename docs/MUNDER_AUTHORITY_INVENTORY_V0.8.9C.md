# Munder Authority Inventory — V0.8.9C (Trusted Terminal Input Boundary Closure)

## 1. Provenance & Authority Context

- **Version Role**: V0.8.9B independent audit P0 capability closure.
- **Sole Objective**: Completely sever the programmatic execution path from **Primary AgentHub Renderer → PTY input/write → shell → provider CLI**, isolate the Developer Terminal into a dedicated WebContents security domain with a narrow preload, enforce sender-bound PTY sessions in Main, and correct the V0.8.9B completion report provenance SHA typo.
- **Backend Integrity**: Backend 0.7.2E (`G:\Code\AgentHub`) is `SEALED` and `UNCHANGED`.
- **Historical Tags**: `V0.8.9`, `V0.8.9A`, `V0.8.9B` strictly untouched.

---

## 2. V0.8.9B Independent Audit Provenance Correction

The previous V0.8.9B completion report (`docs/AGENTHUB_DESKTOP_V0.8.9B_COMPLETION_REPORT.md`) recorded a typographical error in the production commit SHA:
- **Incorrect SHA previously recorded**: `c4a85f6d5312384f7b6059d6153ea3e414c5b3ca`
- **Authoritative V0.8.9B Production / CI Head**: `c4a85f6dcaa58639099180de704c7789347efd27`
- **GitHub Actions Run ID**: `35411362604` (`completed` / `success`)

Historical tag `V0.8.9B` was not moved or rewritten; the provenance typo is formally corrected on `main` within V0.8.9C documentation and inventory records.

---

## 3. Capability Boundary Comparison

| Area | V0.8.9B | V0.8.9C | Authority |
|---|---|---|---|
| Primary Renderer `writePty` | exposed | removed | none |
| Primary Renderer terminal input | arbitrary text possible | open-window intent only | none |
| Dedicated Terminal Renderer | same domain as app | isolated WebContents + preload | own local shell only |
| terminal write IPC | `id + data` | sender-bound `data` only | own session |
| terminal resize/kill | arbitrary id | sender-bound own session | own session |
| Main PTY owner mapping | absent/general | explicit WebContents→PTY binding | Main |
| AgentHub provider execution | Backend official, terminal bypass remained | Backend only from Primary AgentHub Renderer | Backend |
| Developer Terminal | local shell | local shell in isolated domain | human/local shell |

> [!IMPORTANT]
> **Primary AgentHub Renderer no longer possesses PTY stdin authority.**  
> The `writePty` API has been completely excised from `src/preload/index.ts`. All interactive shell input occurs strictly inside dedicated Developer Terminal windows via the narrow `window.developerTerminal` preload.

---

## 4. Security Domain Architecture

```text
┌──────────────────────────────────────┐
│ Primary AgentHub Renderer            │
│                                      │
│ Office / Tasks / Agents / Review     │
│ Backend projection / UI              │
│                                      │
│ NO PTY write authority               │
│ NO arbitrary terminal input IPC      │
└───────────────┬──────────────────────┘
                │
                │ openDeveloperTerminal intent only
                ▼
┌──────────────────────────────────────┐
│ Main Process                         │
│                                      │
│ creates dedicated Terminal Window    │
│ selects default shell (OS-enforced)  │
│ owns PTY id                          │
│ binds PTY ↔ Terminal WebContents     │
└───────────────┬──────────────────────┘
                │
                ▼
┌──────────────────────────────────────┐
│ Dedicated Terminal Renderer          │
│                                      │
│ local terminal UI only               │
│ isolated narrow preload              │
│ terminal write/resize only           │
│ NO window.agentHub                   │
│ NO Agent Management                  │
│ NO Tasks / Review / Office authority │
└──────────────────────────────────────┘
```

---

## 5. Main-Process PTY Write Audit & Classification

All `ptyManager.write` invocation sites across the codebase have been classified in accordance with Section 14:

1. **Dedicated Terminal Input (`src/main/index.ts`, via `src/main/terminalSession.ts`)**:
   - `handleDeveloperTerminalWrite(senderId, data, writer)`
   - **Classification**: **A. Dedicated Terminal input**
   - Strictly bound to `evt.sender.id`; does not accept `ptyId` from Renderer.
2. **Watchdog Inbox Nudge (`src/main/index.ts:nudgeWorker`)**:
   - `ptyManager.write(ptyId, inboxNudgeText(ids))` and `ptyManager.write(ptyId, '\r')`
   - **Classification**: **B. Main-only legacy compatibility**
   - Uses fixed, hard-coded watchdog system text; Primary Renderer cannot supply arbitrary text payload.
3. **Renderer-triggered arbitrary write**:
   - Legacy `ipcMain.handle('pty:write', ...)`: **REMOVED (Count = 0)**.
4. **Unknown / Unclassified writes**:
   - **Count = 0**.
