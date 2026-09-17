import type { CthApi, AgentHubPreloadApi } from './index';

declare global {
  interface Window {
    cth: CthApi;
    agentHub: AgentHubPreloadApi;
  }
}

export {};
