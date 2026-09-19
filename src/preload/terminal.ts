import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface DeveloperTerminalApi {
  write: (data: string) => Promise<{ ok: boolean; error?: string }>;
  resize: (cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
  close: () => Promise<{ ok: boolean; error?: string }>;
  onData: (cb: (data: string) => void) => () => void;
  onExit: (cb: (exit: { exitCode: number; signal?: number }) => void) => () => void;
}

const developerTerminal: DeveloperTerminalApi = {
  write: (data: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('developer-terminal:write', data),
  resize: (cols: number, rows: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('developer-terminal:resize', cols, rows),
  close: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('developer-terminal:close'),
  onData: (cb: (data: string) => void): (() => void) => {
    const channel = 'developer-terminal:data';
    const listener = (_e: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onExit: (cb: (exit: { exitCode: number; signal?: number }) => void): (() => void) => {
    const channel = 'developer-terminal:exit';
    const listener = (_e: IpcRendererEvent, exit: { exitCode: number; signal?: number }) => cb(exit);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('developerTerminal', developerTerminal);
