import chalk from 'chalk';
import ora from 'ora';
import { ALL_FAMILIES } from 'ide-sync-core';
import { getInstaller } from 'ide-sync-core';
import { getCliInstallHint } from 'ide-sync-core';
import type { IDEFamily } from 'ide-sync-core';

export interface InstallOptions {
  ide: string;
  version?: string;
}

export async function installCommand(extensionIds: string[], opts: InstallOptions): Promise<void> {
  const family = opts.ide as IDEFamily;
  if (!ALL_FAMILIES.includes(family)) {
    console.error(chalk.red(`Unknown IDE: "${opts.ide}". Valid: ${ALL_FAMILIES.join(', ')}`));
    process.exit(1);
  }

  const installer = getInstaller(family);
  if (!(await installer.isAvailable())) {
    console.error(chalk.red(`\n${family} CLI not found on PATH.`));
    console.error(chalk.dim(getCliInstallHint(family)));
    process.exit(1);
  }

  let failed = false;
  for (const id of extensionIds) {
    const spinner = ora(`Installing ${chalk.cyan(id)}…`).start();
    const result = await installer.install(id, opts.version);
    if (result.success) {
      spinner.succeed(
        `${chalk.green('Installed')} ${chalk.cyan(id)}${result.version ? chalk.dim(`@${result.version}`) : ''} ${chalk.dim(`(${result.method})`)}`,
      );
    } else {
      spinner.fail(`${chalk.red('Failed')} ${chalk.cyan(id)}: ${result.error}`);
      failed = true;
    }
  }

  if (failed) process.exit(1);
}
