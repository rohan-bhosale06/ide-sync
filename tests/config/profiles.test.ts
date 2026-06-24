import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('extension profiles', () => {
  let tmpDir: string;
  let profiles: typeof import('../../src/config/profiles.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-sync-profiles-test-'));
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
    profiles = await import('../../src/config/profiles.js');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns an empty list when no profiles exist', () => {
    expect(profiles.listProfiles()).toHaveLength(0);
  });

  it('creates a profile with lowercased extension IDs', () => {
    const profile = profiles.createProfile('work', ['Ms-Python.Python', 'esbenp.prettier-vscode']);
    expect(profile.name).toBe('work');
    expect(profile.extensionIds).toEqual(['ms-python.python', 'esbenp.prettier-vscode']);
    expect(profiles.listProfiles()).toHaveLength(1);
  });

  it('throws when creating a profile that already exists', () => {
    profiles.createProfile('work', ['a.b']);
    expect(() => profiles.createProfile('work', ['c.d'])).toThrow(/already exists/);
  });

  it('updates an existing profile', () => {
    profiles.createProfile('work', ['a.b']);
    const updated = profiles.updateProfile('work', ['c.d', 'e.f']);
    expect(updated.extensionIds).toEqual(['c.d', 'e.f']);
  });

  it('throws when updating a profile that does not exist', () => {
    expect(() => profiles.updateProfile('missing', ['a.b'])).toThrow(/does not exist/);
  });

  it('deletes a profile', () => {
    profiles.createProfile('work', ['a.b']);
    profiles.deleteProfile('work');
    expect(profiles.listProfiles()).toHaveLength(0);
  });

  it('throws when deleting a profile that does not exist', () => {
    expect(() => profiles.deleteProfile('missing')).toThrow(/does not exist/);
  });

  it('resolves profile ids as a lowercased set', () => {
    profiles.createProfile('work', ['Ms-Python.Python']);
    const ids = profiles.resolveProfileIds('work');
    expect(ids.has('ms-python.python')).toBe(true);
  });

  it('throws when resolving a profile that does not exist', () => {
    expect(() => profiles.resolveProfileIds('missing')).toThrow(/does not exist/);
  });

  it('persists profiles across reads', () => {
    profiles.createProfile('work', ['a.b']);
    const reread = profiles.readProfiles();
    expect(reread['work']).toBeDefined();
    expect(reread['work'].extensionIds).toEqual(['a.b']);
  });
});
