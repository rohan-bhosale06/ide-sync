import net from 'net';
import fs from 'fs';
import { getSocketPath, sendIpcCommand } from 'ide-sync-core';
import type { IpcCommand, IpcResponse } from 'ide-sync-core';
import type { Logger } from './logger.js';

export { getSocketPath, sendIpcCommand };
export type { IpcCommand, IpcResponse };

type CommandHandler = (cmd: IpcCommand) => Promise<IpcResponse>;

/** IPC server running inside the daemon process. */
export class IpcServer {
  private server: net.Server | null = null;

  constructor(
    private readonly handler: CommandHandler,
    private readonly logger: Logger,
  ) {}

  start(): void {
    const sockPath = getSocketPath();

    // Clean up stale socket file (Unix only).
    if (process.platform !== 'win32' && fs.existsSync(sockPath)) {
      fs.rmSync(sockPath, { force: true });
    }

    this.server = net.createServer((socket) => {
      let buf = '';
      socket.setEncoding('utf8');

      socket.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this._handleLine(trimmed, socket);
        }
      });

      socket.on('error', (err) => {
        this.logger.debug({ err }, 'ipc socket error');
      });
    });

    this.server.on('error', (err) => {
      this.logger.error({ err }, 'ipc server error');
    });

    this.server.listen(sockPath, () => {
      this.logger.info({ sockPath }, 'ipc server listening');
    });
  }

  private _handleLine(line: string, socket: net.Socket): void {
    let cmd: IpcCommand;
    try {
      cmd = JSON.parse(line) as IpcCommand;
    } catch {
      const resp: IpcResponse = { ok: false, error: 'invalid json' };
      socket.write(JSON.stringify(resp) + '\n');
      return;
    }

    this.handler(cmd)
      .then((resp) => {
        socket.write(JSON.stringify(resp) + '\n');
      })
      .catch((err) => {
        const resp: IpcResponse = { ok: false, error: err instanceof Error ? err.message : String(err) };
        socket.write(JSON.stringify(resp) + '\n');
      });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => {
        const sockPath = getSocketPath();
        if (process.platform !== 'win32') {
          fs.rmSync(sockPath, { force: true });
        }
        resolve();
      });
    });
  }
}
