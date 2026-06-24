import pino from 'pino';
import fs from 'fs';
import { DAEMON_LOG_DIR } from 'ide-sync-core';
import path from 'path';

export type Logger = pino.Logger;

let _logger: Logger | null = null;

export function createLogger(level = 'info'): Logger {
  fs.mkdirSync(DAEMON_LOG_DIR, { recursive: true });
  const logFile = path.join(DAEMON_LOG_DIR, 'daemon.log');

  return pino(
    { level },
    pino.transport({
      targets: [
        {
          target: 'pino-roll',
          options: {
            file: logFile,
            frequency: 'daily',
            mkdir: true,
            limit: { count: 7 },
          },
          level,
        },
      ],
    }),
  );
}

export function getLogger(): Logger {
  if (!_logger) _logger = createLogger();
  return _logger;
}

export function setLogger(logger: Logger): void {
  _logger = logger;
}

export function getLogDir(): string {
  return DAEMON_LOG_DIR;
}

export function getLogFile(): string {
  return path.join(DAEMON_LOG_DIR, 'daemon.log');
}
