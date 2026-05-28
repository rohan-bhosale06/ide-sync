/**
 * Write config changes back to an IDE's config files.
 * Every write is preceded by a backup. Writes are atomic.
 */
import type { IDEFamily } from '../detectors/types.js';
import type { ConfigDomain } from './types.js';
import { createDomainHandlers } from './domains/index.js';
import { backupFiles } from './backup.js';
import path from 'path';
import fs from 'fs';

export interface ConfigWritePlan {
  settings?: string;           // new JSONC text
  keybindings?: string;        // new JSONC text
  snippets?: {
    writes: Record<string, string>;   // filename → new text
    deletes: string[];                 // filenames to remove
  };
  tasks?: string;
  mcp?: string;
  uiState?: Record<string, unknown>;  // whitelisted keys to apply
}

/**
 * Apply a write plan to the IDE's config files.
 * Backs up all affected files first, then applies atomically.
 *
 * @returns Array of backup paths created.
 */
export function applyConfigWritePlan(
  ide: IDEFamily,
  configPath: string,
  plan: ConfigWritePlan,
  uiStateWhitelistExtra: string[] = [],
): void {
  const handlers = createDomainHandlers(configPath, uiStateWhitelistExtra);

  // Collect files to back up.
  const filesToBackup: Array<{ sourcePath: string; relativeName?: string }> = [];

  if (plan.settings !== undefined) {
    const p = handlers.settings.path;
    if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p });
  }
  if (plan.keybindings !== undefined) {
    const p = handlers.keybindings.path;
    if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p });
  }
  if (plan.tasks !== undefined) {
    const p = handlers.tasks.path;
    if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p });
  }
  if (plan.mcp !== undefined) {
    const p = handlers.mcp.path;
    if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p });
  }
  if (plan.snippets) {
    const dir = handlers.snippets.dirPath;
    for (const filename of Object.keys(plan.snippets.writes)) {
      const p = path.join(dir, filename);
      if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p, relativeName: path.join('snippets', filename) });
    }
    for (const filename of plan.snippets.deletes) {
      const p = path.join(dir, filename);
      if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p, relativeName: path.join('snippets', filename) });
    }
  }

  // Backup before any writes.
  if (filesToBackup.length > 0) {
    backupFiles(filesToBackup, ide, 'config-sync');
  }

  // Apply writes.
  if (plan.settings !== undefined) handlers.settings.write(plan.settings);
  if (plan.keybindings !== undefined) handlers.keybindings.write(plan.keybindings);
  if (plan.tasks !== undefined) handlers.tasks.write(plan.tasks);
  if (plan.mcp !== undefined) handlers.mcp.write(plan.mcp);
  if (plan.snippets) {
    for (const [filename, text] of Object.entries(plan.snippets.writes)) {
      handlers.snippets.writeFile(filename, text);
    }
    for (const filename of plan.snippets.deletes) {
      handlers.snippets.deleteFile(filename);
    }
  }
  if (plan.uiState !== undefined) {
    handlers.uiState.apply(plan.uiState);
  }
}
