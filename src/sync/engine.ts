import type { IDEFamily } from '../detectors/types.js';
import { resolveVersionConflict, resolveResurrectionConflict } from './conflict.js';
import type {
  ConflictItem,
  ConflictPolicy,
  Device,
  InstalledExtension,
  LocalAction,
  MergePlan,
  RemoteAction,
  SyncState,
  SyncStateExtension,
  TombstoneEntry,
} from './types.js';

// ─────────────────────────── public input/output ─────────────────

export interface MergeInput {
  /** Last state this device successfully synced; null = never synced. */
  base: SyncState | null;
  /** Current extensions from Phase-1 scan. */
  installed: InstalledExtension[];
  /** Current remote state; null = remote is empty (first push). */
  remote: SyncState | null;
  deviceId: string;
  deviceName: string;
  policy: ConflictPolicy;
  tombstoneGCDays: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** If set, only extensions in this set (lowercased IDs) are reasoned about; everything else is left untouched. */
  profileIds?: Set<string>;
  /** Per-extension manual conflict decisions, keyed by extension ID. Only consulted when policy === 'manual'. */
  manualResolutions?: Record<string, 'keep-local' | 'keep-remote'>;
}

// ─────────────────────────── private helpers ─────────────────────

function mergeFamilies(a: IDEFamily[], b: IDEFamily[]): IDEFamily[] {
  const s = new Set<IDEFamily>([...a, ...b]);
  return Array.from(s);
}

function makeEntry(
  ext: InstalledExtension,
  deviceId: string,
  addedAt: string,
  existingEntry?: SyncStateExtension,
): SyncStateExtension {
  return {
    desiredVersion: ext.version,
    families: existingEntry
      ? mergeFamilies(ext.families, existingEntry.families)
      : ext.families,
    addedBy: existingEntry?.addedBy ?? deviceId,
    addedAt: existingEntry?.addedAt ?? addedAt,
  };
}

function shouldGCTombstone(
  tombstone: TombstoneEntry,
  devices: Record<string, Device>,
  gcDays: number,
  now: Date,
): boolean {
  const removedAt = new Date(tombstone.removedAt).getTime();
  const ageMs = now.getTime() - removedAt;
  if (ageMs < gcDays * 86_400_000) return false;

  // All known devices must have synced AFTER the tombstone date.
  for (const dev of Object.values(devices)) {
    if (dev.lastSyncedAt === null) return false;
    if (new Date(dev.lastSyncedAt).getTime() <= removedAt) return false;
  }
  return true;
}

// ─────────────────────────── 3-way merge ─────────────────────────

/**
 * Core merge engine.  Maps each extension ID to exactly one action per the
 * truth table documented in ARCHITECTURE.md / README.
 *
 * Key guarantees:
 *  - Never silently loses an extension.
 *  - Never silently resurrects a deleted one.
 *  - Every non-trivial decision is expressed as a LocalAction or RemoteAction
 *    with a human-readable `reason` string.
 */
