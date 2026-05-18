import { describe, it, expect } from 'vitest';
import {
  resolveVersionConflict,
  resolveResurrectionConflict,
  formatConflictReport,
  hasUnresolvedConflicts,
} from '../../src/sync/conflict.js';
import type { SyncStateExtension, TombstoneEntry } from '../../src/sync/types.js';

const NOW = '2024-06-01T12:00:00.000Z';
const PAST = '2024-05-01T12:00:00.000Z';
const FAR_PAST = '2024-01-01T00:00:00.000Z';

function makeEntry(version: string, addedAt: string = PAST): SyncStateExtension {
  return {
    desiredVersion: version,
    families: ['vscode'],
    addedBy: 'dev-a',
    addedAt,
  };
}

function makeTombstone(removedAt: string = PAST): TombstoneEntry {
  return { removedBy: 'dev-b', removedAt };
}

describe('resolveVersionConflict', () => {
  const base = {
    extensionId: 'ext.a',
    localVersion: '1.0.0',
    remoteVersion: '2.0.0',
    localEntry: makeEntry('1.0.0', NOW),
    remoteEntry: makeEntry('2.0.0', PAST),
    policy: 'newest' as const,
  };

  it('manual policy returns null resolution', () => {
    const result = resolveVersionConflict({ ...base, policy: 'manual' });
    expect(result.resolution).toBeNull();
    expect(result.kind).toBe('version-conflict');
  });

  it('local policy returns keep-local', () => {
    const result = resolveVersionConflict({ ...base, policy: 'local' });
    expect(result.resolution).toBe('keep-local');
  });

  it('remote policy returns keep-remote', () => {
    const result = resolveVersionConflict({ ...base, policy: 'remote' });
    expect(result.resolution).toBe('keep-remote');
  });

  it('newest picks local when local addedAt is newer', () => {
    // localEntry.addedAt = NOW, remoteEntry.addedAt = PAST → local is newer
    const result = resolveVersionConflict({ ...base, policy: 'newest' });
    expect(result.resolution).toBe('keep-local');
  });

  it('newest picks remote when remote addedAt is newer', () => {
    const result = resolveVersionConflict({
      ...base,
      localEntry: makeEntry('1.0.0', FAR_PAST),  // older
      remoteEntry: makeEntry('2.0.0', NOW),        // newer
      policy: 'newest',
    });
    expect(result.resolution).toBe('keep-remote');
  });

  it('newest picks local on tie (same addedAt)', () => {
    const result = resolveVersionConflict({
      ...base,
      localEntry: makeEntry('1.0.0', NOW),
      remoteEntry: makeEntry('2.0.0', NOW),
      policy: 'newest',
    });
    // localTime >= remoteTime → keep-local
    expect(result.resolution).toBe('keep-local');
  });

  it('includes baseVersion when provided', () => {
    const result = resolveVersionConflict({ ...base, baseVersion: '0.5.0', policy: 'manual' });
    expect(result.baseVersion).toBe('0.5.0');
  });
});

describe('resolveResurrectionConflict', () => {
  const base = {
    extensionId: 'ext.zombie',
    localEntry: makeEntry('1.0.0', NOW),
    remoteTombstone: makeTombstone(PAST),
    policy: 'newest' as const,
  };

  it('manual policy returns null resolution', () => {
    const result = resolveResurrectionConflict({ ...base, policy: 'manual' });
    expect(result.resolution).toBeNull();
    expect(result.kind).toBe('resurrection');
  });

  it('local policy returns keep-local', () => {
    const result = resolveResurrectionConflict({ ...base, policy: 'local' });
    expect(result.resolution).toBe('keep-local');
  });

  it('remote policy returns keep-remote', () => {
    const result = resolveResurrectionConflict({ ...base, policy: 'remote' });
    expect(result.resolution).toBe('keep-remote');
  });

  it('newest keeps local when localEntry.addedAt > tombstone.removedAt', () => {
    // localEntry.addedAt = NOW (2024-06-01), tombstone.removedAt = PAST (2024-05-01)
    const result = resolveResurrectionConflict({ ...base, policy: 'newest' });
    expect(result.resolution).toBe('keep-local');
  });

  it('newest keeps remote (delete wins) when tombstone.removedAt > localEntry.addedAt', () => {
    const result = resolveResurrectionConflict({
      ...base,
      localEntry: makeEntry('1.0.0', FAR_PAST),   // old add
      remoteTombstone: makeTombstone(NOW),          // recent delete
      policy: 'newest',
    });
    expect(result.resolution).toBe('keep-remote');
  });

  it('newest keeps remote on tie (localTime == remoteTime)', () => {
    const result = resolveResurrectionConflict({
      ...base,
      localEntry: makeEntry('1.0.0', PAST),
      remoteTombstone: makeTombstone(PAST),
      policy: 'newest',
    });
    // localTime <= remoteTime → keep-remote
    expect(result.resolution).toBe('keep-remote');
  });
});

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

describe('hasUnresolvedConflicts', () => {
  it('returns false when no conflicts', () => {
    expect(hasUnresolvedConflicts([])).toBe(false);
  });

  it('returns false when all conflicts resolved', () => {
    const conflict = resolveVersionConflict({
      extensionId: 'ext.a',
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
      localEntry: makeEntry('1.0.0'),
      remoteEntry: makeEntry('2.0.0'),
      policy: 'local',
    });
    expect(hasUnresolvedConflicts([conflict])).toBe(false);
  });

  it('returns true when any conflict is unresolved', () => {
    const conflict = resolveVersionConflict({
      extensionId: 'ext.a',
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
      localEntry: makeEntry('1.0.0'),
      remoteEntry: makeEntry('2.0.0'),
      policy: 'manual',
    });
    expect(hasUnresolvedConflicts([conflict])).toBe(true);
  });
});
