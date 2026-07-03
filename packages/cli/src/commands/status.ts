import chalk from 'chalk';
import ora from 'ora';
import { readConfig, runStatus } from 'ide-sync-core';
import type { StatusOptions } from 'ide-sync-core';

export type { StatusOptions };

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

  console.log('');
  console.log(`  ${chalk.bold('Sync Status')}`);
  console.log(`  ${RULE}`);
  console.log(`  Device:   ${chalk.cyan(config.deviceName)} ${chalk.dim(`(${config.deviceId.slice(0, 8)}…)`)}`);
  console.log(`  Backend:  ${config.backend}${config.backend === 'git' ? chalk.dim(` (${config.gitRepoUrl ?? ''})`) : chalk.dim(` (${config.filesystemPath ?? ''})`)}`);
  console.log(`  Policy:   ${config.conflictPolicy}`);

  const spinner = ora('Fetching remote state…').start();
  const result = await runStatus(opts);
  spinner.stop();

  if (result.lastSyncedAt) {
    console.log(`  Last sync: ${new Date(result.lastSyncedAt).toLocaleString()}  ${chalk.dim(`(${ago(result.lastSyncedAt)})`)}`);
  } else {
    console.log(`  Last sync: ${chalk.dim('never')}`);
  }

  console.log('');

  if (!result.remoteReachable) {
    console.error(chalk.red(`  ${result.error}\n`));
    return;
  }

  if (result.remoteEmpty) {
    console.log(chalk.yellow('  Remote is empty — run `ide-sync push` to seed it.\n'));
    return;
  }

  const { toPush, toPull, conflicts } = result;

  console.log(`  ${RULE}`);
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
  const deviceList = result.devices;
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
