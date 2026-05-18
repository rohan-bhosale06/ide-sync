import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { GitBackend, PushConflictError } from '../../../src/sync/backends/git.js';
import type { SyncState } from '../../../src/sync/types.js';

/**
 * Creates a local bare git repo that acts as the "remote".
 * Returns the path so GitBackend can clone from it via file:// URL.
 */
async function makeBareRepo(tmpDir: string): Promise<string> {
  const bareDir = path.join(tmpDir, 'remote.git');
  fs.mkdirSync(bareDir, { recursive: true });
  const g = simpleGit(bareDir);
  await g.init(['--bare']);

  // Git needs at least one commit to have a "main" branch.
  // Create a temporary working copy, commit, then push to the bare repo.
  const seedDir = path.join(tmpDir, 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  const sg = simpleGit(seedDir);
  await sg.init();
  await sg.addConfig('user.name', 'Test');
  await sg.addConfig('user.email', 'test@test.com');
  fs.writeFileSync(path.join(seedDir, 'README.md'), '# ide-sync state\n', 'utf8');
  await sg.add('README.md');
  await sg.commit('init');
  await sg.addRemote('origin', bareDir);
  await sg.push('origin', 'master', ['--set-upstream']);

  // Rename to 'main' for consistency with GitBackend default.
  await simpleGit(bareDir).raw(['symbolic-ref', 'HEAD', 'refs/heads/master']);
  return bareDir;
}

function makeState(extId = 'ext.a', version = '1.0.0'): SyncState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedByDevice: 'test-device',
    extensions: {
      [extId]: {
        desiredVersion: version,
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

describe('GitBackend', () => {
  let tmpDir: string;
  let bareRepoPath: string;
  let localRepoPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-sync-git-test-'));
    bareRepoPath = await makeBareRepo(tmpDir);
    localRepoPath = path.join(tmpDir, 'local');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isInitialized returns false before init', async () => {
    const backend = new GitBackend(bareRepoPath, localRepoPath);
    expect(await backend.isInitialized()).toBe(false);
  });

  it('init clones the remote repo', async () => {
    const backend = new GitBackend(bareRepoPath, localRepoPath);
    await backend.init();
    expect(fs.existsSync(path.join(localRepoPath, '.git'))).toBe(true);
    expect(await backend.isInitialized()).toBe(true);
  });

  it('init is idempotent (no-op if already cloned)', async () => {
    const backend = new GitBackend(bareRepoPath, localRepoPath);
    await backend.init();
    await backend.init(); // should not throw
    expect(await backend.isInitialized()).toBe(true);
  });

  it('readState returns null when no state file exists', async () => {
    const backend = new GitBackend(bareRepoPath, localRepoPath);
    await backend.init();
    expect(await backend.readState()).toBeNull();
  });

  it('writeState commits and makes state readable', async () => {
    const backend = new GitBackend(bareRepoPath, localRepoPath);
    await backend.init();

    // Need to configure git user for commits
    const g = simpleGit(localRepoPath);
    await g.addConfig('user.name', 'Test');
    await g.addConfig('user.email', 'test@test.com');

    const state = makeState();
    await backend.writeState(state, 'test: add ext.a');
    const read = await backend.readState();
    expect(read?.extensions['ext.a']).toBeDefined();
    expect(read?.extensions['ext.a'].desiredVersion).toBe('1.0.0');
  });

  it('writeState is a no-op when state is identical (nothing staged)', async () => {
    const backend = new GitBackend(bareRepoPath, localRepoPath);
    await backend.init();
    const g = simpleGit(localRepoPath);
    await g.addConfig('user.name', 'Test');
    await g.addConfig('user.email', 'test@test.com');

    const state = makeState();
    await backend.writeState(state, 'first write');

    // Count commits
    const logBefore = await g.log();
    await backend.writeState(state, 'second write (identical)');
    const logAfter = await g.log();

    // No new commit if nothing changed
    expect(logAfter.total).toBe(logBefore.total);
  });

  it('two instances sharing same remote can read each other\'s writes', async () => {
    const localA = path.join(tmpDir, 'local-a');
    const localB = path.join(tmpDir, 'local-b');

    const backendA = new GitBackend(bareRepoPath, localA);
    const backendB = new GitBackend(bareRepoPath, localB);

    await backendA.init();
    await backendB.init();

    const gA = simpleGit(localA);
    await gA.addConfig('user.name', 'DevA');
    await gA.addConfig('user.email', 'a@test.com');

    await backendA.writeState(makeState('ext.from-a'), 'from a');

    // B reads after A pushed
    const fromB = await backendB.readState();
    expect(fromB?.extensions['ext.from-a']).toBeDefined();
  });
});
