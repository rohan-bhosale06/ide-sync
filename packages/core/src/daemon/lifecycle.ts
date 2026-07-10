/**
 * Pure daemon process management — no CLI/stdio concerns.
 * Used by both the CLI's `daemon` command and (later) the desktop app's
 * background-sync toggle.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DAEMON_PID_FILE } from '../config/config.js';

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

/**
 * Spawn the daemon as a detached background process running `daemonScript`.
 * `extraEnv` lets callers whose execPath is not plain Node (e.g. Electron,
 * which needs ELECTRON_RUN_AS_NODE=1) make the child run as a Node process.
 */
export function spawnDaemon(daemonScript: string, extraEnv: Record<string, string> = {}): void {
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, IDE_SYNC_DAEMON: '1', ...extraEnv },
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
