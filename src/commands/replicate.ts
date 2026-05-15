import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import pLimit from 'p-limit';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { diffExtensions } from '../reconcile/differ.js';
import { buildPlan, summarizePlan } from '../reconcile/planner.js';
import type { Plan, PlanAction } from '../reconcile/planner.js';
import { getInstaller } from '../installers/index.js';
import { resolveExtension } from '../marketplace/resolver.js';
import { getCliInstallHint } from '../utils/cli-detect.js';
import type { ResolverOptions } from '../marketplace/resolver.js';

export interface ReplicateOptions {
  from: string;
  to: string;
  dryRun?: boolean;
  yes?: boolean;
  exclude?: string;
  onlyMissing?: boolean;
  prune?: boolean;
  allowMsMarketplace?: boolean;
}

// ─────────────────────────── helpers ────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

const RULE = '─'.repeat(56);

function formatAction(a: PlanAction): string {
  switch (a.type) {
    case 'install':
      return (
        `${chalk.green('+')} ${chalk.green(pad('install', 9))} ` +
        `${chalk.cyan(a.extensionId)}${a.version ? chalk.dim(`@${a.version}`) : ''}`
      );
    case 'upgrade':
      return (
        `${chalk.yellow('↑')} ${chalk.yellow(pad('upgrade', 9))} ` +
        `${chalk.cyan(a.extensionId)}  ` +
        `${chalk.dim(a.fromVersion)} → ${chalk.bold(a.toVersion)}`
      );
    case 'uninstall':
      return (
        `${chalk.red('-')} ${chalk.red(pad('uninstall', 9))} ` + chalk.cyan(a.extensionId)
      );
    case 'skip':
      return (
        `${chalk.dim('·')} ${chalk.dim(pad('skip', 9))} ` +
        `${chalk.dim(a.extensionId)}  ${chalk.dim(`(${a.reason})`)}`
      );
  }
}

function printPlan(plan: Plan): void {
  const { installs, upgrades, uninstalls, skips } = summarizePlan(plan);
  console.log('');
  console.log(
    `   ${chalk.bold('Plan:')} ${chalk.bold(plan.source)} ${chalk.dim('→')} ${chalk.bold(plan.target)}`,
  );
  console.log(`   ${RULE}`);
  for (const action of plan.actions) {
    console.log(`   ${formatAction(action)}`);
  }
  console.log(`   ${RULE}`);
  const parts: string[] = [];
  if (installs) parts.push(`${chalk.green(installs)} install${installs !== 1 ? 's' : ''}`);
  if (upgrades) parts.push(`${chalk.yellow(upgrades)} upgrade${upgrades !== 1 ? 's' : ''}`);
  if (uninstalls) parts.push(`${chalk.red(uninstalls)} uninstall${uninstalls !== 1 ? 's' : ''}`);
  if (skips) parts.push(`${chalk.dim(skips)} skip${skips !== 1 ? 's' : ''}`);
  console.log(`   ${parts.join(', ') || chalk.dim('nothing to do')}`);
  console.log('');
}

type ExecutionResult = { action: PlanAction; success: boolean; error?: string };

function printSummary(results: ExecutionResult[]): void {
  const ok = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success).length;
  console.log('');
  console.log(`   ${RULE}`);
  if (fail === 0) {
    console.log(`   ${chalk.green('✓')} ${ok} action${ok !== 1 ? 's' : ''} completed successfully`);
  } else {
    console.log(
      `   ${chalk.yellow('!')} ${ok} succeeded, ${chalk.red(fail)} failed`,
    );
    for (const r of results.filter((r) => !r.success)) {
      const id = 'extensionId' in r.action ? r.action.extensionId : '?';
      console.log(`     ${chalk.red('✗')} ${chalk.cyan(id)}: ${r.error ?? 'unknown error'}`);
    }
  }
  console.log(`   ${RULE}`);
}

// ─────────────────────────── command ────────────────────────────

