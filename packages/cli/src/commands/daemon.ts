import chalk from 'chalk';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import { isDaemonAlive, spawnDaemon, stopDaemon, readDaemonPid, getDaemonScript } from '../daemon/lifecycle.js';
import { sendIpcCommand } from '../daemon/ipc.js';
import { getLogFile } from '../daemon/logger.js';
import { writeDaemonConfig, getDaemonConfig, readConfig } from 'ide-sync-core';
import { WindowsServiceInstaller } from 'ide-sync-core';
import { LaunchdServiceInstaller } from 'ide-sync-core';
import { SystemdServiceInstaller } from 'ide-sync-core';

dayjs.extend(relativeTime);

function getInstaller() {
  if (process.platform === 'win32') return new WindowsServiceInstaller();
  if (process.platform === 'darwin') return new LaunchdServiceInstaller();
  return new SystemdServiceInstaller();
}

// ── start ─────────────────────────────────────────────────────────

export async function daemonStartCommand(): Promise<void> {
  if (isDaemonAlive()) {
    const pid = readDaemonPid();
    console.log(chalk.yellow(`  Daemon is already running (pid ${pid}).`));
    return;
  }

  spawnDaemon();

  // Give it a moment to write the PID file.
  await new Promise((r) => setTimeout(r, 600));

  if (isDaemonAlive()) {
    const pid = readDaemonPid();
    console.log(chalk.green(`\n  Daemon started (pid ${pid}).\n`));
    console.log(`  Logs: ${getLogFile()}`);
    console.log(`  Status: ide-sync daemon status\n`);
  } else {
    console.log(chalk.red('\n  Daemon failed to start. Check logs:\n'));
    console.log(`  ${getLogFile()}\n`);
    process.exit(1);
  }
}

// ── stop ──────────────────────────────────────────────────────────

export async function daemonStopCommand(): Promise<void> {
  if (!isDaemonAlive()) {
    console.log(chalk.yellow('  Daemon is not running.'));
    return;
  }

  const sent = stopDaemon();
  if (sent) {
    // Wait for the process to exit (up to 8 seconds).
    const deadline = Date.now() + 8_000;
    while (isDaemonAlive() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!isDaemonAlive()) {
      console.log(chalk.green('\n  Daemon stopped.\n'));
    } else {
      console.log(chalk.yellow('\n  Daemon did not stop within 8 s. Use `kill` to force.\n'));
    }
  } else {
    console.log(chalk.yellow('  Daemon was not running.'));
  }
}

// ── restart ───────────────────────────────────────────────────────

export async function daemonRestartCommand(): Promise<void> {
  await daemonStopCommand();
  await new Promise((r) => setTimeout(r, 500));
  await daemonStartCommand();
}

// ── status ────────────────────────────────────────────────────────

