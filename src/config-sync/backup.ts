/**
 * Backup management for IDE config files.
 * Every write to an IDE config file goes through backup-first.
 * Auto-prune: keep at least last 20 regardless of age; delete those older than 30 days.
 */
import fs from 'fs';
import path from 'path';
import { resolveHome } from '../utils/paths.js';
import type { IDEFamily } from '../detectors/types.js';

const BACKUP_DIR = resolveHome('.ide-sync', 'backups');
const MAX_BACKUPS = 20;
const MAX_AGE_DAYS = 30;

/** Create a timestamped backup of a single file. Returns the backup path. */
export function backupFile(
  sourceFile: string,
  ide: IDEFamily,
  label?: string,
): string | null {
  if (!fs.existsSync(sourceFile)) return null;

  const isoTs = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_DIR, `${isoTs}${label ? `-${label}` : ''}`, ide);
  fs.mkdirSync(dir, { recursive: true });

  const destFile = path.join(dir, path.basename(sourceFile));
  fs.copyFileSync(sourceFile, destFile);

  return destFile;
}

/** Back up multiple files for the same IDE in a single timestamped snapshot. */
export function backupFiles(
  files: Array<{ sourcePath: string; relativeName?: string }>,
  ide: IDEFamily,
  label?: string,
): string {
  const isoTs = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_DIR, `${isoTs}${label ? `-${label}` : ''}`, ide);
  fs.mkdirSync(dir, { recursive: true });

  for (const { sourcePath, relativeName } of files) {
    if (!fs.existsSync(sourcePath)) continue;
    const destName = relativeName ?? path.basename(sourcePath);
    const destFile = path.join(dir, destName);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(sourcePath, destFile);
  }

  return dir;
}

export interface BackupEntry {
  id: string;           // the timestamp-based directory name
  path: string;         // full path
  createdAt: Date;
  ides: IDEFamily[];
}

/** List all available backups, newest first. */
export function listBackups(): BackupEntry[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  const entries: BackupEntry[] = [];
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const fullPath = path.join(BACKUP_DIR, name);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    let createdAt: Date;
    try {
      // Parse the ISO timestamp prefix back to a date.
      const isoLike = name.replace(/-(\d{3})-\d{4}$/, '.$1Z').replace(/-/g, (m, offset, str) => {
        // Very rough heuristic: first 10 chars are date (dashes), rest are time.
        return offset < 10 ? '-' : offset < 23 ? (offset === 10 ? 'T' : ':') : m;
      });
      createdAt = fs.statSync(fullPath).birthtime;
    } catch {
      createdAt = fs.statSync(fullPath).mtime;
    }

    const ides = fs.readdirSync(fullPath).filter((d) =>
      fs.statSync(path.join(fullPath, d)).isDirectory()
    ) as IDEFamily[];

    entries.push({ id: name, path: fullPath, createdAt, ides });
  }

  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Restore all config files for a specific IDE from a backup. Returns restored file paths. */
export function restoreBackup(
  backupId: string,
  ide: IDEFamily,
  targetConfigPath: string,
): string[] {
  const backupIdeDir = path.join(BACKUP_DIR, backupId, ide);
  if (!fs.existsSync(backupIdeDir)) {
    throw new Error(`No backup for IDE '${ide}' in backup '${backupId}'`);
  }

  const restored: string[] = [];
  restoreDir(backupIdeDir, targetConfigPath, restored);
  return restored;
}

function restoreDir(srcDir: string, destDir: string, restored: string[]): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    if (fs.statSync(src).isDirectory()) {
      restoreDir(src, dest, restored);
    } else {
      // Atomic write: write to tmp then rename.
      const tmp = `${dest}.ide-sync.tmp`;
      fs.copyFileSync(src, tmp);
      if (process.platform === 'win32' && fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(tmp, dest);
      restored.push(dest);
    }
  }
}

/**
 * Auto-prune: delete backups older than MAX_AGE_DAYS while keeping at least MAX_BACKUPS.
 */
export function pruneBackups(): void {
  const entries = listBackups();
  if (entries.length <= MAX_BACKUPS) return;

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const toDelete = entries
    .slice(MAX_BACKUPS) // keep newest MAX_BACKUPS regardless of age
    .filter((e) => e.createdAt.getTime() < cutoff);

  for (const entry of toDelete) {
    fs.rmSync(entry.path, { recursive: true, force: true });
  }
}
