/**
 * V0.8.9 Munder authority reduction helpers.
 *
 * AgentHub Backend is the only business truth. Desktop Main is a narrow bridge.
 * Renderer / Office are projection. PTY must not execute AgentHub provider work.
 */

export const AGENTHUB_PTY_EXECUTION_ERROR = 'PTY must not execute AgentHub provider work';

export type PtySpawnPurpose = 'developer-terminal' | 'legacy-munder-compat';

export type MunderAuthorityAction =
  | 'REMOVE'
  | 'DISABLE'
  | 'PRESENTATION ONLY'
  | 'COMPATIBILITY ONLY';

/** Renderer-facing API names that must not exist as AgentHub authority. */
export const FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS = Object.freeze([
  'workerLaunch',
  'wake',
  'hire',
  'godCommand',
  'exec',
  'spawn',
  'writePty',
  'sendToPty',
  'terminalWrite'
]);

/** AgentHub provider execution is only allowed through this preload surface. */
export const AGENTHUB_EXECUTION_PRELOAD_KEYS = Object.freeze([
  'executeTask'
]);

export function rejectAgentHubPtyExecution(opts: unknown): { ok: true } | { ok: false; error: string } {
  if (opts === null || typeof opts !== 'object') {
    return { ok: true };
  }
  const record = opts as Record<string, unknown>;
  if (record.purpose === 'agenthub-execution') {
    return { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR };
  }
  if (record.executionIntent === 'agenthub-provider') {
    return { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR };
  }
  if (typeof record.agenthubTaskId === 'string' && record.agenthubTaskId.trim().length > 0) {
    return { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR };
  }
  if (typeof record.agenthubAgentId === 'string' && record.agenthubAgentId.trim().length > 0) {
    return { ok: false, error: AGENTHUB_PTY_EXECUTION_ERROR };
  }
  return { ok: true };
}

export function classifyLegacyMunderSymbol(symbol: string): MunderAuthorityAction {
  switch (symbol) {
    case 'Hive':
    case 'hive':
      return 'COMPATIBILITY ONLY';
    case 'Michael':
    case 'michael':
      return 'PRESENTATION ONLY';
    case 'GOD':
    case 'isGod':
    case 'godMode':
      return 'PRESENTATION ONLY';
    case 'workerLaunch':
    case 'wake':
    case 'control':
      return 'DISABLE';
    case 'hire':
      return 'COMPATIBILITY ONLY';
    case 'roster':
      return 'COMPATIBILITY ONLY';
    case 'PTY':
    case 'pty':
      return 'COMPATIBILITY ONLY';
    case 'worktree':
      return 'COMPATIBILITY ONLY';
    case 'taskStore':
      return 'COMPATIBILITY ONLY';
    default:
      return 'PRESENTATION ONLY';
  }
}
