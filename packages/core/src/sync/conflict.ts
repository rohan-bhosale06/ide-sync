import type { ConflictItem, ConflictPolicy, SyncStateExtension, TombstoneEntry } from './types.js';

// ─────────────────────────── resolution ──────────────────────────

/**
 * Apply the configured policy to produce a resolution.
 * Returns `null` for manual policy (caller must abort and let user decide).
 */
export function resolveVersionConflict(opts: {
  extensionId: string;
  localVersion: string;
  remoteVersion: string;
  baseVersion?: string;
  localEntry: SyncStateExtension;
  remoteEntry: SyncStateExtension;
  policy: ConflictPolicy;
  /** Per-extension manual decisions, keyed by extension ID. Only consulted when policy === 'manual'. */
  manualResolutions?: Record<string, 'keep-local' | 'keep-remote'>;
}): ConflictItem {
  const { extensionId, localVersion, remoteVersion, baseVersion, localEntry, remoteEntry, policy, manualResolutions } = opts;

  const item: ConflictItem = {
    extensionId,
    kind: 'version-conflict',
    localVersion,
    remoteVersion,
    baseVersion,
    localEntry,
    remoteEntry,
    resolution: null,
  };

  if (policy === 'manual') {
    const decision = manualResolutions?.[extensionId];
    return decision ? { ...item, resolution: decision } : item;
  }
  if (policy === 'local') return { ...item, resolution: 'keep-local' };
  if (policy === 'remote') return { ...item, resolution: 'keep-remote' };

  // newest: compare addedAt timestamps; newer wins
  const localTime = new Date(localEntry.addedAt).getTime();
  const remoteTime = new Date(remoteEntry.addedAt).getTime();
  item.resolution = localTime >= remoteTime ? 'keep-local' : 'keep-remote';
  return item;
}

/**
 * Resurrection = one side explicitly deleted, the other re-added (or never saw the delete).
 * Conservative default for `newest`: remote delete wins (propagate intentional deletions).
 * Local wins only if policy is 'local'.
 */
export function resolveResurrectionConflict(opts: {
  extensionId: string;
  localEntry: SyncStateExtension;
  remoteTombstone: TombstoneEntry;
  policy: ConflictPolicy;
  /** Per-extension manual decisions, keyed by extension ID. Only consulted when policy === 'manual'. */
  manualResolutions?: Record<string, 'keep-local' | 'keep-remote'>;
}): ConflictItem {
  const { extensionId, localEntry, remoteTombstone, policy, manualResolutions } = opts;

  const item: ConflictItem = {
    extensionId,
    kind: 'resurrection',
    localEntry,
    remoteTombstone,
    resolution: null,
  };

  if (policy === 'manual') {
    const decision = manualResolutions?.[extensionId];
    return decision ? { ...item, resolution: decision } : item;
  }
  if (policy === 'local') return { ...item, resolution: 'keep-local' };
  if (policy === 'remote') return { ...item, resolution: 'keep-remote' };

  // newest: compare local addedAt vs tombstone removedAt
  const localTime = new Date(localEntry.addedAt).getTime();
  const remoteTime = new Date(remoteTombstone.removedAt).getTime();
  // Tie goes to keep-remote (delete propagates)
  item.resolution = localTime > remoteTime ? 'keep-local' : 'keep-remote';
  return item;
}

// ─────────────────────────── reporting ───────────────────────────

export function hasUnresolvedConflicts(conflicts: ConflictItem[]): boolean {
  return conflicts.some((c) => c.resolution === null);
}
