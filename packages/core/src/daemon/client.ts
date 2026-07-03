/**
 * Daemon IPC client — connects to the running daemon's Unix socket (or named
 * pipe on Windows) and sends a single command. Used by both the CLI's
 * `daemon` command and (later) the desktop app to query/control background sync.
 */
import net from 'net';
import { DAEMON_SOCK_FILE } from '../config/config.js';

export function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\ide-sync-daemon';
  }
  return DAEMON_SOCK_FILE;
}

export interface IpcCommand {
  cmd: 'ping' | 'status' | 'sync-now' | 'pause' | 'resume' | 'reload-config';
}

export interface IpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Send a single command to the running daemon and return its response. */
export async function sendIpcCommand(cmd: IpcCommand, timeoutMs = 5000): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const sockPath = getSocketPath();
    const socket = net.createConnection(sockPath);
    let buf = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('IPC timeout — daemon may not be running'));
    }, timeoutMs);

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      socket.write(JSON.stringify(cmd) + '\n');
    });

    socket.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (settled) continue;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        try {
          resolve(JSON.parse(trimmed) as IpcResponse);
        } catch {
          reject(new Error(`Invalid IPC response: ${trimmed}`));
        }
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    socket.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('IPC connection closed without response'));
    });
  });
}
