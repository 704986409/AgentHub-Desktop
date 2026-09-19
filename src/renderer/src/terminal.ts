import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

declare global {
  interface Window {
    developerTerminal?: {
      write: (data: string) => Promise<{ ok: boolean; error?: string }>;
      resize: (cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
      close: () => Promise<{ ok: boolean; error?: string }>;
      onData: (cb: (data: string) => void) => () => void;
      onExit: (cb: (exit: { exitCode: number; signal?: number }) => void) => () => void;
    };
  }
}

const container = document.getElementById('terminal-container');
if (container && window.developerTerminal) {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: 14,
    theme: {
      background: '#18181b',
      foreground: '#f4f4f5'
    }
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  try {
    fitAddon.fit();
  } catch {
    /* ignore fit on initial layout */
  }

  window.addEventListener('resize', () => {
    try {
      fitAddon.fit();
      if (term.cols && term.rows) {
        window.developerTerminal?.resize(term.cols, term.rows);
      }
    } catch {
      /* ignore */
    }
  });

  window.developerTerminal.onData((data) => {
    term.write(data);
  });

  term.onData((data) => {
    window.developerTerminal?.write(data);
  });

  window.developerTerminal.onExit((info) => {
    term.write(`\r\n\x1b[33m[Process exited with code ${info.exitCode ?? 0}]\x1b[0m\r\n`);
  });

  if (term.cols && term.rows) {
    window.developerTerminal.resize(term.cols, term.rows);
  }
}