export function threeWayMerge(input: MergeInput): MergePlan {
  const {
    base,
    installed,
    remote,
    deviceId,
    deviceName,
    policy,
    tombstoneGCDays,
    now = new Date(),
    profileIds,
    manualResolutions,
  } = input;

  const nowISO = now.toISOString();
  const localActions: LocalAction[] = [];
  const remoteActions: RemoteAction[] = [];
  const conflicts: ConflictItem[] = [];
  const tombstonesToGC: string[] = [];

  // Fast-path: no remote state at all (first push ever).
  if (remote === null) {
    for (const ext of installed) {
      if (profileIds && !profileIds.has(ext.id.toLowerCase())) continue;
      remoteActions.push({
        type: 'push-add',
        extensionId: ext.id,
        entry: makeEntry(ext, deviceId, nowISO),
        reason: 'first push — seeding remote',
      });
    }
    return { localActions, remoteActions, conflicts, tombstonesToGC };
  }

  // Build lookup structures.
  const installedMap = new Map<string, InstalledExtension>(
    installed.map((e) => [e.id.toLowerCase(), e]),
  );
  const baseExt = base?.extensions ?? {};
  const baseRemoved = base?.removed ?? {};
  const remoteExt = remote.extensions;
  const remoteRemoved = remote.removed;
  const allDevices = { ...remote.devices };

  // Universe of all IDs we need to reason about.
  const allIds = new Set<string>([
    ...Object.keys(baseExt),
    ...Array.from(installedMap.keys()),
    ...Object.keys(remoteExt),
    ...Object.keys(baseRemoved),
    ...Object.keys(remoteRemoved),
  ]);

  for (const id of allIds) {
    if (profileIds && !profileIds.has(id.toLowerCase())) continue;

    const inBase = id in baseExt;
    const inInstalled = installedMap.has(id);
    const inRemote = id in remoteExt;
    const inBaseRemoved = id in baseRemoved;
    const inRemoteRemoved = id in remoteRemoved;

    const baseEntry = baseExt[id];
    const installedEntry = installedMap.get(id);
    const remoteEntry = remoteExt[id];
    const remoteTombstone = remoteRemoved[id];

    // ── Cases where base has an entry for this ID ─────────────────
    if (inBase) {
      if (inInstalled && inRemote) {
        // All three have it — version delta detection.
        const baseVer = baseEntry!.desiredVersion;
        const localVer = installedEntry!.version;
        const remoteVer = remoteEntry!.desiredVersion;
        const localChanged = localVer !== baseVer;
        const remoteChanged = remoteVer !== baseVer;

        // Always merge families in case this device gained a new IDE.
        const mergedFamilies = mergeFamilies(installedEntry!.families, remoteEntry!.families);
        const familiesChanged =
          mergedFamilies.length !== remoteEntry!.families.length ||
          mergedFamilies.some((f) => !remoteEntry!.families.includes(f));

        if (!localChanged && !remoteChanged) {
          // Identical — only push if families need updating.
          if (familiesChanged) {
            remoteActions.push({
              type: 'push-version-update',
              extensionId: id,
              entry: { ...remoteEntry!, families: mergedFamilies },
              reason: 'merged new IDE family into remote entry',
            });
          }
        } else if (!localChanged && remoteChanged) {
          // Remote updated — accept it locally if actually different.
          if (remoteVer !== localVer) {
            localActions.push({
              type: 'install-local',
              extensionId: id,
              desiredVersion: remoteVer,
              families: installedEntry!.families,
              reason: `remote updated to ${remoteVer}`,
            });
          }
        } else if (localChanged && !remoteChanged) {
          // Local updated — push to remote.
          remoteActions.push({
            type: 'push-version-update',
            extensionId: id,
            entry: {
              ...remoteEntry!,
              desiredVersion: localVer,
              families: mergedFamilies,
            },
            reason: `local updated to ${localVer}`,
          });
        } else {
          // Both changed.
          if (localVer === remoteVer) {
            // Converged independently — no conflict, maybe update families.
            if (familiesChanged) {
              remoteActions.push({
                type: 'push-version-update',
                extensionId: id,
                entry: { ...remoteEntry!, families: mergedFamilies },
                reason: 'merged new IDE family (both sides updated to same version)',
              });
            }
          } else {
            const conflict = resolveVersionConflict({
              extensionId: id,
              localVersion: localVer,
              remoteVersion: remoteVer,
              baseVersion: baseEntry!.desiredVersion,
              localEntry: makeEntry(installedEntry!, deviceId, nowISO, remoteEntry),
              remoteEntry: remoteEntry!,
              policy,
              manualResolutions,
            });
            conflicts.push(conflict);
            if (conflict.resolution === 'keep-remote') {
              localActions.push({
                type: 'install-local',
                extensionId: id,
                desiredVersion: remoteVer,
                families: installedEntry!.families,
                reason: `conflict resolved (${policy}): accepting remote ${remoteVer}`,
              });
            } else if (conflict.resolution === 'keep-local') {
              remoteActions.push({
                type: 'push-version-update',
                extensionId: id,
                entry: { ...remoteEntry!, desiredVersion: localVer, families: mergedFamilies },
                reason: `conflict resolved (${policy}): pushing local ${localVer}`,
              });
            }
          }
        }
      } else if (inInstalled && !inRemote && !inRemoteRemoved) {
        // Remote lost it without a tombstone — push it back (conservative: don't silently lose).
        remoteActions.push({
          type: 'push-add',
          extensionId: id,
          entry: makeEntry(installedEntry!, deviceId, nowISO),
          reason: 'remote missing entry without tombstone — restoring',
        });
      } else if (inInstalled && !inRemote && inRemoteRemoved) {
        // Remote deleted; local still has it.
        const baseVer = baseEntry!.desiredVersion;
        const localVer = installedEntry!.version;
        const localChangedSinceBase = localVer !== baseVer;

        if (localChangedSinceBase) {
          // User explicitly updated this extension after our last sync, then another
          // machine deleted it — genuine resurrection conflict.
          const conflict = resolveResurrectionConflict({
            extensionId: id,
            localEntry: makeEntry(installedEntry!, deviceId, nowISO),
            remoteTombstone: remoteTombstone!,
            policy,
            manualResolutions,
          });
          conflicts.push(conflict);
          if (conflict.resolution === 'keep-local') {
            remoteActions.push({
              type: 'push-add',
              extensionId: id,
              entry: makeEntry(installedEntry!, deviceId, nowISO),
              reason: `resurrection conflict resolved (${policy}): local re-add wins`,
            });
          } else if (conflict.resolution === 'keep-remote') {
            localActions.push({
              type: 'uninstall-local',
              extensionId: id,
              reason: `resurrection conflict resolved (${policy}): remote delete wins`,
            });
          }
        } else {
          // Local unchanged — accept remote deletion.
          localActions.push({
            type: 'uninstall-local',
            extensionId: id,
            reason: `remotely deleted by device ${remoteTombstone!.removedBy}`,
          });
        }
      } else if (!inInstalled && inRemote && !inRemoteRemoved) {
        // Locally deleted since base — write tombstone to remote.
        remoteActions.push({
          type: 'push-remove',
          extensionId: id,
          tombstone: { removedBy: deviceId, removedAt: nowISO },
          reason: 'deleted locally since last sync',
        });
      } else if (!inInstalled && !inRemote && !inRemoteRemoved) {
        // Both sides no longer have it and no tombstone — nothing to do.
      } else if (!inInstalled && !inRemote && inRemoteRemoved) {
        // Both deleted; tombstone already in remote — GC candidate.
        if (shouldGCTombstone(remoteTombstone!, allDevices, tombstoneGCDays, now)) {
          tombstonesToGC.push(id);
        }
      }
      // (inBase && !inInstalled && inRemote && inRemoteRemoved) → contradictory remote;
      // extension wins (conservative). Already covered by inInstalled branches above.

    } else if (inBaseRemoved) {
      // This ID was in our own previous tombstone list — already tracked. GC check.
      if (!inRemote && !inInstalled) {
        const ownTombstone = baseRemoved[id];
        const checkTombstone = inRemoteRemoved ? remoteTombstone! : ownTombstone;
        if (shouldGCTombstone(checkTombstone, allDevices, tombstoneGCDays, now)) {
          tombstonesToGC.push(id);
        }
      }
    } else {
      // ── Cases where base has NO entry (new since last sync or first sync) ──

      if (inInstalled && !inRemote && !inRemoteRemoved) {
        // Locally added — push to remote.
        remoteActions.push({
          type: 'push-add',
          extensionId: id,
          entry: makeEntry(installedEntry!, deviceId, nowISO),
          reason: 'added locally since last sync',
        });
      } else if (inInstalled && inRemote && !inRemoteRemoved) {
        // Both added independently (or concurrent).
        const localVer = installedEntry!.version;
        const remoteVer = remoteEntry!.desiredVersion;
        const mergedFamilies = mergeFamilies(installedEntry!.families, remoteEntry!.families);

        if (localVer === remoteVer) {
          // Same version — no conflict; merge families if needed.
          if (mergedFamilies.some((f) => !remoteEntry!.families.includes(f))) {
            remoteActions.push({
              type: 'push-version-update',
              extensionId: id,
              entry: { ...remoteEntry!, families: mergedFamilies },
              reason: 'merged families from concurrent add (same version)',
            });
          }
        } else {
          const conflict = resolveVersionConflict({
            extensionId: id,
            localVersion: localVer,
            remoteVersion: remoteVer,
            localEntry: makeEntry(installedEntry!, deviceId, nowISO),
            remoteEntry: remoteEntry!,
            policy,
            manualResolutions,
          });
          conflicts.push(conflict);
          if (conflict.resolution === 'keep-remote') {
            localActions.push({
              type: 'install-local',
              extensionId: id,
              desiredVersion: remoteVer,
              families: installedEntry!.families,
              reason: `conflict resolved (${policy}): accepting remote ${remoteVer}`,
            });
          } else if (conflict.resolution === 'keep-local') {
            remoteActions.push({
              type: 'push-version-update',
              extensionId: id,
              entry: { ...remoteEntry!, desiredVersion: localVer, families: mergedFamilies },
              reason: `conflict resolved (${policy}): pushing local ${localVer}`,
            });
          }
        }
      } else if (inInstalled && !inRemote && inRemoteRemoved) {
        // Locally installed but remote has a tombstone for it.
        const conflict = resolveResurrectionConflict({
          extensionId: id,
          localEntry: makeEntry(installedEntry!, deviceId, nowISO),
          remoteTombstone: remoteTombstone!,
          policy,
          manualResolutions,
        });
        conflicts.push(conflict);
        if (conflict.resolution === 'keep-local') {
          remoteActions.push({
            type: 'push-add',
            extensionId: id,
            entry: makeEntry(installedEntry!, deviceId, nowISO),
            reason: `resurrection conflict resolved (${policy}): local re-add wins`,
          });
        } else if (conflict.resolution === 'keep-remote') {
          localActions.push({
            type: 'uninstall-local',
            extensionId: id,
            reason: `resurrection conflict resolved (${policy}): remote delete wins`,
          });
        }
      } else if (!inInstalled && inRemote && !inRemoteRemoved) {
        // Remotely added — install locally.
        localActions.push({
          type: 'install-local',
          extensionId: id,
          desiredVersion: remoteEntry!.desiredVersion,
          families: remoteEntry!.families,
          reason: 'added remotely',
        });
      } else if (!inInstalled && !inRemote && inRemoteRemoved) {
        // Remote tombstone only; nothing local to delete — no-op.
      }
      // (!inInstalled && !inRemote && !inRemoteRemoved) → impossible in practice.
    }
  }

  // Deduplicate tombstone GC list (same id can appear from multiple branches).
  const uniqueGC = Array.from(new Set(tombstonesToGC));

  return {
    localActions,
    remoteActions,
    conflicts,
    tombstonesToGC: uniqueGC,
  };
}

