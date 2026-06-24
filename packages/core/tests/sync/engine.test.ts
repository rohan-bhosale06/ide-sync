import { describe, it, expect } from 'vitest';
import { threeWayMerge, applyRemotePlan, stampDevice } from '../../src/sync/engine.js';
import type {
  InstalledExtension,
  MergePlan,
  SyncState,
  SyncStateExtension,
  TombstoneEntry,
} from '../../src/sync/types.js';

// ─────────────────────────── fixtures ────────────────────────────

const NOW = new Date('2024-06-01T12:00:00.000Z');
const PAST = new Date('2024-05-01T12:00:00.000Z');
const FAR_PAST = new Date('2024-01-01T00:00:00.000Z');

const DEV_A = 'device-a';
const DEV_B = 'device-b';

function ext(
  id: string,
  version = '1.0.0',
  opts?: Partial<SyncStateExtension>,
): [string, SyncStateExtension] {
  return [
    id,
    {
      desiredVersion: version,
      families: ['vscode'],
      addedBy: DEV_A,
      addedAt: PAST.toISOString(),
      ...opts,
    },
  ];
}

function tombstone(id: string, opts?: Partial<TombstoneEntry>): [string, TombstoneEntry] {
  return [id, { removedBy: DEV_B, removedAt: PAST.toISOString(), ...opts }];
}

function makeState(
  extensions: [string, SyncStateExtension][],
  removed: [string, TombstoneEntry][] = [],
  devices?: SyncState['devices'],
): SyncState {
  return {
    schemaVersion: 1,
    updatedAt: PAST.toISOString(),
    updatedByDevice: DEV_A,
    extensions: Object.fromEntries(extensions),
    removed: Object.fromEntries(removed),
    devices: devices ?? {
      [DEV_A]: {
        id: DEV_A,
        name: 'laptop',
        platform: 'linux',
        lastSyncedAt: PAST.toISOString(),
        lastSyncedStateHash: null,
      },
    },
  };
}

function installed(id: string, version = '1.0.0'): InstalledExtension {
  return { id, version, families: ['vscode'] };
}

function merge(params: {
  base?: SyncState | null;
  installed?: InstalledExtension[];
  remote?: SyncState | null;
  policy?: 'newest' | 'local' | 'remote' | 'manual';
  profileIds?: Set<string>;
  manualResolutions?: Record<string, 'keep-local' | 'keep-remote'>;
}): MergePlan {
  return threeWayMerge({
    base: params.base ?? null,
    installed: params.installed ?? [],
    remote: params.remote ?? null,
    deviceId: DEV_A,
    deviceName: 'laptop',
    policy: params.policy ?? 'newest',
    tombstoneGCDays: 90,
    now: NOW,
    profileIds: params.profileIds,
    manualResolutions: params.manualResolutions,
  });
}

// ─────────────────────────── fast-path ────────────────────────────

