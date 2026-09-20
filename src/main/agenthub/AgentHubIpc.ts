import { ipcMain, BrowserWindow } from 'electron';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  AgentHubDesktopState,
  AgentHubStateSnapshot,
  TaskExecutionResult,
  TaskSubmissionResult,
  ReviewDecisionResult,
  AgentMutationResult,
  ProviderDto,
  LifecycleMutationResult
} from './AgentHubTypes';
import { AgentHubTaskSubmission } from './AgentHubTaskSubmission';
import { AgentHubTaskExecution } from './AgentHubTaskExecution';
import { AgentHubReviewDecision } from './AgentHubReviewDecision';
import { AgentHubAgentManagement } from './AgentHubAgentManagement';
import { AgentHubLifecycle } from './AgentHubLifecycle';

export const AGENTHUB_IPC_CHANNELS = {
  GET_STATE: 'agenthub:getConnectionState',
  GET_SNAPSHOT: 'agenthub:getSnapshot',
  REFRESH: 'agenthub:refresh',
  CHANGED: 'agenthub:changed',
  CREATE_TASK: 'agenthub:createTask',
  EXECUTE_TASK: 'agenthub:executeTask',
  REVIEW_DECISION: 'agenthub:reviewDecision',
  CREATE_AGENT: 'agenthub:createAgent',
  UPDATE_AGENT: 'agenthub:updateAgent',
  ENABLE_AGENT: 'agenthub:enableAgent',
  DISABLE_AGENT: 'agenthub:disableAgent',
  DELETE_AGENT: 'agenthub:deleteAgent',
  GET_PROVIDERS: 'agenthub:getProviders',
  LIFECYCLE_CREATE_INTAKE: 'agenthub:lifecycle:create-intake',
  LIFECYCLE_CREATE_PLAN: 'agenthub:lifecycle:create-plan',
  LIFECYCLE_CREATE_REVISION: 'agenthub:lifecycle:create-revision',
  LIFECYCLE_APPROVE: 'agenthub:lifecycle:approve',
  LIFECYCLE_REQUEST_CHANGES: 'agenthub:lifecycle:request-changes',
  LIFECYCLE_REJECT: 'agenthub:lifecycle:reject',
  LIFECYCLE_START: 'agenthub:lifecycle:start',
  LIFECYCLE_RESYNC: 'agenthub:lifecycle:resync'
} as const;

export function registerAgentHubIpc(
  connection: AgentHubConnection,
  taskSubmission?: AgentHubTaskSubmission,
  taskExecution?: AgentHubTaskExecution,
  reviewDecision?: AgentHubReviewDecision,
  agentManagement?: AgentHubAgentManagement,
  lifecycle?: AgentHubLifecycle
): () => void {
  const submission = taskSubmission ?? new AgentHubTaskSubmission(connection);
  const execution = taskExecution ?? new AgentHubTaskExecution(connection);
  const decision = reviewDecision ?? new AgentHubReviewDecision(connection);
  const management = agentManagement ?? new AgentHubAgentManagement(connection);
  const lifecycleClient = lifecycle ?? new AgentHubLifecycle(connection);


  ipcMain.handle(AGENTHUB_IPC_CHANNELS.GET_STATE, (): AgentHubDesktopState => {
    return connection.getState();
  });

  ipcMain.handle(AGENTHUB_IPC_CHANNELS.GET_SNAPSHOT, (): AgentHubStateSnapshot | null => {
    return connection.getState().snapshot;
  });

  ipcMain.handle(AGENTHUB_IPC_CHANNELS.REFRESH, async (): Promise<AgentHubDesktopState> => {
    await connection.refresh();
    return connection.getState();
  });

  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.CREATE_TASK,
    async (_event, request: unknown): Promise<TaskSubmissionResult> => {
      return submission.submitTask(request);
    }
  );

  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.EXECUTE_TASK,
    async (_event, request: unknown): Promise<TaskExecutionResult> => {
      return execution.executeTask(request);
    }
  );

  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.REVIEW_DECISION,
    async (_event, request: unknown): Promise<ReviewDecisionResult> => {
      return decision.applyDecision(request);
    }
  );

  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.CREATE_AGENT,
    async (_event, request: unknown): Promise<AgentMutationResult> => management.createAgent(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.UPDATE_AGENT,
    async (_event, request: unknown): Promise<AgentMutationResult> => management.updateAgent(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.ENABLE_AGENT,
    async (_event, request: unknown): Promise<AgentMutationResult> => management.enableAgent(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.DISABLE_AGENT,
    async (_event, request: unknown): Promise<AgentMutationResult> => management.disableAgent(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.DELETE_AGENT,
    async (_event, request: unknown): Promise<AgentMutationResult> => management.deleteAgent(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.GET_PROVIDERS,
    async (): Promise<readonly ProviderDto[]> => connection.getProviders()
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_INTAKE,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.createIntake(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_PLAN,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.createPlan(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_REVISION,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.createRevision(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_APPROVE,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.approve(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_REQUEST_CHANGES,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.requestChanges(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_REJECT,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.reject(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_START,
    async (_event, request: unknown): Promise<LifecycleMutationResult> => lifecycleClient.start(request)
  );
  ipcMain.handle(
    AGENTHUB_IPC_CHANNELS.LIFECYCLE_RESYNC,
    async (): Promise<AgentHubDesktopState> => {
      await connection.refresh();
      return connection.getState();
    }
  );

  const handleChange = (state: AgentHubDesktopState): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents) {
        try {
          win.webContents.send(AGENTHUB_IPC_CHANNELS.CHANGED, state);
        } catch {
          // Window may be closing; silently drop
        }
      }
    }
  };

  connection.cache.on('change', handleChange);

  return () => {
    decision.stop();
    execution.stop();
    submission.stop();
    management.stop();
    lifecycleClient.stop();
    connection.cache.off('change', handleChange);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_STATE);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_SNAPSHOT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.REFRESH);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.CREATE_TASK);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.EXECUTE_TASK);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.REVIEW_DECISION);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.CREATE_AGENT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.UPDATE_AGENT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.ENABLE_AGENT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.DISABLE_AGENT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.DELETE_AGENT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_PROVIDERS);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_INTAKE);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_PLAN);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_CREATE_REVISION);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_APPROVE);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_REQUEST_CHANGES);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_REJECT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_START);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.LIFECYCLE_RESYNC);
  };

}