// ─────────────────────────── state application ───────────────────

/**
 * Apply remoteActions from a MergePlan onto `remote` (or an empty base)
 * to produce the new SyncState to push.
 *
 * Does NOT update `lastSyncedStateHash` — the caller sets that after a
 * successful apply (both local installs and remote push).
 */
export function applyRemotePlan(
  remote: SyncState | null,
  plan: MergePlan,
  deviceId: string,
  deviceName: string,
  now: Date = new Date(),
): SyncState {
  const nowISO = now.toISOString();

  const extensions: Record<string, SyncStateExtension> = {
    ...(remote?.extensions ?? {}),
  };
  const removed: Record<string, TombstoneEntry> = {
    ...(remote?.removed ?? {}),
  };
  const devices: Record<string, Device> = {
    ...(remote?.devices ?? {}),
  };

  for (const action of plan.remoteActions) {
    if (action.type === 'push-add') {
      extensions[action.extensionId] = action.entry!;
      delete removed[action.extensionId]; // clear any tombstone
    } else if (action.type === 'push-remove') {
      removed[action.extensionId] = action.tombstone!;
      delete extensions[action.extensionId];
    } else if (action.type === 'push-version-update') {
      if (extensions[action.extensionId]) {
        extensions[action.extensionId] = action.entry!;
      }
    }
  }

  // Remove GC'd tombstones.
  for (const id of plan.tombstonesToGC) {
    delete removed[id];
  }

  // Upsert this device's record (lastSyncedAt / hash updated by caller).
  devices[deviceId] = {
    id: deviceId,
    name: deviceName,
    platform: process.platform,
    lastSyncedAt: devices[deviceId]?.lastSyncedAt ?? null,
    lastSyncedStateHash: devices[deviceId]?.lastSyncedStateHash ?? null,
  };

  return {
    schemaVersion: 1,
    updatedAt: nowISO,
    updatedByDevice: deviceId,
    extensions,
    removed,
    devices,
  };
}

/** Stamp `lastSyncedAt` and `lastSyncedStateHash` for this device in the state. */
export function stampDevice(
  state: SyncState,
  deviceId: string,
  deviceName: string,
  hash: string,
  now: Date = new Date(),
): SyncState {
  return {
    ...state,
    devices: {
      ...state.devices,
      [deviceId]: {
        id: deviceId,
        name: deviceName,
        platform: process.platform,
        lastSyncedAt: now.toISOString(),
        lastSyncedStateHash: hash,
      },
    },
  };
}
