import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { DAEMON_PID_FILE } from 'ide-sync-core';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  const raw = fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

export function writeDaemonPid(pid: number): void {
  fs.mkdirSync(path.dirname(DAEMON_PID_FILE), { recursive: true });
  fs.writeFileSync(DAEMON_PID_FILE, String(pid), 'utf8');
}

export function removeDaemonPid(): void {
  fs.rmSync(DAEMON_PID_FILE, { force: true });
}

export function isDaemonAlive(): boolean {
  const pid = readDaemonPid();
  if (pid === null) return false;
  return isProcessAlive(pid);
}

/** Spawn the daemon as a detached background process. */
export function spawnDaemon(): void {
  const daemonScript = getDaemonScript();

  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, IDE_SYNC_DAEMON: '1' },
  });

  child.unref();
}

/** Stop the running daemon by sending SIGTERM. */
export function stopDaemon(): boolean {
  const pid = readDaemonPid();
  if (pid === null || !isProcessAlive(pid)) {
    removeDaemonPid();
    return false;
  }

  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    removeDaemonPid();
    return false;
  }
}

/** Resolve path to the daemon script (dist/daemon.js). */
export function getDaemonScript(): string {
  // When running from dist (compiled), this file is dist/daemon/lifecycle.js
  // The daemon entry is dist/daemon.js
  const currentFile = fileURLToPath(import.meta.url);
  const distDir = path.dirname(path.dirname(currentFile)); // dist/
  return path.join(distDir, 'daemon.js');
}
