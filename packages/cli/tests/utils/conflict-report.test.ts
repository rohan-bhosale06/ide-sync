import { describe, it, expect } from 'vitest';
import { resolveVersionConflict, resolveResurrectionConflict } from 'ide-sync-core';
import type { SyncStateExtension, TombstoneEntry } from 'ide-sync-core';
import { formatConflictReport } from '../../src/utils/conflict-report.js';

const PAST = '2024-05-01T12:00:00.000Z';

function makeEntry(version: string, addedAt: string = PAST): SyncStateExtension {
  return { desiredVersion: version, families: ['vscode'], addedBy: 'dev-a', addedAt };
}

function makeTombstone(removedAt: string = PAST): TombstoneEntry {
  return { removedBy: 'dev-b', removedAt };
}

describe('formatConflictReport', () => {
  it('returns empty string for no conflicts', () => {
    expect(formatConflictReport([])).toBe('');
  });

  it('includes extension id in output', () => {
    const conflict = resolveVersionConflict({
      extensionId: 'my.ext',
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
      localEntry: makeEntry('1.0.0'),
      remoteEntry: makeEntry('2.0.0'),
      policy: 'manual',
    });
    const report = formatConflictReport([conflict]);
    expect(report).toContain('my.ext');
    expect(report).toContain('version conflict');
  });

  it('shows resurrection details', () => {
    const conflict = resolveResurrectionConflict({
      extensionId: 'zombie.ext',
      localEntry: makeEntry('1.0.0'),
      remoteTombstone: makeTombstone(),
      policy: 'manual',
    });
    const report = formatConflictReport([conflict]);
    expect(report).toContain('zombie.ext');
    expect(report).toContain('resurrection');
  });

  it('shows auto-resolution when policy resolves it', () => {
    const conflict = resolveVersionConflict({
      extensionId: 'my.ext',
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
      localEntry: makeEntry('1.0.0'),
      remoteEntry: makeEntry('2.0.0'),
      policy: 'local',
    });
    const report = formatConflictReport([conflict]);
    expect(report).toContain('Auto-resolved');
  });
});
