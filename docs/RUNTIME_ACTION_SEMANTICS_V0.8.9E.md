# Runtime Action Semantics — V0.8.9E

V0.8.9E applies one rule to legacy Desktop runtime controls:

```text
No Runtime Transition
→ No Fake UI Transition
```

Legacy Munder UI entries do not carry a verified AgentHub business identity that can safely be submitted to Agent Management. Their lifecycle and runtime-switch actions therefore fail closed. Formal AgentHub lifecycle changes continue through Agent Management, Main-owned idempotency and transport, Backend mutation, and authoritative `/state` synchronization.

| Action | V0.8.9D | V0.8.9E | Truth Owner |
| --- | --- | --- | --- |
| Agent detail Kill | local archive only | disabled / fail-closed | Backend |
| Fullscreen Kill | local archive only | disabled / fail-closed through the same policy | Backend |
| Restart & Continue | local state patch | disabled | Backend |
| Provider/model switch | local patch | disabled in legacy roster; formal changes use Agent Management | Backend |
| Auto-revive | fake restored state | disabled; waits for authoritative state | Backend/Main |
| Theme switch | archives agents | presentation-only | Desktop visuals |
| `disposeTerminal` | misused as lifecycle | presentation-only | Renderer |
| `resetTerminal` | misused as revive | presentation-only | Renderer |
| PTY lifecycle | Main-owned | Main-owned | Main |

## Kill surfaces

`AgentDetailPanel` and `FullscreenTerminal` import the same fail-closed policy. Their destructive buttons remain visibly unavailable and do not call terminal cleanup, archive the local roster, or claim that the runtime stopped. Operators use AgentHub Agent Management for authoritative lifecycle changes.

## Restart and runtime configuration

The legacy Command Center no longer implements restart or provider/model switching by patching Zustand state. The controls show the current configuration and remain disabled with an explanation. No `idle`, `restarted`, `continued`, `model updated`, or provider-switch state is fabricated.

## Power resume

Renderer-side auto-revive is disabled. A dead PTY observation does not reset a terminal, spawn a provider, or promote an Agent to `idle`/`restored`. Backend/Main authoritative state remains the source of runtime truth.

## Office themes

Theme switching persists `officeTheme` and rebuilds the visual scene. It does not terminate, restart, archive, enable, disable, remove, or otherwise mutate Agent lifecycle state. Agent IDs and lifecycle states remain unchanged across a theme update.

## Presentation helpers

`disposeTerminal` releases renderer resources only. `resetTerminal` refreshes renderer terminal state only. Neither helper represents termination, restart, resume, revival, provider switch, or any Backend lifecycle result.

## PTY authority boundary

V0.8.9D remains intact. Primary Renderer exposes no generic PTY lifecycle, write, resize, or enumeration authority. Dedicated Terminal remains sender-bound and Main retains internal compatibility ownership.
