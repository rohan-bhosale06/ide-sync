import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { ALL_FAMILIES } from '../detectors/index.js';
import { getInstaller } from '../installers/index.js';
import { getCliInstallHint } from '../utils/cli-detect.js';
import type { IDEFamily } from '../detectors/types.js';

export interface UninstallOptions {
  ide: string;
  yes?: boolean;
}

export async function uninstallCommand(extensionId: string, opts: UninstallOptions): Promise<void> {
  const family = opts.ide as IDEFamily;
  if (!ALL_FAMILIES.includes(family)) {
    console.error(chalk.red(`Unknown IDE: "${opts.ide}". Valid: ${ALL_FAMILIES.join(', ')}`));
    process.exit(1);
  }

  if (!opts.yes) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: `Uninstall ${chalk.cyan(extensionId)} from ${chalk.bold(family)}?`,
      initial: false,
    });
    if (!confirmed) {
      console.log(chalk.dim('Aborted.'));
      return;
    }
  }

  const installer = getInstaller(family);
  if (!(await installer.isAvailable())) {
    console.error(chalk.red(`\n${family} CLI not found on PATH.`));
    console.error(chalk.dim(getCliInstallHint(family)));
    process.exit(1);
  }

  const spinner = ora(`Uninstalling ${chalk.cyan(extensionId)}…`).start();
  const result = await installer.uninstall(extensionId);

  if (result.success) {
    spinner.succeed(`${chalk.green('Uninstalled')} ${chalk.cyan(extensionId)}`);
  } else {
    spinner.fail(`${chalk.red('Failed')}: ${result.error}`);
    process.exit(1);
  }
}