export async function daemonStatusCommand(): Promise<void> {
  const RULE = '─'.repeat(57);

  if (!isDaemonAlive()) {
    console.log(chalk.dim('\n  ide-sync daemon · ') + chalk.red('stopped'));
    console.log(`  ${RULE}`);
    console.log(chalk.dim(`  Run \`ide-sync daemon start\` to start the daemon.\n`));
    return;
  }

  try {
    const resp = await sendIpcCommand({ cmd: 'status' }, 5000);
    if (!resp.ok || !resp.data) {
      console.log(chalk.yellow('  Daemon is running but did not respond to status query.'));
      return;
    }

    const d = resp.data as {
      pid: number;
      uptimeMs: number;
      state: string;
      paused: boolean;
      pausedUntil: string | null;
      queue: { running: unknown; pending: unknown[]; completedCount: number; failedCount: number };
      lastSync: { at: number; pulled: number; pushed: number; conflicts: number } | null;
      watched: Array<{
        family: string;
        extensionsPath: string;
        eventCount: number;
        lastEventAt: number | null;
        debouncing: boolean;
        msUntilFire: number | null;
      }>;
      periodicCron: string;
      rssMb: number;
    };

    const uptime = dayjs().from(dayjs(Date.now() - d.uptimeMs), true);
    const stateLabel = d.paused
      ? chalk.yellow('paused')
      : chalk.green('active');

    console.log('');
    console.log(`  ide-sync daemon · ${stateLabel} ${chalk.dim(`(pid ${d.pid}, uptime ${uptime})`)}`);
    console.log(`  ${RULE}`);

    console.log(`  ${chalk.bold('Watching:')}`);
    if (d.watched.length === 0) {
      console.log(`    ${chalk.dim('No IDEs detected yet')}`);
    }
    for (const w of d.watched) {
      const lastEvt = w.lastEventAt
        ? `last event ${dayjs(w.lastEventAt).fromNow()}`
        : 'last event never';
      const debounceTag = w.debouncing
        ? chalk.yellow(`  [debouncing — sync in ~${Math.ceil((w.msUntilFire ?? 0) / 1000)}s]`)
        : '';
      console.log(`    ${chalk.green('✓')} ${chalk.cyan(w.family.padEnd(12))}  ${chalk.dim(lastEvt)}${debounceTag}`);
    }

    const qLen = d.queue.pending.length;
    const qRunning = d.queue.running ? 1 : 0;
    console.log(`\n  Queue:        ${qRunning} running, ${qLen} pending`);

    if (d.lastSync) {
      const ago = dayjs(d.lastSync.at).fromNow();
      const summary = `↓${d.lastSync.pulled} ↑${d.lastSync.pushed}${d.lastSync.conflicts > 0 ? ` · ${d.lastSync.conflicts} conflict(s)` : ' · no conflicts'}`;
      console.log(`  Last sync:    ${ago}  · ${summary}`);
    } else {
      console.log(`  Last sync:    ${chalk.dim('none yet')}`);
    }

    console.log(`  Periodic:     ${d.periodicCron}`);
    console.log(`  State:        ${stateLabel}`);
    console.log(`  Memory:       ${d.rssMb.toFixed(1)} MB RSS`);

    if (d.paused && d.pausedUntil) {
      console.log(chalk.yellow(`\n  Paused until: ${dayjs(d.pausedUntil).fromNow()}`));
    }
    console.log('');
  } catch (err) {
    const pid = readDaemonPid();
    console.log(chalk.yellow(`\n  Daemon is running (pid ${pid}) but IPC is unavailable.`));
    console.log(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}\n`));
  }
}

// ── logs ──────────────────────────────────────────────────────────

export async function daemonLogsCommand(opts: { since?: string }): Promise<void> {
  const logFile = getLogFile();

  if (!fs.existsSync(logFile)) {
    console.log(chalk.yellow(`  Log file not found: ${logFile}`));
    return;
  }

  let sinceMs: number | null = null;
  if (opts.since) {
    const match = opts.since.match(/^(\d+)(s|m|h|d)$/);
    if (!match) {
      console.error(chalk.red(`  Invalid --since format. Use: 30s, 5m, 1h, 2d`));
      process.exit(1);
    }
    const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    sinceMs = Date.now() - parseInt(match[1]) * units[match[2]];
  }

  // Stream the file and filter / pretty-print pino JSON lines.
  const stream = fs.createReadStream(logFile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const entry = JSON.parse(trimmed) as { time: number; level: number; msg: string; [k: string]: unknown };
      if (sinceMs !== null && entry.time < sinceMs) return;

      const ts = new Date(entry.time).toISOString().replace('T', ' ').replace('Z', '');
      const levelMap: Record<number, string> = {
        10: chalk.dim('TRACE'),
        20: chalk.dim('DEBUG'),
        30: chalk.white('INFO '),
        40: chalk.yellow('WARN '),
        50: chalk.red('ERROR'),
        60: chalk.bgRed('FATAL'),
      };
      const levelStr = levelMap[entry.level] ?? String(entry.level).padStart(5);
      const extras = Object.entries(entry)
        .filter(([k]) => !['time', 'level', 'msg', 'pid', 'hostname'].includes(k))
        .map(([k, v]) => `${chalk.dim(k)}=${JSON.stringify(v)}`)
        .join(' ');

      console.log(`${chalk.dim(ts)} ${levelStr} ${entry.msg}${extras ? '  ' + extras : ''}`);
    } catch {
      // Raw line that isn't JSON — just print it.
      console.log(line);
    }
  });

  rl.on('close', () => {
    // After printing existing lines, tail the file for new lines.
    let position = fs.statSync(logFile).size;
    const tail = fs.watch(logFile, () => {
      const stat = fs.statSync(logFile);
      if (stat.size <= position) return;
      const buf = Buffer.alloc(stat.size - position);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, position);
      fs.closeSync(fd);
      position = stat.size;
      const newLines = buf.toString('utf8').split('\n').filter(Boolean);
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line) as { time: number; level: number; msg: string; [k: string]: unknown };
          const ts = new Date(entry.time).toISOString().replace('T', ' ').replace('Z', '');
          const levelMap: Record<number, string> = {
            10: chalk.dim('TRACE'), 20: chalk.dim('DEBUG'), 30: chalk.white('INFO '),
            40: chalk.yellow('WARN '), 50: chalk.red('ERROR'), 60: chalk.bgRed('FATAL'),
          };
          const levelStr = levelMap[entry.level] ?? String(entry.level).padStart(5);
          console.log(`${chalk.dim(ts)} ${levelStr} ${entry.msg}`);
        } catch {
          console.log(line);
        }
      }
    });
    process.on('SIGINT', () => { tail.close(); process.exit(0); });
  });
}

// ── sync-now ──────────────────────────────────────────────────────

export async function daemonSyncNowCommand(): Promise<void> {
  if (!isDaemonAlive()) {
    console.log(chalk.red('  Daemon is not running. Start it with: ide-sync daemon start'));
    process.exit(1);
  }
  try {
    const resp = await sendIpcCommand({ cmd: 'sync-now' });
    if (resp.ok) {
      console.log(chalk.green('  Sync job enqueued. Watch logs: ide-sync daemon logs'));
    } else {
      console.log(chalk.red(`  ${resp.error}`));
    }
  } catch (err) {
    console.error(chalk.red('  IPC error:'), err instanceof Error ? err.message : err);
  }
}

// ── pause ─────────────────────────────────────────────────────────

export async function daemonPauseCommand(): Promise<void> {
  if (!isDaemonAlive()) {
    // Persist pause even if daemon isn't running (takes effect on next start).
    writeDaemonConfig({ pausedUntil: null });
    console.log(chalk.yellow('  Daemon is not running. Pause will take effect when started.'));
    return;
  }
  try {
    const resp = await sendIpcCommand({ cmd: 'pause' });
    if (resp.ok) {
      console.log(chalk.yellow('\n  Daemon paused. Watchers are still observing but no syncs will fire.\n'));
      console.log(`  Resume with: ide-sync daemon resume\n`);
    } else {
      console.log(chalk.red(`  ${resp.error}`));
    }
  } catch (err) {
    console.error(chalk.red('  IPC error:'), err instanceof Error ? err.message : err);
  }
}

// ── resume ────────────────────────────────────────────────────────

export async function daemonResumeCommand(): Promise<void> {
  if (!isDaemonAlive()) {
    writeDaemonConfig({ pausedUntil: null });
    console.log(chalk.yellow('  Daemon is not running. Start it with: ide-sync daemon start'));
    return;
  }
  try {
    const resp = await sendIpcCommand({ cmd: 'resume' });
    if (resp.ok) {
      console.log(chalk.green('\n  Daemon resumed.\n'));
    } else {
      console.log(chalk.red(`  ${resp.error}`));
    }
  } catch (err) {
    console.error(chalk.red('  IPC error:'), err instanceof Error ? err.message : err);
  }
}

// ── install ───────────────────────────────────────────────────────

export async function daemonInstallCommand(): Promise<void> {
  const daemonScript = getDaemonScript();
  const installer = getInstaller();
  try {
    await installer.install(daemonScript);
  } catch (err) {
    console.error(chalk.red(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}

// ── uninstall ─────────────────────────────────────────────────────

export async function daemonUninstallCommand(): Promise<void> {
  const installer = getInstaller();
  try {
    await installer.uninstall();
  } catch (err) {
    console.error(chalk.red(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}
