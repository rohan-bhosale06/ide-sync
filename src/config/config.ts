import fs from 'fs';
import { resolveHome } from '../utils/paths.js';
import { migrateSyncState } from '../sync/state.js';
import type { Config, DaemonConfig, SyncState } from '../sync/types.js';
import type { ConfigSyncConfig, ConfigDomain } from '../config-sync/types.js';
import { DEFAULT_CONFIG_SYNC_CONFIG } from '../config-sync/types.js';
import type { IDEFamily } from '../detectors/types.js';

const CONFIG_DIR = resolveHome('.ide-sync');
const CONFIG_FILE = resolveHome('.ide-sync', 'config.json');
export const LAST_SYNCED_FILE = resolveHome('.ide-sync', 'last-synced-state.json');
export const DAEMON_PID_FILE = resolveHome('.ide-sync', 'daemon.pid');
export const DAEMON_SOCK_FILE = resolveHome('.ide-sync', 'daemon.sock');
export const DAEMON_LOG_DIR = resolveHome('.ide-sync', 'logs');

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  enabled: true,
  debounceMs: 10_000,
  maxDebounceMs: 60_000,
  periodicPullCron: '*/5 * * * *',
  pausedUntil: null,
  autoApplyLargeChanges: false,
  largeChangeThresholdPercent: 50,
  notifications: {
    enabled: true,
    onSync: false,
    onConflict: true,
    onError: true,
  },
};

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

export function getDaemonConfig(config: Config): DaemonConfig {
  return { ...DEFAULT_DAEMON_CONFIG, ...config.daemon };
}

export function writeDaemonConfig(daemonCfg: Partial<DaemonConfig>): void {
  const config = readConfig();
  config.daemon = { ...DEFAULT_DAEMON_CONFIG, ...config.daemon, ...daemonCfg };
  writeConfig(config);
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

// ─────────────────────────── config-sync ─────────────────────────────

const CONFIG_SYNC_FILE = resolveHome('.ide-sync', 'config-sync.json');

export function readConfigSyncConfig(): ConfigSyncConfig {
  if (!fs.existsSync(CONFIG_SYNC_FILE)) return { ...DEFAULT_CONFIG_SYNC_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_SYNC_FILE, 'utf8')) as Partial<ConfigSyncConfig>;
    return { ...DEFAULT_CONFIG_SYNC_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG_SYNC_CONFIG };
  }
}

export function writeConfigSyncConfig(cfg: ConfigSyncConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_SYNC_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

export function enableConfigDomain(domain: ConfigDomain, ide?: IDEFamily): void {
  const cfg = readConfigSyncConfig();
  if (!cfg.enabledDomains.includes(domain)) {
    cfg.enabledDomains.push(domain);
  }
  if (ide) {
    const optOuts = cfg.domainOptOuts[ide] ?? [];
    cfg.domainOptOuts[ide] = optOuts.filter((d) => d !== domain);
  }
  writeConfigSyncConfig(cfg);
}

export function disableConfigDomain(domain: ConfigDomain, ide?: IDEFamily): void {
  const cfg = readConfigSyncConfig();
  if (ide) {
    const optOuts = cfg.domainOptOuts[ide] ?? [];
    if (!optOuts.includes(domain)) {
      cfg.domainOptOuts[ide] = [...optOuts, domain];
    }
  } else {
    cfg.enabledDomains = cfg.enabledDomains.filter((d) => d !== domain);
  }
  writeConfigSyncConfig(cfg);
}
