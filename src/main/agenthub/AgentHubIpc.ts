import { ipcMain, BrowserWindow } from 'electron';
import type { AgentHubConnection } from './AgentHubConnection';
import type {
  AgentHubDesktopState,
  AgentHubStateSnapshot,
  TaskSubmissionResult
} from './AgentHubTypes';
import { AgentHubTaskSubmission } from './AgentHubTaskSubmission';

export const AGENTHUB_IPC_CHANNELS = {
  GET_STATE: 'agenthub:getConnectionState',
  GET_SNAPSHOT: 'agenthub:getSnapshot',
  REFRESH: 'agenthub:refresh',
  CHANGED: 'agenthub:changed',
  CREATE_TASK: 'agenthub:createTask'
} as const;

export function registerAgentHubIpc(
  connection: AgentHubConnection,
  taskSubmission?: AgentHubTaskSubmission
): () => void {
  const submission = taskSubmission ?? new AgentHubTaskSubmission(connection);

  // 1. Register IPC handlers
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

  // 2. Broadcast state changes to all active windows
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

  // Return unregister cleanup function
  return () => {
    submission.stop();
    connection.cache.off('change', handleChange);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_STATE);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_SNAPSHOT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.REFRESH);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.CREATE_TASK);
  };
}