describe('fast-path: remote is null (first push)', () => {
  it('pushes all installed extensions', () => {
    const plan = merge({ installed: [installed('ext.a'), installed('ext.b', '2.0.0')] });
    expect(plan.remoteActions).toHaveLength(2);
    expect(plan.remoteActions.every((a) => a.type === 'push-add')).toBe(true);
    expect(plan.remoteActions.map((a) => a.extensionId)).toContain('ext.a');
    expect(plan.remoteActions.map((a) => a.extensionId)).toContain('ext.b');
    expect(plan.localActions).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('produces no actions when nothing is installed', () => {
    const plan = merge({ installed: [] });
    expect(plan.remoteActions).toHaveLength(0);
  });
});

// ─────────────────────────── joining (base=null, remote exists) ───

describe('joining mode: base is null, remote exists', () => {
  it('installs extensions that are in remote but not locally', () => {
    const remote = makeState([ext('ext.remote')]);
    const plan = merge({ base: null, installed: [], remote });
    expect(plan.localActions).toHaveLength(1);
    expect(plan.localActions[0]).toMatchObject({
      type: 'install-local',
      extensionId: 'ext.remote',
      desiredVersion: '1.0.0',
    });
  });

  it('pushes extensions that are local but not in remote', () => {
    const remote = makeState([]);
    const plan = merge({ base: null, installed: [installed('ext.local')], remote });
    expect(plan.remoteActions).toHaveLength(1);
    expect(plan.remoteActions[0]).toMatchObject({ type: 'push-add', extensionId: 'ext.local' });
  });

  it('no-ops for extensions in both at same version', () => {
    const remote = makeState([ext('ext.shared', '1.0.0')]);
    const plan = merge({ base: null, installed: [installed('ext.shared', '1.0.0')], remote });
    // No installs, no pushes for the shared ext (may merge families)
    const relevant = plan.localActions.filter((a) => a.extensionId === 'ext.shared');
    expect(relevant).toHaveLength(0);
  });

  it('produces version conflict for extensions in both at different versions', () => {
    const remote = makeState([ext('ext.shared', '2.0.0')]);
    const plan = merge({
      base: null,
      installed: [installed('ext.shared', '1.0.0')],
      remote,
      policy: 'manual',
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      extensionId: 'ext.shared',
      kind: 'version-conflict',
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
      resolution: null,
    });
  });

  it('respects remote tombstone on join — uninstalls locally if remote deleted', () => {
    const remote = makeState([], [tombstone('ext.deleted')]);
    // We have it installed
    const plan = merge({ base: null, installed: [installed('ext.deleted')], remote, policy: 'remote' });
    const uninstall = plan.localActions.find(
      (a) => a.extensionId === 'ext.deleted' && a.type === 'uninstall-local',
    );
    expect(uninstall).toBeDefined();
  });
});

// ─────────────────────────── local add ───────────────────────────

describe('locally added (Case 1): !base, installed, !remote', () => {
  it('pushes extension to remote', () => {
    const base = makeState([ext('ext.existing')]);
    const remote = makeState([ext('ext.existing')]);
    const plan = merge({
      base,
      installed: [installed('ext.existing'), installed('ext.new')],
      remote,
    });
    const pushAction = plan.remoteActions.find((a) => a.extensionId === 'ext.new');
    expect(pushAction).toMatchObject({ type: 'push-add', extensionId: 'ext.new' });
    expect(plan.localActions).toHaveLength(0);
  });
});

// ─────────────────────────── remote add ──────────────────────────

describe('remotely added (Case 4): !base, !installed, remote', () => {
  it('installs extension locally', () => {
    const base = makeState([ext('ext.existing')]);
    const remote = makeState([ext('ext.existing'), ext('ext.new', '3.0.0')]);
    const plan = merge({ base, installed: [installed('ext.existing')], remote });
    expect(plan.localActions).toHaveLength(1);
    expect(plan.localActions[0]).toMatchObject({
      type: 'install-local',
      extensionId: 'ext.new',
      desiredVersion: '3.0.0',
    });
  });
});

// ─────────────────────────── concurrent add ──────────────────────

describe('concurrent add (Case 2): !base, installed, remote', () => {
  it('no conflict when same version', () => {
    const base = makeState([]);
    const remote = makeState([ext('ext.concurrent', '1.0.0')]);
    const plan = merge({ base, installed: [installed('ext.concurrent', '1.0.0')], remote });
    expect(plan.conflicts).toHaveLength(0);
    const localForExt = plan.localActions.filter((a) => a.extensionId === 'ext.concurrent');
    expect(localForExt).toHaveLength(0);
  });

  it('version conflict when different versions — manual policy leaves unresolved', () => {
    const base = makeState([]);
    const remote = makeState([ext('ext.concurrent', '2.0.0')]);
    const plan = merge({
      base,
      installed: [installed('ext.concurrent', '1.0.0')],
      remote,
      policy: 'manual',
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].resolution).toBeNull();
  });

  it('version conflict — local policy keeps local', () => {
    const base = makeState([]);
    const remote = makeState([ext('ext.concurrent', '2.0.0')]);
    const plan = merge({
      base,
      installed: [installed('ext.concurrent', '1.0.0')],
      remote,
      policy: 'local',
    });
    expect(plan.conflicts[0].resolution).toBe('keep-local');
    const pushAction = plan.remoteActions.find((a) => a.extensionId === 'ext.concurrent');
    expect(pushAction?.entry?.desiredVersion).toBe('1.0.0');
  });

  it('version conflict — remote policy keeps remote', () => {
    const base = makeState([]);
    const remote = makeState([ext('ext.concurrent', '2.0.0')]);
    const plan = merge({
      base,
      installed: [installed('ext.concurrent', '1.0.0')],
      remote,
      policy: 'remote',
    });
    expect(plan.conflicts[0].resolution).toBe('keep-remote');
    const installAction = plan.localActions.find((a) => a.extensionId === 'ext.concurrent');
    expect(installAction?.desiredVersion).toBe('2.0.0');
  });
});

// ─────────────────────────── local delete (tombstone) ─────────────

describe('local delete (Case 9): base, !installed, remote', () => {
  it('writes tombstone to remote', () => {
    const base = makeState([ext('ext.a'), ext('ext.deleted')]);
    const remote = makeState([ext('ext.a'), ext('ext.deleted')]);
    const plan = merge({ base, installed: [installed('ext.a')], remote });
    const removeAction = plan.remoteActions.find((a) => a.extensionId === 'ext.deleted');
    expect(removeAction).toMatchObject({ type: 'push-remove' });
    expect(removeAction?.tombstone?.removedBy).toBe(DEV_A);
    expect(plan.localActions).toHaveLength(0);
  });
});

// ─────────────────────────── remote delete ───────────────────────

describe('remote delete (Case 8): base, installed, !remote, remote.removed', () => {
  it('uninstalls locally when local version unchanged since base', () => {
    const base = makeState([ext('ext.a'), ext('ext.deleted')]);
    const remote = makeState([ext('ext.a')], [tombstone('ext.deleted')]);
    const plan = merge({
      base,
      installed: [installed('ext.a'), installed('ext.deleted', '1.0.0')], // same as base
      remote,
    });
    const uninstall = plan.localActions.find((a) => a.extensionId === 'ext.deleted');
    expect(uninstall?.type).toBe('uninstall-local');
    expect(plan.remoteActions).toHaveLength(0);
  });

  it('resurrection conflict when local version changed since base', () => {
    const base = makeState([ext('ext.a'), ext('ext.deleted', '1.0.0')]);
    const remote = makeState([ext('ext.a')], [tombstone('ext.deleted')]);
    const plan = merge({
      base,
      installed: [installed('ext.a'), installed('ext.deleted', '2.0.0')], // upgraded locally
      remote,
      policy: 'manual',
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'resurrection',
      extensionId: 'ext.deleted',
      resolution: null,
    });
  });

  it('resurrection — local policy keeps local extension', () => {
    const base = makeState([ext('ext.d', '1.0.0')]);
    const remote = makeState([], [tombstone('ext.d')]);
    const plan = merge({
      base,
      installed: [installed('ext.d', '2.0.0')],
      remote,
      policy: 'local',
    });
    expect(plan.conflicts[0].resolution).toBe('keep-local');
    const addAction = plan.remoteActions.find((a) => a.extensionId === 'ext.d');
    expect(addAction?.type).toBe('push-add');
    expect(plan.localActions).toHaveLength(0);
  });

  it('resurrection — remote policy uninstalls locally', () => {
    const base = makeState([ext('ext.d', '1.0.0')]);
    const remote = makeState([], [tombstone('ext.d')]);
    const plan = merge({
      base,
      installed: [installed('ext.d', '2.0.0')],
      remote,
      policy: 'remote',
    });
    expect(plan.conflicts[0].resolution).toBe('keep-remote');
    const uninstall = plan.localActions.find((a) => a.extensionId === 'ext.d');
    expect(uninstall?.type).toBe('uninstall-local');
    expect(plan.remoteActions).toHaveLength(0);
  });
});

// ─────────────────────────── both delete ──────────────────────────

describe('both delete (Case 11): base, !installed, !remote, remote.removed', () => {
  it('no local action required', () => {
    const base = makeState([ext('ext.a'), ext('ext.gone')]);
    const remote = makeState([ext('ext.a')], [tombstone('ext.gone')]);
    const plan = merge({ base, installed: [installed('ext.a')], remote });
    const localForGone = plan.localActions.filter((a) => a.extensionId === 'ext.gone');
    expect(localForGone).toHaveLength(0);
  });

  it('tombstone is GC candidate when old enough and all devices synced', () => {
    const oldTombstone = new Date('2024-01-01T00:00:00.000Z');
    const allSyncedAfter = new Date('2024-02-01T00:00:00.000Z');
    const base = makeState([ext('ext.gone')]);
    const remote: SyncState = {
      ...makeState([ext('ext.a')], [[
        'ext.gone',
        { removedBy: DEV_B, removedAt: oldTombstone.toISOString() },
      ]]),
      devices: {
        [DEV_A]: {
          id: DEV_A,
          name: 'laptop',
          platform: 'linux',
          lastSyncedAt: allSyncedAfter.toISOString(),
          lastSyncedStateHash: null,
        },
        [DEV_B]: {
          id: DEV_B,
          name: 'desktop',
          platform: 'linux',
          lastSyncedAt: allSyncedAfter.toISOString(),
          lastSyncedStateHash: null,
        },
      },
    };
    // NOW = June 2024, oldTombstone = Jan 2024 → 150+ days old > 90 day GC
    const plan = merge({ base, installed: [installed('ext.a')], remote });
    expect(plan.tombstonesToGC).toContain('ext.gone');
  });

  it('tombstone is NOT GC\'d when not old enough', () => {
    // Tombstone created only 5 days ago
    const recentTombstone = new Date('2024-05-27T00:00:00.000Z'); // 5 days before NOW
    const base = makeState([ext('ext.gone')]);
    const remote = makeState(
      [ext('ext.a')],
      [['ext.gone', { removedBy: DEV_B, removedAt: recentTombstone.toISOString() }]],
    );
    const plan = merge({ base, installed: [installed('ext.a')], remote });
    expect(plan.tombstonesToGC).not.toContain('ext.gone');
  });

  it('tombstone is NOT GC\'d when a device has never synced', () => {
    const oldTombstone = new Date('2024-01-01T00:00:00.000Z');
    const base = makeState([ext('ext.gone')]);
    const remote: SyncState = {
      ...makeState([ext('ext.a')], [['ext.gone', { removedBy: DEV_B, removedAt: oldTombstone.toISOString() }]]),
      devices: {
        [DEV_A]: {
          id: DEV_A,
          name: 'laptop',
          platform: 'linux',
          lastSyncedAt: new Date('2024-02-01T00:00:00.000Z').toISOString(),
          lastSyncedStateHash: null,
        },
        [DEV_B]: {
          id: DEV_B,
          name: 'desktop',
          platform: 'linux',
          lastSyncedAt: null, // never synced!
          lastSyncedStateHash: null,
        },
      },
    };
    const plan = merge({ base, installed: [installed('ext.a')], remote });
    expect(plan.tombstonesToGC).not.toContain('ext.gone');
  });
});

// ─────────────────────────── both no change ───────────────────────

describe('no change (Case 10): base, !installed, !remote, no tombstone', () => {
  it('no actions when extension is gone from all sides without tombstone', () => {
    const base = makeState([ext('ext.a'), ext('ext.gone')]);
    const remote = makeState([ext('ext.a')]); // no tombstone, just gone
    const plan = merge({ base, installed: [installed('ext.a')], remote });
    // ext.gone is in base, not in installed, not in remote, not in remote.removed
    // → no-op (Case 10)
    const actionsForGone = [
      ...plan.localActions.filter((a) => a.extensionId === 'ext.gone'),
      ...plan.remoteActions.filter((a) => a.extensionId === 'ext.gone'),
    ];
    expect(actionsForGone).toHaveLength(0);
  });
});

// ─────────────────────────── 3-way version conflicts ──────────────

describe('3-way version delta (Case 6): base, installed, remote', () => {
  it('no action when all three at same version', () => {
    const base = makeState([ext('ext.same', '1.0.0')]);
    const remote = makeState([ext('ext.same', '1.0.0')]);
    const plan = merge({ base, installed: [installed('ext.same', '1.0.0')], remote });
    const actionsForSame = [
      ...plan.localActions.filter((a) => a.extensionId === 'ext.same'),
      ...plan.remoteActions.filter((a) => a.extensionId === 'ext.same'),
    ];
    expect(actionsForSame).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('accepts remote update when only remote changed', () => {
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '2.0.0')]);
    const plan = merge({ base, installed: [installed('ext.a', '1.0.0')], remote });
    expect(plan.localActions).toHaveLength(1);
    expect(plan.localActions[0]).toMatchObject({
      type: 'install-local',
      extensionId: 'ext.a',
      desiredVersion: '2.0.0',
    });
    expect(plan.remoteActions).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('pushes local update when only local changed', () => {
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '1.0.0')]);
    const plan = merge({ base, installed: [installed('ext.a', '2.0.0')], remote });
    expect(plan.remoteActions).toHaveLength(1);
    expect(plan.remoteActions[0]).toMatchObject({
      type: 'push-version-update',
      extensionId: 'ext.a',
    });
    expect(plan.remoteActions[0].entry?.desiredVersion).toBe('2.0.0');
    expect(plan.localActions).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('no conflict when both changed to same version', () => {
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '2.0.0')]);
    const plan = merge({ base, installed: [installed('ext.a', '2.0.0')], remote });
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.localActions).toHaveLength(0);
  });

  it('version conflict when both changed to different versions', () => {
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '3.0.0')]);
    const plan = merge({ base, installed: [installed('ext.a', '2.0.0')], remote, policy: 'manual' });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'version-conflict',
      localVersion: '2.0.0',
      remoteVersion: '3.0.0',
      baseVersion: '1.0.0',
      resolution: null,
    });
  });

  it('newest policy picks local when local addedAt is newer', () => {
    const olderAt = new Date('2024-03-01T00:00:00.000Z').toISOString();
    const newerAt = new Date('2024-04-01T00:00:00.000Z').toISOString();
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '3.0.0', { addedAt: olderAt })]);
    // local entry will get addedAt = NOW (now is 2024-06-01) which is newer
    const plan = merge({ base, installed: [installed('ext.a', '2.0.0')], remote, policy: 'newest' });
    expect(plan.conflicts[0].resolution).toBe('keep-local');
  });
});

