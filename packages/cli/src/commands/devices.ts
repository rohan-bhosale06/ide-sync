import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { readConfig } from 'ide-sync-core';
import { createBackend } from 'ide-sync-core';
import { hashState } from 'ide-sync-core';

export interface DevicesOptions {
  yes?: boolean;
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

export async function devicesListCommand(): Promise<void> {
  const config = readConfig();
  const backend = createBackend(config);

  const spinner = ora('Fetching device list…').start();
  const remote = await backend.readState();
  spinner.stop();

  if (remote === null) {
    console.log(chalk.yellow('\n  Remote is empty — no devices registered yet.\n'));
    return;
  }

  const devices = Object.values(remote.devices);
  const RULE = '─'.repeat(54);

  console.log('');
  console.log(`  ${chalk.bold(`Registered devices`)} (${devices.length})`);
  console.log(`  ${RULE}`);

  for (const dev of devices) {
    const isSelf = dev.id === config.deviceId;
    const ts = dev.lastSyncedAt ? `last sync ${ago(dev.lastSyncedAt)}` : 'never synced';
    console.log(
      `  ${isSelf ? chalk.green('→') : ' '} ${chalk.bold(dev.name)}` +
      `  ${chalk.dim(dev.id)}` +
      `\n      ${chalk.dim(`${dev.platform}   ${ts}${isSelf ? '  (this device)' : ''}`)}`
    );
  }

  console.log(`  ${RULE}\n`);
}

export async function devicesRemoveCommand(
  deviceId: string,
  opts: DevicesOptions = {},
): Promise<void> {
  const config = readConfig();
  const backend = createBackend(config);

  const spinner = ora('Fetching remote state…').start();
  const remote = await backend.readState();
  spinner.stop();

  if (remote === null) {
    console.log(chalk.yellow('\n  Remote is empty.\n'));
    return;
  }

  if (!(deviceId in remote.devices)) {
    console.error(chalk.red(`\n  Device "${deviceId}" not found in remote.\n`));
    process.exit(1);
  }

  const target = remote.devices[deviceId];
  const isSelf = deviceId === config.deviceId;

  console.log(`\n  Removing device: ${chalk.cyan(target.name)} ${chalk.dim(`(${target.id})`)}`);
  if (isSelf) {
    console.log(chalk.yellow('  Warning: you are removing this device.'));
  }

  if (!opts.yes) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Remove this device from the sync state?',
      initial: false,
    });
    if (!confirmed) {
      console.log(chalk.dim('\n  Aborted.\n'));
      return;
    }
  }

  const newDevices = { ...remote.devices };
  delete newDevices[deviceId];

  const newState = { ...remote, devices: newDevices };
  const hash = hashState(newState);
  const stamped = {
    ...newState,
    updatedAt: new Date().toISOString(),
    updatedByDevice: config.deviceId,
    devices: {
      ...newDevices,
      [config.deviceId]: {
        ...remote.devices[config.deviceId]!,
        lastSyncedStateHash: hash,
      },
    },
  };

  const writeSpinner = ora('Updating remote…').start();
  await backend.writeState(
    stamped,
    `devices: remove ${target.name} (${target.id.slice(0, 8)})`,
  );
  writeSpinner.succeed(`Removed device "${target.name}"`);
  console.log('');
}
