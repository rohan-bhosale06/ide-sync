import chalk from 'chalk';
import ora from 'ora';
import { readConfig, readLastSyncedState, writeLastSyncedState } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { buildInstalledSet, hashState } from '../sync/state.js';
import { threeWayMerge, applyRemotePlan, stampDevice } from '../sync/engine.js';
import { formatConflictReport, hasUnresolvedConflicts } from '../sync/conflict.js';
import { createBackend, PushConflictError } from '../sync/backends/index.js';
import { acquireLock } from '../utils/lock.js';

export interface PushOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
}

export async function pushCommand(opts: PushOptions = {}): Promise<void> {
  const config = readConfig();
  const conflictPolicy = (opts.conflict ?? config.conflictPolicy) as import('../sync/types.js').ConflictPolicy;

  const families: IDEFamily[] =
    opts.ide
      ? opts.ide.split(',').map((s) => s.trim() as IDEFamily)
      : ALL_FAMILIES;

  const releaseLock = acquireLock();

  try {
    // ── 1. Scan local IDEs ────────────────────────────────────────
    const scanSpinner = ora('Scanning local IDEs…').start();
    const inventories = runDetectors(families);
    const installed = buildInstalledSet(inventories);
    scanSpinner.succeed(`Found ${installed.length} unique extension${installed.length !== 1 ? 's' : ''}`);

    // ── 2. Fetch remote state ─────────────────────────────────────
    const backend = createBackend(config);
    const fetchSpinner = ora('Fetching remote state…').start();
    const remote = await backend.readState();
    fetchSpinner.succeed(
      remote ? `Remote has ${Object.keys(remote.extensions).length} extensions` : 'Remote is empty',
    );

    const base = readLastSyncedState();

    // ── 3. Merge ──────────────────────────────────────────────────
    const plan = threeWayMerge({
      base,
      installed,
      remote,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      policy: conflictPolicy,
      tombstoneGCDays: config.tombstoneGCDays,
    });

    // Report conflicts.
    if (plan.conflicts.length > 0) {
      console.log(formatConflictReport(plan.conflicts));
      if (hasUnresolvedConflicts(plan.conflicts)) {
        console.error(chalk.red('  Push aborted: unresolved conflicts (use --conflict to auto-resolve).\n'));
        process.exit(1);
      }
    }

    const pushActions = plan.remoteActions;

    if (pushActions.length === 0 && plan.tombstonesToGC.length === 0) {
      console.log(chalk.green('\n  Remote is already up to date.\n'));
      return;
    }

    // ── 4. Show what will be pushed ───────────────────────────────
    console.log('');
    console.log(`  ${chalk.bold('Push plan:')}`);
    const RULE = '─'.repeat(50);
    console.log(`  ${RULE}`);
    for (const a of pushActions) {
      if (a.type === 'push-add') {
        console.log(`  ${chalk.green('+')} add     ${chalk.cyan(a.extensionId)}   ${chalk.dim(a.reason)}`);
      } else if (a.type === 'push-remove') {
        console.log(`  ${chalk.red('-')} remove  ${chalk.cyan(a.extensionId)}   ${chalk.dim(a.reason)}`);
      } else {
        console.log(`  ${chalk.yellow('↑')} update  ${chalk.cyan(a.extensionId)}   ${chalk.dim(a.reason)}`);
      }
    }
    if (plan.tombstonesToGC.length > 0) {
      console.log(`  ${chalk.dim('gc')}      ${plan.tombstonesToGC.length} stale tombstone${plan.tombstonesToGC.length !== 1 ? 's' : ''} will be cleaned up`);
    }
    console.log(`  ${RULE}`);
    console.log('');

    if (opts.dryRun) {
      console.log(chalk.dim('  Dry run — no changes pushed.\n'));
      return;
    }

    // ── 5. Push ───────────────────────────────────────────────────
    const newState = applyRemotePlan(remote, plan, config.deviceId, config.deviceName);
    const newHash = hashState(newState);
    const stampedState = stampDevice(newState, config.deviceId, config.deviceName, newHash);

    const adds = pushActions.filter((a) => a.type === 'push-add').length;
    const removes = pushActions.filter((a) => a.type === 'push-remove').length;
    const updates = pushActions.filter((a) => a.type === 'push-version-update').length;
    const msgParts: string[] = [];
    if (adds) msgParts.push(`+${adds}`);
    if (removes) msgParts.push(`-${removes}`);
    if (updates) msgParts.push(`~${updates}`);
    const commitMsg = `sync: ${config.deviceName} ${msgParts.join(' ')} @ ${new Date().toISOString()}`;

    const pushSpinner = ora('Pushing to remote…').start();

    try {
      await backend.writeState(stampedState, commitMsg);
      pushSpinner.succeed('Pushed to remote');
    } catch (err) {
      if (err instanceof PushConflictError) {
        pushSpinner.warn('Push conflict — re-pulling and retrying…');
        const freshRemote = await backend.readState();
        const retryPlan = threeWayMerge({
          base,
          installed,
          remote: freshRemote,
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          policy: conflictPolicy,
          tombstoneGCDays: config.tombstoneGCDays,
        });
        const retryState = applyRemotePlan(freshRemote, retryPlan, config.deviceId, config.deviceName);
        const retryHash = hashState(retryState);
        const retryStamped = stampDevice(retryState, config.deviceId, config.deviceName, retryHash);
        const retrySpinner = ora('Retry push…').start();
        await backend.writeState(retryStamped, commitMsg);
        retrySpinner.succeed('Pushed to remote (after retry)');
        writeLastSyncedState(retryStamped);
        console.log(chalk.green('\n  Push complete.\n'));
        return;
      }
      throw err;
    }

    // ── 6. Persist merge base ─────────────────────────────────────
    writeLastSyncedState(stampedState);
    console.log(chalk.green('\n  Push complete.\n'));
  } finally {
    releaseLock();
  }
}
