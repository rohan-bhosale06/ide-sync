import fs from 'fs';
import { resolveHome } from './paths.js';

const LOCK_FILE = resolveHome('.ide-sync', '.lock');

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a per-user lockfile so concurrent ide-sync processes don't corrupt
 * the merge base.  Returns a release function.
 *
 * Throws if another live process holds the lock.
 */
export function acquireLock(): () => void {
  if (fs.existsSync(LOCK_FILE)) {
    const existing = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    const pid = parseInt(existing, 10);
    if (!isNaN(pid) && isProcessAlive(pid) && pid !== process.pid) {
      throw new Error(
        `Another ide-sync process (PID ${pid}) is running. ` +
        `Wait for it to finish or delete ${LOCK_FILE} if it is stale.`,
      );
    }
    // Stale lock from a crashed previous run — clear it.
    fs.rmSync(LOCK_FILE, { force: true });
  }

  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');

  const release = (): void => {
    try {
      fs.rmSync(LOCK_FILE, { force: true });
    } catch {
      // Ignore — process is exiting anyway.
    }
  };

  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(130); });
  process.once('SIGTERM', () => { release(); process.exit(143); });

  return release;
}