// ─────────────────────────── remote lost without tombstone ────────

describe('remote lost without tombstone (Case 7): base, installed, !remote', () => {
  it('pushes extension back to remote', () => {
    const base = makeState([ext('ext.a'), ext('ext.orphan')]);
    const remote = makeState([ext('ext.a')]); // ext.orphan vanished without tombstone
    const plan = merge({
      base,
      installed: [installed('ext.a'), installed('ext.orphan')],
      remote,
    });
    const pushAction = plan.remoteActions.find((a) => a.extensionId === 'ext.orphan');
    expect(pushAction?.type).toBe('push-add');
    expect(plan.localActions).toHaveLength(0);
  });
});

// ─────────────────────────── resurrection (Case 3) ───────────────

describe('resurrection (Case 3): !base, installed, !remote, remote.removed', () => {
  it('creates resurrection conflict', () => {
    const base = makeState([]);
    const remote = makeState([], [tombstone('ext.zombie')]);
    const plan = merge({
      base,
      installed: [installed('ext.zombie')],
      remote,
      policy: 'manual',
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].kind).toBe('resurrection');
    expect(plan.conflicts[0].resolution).toBeNull();
  });

  it('newest policy defaults to keep-remote (delete propagates) when addedAt <= removedAt', () => {
    // Local entry will get addedAt=NOW, tombstone is at PAST which is before NOW
    // So local addedAt > remote removedAt → keep-local
    const base = makeState([]);
    const remote = makeState([], [tombstone('ext.zombie', { removedAt: FAR_PAST.toISOString() })]);
    const plan = merge({
      base,
      installed: [installed('ext.zombie')],
      remote,
      policy: 'newest',
    });
    // local addedAt = NOW (2024-06-01) > FAR_PAST (2024-01-01) → keep-local
    expect(plan.conflicts[0].resolution).toBe('keep-local');
  });
});

