import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import pLimit from 'p-limit';
import { readConfig, readLastSyncedState, writeLastSyncedState } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { buildInstalledSet, hashState } from '../sync/state.js';
import { threeWayMerge, applyRemotePlan, stampDevice } from '../sync/engine.js';
import { formatConflictReport, hasUnresolvedConflicts } from '../sync/conflict.js';
import { createBackend } from '../sync/backends/index.js';
import { getInstaller } from '../installers/index.js';
import { acquireLock } from '../utils/lock.js';
import type { LocalAction } from '../sync/types.js';

export interface PullOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
  keepLocalExtensions?: boolean;
}

const RULE = '─'.repeat(54);

function printLocalPlan(actions: LocalAction[]): void {
  const installs = actions.filter((a) => a.type === 'install-local');
  const uninstalls = actions.filter((a) => a.type === 'uninstall-local');

  console.log('');
  console.log(`  ${chalk.bold('Pull plan:')}`);
  console.log(`  ${RULE}`);

  for (const a of installs) {
    console.log(
      `  ${chalk.green('+')} install    ${chalk.cyan(a.extensionId)}` +
      (a.desiredVersion ? chalk.dim(`@${a.desiredVersion}`) : '') +
      `   ${chalk.dim(a.reason)}`,
    );
  }
  for (const a of uninstalls) {
    console.log(
      `  ${chalk.red('-')} uninstall  ${chalk.cyan(a.extensionId)}   ${chalk.dim(a.reason)}`,
    );
  }

  console.log(`  ${RULE}`);
  const parts: string[] = [];
  if (installs.length) parts.push(`${chalk.green(installs.length)} install${installs.length !== 1 ? 's' : ''}`);
  if (uninstalls.length) parts.push(`${chalk.red(uninstalls.length)} uninstall${uninstalls.length !== 1 ? 's' : ''}`);
  console.log(`  ${parts.join(', ') || chalk.dim('nothing to do')}`);
  console.log('');
}

export async function pullCommand(opts: PullOptions = {}): Promise<void> {
  const config = readConfig();
  const conflictPolicy = (opts.conflict ?? config.conflictPolicy) as import('../sync/types.js').ConflictPolicy;

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const releaseLock = acquireLock();

  try {
    // ── 1. Fetch remote ────────────────────────────────────────────
    const backend = createBackend(config);
    const fetchSpinner = ora('Fetching remote state…').start();
    const remote = await backend.readState();
    fetchSpinner.succeed(
      remote ? `Remote has ${Object.keys(remote.extensions).length} extensions` : 'Remote is empty',
    );

    if (remote === null) {
      console.log(chalk.yellow('\n  Remote is empty — nothing to pull. Run `ide-sync push` first.\n'));
      return;
    }

    // ── 2. Scan local ──────────────────────────────────────────────
    const scanSpinner = ora('Scanning local IDEs…').start();
    const inventories = runDetectors(families);
    const installed = buildInstalledSet(inventories);
    scanSpinner.succeed(`Found ${installed.length} local extension${installed.length !== 1 ? 's' : ''}`);

    const base = readLastSyncedState();

    // ── 3. Merge ───────────────────────────────────────────────────
    const plan = threeWayMerge({
      base,
      installed,
      remote,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      policy: conflictPolicy,
      tombstoneGCDays: config.tombstoneGCDays,
    });

    if (plan.conflicts.length > 0) {
      console.log(formatConflictReport(plan.conflicts));
      if (hasUnresolvedConflicts(plan.conflicts)) {
        console.error(chalk.red('  Pull aborted: unresolved conflicts (use --conflict to auto-resolve).\n'));
        process.exit(1);
      }
    }

    // Filter out uninstalls if --keep-local-extensions.
    const localActions = opts.keepLocalExtensions
      ? plan.localActions.filter((a) => a.type !== 'uninstall-local')
      : plan.localActions;

    const executableActions = localActions;

    if (executableActions.length === 0) {
      console.log(chalk.green('\n  Local IDEs are already up to date.\n'));
      return;
    }

    // ── 4. Display plan ────────────────────────────────────────────
    printLocalPlan(executableActions);

    if (opts.dryRun) {
      console.log(chalk.dim('  Dry run — no changes made.\n'));
      return;
    }

    // ── 5. Confirm ─────────────────────────────────────────────────
    if (!opts.yes) {
      const { confirmed } = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: 'Apply this plan?',
        initial: true,
      });
      if (!confirmed) {
        console.log(chalk.dim('\n  Aborted.\n'));
        return;
      }
      console.log('');
    }

    // ── 6. Execute (build full plan first, then apply atomically) ──
    //    Collect all failures; do NOT update merge base on partial failure.
    const limit = pLimit(1); // serialise to avoid IDE CLI lock contention
    type Result = { action: LocalAction; success: boolean; error?: string };
    const results: Result[] = [];

    await Promise.all(
      executableActions.map((action) =>
        limit(async () => {
          // Determine which IDEs to target for this action.
          const targetFamilies =
            action.families?.filter((f) => families.includes(f)) ?? families;

          if (targetFamilies.length === 0) {
            results.push({ action, success: true });
            return;
          }

          for (const family of targetFamilies) {
            const installer = getInstaller(family);
            if (!(await installer.isAvailable())) continue;

            const label =
              action.type === 'install-local'
                ? `install ${action.extensionId}${action.desiredVersion ? `@${action.desiredVersion}` : ''} → ${family}`
                : `uninstall ${action.extensionId} ← ${family}`;

            const spinner = ora(label).start();

            try {
              let result;
              if (action.type === 'install-local') {
                result = await installer.install(action.extensionId, action.desiredVersion);
              } else {
                result = await installer.uninstall(action.extensionId);
              }

              if (result.success) {
                spinner.succeed(`${chalk.green('✓')} ${label}`);
                results.push({ action, success: true });
              } else {
                spinner.fail(`${chalk.red('✗')} ${label}: ${result.error}`);
                results.push({ action, success: false, error: result.error });
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              spinner.fail(`${chalk.red('✗')} ${label}: ${msg}`);
              results.push({ action, success: false, error: msg });
            }
          }
        }),
      ),
    );

    // ── 7. Persist merge base only on full success ─────────────────
    const anyFailed = results.some((r) => !r.success);
    if (!anyFailed) {
      const newState = applyRemotePlan(remote, plan, config.deviceId, config.deviceName);
      const hash = hashState(newState);
      const stamped = stampDevice(newState, config.deviceId, config.deviceName, hash);
      writeLastSyncedState(stamped);
      console.log(chalk.green('\n  Pull complete.\n'));
    } else {
      console.log('');
      console.log(`  ${chalk.yellow('!')} Some actions failed — merge base NOT updated.`);
      console.log(`  ${chalk.dim('Re-run `ide-sync pull` to retry failed actions.')}\n`);
      process.exit(1);
    }
  } finally {
    releaseLock();
  }
}
