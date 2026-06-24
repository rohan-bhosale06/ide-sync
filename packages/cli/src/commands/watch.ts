import chalk from 'chalk';
import { IDEWatcher } from '../daemon/watcher.js';
import { DebouncerRegistry } from '../daemon/debouncer.js';
import { JobQueue } from '../daemon/queue.js';
import { createLogger } from '../daemon/logger.js';
import { readConfig, getDaemonConfig } from 'ide-sync-core';
import { runSync } from './sync-cmd.js';
import type { IDEFamily } from 'ide-sync-core';
import pino from 'pino';

export interface WatchOptions {
  ide?: string;
  verbose?: boolean;
}

/** `ide-sync watch` — foreground watcher for debugging. Same engine as the daemon. */
export async function watchCommand(opts: WatchOptions = {}): Promise<void> {
  const config = readConfig();
  const daemonCfg = getDaemonConfig(config);

  // Pretty-print logs to stdout instead of a file.
  const level = opts.verbose ? 'debug' : 'info';
  const logger = pino({ level, transport: { target: 'pino-pretty', options: { colorize: true } } });

  console.log(chalk.bold('\n  ide-sync watch') + chalk.dim(' — foreground mode (Ctrl+C to stop)\n'));

  const queue = new JobQueue(async (job) => {
    console.log(chalk.cyan(`\n  → sync triggered by ${job.type}${job.ide ? ` (${job.ide})` : ''}`));
    const result = await runSync({
      yes: true,
      silent: false,
      conflict: config.conflictPolicy,
      ide: opts.ide ?? job.ide,
      largeChangeThresholdPercent: daemonCfg.largeChangeThresholdPercent,
      autoApplyLargeChanges: daemonCfg.autoApplyLargeChanges,
    });

    if (result.skipped === 'large-change') {
      console.log(chalk.yellow('  ⚠ Large change detected — skipped (set autoApplyLargeChanges: true to override)'));
    } else if (!result.ok) {
      console.log(chalk.red(`  ✗ Sync failed: ${result.error}`));
    } else if (result.skipped === 'up-to-date') {
      console.log(chalk.dim('  Already up to date.'));
    } else {
      console.log(chalk.green(`  ✓ Sync complete — ↓${result.pulled} ↑${result.pushed}`));
    }
  }, logger);

  const families = opts.ide
    ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
    : undefined;

  const debouncers = new DebouncerRegistry(
    daemonCfg.debounceMs,
    daemonCfg.maxDebounceMs,
    (ide: IDEFamily) => queue.enqueue('local-change', ide),
  );

  const watcher = new IDEWatcher(
    (ide: IDEFamily) => {
      if (families && !families.includes(ide)) return;
      console.log(chalk.dim(`  [${new Date().toISOString()}] event: ${ide} — debouncing…`));
      debouncers.event(ide);
    },
    logger,
  );

  watcher.start();
  console.log(chalk.dim('  Watching IDE extension directories…\n'));

  // Keep alive until Ctrl+C.
  await new Promise<void>((resolve) => {
    process.once('SIGINT', async () => {
      console.log(chalk.dim('\n  Stopping…'));
      debouncers.cancelAll();
      await watcher.stop();
      resolve();
    });
    process.once('SIGTERM', async () => {
      debouncers.cancelAll();
      await watcher.stop();
      resolve();
    });
  });

  console.log(chalk.dim('  Stopped.\n'));
}