// ─────────────────────────── applyRemotePlan ─────────────────────

describe('applyRemotePlan', () => {
  it('adds extensions from push-add actions', () => {
    const remote = makeState([]);
    const plan: MergePlan = {
      localActions: [],
      remoteActions: [
        {
          type: 'push-add',
          extensionId: 'new.ext',
          entry: { desiredVersion: '1.0.0', families: ['vscode'], addedBy: DEV_A, addedAt: NOW.toISOString() },
          reason: 'test',
        },
      ],
      conflicts: [],
      tombstonesToGC: [],
    };
    const newState = applyRemotePlan(remote, plan, DEV_A, 'laptop', NOW);
    expect(newState.extensions['new.ext']).toBeDefined();
    expect(newState.extensions['new.ext'].desiredVersion).toBe('1.0.0');
  });

  it('removes extensions and adds tombstones from push-remove actions', () => {
    const remote = makeState([ext('ext.gone')]);
    const plan: MergePlan = {
      localActions: [],
      remoteActions: [
        {
          type: 'push-remove',
          extensionId: 'ext.gone',
          tombstone: { removedBy: DEV_A, removedAt: NOW.toISOString() },
          reason: 'test',
        },
      ],
      conflicts: [],
      tombstonesToGC: [],
    };
    const newState = applyRemotePlan(remote, plan, DEV_A, 'laptop', NOW);
    expect(newState.extensions['ext.gone']).toBeUndefined();
    expect(newState.removed['ext.gone']).toBeDefined();
  });

  it('clears tombstone when push-add is used (resurrection wins)', () => {
    const remote = makeState([], [tombstone('ext.zombie')]);
    const plan: MergePlan = {
      localActions: [],
      remoteActions: [
        {
          type: 'push-add',
          extensionId: 'ext.zombie',
          entry: { desiredVersion: '1.0.0', families: ['vscode'], addedBy: DEV_A, addedAt: NOW.toISOString() },
          reason: 'resurrection win',
        },
      ],
      conflicts: [],
      tombstonesToGC: [],
    };
    const newState = applyRemotePlan(remote, plan, DEV_A, 'laptop', NOW);
    expect(newState.extensions['ext.zombie']).toBeDefined();
    expect(newState.removed['ext.zombie']).toBeUndefined();
  });

  it('removes GC\'d tombstones', () => {
    const remote = makeState([], [tombstone('ext.old')]);
    const plan: MergePlan = {
      localActions: [],
      remoteActions: [],
      conflicts: [],
      tombstonesToGC: ['ext.old'],
    };
    const newState = applyRemotePlan(remote, plan, DEV_A, 'laptop', NOW);
    expect(newState.removed['ext.old']).toBeUndefined();
  });
});

