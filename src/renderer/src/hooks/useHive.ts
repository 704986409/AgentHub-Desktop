import { useEffect, useRef } from 'react';
import { useStore, type Agent, type StationKind, type ToolKind } from '@/store/store';
import { type HarnessConfig } from '@/store/config';

import { isDurableRole, preferredAgentRole } from '../../../shared/agentRole';
import { GOD_ID, resolveGodName } from '../../../shared/godIdentity';

import { OFFICE_CAST, DEFAULT_CHARACTER } from '@/scene/office/cast';

/** Accent palette for MAIN-spawned (voice-hired) agents — picked deterministically
 *  from the agent id so the same agent always gets the same colour. Mirrors the
 *  AddAgentModal palette. */
const SPAWN_ACCENTS = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'] as const;

/** Tool name → where the avatar walks + what it carries. */
const TOOL_STATION: Record<string, { station: StationKind; carry?: ToolKind }> = {
  Read: { station: 'shelf', carry: 'Read' },
  Edit: { station: 'desk', carry: 'Edit' },
  Write: { station: 'desk', carry: 'Write' },
  Bash: { station: 'terminal', carry: 'Bash' },
  Grep: { station: 'shelf', carry: 'Grep' },
  Glob: { station: 'shelf', carry: 'Glob' },
  WebFetch: { station: 'web', carry: 'WebFetch' },
  WebSearch: { station: 'web', carry: 'WebSearch' },
  TodoWrite: { station: 'board', carry: 'TodoWrite' },
  // #5A — delegating to a sub-agent reads as "handing off at the outbox".
  Task: { station: 'mailbox', carry: 'TodoWrite' }
};

/** Resolve a tool name to its station/glyph. Falls back: any `mcp__*` tool →
 *  the MCP station (previously these silently sat at the desk, #5A gap); anything
 *  else → the desk. */
function stationForTool(tool: string): { station: StationKind; carry?: ToolKind } {
  if (TOOL_STATION[tool]) return TOOL_STATION[tool];
  if (tool.startsWith('mcp__')) return { station: 'mcp', carry: 'MCP' };
  // Heuristic fallback for non-Claude tool names (Antigravity sends run_command,
  // ListDir, write_file, … — its hook names differ from Claude's exact tags).
  // Match write/edit BEFORE read so "write_file" → desk, not shelf.
  const t = tool.toLowerCase();
  if (/command|bash|shell|exec|terminal|run_/.test(t)) return { station: 'terminal', carry: 'Bash' };
  if (/web|fetch|browser|http|url/.test(t)) return { station: 'web', carry: 'WebFetch' };
  if (/write|edit|create|patch|replace|apply/.test(t)) return { station: 'desk', carry: 'Write' };
  if (/read|list|view|dir|glob|grep|search|find|file|cat|\bls\b/.test(t)) return { station: 'shelf', carry: 'Read' };
  return { station: 'desk' };
}

/**
 * The renderer-side glue for the hive:
 *   1. resolves the presentation-only Office Host name, and
 *   2. drives real worker avatar state from authoritative hook events.
 */
