import { ipcMain, BrowserWindow } from 'electron';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  AgentHubDesktopState,
  AgentHubStateSnapshot,
  TaskExecutionResult,
  TaskSubmissionResult,
  ReviewDecisionResult,
  AgentMutationResult
} from './AgentHubTypes';
import { AgentHubTaskSubmission } from './AgentHubTaskSubmission';
import { AgentHubTaskExecution } from './AgentHubTaskExecution';
import { AgentHubReviewDecision } from './AgentHubReviewDecision';
import { AgentHubAgentManagement } from './AgentHubAgentManagement';

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
  DELETE_AGENT: 'agenthub:deleteAgent'
} as const;

export function registerAgentHubIpc(
  connection: AgentHubConnection,
  taskSubmission?: AgentHubTaskSubmission,
  taskExecution?: AgentHubTaskExecution,
  reviewDecision?: AgentHubReviewDecision,
  agentManagement?: AgentHubAgentManagement
): () => void {
  const submission = taskSubmission ?? new AgentHubTaskSubmission(connection);
  const execution = taskExecution ?? new AgentHubTaskExecution(connection);
  const decision = reviewDecision ?? new AgentHubReviewDecision(connection);
  const management = agentManagement ?? new AgentHubAgentManagement(connection);


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
  };

}
