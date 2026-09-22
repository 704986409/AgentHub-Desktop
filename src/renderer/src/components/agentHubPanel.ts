export const AGENTHUB_PANEL_Z = 420;
export const AGENTHUB_MODAL_Z = 1100;

export type AgentHubDialogKind =
  | 'submit-task'
  | 'create-project'
  | 'agents'
  | 'lifecycle'
  | 'execute-task'
  | 'reviews';

export interface AgentHubPanelState {
  readonly open: boolean;
  readonly dialog: AgentHubDialogKind | null;
}

export const closedAgentHubPanel: AgentHubPanelState = { open: false, dialog: null };

export type AgentHubPanelEvent =
  | { type: 'toggle' }
  | { type: 'outside' }
  | { type: 'escape' }
  | { type: 'inside' }
  | { type: 'tick' }
  | { type: 'open-dialog'; dialog: AgentHubDialogKind }
  | { type: 'close-dialog' };

export function reduceAgentHubPanel(state: AgentHubPanelState, event: AgentHubPanelEvent): AgentHubPanelState {
  switch (event.type) {
    case 'toggle':
      return { ...state, open: !state.open };
    case 'outside':
      return state.open ? { ...state, open: false } : state;
    case 'escape':
      if (state.dialog !== null) return { open: false, dialog: null };
      return state.open ? { ...state, open: false } : state;
    case 'inside':
    case 'tick':
      return state;
    case 'open-dialog':
      return { open: false, dialog: event.dialog };
    case 'close-dialog':
      return { open: false, dialog: null };
    default:
      return state;
  }
}

export function isOutsideAgentHubPanel(target: Node | null, trigger: Node | null, panel: Node | null): boolean {
  if (target === null) return true;
  if (trigger?.contains(target)) return false;
  if (panel?.contains(target)) return false;
  return true;
}
