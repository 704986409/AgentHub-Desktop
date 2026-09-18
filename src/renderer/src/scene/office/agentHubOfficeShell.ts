import type { AgentHubStateSnapshot } from '@shared/agenthubTypes';

export type AgentHubOfficeShellState =
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'populated'; count: number };

export function deriveAgentHubOfficeShellState(
  snapshot: AgentHubStateSnapshot | null
): AgentHubOfficeShellState {
  if (!snapshot || !Array.isArray(snapshot.agents)) {
    return { kind: 'unavailable' };
  }
  if (snapshot.agents.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'populated', count: snapshot.agents.length };
}
