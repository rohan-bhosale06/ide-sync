import chalk from 'chalk';
import type { ConflictItem } from 'ide-sync-core';

const RULE = '─'.repeat(56);

/** Render a human-readable, colorized conflict report for the terminal. */
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
