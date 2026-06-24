import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { configExists, readConfig, writeConfig } from 'ide-sync-core';
import { createDevice } from 'ide-sync-core';
import { createBackend } from 'ide-sync-core';
import type { Config, ConflictPolicy } from 'ide-sync-core';

export interface InitOptions {
  backend?: string;
  repo?: string;
  path?: string;
  device?: string;
  yes?: boolean;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  console.log('');
  console.log(chalk.bold('  ide-sync init'));
  console.log('');

  if (configExists() && !opts.yes) {
    const { overwrite } = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: 'ide-sync is already configured. Overwrite?',
      initial: false,
    });
    if (!overwrite) {
      console.log(chalk.dim('  Aborted.\n'));
      return;
    }
  }

  // ── 1. Determine backend ──────────────────────────────────────────
  let backend: 'git' | 'filesystem';
  let gitRepoUrl: string | undefined;
  let filesystemPath: string | undefined;

  if (opts.backend === 'git' || opts.backend === 'filesystem') {
    backend = opts.backend;
    gitRepoUrl = opts.repo;
    filesystemPath = opts.path;
  } else {
    const { choice } = await prompts({
      type: 'select',
      name: 'choice',
      message: 'Choose a sync backend:',
      choices: [
        {
          title: 'Git repository (recommended)',
          description: 'State stored in a git repo you own — no servers, full history',
          value: 'git',
        },
        {
          title: 'Local folder',
          description: 'State stored in a local directory (great with Dropbox / iCloud / Syncthing)',
          value: 'filesystem',
        },
      ],
    });
    backend = choice as 'git' | 'filesystem';
  }

  if (backend === 'git' && !gitRepoUrl) {
    const { url } = await prompts({
      type: 'text',
      name: 'url',
      message: 'Git repository URL (SSH or HTTPS):',
      hint: 'e.g. git@github.com:you/ide-sync-state.git',
      validate: (v) => (v.trim().length > 0 ? true : 'Required'),
    });
    gitRepoUrl = url as string;
  }

  if (backend === 'filesystem' && !filesystemPath) {
    const { dir } = await prompts({
      type: 'text',
      name: 'dir',
      message: 'Directory path for sync state:',
      hint: 'e.g. ~/Dropbox/ide-sync',
      validate: (v) => (v.trim().length > 0 ? true : 'Required'),
    });
    filesystemPath = dir as string;
  }

  // ── 2. Device identity ────────────────────────────────────────────
  const existing = configExists() ? readConfig() : null;
  const deviceDefaults = createDevice(opts.device);
  let deviceName: string;
  let deviceId: string;

  if (opts.device) {
    deviceName = opts.device;
    deviceId = existing?.deviceId ?? deviceDefaults.id;
  } else if (opts.yes) {
    deviceName = deviceDefaults.name;
    deviceId = existing?.deviceId ?? deviceDefaults.id;
  } else {
    const { name } = await prompts({
      type: 'text',
      name: 'name',
      message: 'Device name:',
      initial: existing?.deviceName ?? deviceDefaults.name,
    });
    deviceName = name as string;
    deviceId = existing?.deviceId ?? deviceDefaults.id;
  }

  // ── 3. Write config ───────────────────────────────────────────────
  const config: Config = {
    deviceId,
    deviceName,
    backend,
    gitRepoUrl,
    filesystemPath,
    conflictPolicy: existing?.conflictPolicy ?? 'newest',
    tombstoneGCDays: existing?.tombstoneGCDays ?? 90,
  };

  writeConfig(config);
  console.log(`  ${chalk.green('✓')} Config written`);

  // ── 4. Initialise backend ─────────────────────────────────────────
  const backendInst = createBackend(config);
  const spinner = ora('Initialising backend…').start();

  try {
    await backendInst.init();
    spinner.succeed('Backend initialised');
  } catch (err) {
    spinner.fail('Backend init failed');
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`  ${msg}`));
    process.exit(1);
  }

  // ── 5. Offer first push ───────────────────────────────────────────
  const remoteState = await backendInst.readState().catch(() => null);

  if (remoteState === null && !opts.yes) {
    console.log('');
    const { seed } = await prompts({
      type: 'confirm',
      name: 'seed',
      message: 'Remote is empty. Push your current extensions now?',
      initial: true,
    });
    if (seed) {
      const { pushCommand } = await import('./push.js');
      await pushCommand({ yes: true });
      return;
    }
  }

  console.log('');
  console.log(
    `  ${chalk.green('✓')} Done. Run ${chalk.cyan('ide-sync sync')} to start syncing.\n`,
  );
}
