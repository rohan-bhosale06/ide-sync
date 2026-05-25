import process from 'process';
import { readConfig, getDaemonConfig, writeDaemonConfig } from '../config/config.js';
import { createLogger, setLogger } from './logger.js';
import { DebouncerRegistry } from './debouncer.js';
import { JobQueue } from './queue.js';
import { IpcServer } from './ipc.js';
import { IDEWatcher } from './watcher.js';
import { PeriodicScheduler } from './scheduler.js';
import { writeDaemonPid, removeDaemonPid } from './lifecycle.js';
import { notify } from './notifier.js';
import { runSync } from '../commands/sync-cmd.js';
import { runPull } from '../commands/pull.js';
import type { IDEFamily } from '../detectors/types.js';
import type { IpcCommand, IpcResponse } from './ipc.js';

const RESOURCE_CHECK_INTERVAL_MS = 60_000;
const MAX_RSS_MB = 200;
const MAX_JOBS_PER_HOUR = 10;

export async function runDaemon(): Promise<void> {
  // ── Setup ─────────────────────────────────────────────────────────
  const config = readConfig();
  const daemonCfg = getDaemonConfig(config);

  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
  setLogger(logger);

  logger.info({ pid: process.pid, version: '0.4.0' }, 'daemon starting');

  writeDaemonPid(process.pid);

  const startedAt = Date.now();
  let jobsThisHour = 0;
  let jobsHourWindowStart = Date.now();
  let lastSyncResult: { at: number; pulled: number; pushed: number; conflicts: number } | null = null;

  // Respect pausedUntil from persisted config.
  const isPaused = (): boolean => {
    if (daemonCfg.pausedUntil === null) return false;
    return new Date(daemonCfg.pausedUntil).getTime() > Date.now();
  };

  // ── Job executor ──────────────────────────────────────────────────
  const queue = new JobQueue(async (job) => {
    const freshConfig = readConfig();
    const freshDaemon = getDaemonConfig(freshConfig);

    const syncOpts = {
      yes: true,
      silent: true,
      conflict: freshConfig.conflictPolicy,
      largeChangeThresholdPercent: freshDaemon.largeChangeThresholdPercent,
      autoApplyLargeChanges: freshDaemon.autoApplyLargeChanges,
      ide: job.ide,
    };

    // Rate limit check.
    const now = Date.now();
    if (now - jobsHourWindowStart > 3_600_000) {
      jobsHourWindowStart = now;
      jobsThisHour = 0;
    }
    jobsThisHour++;
    if (jobsThisHour > MAX_JOBS_PER_HOUR) {
      logger.warn({ jobsThisHour }, 'job rate limit exceeded — possible watcher loop bug');
    }

    try {
      if (job.type === 'remote-check') {
        const result = await runPull({ ...syncOpts });
        if (result.skipped === 'large-change') {
          logger.warn({ job }, 'large-change gate: skipping auto-pull');
          await notify(freshDaemon.notifications, 'conflict',
            'Large change detected', 'Auto-sync skipped — run ide-sync pull to review');
          return;
        }
        lastSyncResult = { at: Date.now(), pulled: result.pulled, pushed: 0, conflicts: result.conflicts };
        if (result.conflicts > 0) {
          await notify(freshDaemon.notifications, 'conflict',
            'Sync conflict', `${result.conflicts} conflict(s) auto-resolved`);
        }
        logger.info({ result }, 'remote-check complete');
      } else {
        const result = await runSync(syncOpts);
        if (result.skipped === 'large-change') {
          logger.warn({ job }, 'large-change gate: skipping auto-sync');
          await notify(freshDaemon.notifications, 'conflict',
            'Large change detected', 'Auto-sync skipped — run ide-sync sync to review');
          return;
        }
        lastSyncResult = { at: Date.now(), pulled: result.pulled, pushed: result.pushed, conflicts: result.conflicts };
        if (!result.ok) {
          logger.error({ result }, 'sync failed');
          await notify(freshDaemon.notifications, 'error', 'Sync failed', result.error ?? 'unknown error');
        } else {
          logger.info({ result }, 'sync complete');
          if (result.conflicts > 0) {
            await notify(freshDaemon.notifications, 'conflict',
              'Sync conflict', `${result.conflicts} conflict(s) auto-resolved`);
          }
          if (freshDaemon.notifications.onSync && (result.pulled > 0 || result.pushed > 0)) {
            await notify(freshDaemon.notifications, 'sync',
              'Sync complete', `↓${result.pulled} ↑${result.pushed}`);
          }
        }
      }
    } catch (err) {
      logger.error({ err, job }, 'unexpected error in job executor');
      const freshDaemon2 = getDaemonConfig(readConfig());
      await notify(freshDaemon2.notifications, 'error', 'Daemon error',
        err instanceof Error ? err.message : String(err));
    }
  }, logger);

  if (isPaused()) {
    queue.pause();
    logger.info('daemon started in paused state');
  }

  // ── Debouncer ─────────────────────────────────────────────────────
  const debouncers = new DebouncerRegistry(
    daemonCfg.debounceMs,
    daemonCfg.maxDebounceMs,
    (ide: IDEFamily) => {
      if (!queue.isPaused) {
        queue.enqueue('local-change', ide);
      }
    },
  );

  // ── Watcher ───────────────────────────────────────────────────────
  const watcher = new IDEWatcher(
    (ide: IDEFamily) => debouncers.event(ide),
    logger,
  );
  watcher.start();

  // ── Periodic scheduler ────────────────────────────────────────────
  const scheduler = new PeriodicScheduler(
    daemonCfg.periodicPullCron,
    () => {
      if (!queue.isPaused) {
        queue.enqueue('remote-check');
      }
    },
    logger,
  );
  scheduler.start();

  // ── IPC server ────────────────────────────────────────────────────
  const ipc = new IpcServer(async (cmd: IpcCommand): Promise<IpcResponse> => {
    const freshConfig = readConfig();
    const freshDaemon = getDaemonConfig(freshConfig);

    switch (cmd.cmd) {
      case 'ping':
        return { ok: true, data: 'pong' };

      case 'status': {
        const qStatus = queue.status;
        const watched = watcher.getWatchedIDEs();
        return {
          ok: true,
          data: {
            pid: process.pid,
            uptimeMs: Date.now() - startedAt,
            state: queue.isPaused ? 'paused' : 'active',
            paused: queue.isPaused,
            pausedUntil: freshDaemon.pausedUntil,
            queue: {
              running: qStatus.running,
              pending: qStatus.pending,
              completedCount: qStatus.completedCount,
              failedCount: qStatus.failedCount,
            },
            lastSync: lastSyncResult,
            watched: watched.map((w) => ({
              family: w.family,
              extensionsPath: w.extensionsPath,
              eventCount: w.eventCount,
              lastEventAt: w.lastEventAt,
              debouncing: debouncers.getDebouncer(w.family)?.isPending ?? false,
              msUntilFire: debouncers.getDebouncer(w.family)?.msUntilFire ?? null,
            })),
            periodicCron: daemonCfg.periodicPullCron,
            rssMb: process.memoryUsage().rss / 1_048_576,
          },
        };
      }

      case 'sync-now':
        queue.enqueue('manual-sync');
        return { ok: true, data: 'sync job enqueued' };

      case 'pause':
        queue.pause();
        writeDaemonConfig({ pausedUntil: null });
        return { ok: true, data: 'paused' };

      case 'resume':
        queue.resume();
        writeDaemonConfig({ pausedUntil: null });
        return { ok: true, data: 'resumed' };

      case 'reload-config':
        return { ok: true, data: 'config reloaded' };

      default:
        return { ok: false, error: `unknown command: ${(cmd as IpcCommand).cmd}` };
    }
  }, logger);

  ipc.start();

  // ── Resource ceiling monitor ──────────────────────────────────────
  const resourceCheck = setInterval(() => {
    const rssMb = process.memoryUsage().rss / 1_048_576;
    if (rssMb > MAX_RSS_MB) {
      logger.warn({ rssMb: rssMb.toFixed(1) }, 'daemon RSS exceeds 200 MB');
    }
  }, RESOURCE_CHECK_INTERVAL_MS);

  logger.info('daemon running');

  // ── Graceful shutdown ─────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    debouncers.cancelAll();
    scheduler.stop();
    clearInterval(resourceCheck);
    await queue.drainWithTimeout(30_000);
    await ipc.close();
    await watcher.stop();
    removeDaemonPid();
    logger.info('daemon stopped');
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT',  () => { void shutdown('SIGINT'); });
}
