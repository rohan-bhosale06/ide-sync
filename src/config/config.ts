import fs from 'fs';
import { resolveHome } from '../utils/paths.js';
import { migrateSyncState } from '../sync/state.js';
import type { Config, SyncState } from '../sync/types.js';

const CONFIG_DIR = resolveHome('.ide-sync');
const CONFIG_FILE = resolveHome('.ide-sync', 'config.json');
export const LAST_SYNCED_FILE = resolveHome('.ide-sync', 'last-synced-state.json');

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function readConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error('ide-sync is not initialised. Run `ide-sync init` first.');
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as unknown;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Corrupt config.json — run `ide-sync init` to reconfigure.');
  }
  return raw as Config;
}

export function writeConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function readLastSyncedState(): SyncState | null {
  if (!fs.existsSync(LAST_SYNCED_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(LAST_SYNCED_FILE, 'utf8')) as unknown;
    return migrateSyncState(raw);
  } catch {
    return null;
  }
}

export function writeLastSyncedState(state: SyncState): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(LAST_SYNCED_FILE, JSON.stringify(state, null, 2), 'utf8');
}
