/**
 * Headless install/uninstall — structured results, no process.exit, no prompts.
 * Backs the CLI's interactive install/uninstall commands and the desktop marketplace screen.
 */
import { ALL_FAMILIES } from '../detectors/index.js';
import { getInstaller } from '../installers/index.js';
import { getCliInstallHint } from '../utils/cli-detect.js';
import type { IDEFamily } from '../detectors/types.js';

export interface RunInstallOptions {
  ide: string;
  version?: string;
}

export interface RunInstallEntryResult {
  id: string;
  success: boolean;
  version?: string;
  method?: 'cli' | 'vsix' | 'manual';
  error?: string;
}

export interface RunInstallResult {
  ok: boolean;
  results: RunInstallEntryResult[];
  error?: string;
}

/** Headless install of one or more extensions into a target IDE family. */
export async function runInstall(extensionIds: string[], opts: RunInstallOptions): Promise<RunInstallResult> {
  const family = opts.ide as IDEFamily;
  if (!ALL_FAMILIES.includes(family)) {
    return { ok: false, results: [], error: `Unknown IDE: "${opts.ide}". Valid: ${ALL_FAMILIES.join(', ')}` };
  }

  const installer = getInstaller(family);
  if (!(await installer.isAvailable())) {
    return { ok: false, results: [], error: `${family} CLI not found on PATH. ${getCliInstallHint(family)}` };
  }

  const results: RunInstallEntryResult[] = [];
  for (const id of extensionIds) {
    const result = await installer.install(id, opts.version);
    results.push({ id, success: result.success, version: result.version, method: result.method, error: result.error });
  }

  return { ok: results.every((r) => r.success), results };
}

export interface RunUninstallOptions {
  ide: string;
}

export interface RunUninstallResult {
  ok: boolean;
  error?: string;
}

/** Headless uninstall of a single extension from a target IDE family. */
export async function runUninstall(extensionId: string, opts: RunUninstallOptions): Promise<RunUninstallResult> {
  const family = opts.ide as IDEFamily;
  if (!ALL_FAMILIES.includes(family)) {
    return { ok: false, error: `Unknown IDE: "${opts.ide}". Valid: ${ALL_FAMILIES.join(', ')}` };
  }

  const installer = getInstaller(family);
  if (!(await installer.isAvailable())) {
    return { ok: false, error: `${family} CLI not found on PATH. ${getCliInstallHint(family)}` };
  }

  const result = await installer.uninstall(extensionId);
  return { ok: result.success, error: result.error };
}
