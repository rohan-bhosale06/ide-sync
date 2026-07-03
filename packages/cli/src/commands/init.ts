import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { configExists, readConfig, createDevice, runInit } from 'ide-sync-core';

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

  if (opts.device) {
    deviceName = opts.device;
  } else if (opts.yes) {
    deviceName = deviceDefaults.name;
  } else {
    const { name } = await prompts({
      type: 'text',
      name: 'name',
      message: 'Device name:',
      initial: existing?.deviceName ?? deviceDefaults.name,
    });
    deviceName = name as string;
  }

  // ── 3. Initialise backend + write config ──────────────────────────
  const spinner = ora('Initialising backend…').start();
  const result = await runInit({
    backend,
    gitRepoUrl,
    filesystemPath,
    deviceName,
    conflictPolicy: existing?.conflictPolicy,
    tombstoneGCDays: existing?.tombstoneGCDays,
  });

  if (!result.ok) {
    spinner.fail('Backend init failed');
    console.error(chalk.red(`  ${result.error}`));
    process.exit(1);
  }
  spinner.succeed('Backend initialised');
  console.log(`  ${chalk.green('✓')} Config written`);

  // ── 4. Offer first push ───────────────────────────────────────────
  if (result.remoteEmpty && !opts.yes) {
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