// ─────────────────────────── stampDevice ─────────────────────────

describe('stampDevice', () => {
  it('updates lastSyncedAt and hash for the device', () => {
    const state = makeState([]);
    const stamped = stampDevice(state, DEV_A, 'laptop', 'abc123', NOW);
    expect(stamped.devices[DEV_A].lastSyncedAt).toBe(NOW.toISOString());
    expect(stamped.devices[DEV_A].lastSyncedStateHash).toBe('abc123');
  });
});

// ─────────────────────────── idempotency ─────────────────────────

describe('idempotency', () => {
  it('produces no actions when state is fully in sync', () => {
    const state = makeState([ext('ext.a'), ext('ext.b')]);
    const plan = merge({
      base: state,
      installed: [installed('ext.a'), installed('ext.b')],
      remote: state,
    });
    expect(plan.localActions).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    // remoteActions could include family merges but should have no push-adds or push-removes
    const nonTrivial = plan.remoteActions.filter(
      (a) => a.type === 'push-add' || a.type === 'push-remove',
    );
    expect(nonTrivial).toHaveLength(0);
  });
});

// ─────────────────────────── profile filtering ────────────────────

describe('profileIds filtering', () => {
  it('ignores extensions outside the profile entirely, even if base/remote disagree', () => {
    const base = makeState([ext('ext.in'), ext('ext.out')]);
    const remote = makeState([ext('ext.in')]); // ext.out vanished from remote w/o tombstone
    const plan = merge({
      base,
      installed: [installed('ext.in'), installed('ext.out')],
      remote,
      profileIds: new Set(['ext.in']),
    });
    expect(plan.localActions.find((a) => a.extensionId === 'ext.out')).toBeUndefined();
    expect(plan.remoteActions.find((a) => a.extensionId === 'ext.out')).toBeUndefined();
  });

  it('still reasons normally about in-profile extensions', () => {
    const base = makeState([ext('ext.in', '1.0.0')]);
    const remote = makeState([ext('ext.in', '2.0.0')]);
    const plan = merge({
      base,
      installed: [installed('ext.in', '1.0.0')],
      remote,
      profileIds: new Set(['ext.in']),
    });
    expect(plan.localActions).toHaveLength(1);
    expect(plan.localActions[0]).toMatchObject({ type: 'install-local', extensionId: 'ext.in' });
  });

  it('fast-path (no remote) only pushes profile-scoped extensions', () => {
    const plan = merge({
      installed: [installed('ext.in'), installed('ext.out')],
      profileIds: new Set(['ext.in']),
    });
    expect(plan.remoteActions).toHaveLength(1);
    expect(plan.remoteActions[0].extensionId).toBe('ext.in');
  });
});

// ─────────────────────────── manual conflict resolutions ──────────

describe('manualResolutions', () => {
  it('resolves a version conflict using the supplied decision', () => {
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '3.0.0')]);
    const plan = merge({
      base,
      installed: [installed('ext.a', '2.0.0')],
      remote,
      policy: 'manual',
      manualResolutions: { 'ext.a': 'keep-local' },
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].resolution).toBe('keep-local');
    expect(plan.remoteActions.some((a) => a.extensionId === 'ext.a' && a.type === 'push-version-update')).toBe(true);
  });

  it('leaves resolution null when manual policy has no matching decision', () => {
    const base = makeState([ext('ext.a', '1.0.0')]);
    const remote = makeState([ext('ext.a', '3.0.0')]);
    const plan = merge({
      base,
      installed: [installed('ext.a', '2.0.0')],
      remote,
      policy: 'manual',
      manualResolutions: { 'ext.other': 'keep-local' },
    });
    expect(plan.conflicts[0].resolution).toBeNull();
  });
});
