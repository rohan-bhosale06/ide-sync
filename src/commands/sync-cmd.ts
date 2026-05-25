import { runPull, pullCommand } from './pull.js';
import { runPush, pushCommand } from './push.js';
import type { PullOptions, PullResult } from './pull.js';
import type { PushOptions, PushResult } from './push.js';

export interface SyncOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
  keepLocalExtensions?: boolean;
  silent?: boolean;
  largeChangeThresholdPercent?: number;
  autoApplyLargeChanges?: boolean;
}

export interface SyncResult {
  ok: boolean;
  pulled: number;
  pushed: number;
  conflicts: number;
  error?: string;
  skipped?: PullResult['skipped'] | PushResult['skipped'];
}

/** Headless sync (pull then push) — returns structured result, no process.exit. */
export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const shared: PullOptions & PushOptions = {
    ide: opts.ide,
    dryRun: opts.dryRun,
    yes: true,
    conflict: opts.conflict,
    keepLocalExtensions: opts.keepLocalExtensions,
    silent: opts.silent,
    largeChangeThresholdPercent: opts.largeChangeThresholdPercent,
    autoApplyLargeChanges: opts.autoApplyLargeChanges,
  };

  const pullResult = await runPull(shared);
  if (!pullResult.ok && pullResult.skipped !== 'up-to-date') {
    return {
      ok: pullResult.ok,
      pulled: pullResult.pulled,
      pushed: 0,
      conflicts: pullResult.conflicts,
      error: pullResult.error,
      skipped: pullResult.skipped,
    };
  }

  const pushResult = await runPush(shared);
  return {
    ok: pushResult.ok,
    pulled: pullResult.pulled,
    pushed: pushResult.pushed,
    conflicts: Math.max(pullResult.conflicts, pushResult.conflicts),
    error: pushResult.error,
    skipped: pushResult.skipped,
  };
}

/**
 * `ide-sync sync` — pull then push in one shot.
 */
export async function syncCommand(opts: SyncOptions): Promise<void> {
  const shared: PullOptions & PushOptions = {
    ide: opts.ide,
    dryRun: opts.dryRun,
    yes: opts.yes,
    conflict: opts.conflict,
    keepLocalExtensions: opts.keepLocalExtensions,
  };

  await pullCommand(shared);
  await pushCommand(shared);
}
