import type { CthApi, AgentHubPreloadApi } from './index';
import type { DeveloperTerminalApi } from './terminal';

declare global {
  interface Window {
    cth: CthApi;
    agentHub: AgentHubPreloadApi;
    developerTerminal?: DeveloperTerminalApi;
  }
}

export {};
