/**
 * Headless backup list/restore — structured wrapper around `config-sync/backup.ts`
 * for reuse by the CLI and (later) an IPC layer.
 */
import { listBackups, restoreBackup, type BackupEntry } from 'ide-sync-core';
import { runDetectors } from 'ide-sync-core';
import type { IDEFamily } from 'ide-sync-core';
import fs from 'fs';
import path from 'path';

export interface BackupSummary {
  id: string;
  createdAt: string;
  ides: IDEFamily[];
  files: Record<string, string[]>;
}

function listBackupFiles(entry: BackupEntry, ide: IDEFamily): string[] {
  const ideDir = path.join(entry.path, ide);
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  if (fs.existsSync(ideDir)) walk(ideDir, '');
  return out;
}

/** List all available backups with per-IDE file listings, newest first. */
export function runListBackups(): BackupSummary[] {
  return listBackups().map((entry) => {
    const files: Record<string, string[]> = {};
    for (const ide of entry.ides) {
      files[ide] = listBackupFiles(entry, ide);
    }
    return {
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      ides: entry.ides,
      files,
    };
  });
}

export interface RestoreBackupOptions {
  backupId: string;
  ide: IDEFamily;
  /** Override the target config path; defaults to the live-detected path for `ide`. */
  targetConfigPath?: string;
}

export interface RestoreBackupResult {
  ok: boolean;
  restored: string[];
  error?: string;
}

/** Restore a backup for one IDE, resolving its live config path automatically. */
export function runRestoreBackup(opts: RestoreBackupOptions): RestoreBackupResult {
  let targetConfigPath = opts.targetConfigPath;

  if (!targetConfigPath) {
    const inventories = runDetectors([opts.ide]);
    const inv = inventories.find((i) => i.ide.family === opts.ide);
    if (!inv?.ide.configPath) {
      return { ok: false, restored: [], error: `Config path for '${opts.ide}' could not be determined.` };
    }
    targetConfigPath = inv.ide.configPath;
  }

  try {
    const restored = restoreBackup(opts.backupId, opts.ide, targetConfigPath);
    return { ok: true, restored };
  } catch (err) {
    return { ok: false, restored: [], error: err instanceof Error ? err.message : String(err) };
  }
}
