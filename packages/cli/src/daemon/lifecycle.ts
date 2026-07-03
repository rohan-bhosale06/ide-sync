import path from 'path';
import { fileURLToPath } from 'url';
import { isDaemonAlive, spawnDaemon as coreSpawnDaemon, stopDaemon, readDaemonPid, writeDaemonPid, removeDaemonPid } from 'ide-sync-core';

export { isDaemonAlive, stopDaemon, readDaemonPid, writeDaemonPid, removeDaemonPid };

/** Resolve path to the daemon script (dist/daemon.js). */
export function getDaemonScript(): string {
  // When running from dist (compiled), this file is dist/daemon/lifecycle.js
  // The daemon entry is dist/daemon.js
  const currentFile = fileURLToPath(import.meta.url);
  const distDir = path.dirname(path.dirname(currentFile)); // dist/
  return path.join(distDir, 'daemon.js');
}

/** Spawn the daemon as a detached background process. */
export function spawnDaemon(): void {
  coreSpawnDaemon(getDaemonScript());
}
