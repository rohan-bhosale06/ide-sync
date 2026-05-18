import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FilesystemBackend } from '../../../src/sync/backends/filesystem.js';
import type { SyncState } from '../../../src/sync/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ide-sync-fs-test-'));
}

function makeState(): SyncState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedByDevice: 'test-device',
    extensions: {
      'ext.a': {
        desiredVersion: '1.0.0',
        families: ['vscode'],
        addedBy: 'test-device',
        addedAt: new Date().toISOString(),
      },
    },
    removed: {},
    devices: {
      'test-device': {
        id: 'test-device',
        name: 'test',
        platform: 'linux',
        lastSyncedAt: null,
        lastSyncedStateHash: null,
      },
    },
  };
}

describe('FilesystemBackend', () => {
  let tmpDir: string;
  let backend: FilesystemBackend;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    backend = new FilesystemBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isInitialized returns true when dir exists', async () => {
    expect(await backend.isInitialized()).toBe(true);
  });

  it('isInitialized returns false when dir does not exist', async () => {
    const missing = new FilesystemBackend(path.join(tmpDir, 'nonexistent'));
    expect(await missing.isInitialized()).toBe(false);
  });

  it('init creates directory if missing', async () => {
    const newDir = path.join(tmpDir, 'new-dir');
    const b = new FilesystemBackend(newDir);
    await b.init();
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('readState returns null when no state file exists', async () => {
    expect(await backend.readState()).toBeNull();
  });

  it('writeState and readState round-trip', async () => {
    const state = makeState();
    await backend.writeState(state, 'test commit');
    const read = await backend.readState();
    expect(read).not.toBeNull();
    expect(read?.extensions['ext.a'].desiredVersion).toBe('1.0.0');
    expect(read?.schemaVersion).toBe(1);
  });

  it('writeState overwrites previous state', async () => {
    const state1 = makeState();
    await backend.writeState(state1, 'first');

    const state2: SyncState = {
      ...state1,
      extensions: {
        'ext.b': {
          desiredVersion: '2.0.0',
          families: ['cursor'],
          addedBy: 'test-device',
          addedAt: new Date().toISOString(),
        },
      },
    };
    await backend.writeState(state2, 'second');

    const read = await backend.readState();
    expect(read?.extensions['ext.a']).toBeUndefined();
    expect(read?.extensions['ext.b']?.desiredVersion).toBe('2.0.0');
  });

  it('readState rejects invalid schema version', async () => {
    const invalid = { schemaVersion: 99, updatedAt: new Date().toISOString() };
    fs.writeFileSync(
      path.join(tmpDir, 'sync-state.json'),
      JSON.stringify(invalid),
      'utf8',
    );
    await expect(backend.readState()).rejects.toThrow(/Unsupported schemaVersion/);
  });

  it('readState rejects malformed JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, 'sync-state.json'), 'not json', 'utf8');
    await expect(backend.readState()).rejects.toThrow();
  });

  it('handles multiple writes across instances sharing directory', async () => {
    const state = makeState();
    const b1 = new FilesystemBackend(tmpDir);
    const b2 = new FilesystemBackend(tmpDir);

    await b1.writeState(state, 'from b1');
    const fromB2 = await b2.readState();
    expect(fromB2?.extensions['ext.a']).toBeDefined();
  });
});