export function useHive(config: HarnessConfig | null): void {
  // #5C/#7C.4 — latest circuit-breaker level per agent. When 'constrained'/
  // 'stopped' the avatar is pinned to 'looping' and hook events must NOT flip it
  // back to 'working' (the flicker the spec calls out); only a genuine Stop clears it.
  const breakerLevel = useRef<Record<string, string>>({});

  // 0) Heal roster `description` from hive `role` when the floor caption was
  //    overwritten by a status string ("on standby") after hire.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    void window.cth.hiveRegistry().then((reg) => {
      const roles: Record<string, string> = {};
      for (const [id, entry] of Object.entries(reg.agents ?? {})) {
        if (typeof entry.role === 'string' && entry.role.trim()) roles[id] = entry.role.trim();
      }
      useStore.getState().syncDescriptionsFromRoles(roles);
      const { agents, archivedAgents } = useStore.getState();
      for (const a of [...agents, ...archivedAgents]) {
        const next = preferredAgentRole(a.description, roles[a.id], !!a.isGod);
        if (isDurableRole(next) && next !== roles[a.id]) {
          void window.cth.hivePatchAgentRole(a.id, next);
        }
      }
    }).catch(() => { /* hive not ready yet */ });
  }, [config?.onboardingComplete]);

  // 1) Resolve Michael as a presentation actor. Registry metadata may rename
  //    the host, but it never creates an Agent, runtime status, provider, or PTY.
  useEffect(() => {
    if (!config?.onboardingComplete || !config.harnessHome) return;
    let cancelled = false;
    void window.cth.hiveRegistry().then((reg) => {
      if (cancelled) return;
      const godName = resolveGodName(reg?.agents?.[GOD_ID]?.name);
      useStore.getState().setPresentationActorName(godName);
    }).catch(() => { /* presentation keeps its default name */ });
    return () => { cancelled = true; };
  }, [config?.onboardingComplete, config?.harnessHome]);

  // 2) Drive avatars from real hook events emitted by each agent's shim.
  useEffect(() => {
    return window.cth.onHiveHookEvent((e) => {
      if (!e.agentId) return;
      const { updateAgent, agents } = useStore.getState();
      const self = agents.find((a) => a.id === e.agentId);
      if (!self) return;
      // Breaker precedence (#5C): a constrained/stopped agent stays 'looping'
      // regardless of in-flight tool/prompt/compact events.
      const blevel = breakerLevel.current[e.agentId];
      const breakerArmed = blevel === 'constrained' || blevel === 'stopped';
      // Hook events are the authoritative status source for real agents (the
      // pty-stream parser only refines the on-floor action/station).
      if (e.event === 'PreCompact') {
        // #5C — agent entered /compact; show it's boxing up context, not frozen.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'compacting', action: 'compacting context', carrying: undefined });
      } else if (e.event === 'PostCompact') {
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', action: 'resumed', carrying: undefined });
      } else if (e.event === 'PreToolUse' && e.tool) {
        const m = stationForTool(e.tool);
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', currentStation: m.station, carrying: m.carry, action: `using ${e.tool}` });
        useStore.getState().bumpToolCount(e.agentId); // usage proxy for the command center
      } else if (e.event === 'PostToolUse' || e.event === 'UserPromptSubmit') {
        // A turn is in progress (prompt submitted / tool just finished) — keep
        // it working so it doesn't flicker idle between tool calls.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working' });
      } else if (e.event === 'PreInvocation') {
        // Antigravity (agy): the model is being called — it's thinking/working.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', action: 'thinking' });
      } else if (e.event === 'PostInvocation') {
        // agy's per-turn boundary. Unlike Claude, agy's Stop fires only on process
        // EXIT, so without this an agy worker would never register as idle and the
        // inbox-wake nudge (idle-only) could never reach it — its mail would sit
        // undrained. Treat it as idle; a follow-up tool/turn re-sets working.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'idle', action: 'idle', carrying: undefined });
      } else if (e.event === 'Stop' || e.event === 'SubagentStop') {
        // A blocked Stop means the agent is being re-engaged to process its
        // inbox — it's NOT idle, so keep it working until it genuinely stops.
        if (e.blocked) {
          if (!breakerArmed) updateAgent(e.agentId, { status: 'working', action: 'reading inbox', carrying: undefined });
        } else {
          // A genuine stop clears any breaker override — the run is over.
          breakerLevel.current[e.agentId] = 'healthy';
          updateAgent(e.agentId, { status: 'idle', action: 'idle', carrying: undefined });
        }
      } else if (e.event === 'Notification' && !breakerArmed) {
        // Claude Code fires Notification for two very different situations:
        //   1. it genuinely needs the human (a permission / approval prompt), or
        //   2. the prompt has merely gone idle ("Claude is waiting for your
        //      input") — i.e. the agent answered and has nothing queued.
        // Only (1) is a real "needs you". Treating (2) as blocked made Michael
        // march to the door with a red "!" right after finishing, so detect the
        // idle case and let him linger on the floor instead.
        const msg = (e.message ?? '').toLowerCase();
        const idleWaiting = !msg
          || msg.includes('waiting for your input')
          || msg.includes('is idle')
          || msg.includes('waiting for input');
        const needsHuman = msg.includes('permission')
          || msg.includes('approve')
          || msg.includes('confirm')
          || msg.includes('needs your');
        if (needsHuman && !idleWaiting) {
          // Only the god agent escalates to the human; sub-agents are autonomous
          // and read as "waiting" (parked on god, not on you).
          updateAgent(e.agentId, { status: self.isGod ? 'blocked' : 'waiting' });
        } else {
          // Idle notification — responded, nothing to do. Linger, don't flag.
          updateAgent(e.agentId, { status: 'idle', action: 'idle', carrying: undefined });
        }
      }
    });
  }, []);

  // 2b) Consume circuit-breaker state (#7C.4/#5C). Lane A's breaker policy (#6)
  //     pushes BreakerState on `control:breakerState`; this gives it PRECEDENCE
  //     over hook-derived status: a constrained/stopped agent is pinned to
  //     'looping' (see the breakerArmed guard above) until it genuinely Stops.
  useEffect(() => {
    return window.cth.onBreakerState((s) => {
      breakerLevel.current[s.agentId] = s.level;
      const { updateAgent, agents } = useStore.getState();
      if (!agents.some((a) => a.id === s.agentId)) return;
      if (s.level === 'constrained' || s.level === 'stopped') {
        updateAgent(s.agentId, { status: 'looping', action: s.reason || 'breaker armed', carrying: undefined });
      }
      // 'healthy'/'steering' clear the pin; the next hook event refreshes status.
    });
  }, []);

  // 2c) Context gauge backfill: poll each live agent's current context size
  //     (tokens) from its session transcript — only until the status line
  //     (effect 2d) has delivered exact numbers for that agent.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const poll = async () => {
      const { agents, updateAgent } = useStore.getState();
      for (const a of agents) {
        if (!a.ptyId) continue;
        // The status line pushes exact numbers after every response (effect
        // 2d) — this transcript poll only backfills agents whose status line
        // hasn't fired yet (e.g. freshly restored, no response so far).
        if (a.contextLimit !== undefined) continue;
        try {
          const ctx = await window.cth.agentContext(a.id);
          if (ctx === null) continue;
          const hinted = /1m/i.test(a.model ?? '') ? 1_000_000 : 200_000;
          const limit = Math.max(hinted, ctx > 200_000 ? 1_000_000 : 0);
          const progress = Math.max(0, Math.min(8, Math.round((ctx / limit) * 8)));
          updateAgent(a.id, { contextTokens: ctx, progress });
        } catch { /* ignore — try again next tick */ }
      }
    };
    const t = setTimeout(poll, 3000); // first fill shortly after boot
    const iv = setInterval(poll, 15000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [config?.onboardingComplete]);

  // 2d) Push-based context gauge: the status-line shim forwards the session's
  //     EXACT context accounting (tokens + real window size) after every
  //     response — no probing, no transcript guesswork.
  useEffect(() => {
    return window.cth.onHiveContextUpdate(({ agentId, tokens, limit }) => {
      // Defense-in-depth: the main process already filters limit > 0, but the
      // renderer must not trust IPC blindly — limit 0 would put NaN progress
      // into the store (NaN survives the Math.min/max clamp).
      if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(tokens)) return;
      const progress = Math.max(0, Math.min(8, Math.round((tokens / limit) * 8)));
      useStore.getState().updateAgent(agentId, { contextTokens: tokens, contextLimit: limit, progress });
    });
  }, []);

  // 5b) MAIN-initiated roster changes (rt-5 voice spawn/kill). The renderer store is
  //     only mutated by renderer-initiated hires (AddAgentModal); a voice hire/kill
  //     runs in MAIN (spawnAgentCore / teardownPty, owner=null) and would otherwise
  //     be invisible on the floor. Main broadcasts; we build/archive the card here.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const offSpawn = window.cth.onHiveAgentSpawned?.((rec) => {
      if (!rec?.id) return;
      // addAgent is idempotent, but bail early if the renderer already carded it.
      if (useStore.getState().agents.some((a) => a.id === rec.id)) return;
      // An explicit character wins; otherwise infer it from the name, which is
      // what makes "spawn one called Meredith" land on the Meredith avatar with
      // nothing else asked for. The explicit field covers what inference cannot
      // express: an agent named something else that should still look like a
      // particular character. Unknown values fall through to the inference rather
      // than breaking the card.
      const castMember = (q?: string) =>
        q ? OFFICE_CAST.find((m) => m.name === q || m.displayName.toLowerCase() === q)?.name : undefined;
      const character =
        castMember(rec.character?.trim().toLowerCase()) ??
        castMember((rec.name || rec.id).toLowerCase()) ??
        DEFAULT_CHARACTER;
      // Accent is otherwise hashed from the worker id, which is stable but not
      // choosable. An unrecognised accent keeps the hash.
      const askedAccent = SPAWN_ACCENTS.find((a) => a === rec.accent?.trim().toLowerCase());
      let h = 0;
      for (const ch of rec.id) h = (h + ch.charCodeAt(0)) % SPAWN_ACCENTS.length;
      const project = (rec.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'hive';
      const agent: Agent = {
        id: rec.id,
        name: rec.name || rec.id,
        character,
        accent: askedAccent ?? SPAWN_ACCENTS[h],
        description: rec.role || 'a fresh harness',
        project,
        tmuxTarget: '',
        cwd: rec.cwd,
        status: 'idle',
        action: 'starting up',
        progress: 0,
        currentStation: 'desk',
        ptyId: rec.id,
        command: rec.command,
        provider: rec.provider as Agent['provider'],
        isGod: false,
        recentTextTs: Date.now()
      };
      useStore.getState().addAgent(agent);
    });
    const offArchive = window.cth.onHiveAgentArchived?.((e) => {
      if (e?.id) useStore.getState().archiveAgent(e.id);
    });
    return () => { offSpawn?.(); offArchive?.(); };
  }, [config?.onboardingComplete]);

  // Renderer-side auto-revive is intentionally disabled in AgentHub mode.
  // A dead legacy PTY is not proof that a runtime was restored; authoritative
  // Agent state remains offline/degraded until Backend state says otherwise.
}
