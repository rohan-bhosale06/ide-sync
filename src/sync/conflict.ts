import chalk from 'chalk';
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

const RULE = '─'.repeat(56);

export function formatConflictReport(conflicts: ConflictItem[]): string {
  if (conflicts.length === 0) return '';

  const lines: string[] = [
    '',
    `   ${chalk.yellow('⚠')}  ${chalk.bold(`${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} detected`)}`,
    `   ${RULE}`,
  ];

  for (const c of conflicts) {
    lines.push(`   ${chalk.cyan(c.extensionId)}`);

    if (c.kind === 'version-conflict') {
      lines.push(`     Kind:    version conflict`);
      if (c.baseVersion) lines.push(`     Base:    ${chalk.dim(c.baseVersion)}`);
      lines.push(`     Local:   ${chalk.green(c.localVersion ?? '?')}`);
      lines.push(`     Remote:  ${chalk.blue(c.remoteVersion ?? '?')}`);
    } else {
      lines.push(`     Kind:    resurrection (local add vs remote delete)`);
      lines.push(`     Local added:   ${chalk.green(c.localEntry?.addedAt ?? 'unknown')}`);
      lines.push(`     Remote removed: ${chalk.red(c.remoteTombstone?.removedAt ?? 'unknown')} by ${c.remoteTombstone?.removedBy ?? '?'}`);
    }

    if (c.resolution !== null) {
      const winner = c.resolution === 'keep-local' ? chalk.green('local') : chalk.blue('remote');
      lines.push(`     ${chalk.dim('→')} Auto-resolved: ${winner} wins`);
    } else {
      lines.push(`     ${chalk.red('→')} Unresolved — re-run with --conflict local|remote|newest to auto-resolve`);
    }

    lines.push('');
  }

  lines.push(`   ${RULE}`);
  return lines.join('\n');
}

export function hasUnresolvedConflicts(conflicts: ConflictItem[]): boolean {
  return conflicts.some((c) => c.resolution === null);
}
