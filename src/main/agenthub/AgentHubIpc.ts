import { ipcMain, BrowserWindow } from 'electron';
import type { AgentHubConnection } from './AgentHubConnection';
import type { AgentHubDesktopState, AgentHubStateSnapshot } from './AgentHubTypes';

export const AGENTHUB_IPC_CHANNELS = {
  GET_STATE: 'agenthub:getConnectionState',
  GET_SNAPSHOT: 'agenthub:getSnapshot',
  REFRESH: 'agenthub:refresh',
  CHANGED: 'agenthub:changed'
} as const;

export function registerAgentHubIpc(connection: AgentHubConnection): () => void {
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
    connection.cache.off('change', handleChange);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_STATE);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.GET_SNAPSHOT);
    ipcMain.removeHandler(AGENTHUB_IPC_CHANNELS.REFRESH);
  };
}