export async function replicateCommand(opts: ReplicateOptions): Promise<void> {
  const sourceFamily = opts.from as IDEFamily;
  const targetFamily = opts.to as IDEFamily;

  if (!ALL_FAMILIES.includes(sourceFamily)) {
    console.error(chalk.red(`Unknown source IDE: "${opts.from}". Valid: ${ALL_FAMILIES.join(', ')}`));
    process.exit(1);
  }
  if (!ALL_FAMILIES.includes(targetFamily)) {
    console.error(chalk.red(`Unknown target IDE: "${opts.to}". Valid: ${ALL_FAMILIES.join(', ')}`));
    process.exit(1);
  }
  if (sourceFamily === targetFamily) {
    console.error(chalk.red('Source and target IDE cannot be the same.'));
    process.exit(1);
  }

  const resolverOpts: ResolverOptions = { allowMsMarketplace: opts.allowMsMarketplace };
  const exclude = opts.exclude ? opts.exclude.split(',').map((e) => e.trim()).filter(Boolean) : [];

  // ── 1. Scan both IDEs ──────────────────────────────────────────
  const scanSpinner = ora('Scanning IDEs…').start();
  const inventories = runDetectors([sourceFamily, targetFamily]);
  const [sourceInv, targetInv] = inventories;
  scanSpinner.stop();

  if (!sourceInv.ide.installed) {
    console.error(chalk.red(`Source IDE "${sourceFamily}" is not installed (extensions directory not found).`));
    process.exit(1);
  }

  // ── 2. Build initial plan from diff ───────────────────────────
  const diff = diffExtensions(sourceInv.extensions, targetInv.extensions);
  const rawPlan = buildPlan(sourceFamily, targetFamily, diff, {
    exclude,
    onlyMissing: opts.onlyMissing,
    prune: opts.prune,
  });

  // ── 3. Marketplace pre-check for install/upgrade actions ──────
  //    This enriches the plan before display so users know which
  //    extensions will be skipped due to marketplace unavailability.
  const preCheckSpinner = ora('Checking marketplace availability…').start();
  const checkLimit = pLimit(5);

  const enrichedActions: PlanAction[] = await Promise.all(
    rawPlan.actions.map((action) =>
      checkLimit(async () => {
        if (action.type !== 'install' && action.type !== 'upgrade') return action;
        const resolved = await resolveExtension(action.extensionId, targetFamily, resolverOpts);
        if (!resolved) {
          return {
            type: 'skip' as const,
            extensionId: action.extensionId,
            reason: `not found on marketplace`,
          };
        }
        return action;
      }),
    ),
  );
  preCheckSpinner.stop();

  const enrichedPlan: Plan = { ...rawPlan, actions: enrichedActions };

  // ── 4. Print plan ─────────────────────────────────────────────
  printPlan(enrichedPlan);

  if (opts.dryRun) {
    console.log(chalk.dim('Dry run — no changes made.\n'));
    return;
  }

  const executableActions = enrichedPlan.actions.filter((a) => a.type !== 'skip');
  if (executableActions.length === 0) {
    console.log(chalk.green('Nothing to do.\n'));
    return;
  }

  // ── 5. Confirm (unless --yes) ─────────────────────────────────
  if (!opts.yes) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Apply this plan?',
      initial: true,
    });
    if (!confirmed) {
      console.log(chalk.dim('\nAborted.\n'));
      return;
    }
    console.log('');
  }

  // ── 6. Check target CLI ───────────────────────────────────────
  const installer = getInstaller(targetFamily);
  if (!(await installer.isAvailable())) {
    console.error(chalk.red(`\n${targetFamily} CLI not found on PATH.`));
    console.error(chalk.dim(getCliInstallHint(targetFamily)));
    process.exit(1);
  }

  // ── 7. Execute ────────────────────────────────────────────────
  // Serialize within a single target IDE to avoid CLI lock contention.
  const execLimit = pLimit(1);
  const results: ExecutionResult[] = [];

  await Promise.all(
    executableActions.map((action) =>
      execLimit(async () => {
        const label = actionLabel(action);
        const spinner = ora(label).start();

        try {
          let success = false;
          let error: string | undefined;

          if (action.type === 'install') {
            const r = await installer.install(action.extensionId, action.version);
            success = r.success;
            error = r.error;
          } else if (action.type === 'upgrade') {
            const r = await installer.install(action.extensionId, action.toVersion);
            success = r.success;
            error = r.error;
          } else if (action.type === 'uninstall') {
            const r = await installer.uninstall(action.extensionId);
            success = r.success;
            error = r.error;
          }

          if (success) {
            spinner.succeed(`${chalk.green('✓')} ${label}`);
          } else {
            spinner.fail(`${chalk.red('✗')} ${label}: ${error}`);
          }
          results.push({ action, success, error });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          spinner.fail(`${chalk.red('✗')} ${label}: ${msg}`);
          results.push({ action, success: false, error: msg });
        }
      }),
    ),
  );

  printSummary(results);

  if (results.some((r) => !r.success)) process.exit(1);
}

function actionLabel(action: PlanAction): string {
  switch (action.type) {
    case 'install':
      return `install ${action.extensionId}${action.version ? `@${action.version}` : ''}`;
    case 'upgrade':
      return `upgrade ${action.extensionId} ${action.fromVersion} → ${action.toVersion}`;
    case 'uninstall':
      return `uninstall ${action.extensionId}`;
    case 'skip':
      return `skip ${action.extensionId}`;
  }
}
