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
import type { LocalAction, MergePlan } from '../sync/types.js';

export interface PullOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
  keepLocalExtensions?: boolean;
  /** When true, suppress all console output (for daemon use). */
  silent?: boolean;
  /** If set and !autoApplyLargeChanges, abort when changed% exceeds this. */
  largeChangeThresholdPercent?: number;
  autoApplyLargeChanges?: boolean;
}

export interface PullResult {
  ok: boolean;
  pulled: number;
  conflicts: number;
  error?: string;
  skipped?: 'up-to-date' | 'remote-empty' | 'dry-run' | 'aborted' | 'large-change' | 'unresolved-conflicts';
  plan?: MergePlan;
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

/** Headless pull — returns structured result, no process.exit, no interactive prompts. */
export async function runPull(opts: PullOptions = {}): Promise<PullResult> {
  const config = readConfig();
  const conflictPolicy = (opts.conflict ?? config.conflictPolicy) as import('../sync/types.js').ConflictPolicy;
  const silent = opts.silent ?? false;

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const releaseLock = acquireLock();

  try {
    const backend = createBackend(config);
    const remote = await backend.readState();

    if (remote === null) {
      return { ok: true, pulled: 0, conflicts: 0, skipped: 'remote-empty' };
    }

    const inventories = runDetectors(families);
    const installed = buildInstalledSet(inventories);
    const base = readLastSyncedState();

    const plan = threeWayMerge({
      base,
      installed,
      remote,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      policy: conflictPolicy,
      tombstoneGCDays: config.tombstoneGCDays,
    });

    if (hasUnresolvedConflicts(plan.conflicts)) {
      return { ok: false, pulled: 0, conflicts: plan.conflicts.length, skipped: 'unresolved-conflicts', plan };
    }

    const localActions = opts.keepLocalExtensions
      ? plan.localActions.filter((a) => a.type !== 'uninstall-local')
      : plan.localActions;

    if (localActions.length === 0) {
      return { ok: true, pulled: 0, conflicts: plan.conflicts.length, skipped: 'up-to-date', plan };
    }

    // Large-change gate (daemon safety check).
    if (opts.largeChangeThresholdPercent !== undefined && !opts.autoApplyLargeChanges) {
      const totalRemote = Object.keys(remote.extensions).length;
      const changed = plan.localActions.length + plan.remoteActions.length;
      const pct = totalRemote > 0 ? (changed / totalRemote) * 100 : 0;
      if (pct >= opts.largeChangeThresholdPercent) {
        return { ok: false, pulled: 0, conflicts: plan.conflicts.length, skipped: 'large-change', plan };
      }
    }

    if (opts.dryRun) {
      return { ok: true, pulled: 0, conflicts: plan.conflicts.length, skipped: 'dry-run', plan };
    }

    const limit = pLimit(1);
    type Result = { action: LocalAction; success: boolean; error?: string };
    const results: Result[] = [];

    await Promise.all(
      localActions.map((action) =>
        limit(async () => {
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

            if (!silent) {
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
            } else {
              try {
                let result;
                if (action.type === 'install-local') {
                  result = await installer.install(action.extensionId, action.desiredVersion);
                } else {
                  result = await installer.uninstall(action.extensionId);
                }
                results.push({ action, success: result.success, error: result.error });
              } catch (err) {
                results.push({ action, success: false, error: err instanceof Error ? err.message : String(err) });
              }
            }
          }
        }),
      ),
    );

    const anyFailed = results.some((r) => !r.success);
    if (!anyFailed) {
      const newState = applyRemotePlan(remote, plan, config.deviceId, config.deviceName);
      const hash = hashState(newState);
      const stamped = stampDevice(newState, config.deviceId, config.deviceName, hash);
      writeLastSyncedState(stamped);
      return { ok: true, pulled: localActions.length, conflicts: plan.conflicts.length, plan };
    } else {
      const errors = results.filter((r) => !r.success).map((r) => r.error).filter(Boolean).join('; ');
      return { ok: false, pulled: 0, conflicts: plan.conflicts.length, error: errors || 'some actions failed', plan };
    }
  } finally {
    releaseLock();
  }
}

/** Interactive CLI wrapper around runPull. */
export async function pullCommand(opts: PullOptions = {}): Promise<void> {
  const config = readConfig();
  const conflictPolicy = (opts.conflict ?? config.conflictPolicy) as import('../sync/types.js').ConflictPolicy;

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const releaseLock = acquireLock();

  try {
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

    const scanSpinner = ora('Scanning local IDEs…').start();
    const inventories = runDetectors(families);
    const installed = buildInstalledSet(inventories);
    scanSpinner.succeed(`Found ${installed.length} local extension${installed.length !== 1 ? 's' : ''}`);

    const base = readLastSyncedState();

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

    const localActions = opts.keepLocalExtensions
      ? plan.localActions.filter((a) => a.type !== 'uninstall-local')
      : plan.localActions;

    if (localActions.length === 0) {
      console.log(chalk.green('\n  Local IDEs are already up to date.\n'));
      return;
    }

    printLocalPlan(localActions);

    if (opts.dryRun) {
      console.log(chalk.dim('  Dry run — no changes made.\n'));
      return;
    }

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

    const limit = pLimit(1);
    type Result = { action: LocalAction; success: boolean; error?: string };
    const results: Result[] = [];

    await Promise.all(
      localActions.map((action) =>
        limit(async () => {
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
