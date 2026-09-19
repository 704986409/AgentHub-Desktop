# Legacy Munder Consolidation & Dead-Code Cleanup — AgentHub Desktop V0.8.9H

## 1. Executive Summary

AgentHub Desktop V0.8.9H consolidates legacy Munder technical debt accumulated across iterations V0.8.9A through V0.8.9G. Rather than adding further guards or `blocked-by-authority` wrappers, V0.8.9H executes a deletion-based refactoring that removes permanently unreachable runtime paths, eliminates fake runtime status mutations, and shrinks `useHive.ts` by nearly 50%.

### Core Architectural Principle

```
Desktop local state may describe UI state.

Desktop local state must NOT pretend
that a provider process exists,
a task executed,
an agent restarted,
an agent was restored,
or a model/provider switched
unless authoritative evidence exists.
```

---

## 2. Final Architectural Boundaries

```
                    ┌─────────────────┐
                    │      Human      │
                    └────────┬────────┘
                             │
                    user intent / approval
                             │
                             ▼
┌──────────────────────────────────────────────────┐
│              Primary Renderer                    │
│                                                  │
│  AgentHub UI       Office Projection             │
│      │                   │                       │
│      │ intent            │ read-only snapshot    │
│      ▼                   ▼                       │
│  window.agentHub      visual state               │
│                                                  │
│  NO agent PTY spawn/write/kill/list/resize       │
│  NO provider CLI execution                       │
│  NO fake restore/restart/revive                  │
│  NO queue-to-PTY delivery automation             │
└───────────────┬──────────────────────────────────┘
                │
                ▼
┌──────────────────────────┐
│           Main           │
│ validation / IPC / HTTP  │
└──────────────┬───────────┘
               │
               ▼
┌──────────────────────────┐
│        AgentHub Backend  │
│        OWNS TRUTH        │
└──────────────┬───────────┘
               │
               ▼
         Providers / Agents


Separate human tool:

Primary Renderer
      │
      └── openDeveloperTerminal()
                │
                ▼
      Dedicated Terminal Window
                │
                ▼
          Human Shell Input

(This terminal is NOT AgentHub provider runtime authority.)
```

---

## 3. Consolidation Actions Detail

### 3.1 Removal of `useRestoreTeam` and Runtime Fabrication
- Deleted `src/renderer/src/hooks/useRestoreTeam.ts`.
- Removed Restore Team button, banner, and popup menu from `AgentStrip.tsx` and `FullscreenTerminal.tsx`.
- Removed all local state promotions (`status: 'idle'`, `action: 'restored'`, fabricated `pty-${a.id}` IDs).
- Preserved `restorableAgents` in store as inert presentation/migration state to ensure backward compatibility with persisted local data.

### 3.2 Removal of Unreachable PTY Delivery Automation (`queueDelivery.ts`)
- Strategy A adopted: verified zero production senders exist that can legally return `{ status: 'sent' }`.
- Deleted `src/renderer/src/hooks/queueDelivery.ts` (`deliverWithAcknowledgement`, `isLegacyTerminalDeliveryResult`, `canDeliverToAgent`, `checkPrecondition`).
- Cleaned unreachable queue drain loop (`useEffect #4`), seed delivery loop (`useEffect #3b`), and auto-compaction loop (`useEffect #6`) from `useHive.ts`.
- Preserved message queue in store for visual presentation and history without false automated drain attempts.

### 3.3 Elimination of Dead State and Helpers in `useHive.ts`
- Reduced `useHive.ts` from 1,105 LOC (~59KB) to 577 LOC.
- Removed dead symbols: `INITIAL_GOD_PROMPT`, `REMOTE_CONTROL_SETTLE_MS`, `QUIESCE_POLL_MS`, `readyPids`, `enrichTaskPrompt`, `writeChains`, `waitForTerminalReady`, `submitToPty`.
- Removed unused imports: `ASSISTANT_MODEL`, `isClaudeProvider`, `remoteControlCommandForProvider`, `terminalReadyToReceive`, `roleForHiveSpawn`, `acquireTerminal`, `isTerminalAutomationSafe`.
- Preserved live telemetry and presentation: `contextFillPct`, `passesContextPressure`, `LARGE_CONTEXT_WINDOW`, `GOD_ID`, `GOD_PTY`, `SPAWN_ACCENTS`, `inferAgentProvider`, and standing goal formatting.

### 3.4 Test Suite Consolidation
- Replaced obsolete regex-based implementation locks (`agenthub-suppressed-delivery-ack-v089f.test.ts`, `agenthub-explicit-delivery-result-contract-v089g.test.ts`) with high-level behavioral test suite `agenthub-legacy-consolidation-v089h.test.ts`.
- 33 focused behavioral tests covering:
  - Restore Team removal proof (0 imports, UI absent)
  - No fake runtime restoration or status promotions
  - Strategy A queue delivery removal
  - Primary PTY authority closure and alias denial
  - Dedicated Developer Terminal boundary verification
  - Office authoritative projection isolation
  - Theme presentation-only invariant
  - Fail-closed provider switches and absence of auto-revive
  - Primary preload provider CLI denial
  - Migration resilience with legacy data payloads
  - Public API contract verification
