import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/detectors/index.js', () => ({
  runDetectors: vi.fn(() => [
    { ide: { family: 'vscode', installed: true, configPath: '/fake/vscode/config' } },
  ]),
}));

describe('headless backup commands', () => {
  let tmpDir: string;
  let backups: typeof import('../../src/commands/backups.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-sync-backups-test-'));
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
    backups = await import('../../src/commands/backups.js');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeBackup(id: string, ide: string, files: Record<string, string>): void {
    const dir = path.join(tmpDir, '.ide-sync', 'backups', id, ide);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
  }

  it('returns an empty list when no backups exist', () => {
    expect(backups.runListBackups()).toHaveLength(0);
  });

  it('lists backups with per-IDE file listings', () => {
    makeBackup('2024-01-01T00-00-00-000Z', 'vscode', { 'settings.json': '{}' });
    const summaries = backups.runListBackups();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].ides).toEqual(['vscode']);
    expect(summaries[0].files['vscode']).toEqual(['settings.json']);
  });

  it('restores a backup to the resolved live config path', () => {
    makeBackup('2024-01-01T00-00-00-000Z', 'vscode', { 'settings.json': '{"a":1}' });
    const targetDir = path.join(tmpDir, 'restore-target');
    const result = backups.runRestoreBackup({
      backupId: '2024-01-01T00-00-00-000Z',
      ide: 'vscode' as const,
      targetConfigPath: targetDir,
    });
    expect(result.ok).toBe(true);
    expect(result.restored).toHaveLength(1);
    expect(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8')).toBe('{"a":1}');
  });

  it('returns ok:false for a non-existent backup', () => {
    const result = backups.runRestoreBackup({
      backupId: 'does-not-exist',
      ide: 'vscode' as const,
      targetConfigPath: path.join(tmpDir, 'restore-target'),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
