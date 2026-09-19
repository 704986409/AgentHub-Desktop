/**
 * Dedicated Developer Terminal session registry and sender-bound IPC handlers (V0.8.9C).
 *
 * Security boundary:
 * 1. Primary AgentHub Renderer has NO PTY write authority.
 * 2. Dedicated Terminal Window gets an isolated WebContents.
 * 3. Session mapping is strictly sender-bound: ownerWebContentsId -> TerminalSession.
 * 4. IPC handlers developer-terminal:write/resize/close read evt.sender.id and NEVER accept ptyId from Renderer.
 */

export interface TerminalSession {
  ptyId: string;
  ownerWebContentsId: number;
  cwd: string;
}

export const terminalSessions = new Map<number, TerminalSession>();

export function sessionForSender(senderId: number): TerminalSession | null {
  return terminalSessions.get(senderId) ?? null;
}

export function handleDeveloperTerminalWrite(
  senderId: number,
  data: unknown,
  writer: (ptyId: string, d: string) => { ok: boolean; error?: string }
): { ok: boolean; error?: string } {
  if (typeof data !== 'string') return { ok: false, error: 'INVALID_TERMINAL_INPUT' };
  const session = sessionForSender(senderId);
  if (!session) return { ok: false, error: 'UNAUTHORIZED_TERMINAL_SENDER' };
  return writer(session.ptyId, data);
}

export function handleDeveloperTerminalResize(
  senderId: number,
  cols: unknown,
  rows: unknown,
  resizer: (ptyId: string, c: number, r: number) => { ok: boolean; error?: string }
): { ok: boolean; error?: string } {
  if (typeof cols !== 'number' || typeof rows !== 'number') {
    return { ok: false, error: 'INVALID_TERMINAL_RESIZE' };
  }
  const session = sessionForSender(senderId);
  if (!session) return { ok: false, error: 'UNAUTHORIZED_TERMINAL_SENDER' };
  return resizer(session.ptyId, cols, rows);
}

export function handleDeveloperTerminalClose(
  senderId: number,
  killer: (ptyId: string) => void
): { ok: boolean; error?: string } {
  const session = sessionForSender(senderId);
  if (!session) return { ok: false, error: 'UNAUTHORIZED_TERMINAL_SENDER' };
  killer(session.ptyId);
  terminalSessions.delete(senderId);
  return { ok: true };
}
