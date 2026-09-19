# Legacy Runtime Final Closure — AgentHub Desktop V0.8.9I

V0.8.9I removes the final Desktop/Renderer paths that looked like runtime authority without an authoritative execution path. AgentHub Backend remains unchanged.

## Authority boundary

```text
Human
  -> Primary Renderer intent
  -> Main
  -> AgentHub Backend
  -> AgentProvider / WorkerSession

Office UI
  -> Backend snapshot projection only

Developer Terminal
  -> isolated human shell with sender-bound write/resize/close
```

The Primary Renderer does not expose generic PTY spawn, write, resize, redraw, kill, or enumeration authority.

## Inventory and disposition

| Legacy surface | Before | V0.8.9I disposition |
| --- | --- | --- |
| Composer | Wrote to an undeliverable runtime queue | Removed |
| Slack ingress | Enqueued work and emitted a false success acknowledgement | Listener and acknowledgement removed; no execution claim |
| Realtime ingress | Enqueued local PTY text | Listener removed; no blind `executeTask` conversion |
| Hive enqueue | Enqueued local PTY text | Listener removed |
| Terminal handoff | Converted handoff into local PTY work | Listener removed |
| Inbox nudge | Enqueued a local wake prompt | Poll/producer removed; inbox remains readable |
| Persisted active roster | Became live `idle` / `reconnecting` agents | Ignored as non-authoritative legacy data |
| Restorable roster | Became a live-looking restore list | Ignored; restore UI/state/actions removed |
| Persisted queues | Re-entered a queue with no consumer | Ignored; compatibility file fields are written empty |
| Michael / God | Synthetic `Agent` with `pty-god`, provider, model and status | Separate `PresentationActor` with UI identity only |

Legacy runtime producers: 6 before, 0 after. Legacy runtime consumers: 0 before, 0 after.

## Michael presentation model

Michael is an Office Host used to open the Command Center. The presentation actor has an id, display name, character, accent, description, role and workspace context. It has no `ptyId`, provider, model, runtime status or runtime action. Selecting it enters the Command Center directly and cannot acquire a terminal or enter PTY focus mode.

Human Boss remains a separate human presentation actor. Michael is neither the human nor an AgentHub Agent.

## Persistence migration

The version-1 roster file retains `restorable` and `queues` fields only so older builds can parse the file shape. V0.8.9I writes them as `[]` and `{}` and never imports their payload into live state. Saved active legacy agents are likewise ignored; live worker cards can only be created from current lifecycle evidence.

## Truthful UI and telemetry

The send composer, Send Now controls, delivery status, restore list, reconnecting boot state and waking/terminal-landing copy are removed. A locally queued draft is no longer counted as `message_sent`; the deleted composer has no telemetry call.

The governing invariants are:

```text
No Runtime Action -> No Runtime Success Copy
No Actual PTY -> No ptyId
No Restore API -> No Restore UI
No Delivery Consumer -> No Delivery Queue
```

