import type { IDEFamily } from '../detectors/types.js';
import type { ConfigSyncState, ConfigDomain } from '../config-sync/types.js';

// ─────────────────────────── config ──────────────────────────────

export type ConflictPolicy = 'newest' | 'local' | 'remote' | 'manual';

export interface DaemonNotificationConfig {
  enabled: boolean;
  onSync: boolean;
  onConflict: boolean;
  onError: boolean;
}

export interface DaemonConfig {
  enabled: boolean;
  debounceMs: number;
  maxDebounceMs: number;
  periodicPullCron: string;
  pausedUntil: string | null;
  autoApplyLargeChanges: boolean;
  largeChangeThresholdPercent: number;
  notifications: DaemonNotificationConfig;
}

export interface Config {
  deviceId: string;
  deviceName: string;
  backend: 'git' | 'filesystem';
  gitRepoUrl?: string;
  filesystemPath?: string;
  conflictPolicy: ConflictPolicy;
  tombstoneGCDays: number;
  daemon?: DaemonConfig;
}

// ─────────────────────────── sync state ──────────────────────────

export interface TombstoneEntry {
  removedBy: string;   // device id
  removedAt: string;   // ISO
}

export interface SyncStateExtension {
  desiredVersion: string;         // semver or "latest"
  families: IDEFamily[];          // which IDE families should have this
  addedBy: string;                // device id
  addedAt: string;                // ISO
}

export interface Device {
  id: string;
  name: string;
  platform: NodeJS.Platform;
  lastSyncedAt: string | null;
  lastSyncedStateHash: string | null;
}

export interface SyncState {
  schemaVersion: 1 | 2;
  updatedAt: string;
  updatedByDevice: string;
  extensions: Record<string, SyncStateExtension>;
  removed: Record<string, TombstoneEntry>;
  devices: Record<string, Device>;
  // v2 additions — absent on v1 states (present after migration)
  configs?: ConfigSyncState;
  domainOptOuts?: Partial<Record<IDEFamily, ConfigDomain[]>>;
}

// ─────────────────────────── backend ─────────────────────────────

export interface SyncBackend {
  /** Read current remote state; null = no state seeded yet */
  readState(): Promise<SyncState | null>;
  /** Commit new state to remote */
  writeState(state: SyncState, message: string): Promise<void>;
  /** One-time setup (clone repo, create dir, etc.) */
  init(): Promise<void>;
  /** True if already initialised */
  isInitialized(): Promise<boolean>;
}

// ─────────────────────────── merge plan ──────────────────────────

export interface InstalledExtension {
  id: string;
  version: string;
  families: IDEFamily[];
}

export interface LocalAction {
  type: 'install-local' | 'uninstall-local';
  extensionId: string;
  desiredVersion?: string;    // for install-local
  families?: IDEFamily[];     // for install-local: which IDEs to target
  reason: string;
}

export interface RemoteAction {
  type: 'push-add' | 'push-remove' | 'push-version-update';
  extensionId: string;
  entry?: SyncStateExtension;    // push-add / push-version-update
  tombstone?: TombstoneEntry;    // push-remove
  reason: string;
}

export interface ConflictItem {
  extensionId: string;
  kind: 'version-conflict' | 'resurrection';
  localVersion?: string;
  remoteVersion?: string;
  baseVersion?: string;
  localEntry?: SyncStateExtension;
  remoteEntry?: SyncStateExtension;
  remoteTombstone?: TombstoneEntry;
  /** null = unresolved (manual policy); set = auto-resolved */
  resolution: 'keep-local' | 'keep-remote' | null;
}

export interface MergePlan {
  localActions: LocalAction[];
  remoteActions: RemoteAction[];
  conflicts: ConflictItem[];
  tombstonesToGC: string[];
}
