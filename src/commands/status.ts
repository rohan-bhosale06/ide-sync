import chalk from 'chalk';
import ora from 'ora';
import { readConfig, readLastSyncedState } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { buildInstalledSet } from '../sync/state.js';
import { threeWayMerge } from '../sync/engine.js';
import { createBackend } from '../sync/backends/index.js';

export interface StatusOptions {
  ide?: string;
}

function ago(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const RULE = '─'.repeat(54);

export async function statusCommand(opts: StatusOptions = {}): Promise<void> {
  const config = readConfig();

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  console.log('');
  console.log(`  ${chalk.bold('Sync Status')}`);
  console.log(`  ${RULE}`);
  console.log(`  Device:   ${chalk.cyan(config.deviceName)} ${chalk.dim(`(${config.deviceId.slice(0, 8)}…)`)}`);
  console.log(`  Backend:  ${config.backend}${config.backend === 'git' ? chalk.dim(` (${config.gitRepoUrl ?? ''})`) : chalk.dim(` (${config.filesystemPath ?? ''})`)}`);
  console.log(`  Policy:   ${config.conflictPolicy}`);

  const base = readLastSyncedState();
  if (base) {
    const dev = base.devices[config.deviceId];
    const ts = dev?.lastSyncedAt;
    if (ts) {
      console.log(`  Last sync: ${new Date(ts).toLocaleString()}  ${chalk.dim(`(${ago(ts)})`)}`);
    } else {
      console.log(`  Last sync: ${chalk.dim('never')}`);
    }
  } else {
    console.log(`  Last sync: ${chalk.dim('never')}`);
  }

  console.log('');

  // ── Fetch remote ───────────────────────────────────────────────────
  const backend = createBackend(config);
  const fetchSpinner = ora('Fetching remote state…').start();
  let remote;
  try {
    remote = await backend.readState();
    fetchSpinner.succeed('Remote state fetched');
  } catch (err) {
    fetchSpinner.fail('Failed to fetch remote state');
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`  ${msg}\n`));
    return;
  }

  if (remote === null) {
    console.log(chalk.yellow('  Remote is empty — run `ide-sync push` to seed it.\n'));
    return;
  }

  // ── Scan local ─────────────────────────────────────────────────────
  const scanSpinner = ora('Scanning local IDEs…').start();
  const inventories = runDetectors(families);
  const installed = buildInstalledSet(inventories);
  scanSpinner.stop();

  // ── Compute drift (read-only merge) ────────────────────────────────
  const plan = threeWayMerge({
    base,
    installed,
    remote,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    policy: config.conflictPolicy,
    tombstoneGCDays: config.tombstoneGCDays,
  });

  const toPush = plan.remoteActions;
  const toPull = plan.localActions;
  const conflicts = plan.conflicts;

  console.log(`  ${RULE}`);
  console.log(`  Remote: ${Object.keys(remote.extensions).length} extensions   Local: ${installed.length} extensions`);
  console.log('');

  if (toPush.length === 0 && toPull.length === 0 && conflicts.length === 0) {
    console.log(`  ${chalk.green('✓')} In sync — nothing to do.`);
  } else {
    if (toPush.length > 0) {
      console.log(`  ${chalk.bold('Would push')} (${toPush.length}):`);
      for (const a of toPush) {
        const icon = a.type === 'push-add' ? chalk.green('+') : a.type === 'push-remove' ? chalk.red('-') : chalk.yellow('↑');
        console.log(`    ${icon} ${chalk.cyan(a.extensionId)}  ${chalk.dim(a.reason)}`);
      }
      console.log('');
    }
    if (toPull.length > 0) {
      console.log(`  ${chalk.bold('Would pull')} (${toPull.length}):`);
      for (const a of toPull) {
        const icon = a.type === 'install-local' ? chalk.green('+') : chalk.red('-');
        console.log(`    ${icon} ${chalk.cyan(a.extensionId)}  ${chalk.dim(a.reason)}`);
      }
      console.log('');
    }
    if (conflicts.length > 0) {
      console.log(`  ${chalk.yellow('⚠')} ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} (run \`ide-sync sync\` to resolve)`);
    }
    console.log(`  Run ${chalk.cyan('ide-sync sync')} to synchronise.`);
  }

  // ── Remote devices ────────────────────────────────────────────────
  const deviceList = Object.values(remote.devices);
  if (deviceList.length > 1) {
    console.log('');
    console.log(`  ${RULE}`);
    console.log(`  ${chalk.bold('Registered devices')} (${deviceList.length}):`);
    for (const dev of deviceList) {
      const isSelf = dev.id === config.deviceId;
      const ts = dev.lastSyncedAt ? `last sync ${ago(dev.lastSyncedAt)}` : 'never synced';
      console.log(
        `    ${isSelf ? chalk.green('→') : ' '} ${chalk.cyan(dev.name)} ` +
        `${chalk.dim(`(${dev.id.slice(0, 8)}…) — ${ts}${isSelf ? ' (this device)' : ''}`)}`
      );
    }
  }

  console.log('');
}
