/**
 * Headless status — structured drift summary, no console output.
 * Backs the CLI's interactive `status` command and the desktop dashboard.
 */
import { readConfig, readLastSyncedState } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { buildInstalledSet } from '../sync/state.js';
import { threeWayMerge } from '../sync/engine.js';
import { createBackend } from '../sync/backends/index.js';
import type { ConflictItem, Config, Device, LocalAction, RemoteAction } from '../sync/types.js';

export interface StatusOptions {
  ide?: string;
}

export interface StatusResult {
  ok: boolean;
  device: { id: string; name: string };
  backend: Config['backend'];
  conflictPolicy: Config['conflictPolicy'];
  lastSyncedAt: string | null;
  /** False when the remote backend could not be reached at all. */
  remoteReachable: boolean;
  /** True when the backend is reachable but has no state yet. */
  remoteEmpty: boolean;
  toPush: RemoteAction[];
  toPull: LocalAction[];
  conflicts: ConflictItem[];
  devices: Device[];
  error?: string;
}

/** Headless status — read-only drift computation between local, base, and remote state. */
export async function runStatus(opts: StatusOptions = {}): Promise<StatusResult> {
  const config = readConfig();

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const base = readLastSyncedState();
  const lastSyncedAt = base?.devices[config.deviceId]?.lastSyncedAt ?? null;

  const backend = createBackend(config);

  let remote;
  try {
    remote = await backend.readState();
  } catch (err) {
    return {
      ok: false,
      device: { id: config.deviceId, name: config.deviceName },
      backend: config.backend,
      conflictPolicy: config.conflictPolicy,
      lastSyncedAt,
      remoteReachable: false,
      remoteEmpty: false,
      toPush: [],
      toPull: [],
      conflicts: [],
      devices: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (remote === null) {
    return {
      ok: true,
      device: { id: config.deviceId, name: config.deviceName },
      backend: config.backend,
      conflictPolicy: config.conflictPolicy,
      lastSyncedAt,
      remoteReachable: true,
      remoteEmpty: true,
      toPush: [],
      toPull: [],
      conflicts: [],
      devices: [],
    };
  }

  const inventories = runDetectors(families);
  const installed = buildInstalledSet(inventories);

  const plan = threeWayMerge({
    base,
    installed,
    remote,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    policy: config.conflictPolicy,
    tombstoneGCDays: config.tombstoneGCDays,
  });

  return {
    ok: true,
    device: { id: config.deviceId, name: config.deviceName },
    backend: config.backend,
    conflictPolicy: config.conflictPolicy,
    lastSyncedAt,
    remoteReachable: true,
    remoteEmpty: false,
    toPush: plan.remoteActions,
    toPull: plan.localActions,
    conflicts: plan.conflicts,
    devices: Object.values(remote.devices),
  };
}
