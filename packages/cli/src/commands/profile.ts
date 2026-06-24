/**
 * `ide-sync profile` command group — named extension profiles for scoped sync.
 */
import chalk from 'chalk';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  readProfiles,
} from 'ide-sync-core';

const RULE = '─'.repeat(54);

export async function profileCreateCommand(name: string, opts: { extensions?: string }): Promise<void> {
  const extensionIds = (opts.extensions ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (extensionIds.length === 0) {
    console.error(chalk.red('  --extensions <ids> is required (comma-separated extension IDs).'));
    process.exit(1);
  }
  try {
    const profile = createProfile(name, extensionIds);
    console.log(chalk.green(`  ✓ Profile '${profile.name}' created with ${profile.extensionIds.length} extension(s).`));
  } catch (err) {
    console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

export async function profileUpdateCommand(name: string, opts: { extensions?: string }): Promise<void> {
  const extensionIds = (opts.extensions ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (extensionIds.length === 0) {
    console.error(chalk.red('  --extensions <ids> is required (comma-separated extension IDs).'));
    process.exit(1);
  }
  try {
    const profile = updateProfile(name, extensionIds);
    console.log(chalk.green(`  ✓ Profile '${profile.name}' updated — now ${profile.extensionIds.length} extension(s).`));
  } catch (err) {
    console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

export async function profileDeleteCommand(name: string): Promise<void> {
  try {
    deleteProfile(name);
    console.log(chalk.dim(`  Profile '${name}' deleted.`));
  } catch (err) {
    console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

export async function profileListCommand(): Promise<void> {
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.log(chalk.dim('\n  No profiles defined. Use `ide-sync profile create <name> --extensions a,b,c`.\n'));
    return;
  }

  console.log('');
  console.log(chalk.bold('  Extension profiles'));
  console.log(`  ${RULE}`);
  for (const profile of profiles) {
    console.log(`  ${chalk.cyan(profile.name)}  (${profile.extensionIds.length} extension(s))`);
  }
  console.log(`  ${RULE}`);
  console.log('');
}

export async function profileShowCommand(name: string): Promise<void> {
  const profile = readProfiles()[name];
  if (!profile) {
    console.error(chalk.red(`  Profile '${name}' does not exist.`));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold(`  Profile: ${profile.name}`));
  console.log(`  ${RULE}`);
  for (const id of profile.extensionIds) console.log(`  ${chalk.cyan(id)}`);
  console.log(`  ${RULE}`);
  console.log('');
}
