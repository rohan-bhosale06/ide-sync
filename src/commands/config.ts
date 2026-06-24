/**
 * `ide-sync config` command group — Phase 5 config-domain management.
 *
 * Subcommands:
 *   list            Show which domains are enabled per IDE
 *   show            Print the captured snapshot for a domain
 *   diff            Show translation+merge plan (local↔local or local↔remote)
 *   replicate       One-shot copy from one IDE to another
 *   enable          Enable a domain (globally or for a specific IDE)
 *   disable         Disable / opt-out a domain
 *   backup          Snapshot all IDE config files now
 *   restore         Restore from a named backup
 *   backups         List available backups
 */
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { readConfig, readConfigSyncConfig, writeConfigSyncConfig, enableConfigDomain, disableConfigDomain, readLastSyncedState } from '../config/config.js';
import { runDetectors, ALL_FAMILIES } from '../detectors/index.js';
import type { IDEFamily } from '../detectors/types.js';
import { ALL_CONFIG_DOMAINS, type ConfigDomain } from '../config-sync/types.js';
import { readConfigSnapshot } from '../config-sync/reader.js';
import { configDiff, configReplicate, previewConfigChanges } from '../config-sync/engine.js';
import { backupFiles } from '../config-sync/backup.js';
import { runListBackups, runRestoreBackup } from './backups.js';
import { createBackend } from '../sync/backends/index.js';
import path from 'path';
import fs from 'fs';

const RULE = '─'.repeat(54);

// ─────────────────────────── list ────────────────────────────────

export async function configListCommand(): Promise<void> {
  const cfg = readConfigSyncConfig();
  const inventories = runDetectors();

  console.log('');
  console.log(chalk.bold('  Config sync domains'));
  console.log(`  ${RULE}`);

  if (cfg.enabledDomains.length === 0) {
    console.log(chalk.yellow('  No domains enabled. Use `ide-sync config enable <domain>` to opt in.'));
    console.log('');
    console.log('  Available domains: ' + ALL_CONFIG_DOMAINS.map((d) => chalk.cyan(d)).join(', '));
    console.log('');
    return;
  }

  for (const domain of ALL_CONFIG_DOMAINS) {
    const globallyEnabled = cfg.enabledDomains.includes(domain);
    const ideStatuses = inventories
      .filter((inv) => inv.ide.installed)
      .map((inv) => {
        const optedOut = (cfg.domainOptOuts[inv.ide.family] ?? []).includes(domain);
        const effective = globallyEnabled && !optedOut;
        return `${inv.ide.family}:${effective ? chalk.green('✓') : chalk.dim('–')}`;
      })
      .join('  ');

    const enabledLabel = globallyEnabled ? chalk.green('enabled') : chalk.dim('disabled');
    console.log(`  ${domain.padEnd(14)} ${enabledLabel.padEnd(20)}  ${ideStatuses}`);
  }

  console.log(`  ${RULE}`);
  console.log('');
}

// ─────────────────────────── show ────────────────────────────────

export async function configShowCommand(opts: { ide?: string; domain?: string }): Promise<void> {
  const cfg = readConfigSyncConfig();
  const family = (opts.ide ?? 'vscode') as IDEFamily;
  const domain = (opts.domain ?? 'settings') as ConfigDomain;

  const inventories = runDetectors([family]);
  const ideInv = inventories.find((inv) => inv.ide.family === family);

  if (!ideInv?.ide.installed || !ideInv.ide.configPath) {
    console.error(chalk.red(`  IDE '${family}' not found or not installed.`));
    process.exit(1);
  }

  const snapshot = readConfigSnapshot(family, ideInv.ide.configPath, [domain], cfg.uiStateWhitelistExtra);

  console.log('');
  console.log(chalk.bold(`  Config snapshot: ${family} / ${domain}`));
  console.log(`  ${RULE}`);

  switch (domain) {
    case 'settings':
      console.log(snapshot.domains.settings?.raw ?? chalk.dim('  (no settings.json found)'));
      break;
    case 'keybindings':
      console.log(snapshot.domains.keybindings?.raw ?? chalk.dim('  (no keybindings.json found)'));
      break;
    case 'snippets': {
      const files = Object.keys(snapshot.domains.snippets);
      if (files.length === 0) {
        console.log(chalk.dim('  (no snippet files found)'));
      } else {
        for (const [filename, entry] of Object.entries(snapshot.domains.snippets)) {
          console.log(chalk.cyan(`\n  ── ${filename} ──`));
          console.log(entry.raw);
        }
      }
      break;
    }
    case 'tasks':
      console.log(snapshot.domains.tasks?.raw ?? chalk.dim('  (no tasks.json found)'));
      break;
    case 'mcp':
      console.log(snapshot.domains.mcp?.raw ?? chalk.dim('  (no mcp.json found)'));
      break;
    case 'ui-state':
      console.log(JSON.stringify(snapshot.domains.uiState ?? {}, null, 2));
      break;
    default:
      console.log(chalk.red(`  Unknown domain: ${domain}`));
  }
  console.log('');
}

// ─────────────────────────── diff ────────────────────────────────

export async function configDiffCommand(opts: { from?: string; to?: string; remote?: boolean }): Promise<void> {
  const cfg = readConfigSyncConfig();
  const inventories = runDetectors();

  if (opts.remote) {
    const mainConfig = readConfig();
    const backend = createBackend(mainConfig);
    const spinner = ora('Fetching remote state…').start();
    const remoteState = await backend.readState();
    spinner.succeed(remoteState ? 'Remote state loaded' : 'Remote is empty');

    if (!remoteState?.configs) {
      console.log(chalk.yellow('\n  No config state on remote yet. Run `ide-sync push` first.\n'));
      return;
    }

    const family = (opts.from ?? 'vscode') as IDEFamily;
    const inv = inventories.find((i) => i.ide.family === family);
    if (!inv?.ide.installed || !inv.ide.configPath) {
      console.error(chalk.red(`  IDE '${family}' not found.`));
      process.exit(1);
    }

    const baseState = readLastSyncedState();
    const changesByDomain = await previewConfigChanges({
      targetIDE: inv.ide,
      cfg,
      baseState,
      remoteState,
      policy: mainConfig.conflictPolicy,
    });

    const anyChanges = Object.values(changesByDomain).some((changes) =>
      changes?.some((c) => c.status !== 'unchanged'),
    );

    if (!anyChanges) {
      console.log(chalk.green(`\n  ${family} is already in sync with remote for all enabled domains.\n`));
      return;
    }

    console.log('');
    console.log(chalk.bold(`  Local (${family}) ↔ remote diff`));
    for (const [domain, changes] of Object.entries(changesByDomain)) {
      const nonTrivial = (changes ?? []).filter((c) => c.status !== 'unchanged');
      if (nonTrivial.length === 0) continue;
      console.log(`\n  ${chalk.bold(domain)}`);
      console.log(`  ${RULE}`);
      for (const c of nonTrivial) {
        const marker = c.status === 'conflict' ? chalk.red('!')
          : c.status === 'local-only' ? chalk.green('+')
          : c.status === 'remote-only' ? chalk.yellow('~')
          : chalk.cyan('=');
        console.log(`  ${marker} ${c.key}  ${chalk.dim(`local=${JSON.stringify(c.localValue)} remote=${JSON.stringify(c.remoteValue)} (${c.status})`)}`);
      }
    }
    console.log('');
    return;
  }

  const fromFamily = (opts.from ?? 'vscode') as IDEFamily;
  const toFamily = (opts.to ?? 'cursor') as IDEFamily;

  const fromInv = inventories.find((inv) => inv.ide.family === fromFamily);
  const toInv = inventories.find((inv) => inv.ide.family === toFamily);

  if (!fromInv?.ide.installed || !fromInv.ide.configPath) {
    console.error(chalk.red(`  IDE '${fromFamily}' not found.`)); process.exit(1);
  }
  if (!toInv?.ide.installed || !toInv.ide.configPath) {
    console.error(chalk.red(`  IDE '${toFamily}' not found.`)); process.exit(1);
  }

  const spinner = ora(`Computing diff ${fromFamily} → ${toFamily}…`).start();
  const diffs = await configDiff({ sourceIDE: fromInv.ide, targetIDE: toInv.ide, cfg });
  spinner.succeed('Diff computed');

  if (diffs.length === 0) {
    console.log(chalk.green(`\n  ${fromFamily} and ${toFamily} are in sync for all enabled domains.\n`));
    return;
  }

  console.log('');
  for (const diff of diffs) {
    console.log(chalk.bold(`  ${diff.domain}`));
    console.log(`  ${RULE}`);
    for (const k of diff.addedKeys) console.log(`  ${chalk.green('+')} ${k}`);
    for (const k of diff.removedKeys) console.log(`  ${chalk.red('-')} ${k}`);
    for (const k of diff.modifiedKeys) console.log(`  ${chalk.yellow('~')} ${k}`);
    console.log('');
  }
}

// ─────────────────────────── replicate ───────────────────────────

export async function configReplicateCommand(opts: {
  from: string;
  to: string;
  domain?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<void> {
  const cfg = readConfigSyncConfig();
  const fromFamily = opts.from as IDEFamily;
  const toFamilies = opts.to.split(',').map((s) => s.trim() as IDEFamily);
  const domains: ConfigDomain[] = opts.domain
    ? opts.domain.split(',').map((s) => s.trim() as ConfigDomain)
    : ALL_CONFIG_DOMAINS;

  const inventories = runDetectors();
  const fromInv = inventories.find((inv) => inv.ide.family === fromFamily);
  if (!fromInv?.ide.installed || !fromInv.ide.configPath) {
    console.error(chalk.red(`  Source IDE '${fromFamily}' not found.`)); process.exit(1);
  }

  const targetIDEs = toFamilies
    .map((f) => inventories.find((inv) => inv.ide.family === f)?.ide)
    .filter((ide): ide is NonNullable<typeof ide> => !!(ide?.installed && ide.configPath));

  if (targetIDEs.length === 0) {
    console.error(chalk.red('  No target IDEs found.')); process.exit(1);
  }

  console.log('');
  console.log(chalk.bold(`  Replicate ${fromFamily} → ${toFamilies.join(', ')}`));
  console.log(`  Domains: ${domains.map((d) => chalk.cyan(d)).join(', ')}`);
  console.log(`  ${RULE}`);

  if (opts.dryRun) {
    console.log(chalk.dim('  Dry run — no changes will be made.\n'));
  }

  if (!opts.dryRun && !opts.yes) {
    const { confirmed } = await prompts({ type: 'confirm', name: 'confirmed', message: 'Apply?', initial: true });
    if (!confirmed) { console.log(chalk.dim('\n  Aborted.\n')); return; }
  }

  const spinner = ora('Replicating config…').start();
  const result = await configReplicate({ sourceIDE: fromInv.ide, targetIDEs, domains, cfg, dryRun: opts.dryRun });
  spinner.succeed(`Applied: ${result.appliedDomains.join(', ') || 'nothing'}`);
  console.log('');
}

// ─────────────────────────── enable/disable ──────────────────────

export async function configEnableCommand(domain: string, opts: { ide?: string }): Promise<void> {
  if (!ALL_CONFIG_DOMAINS.includes(domain as ConfigDomain)) {
    console.error(chalk.red(`  Unknown domain '${domain}'. Valid: ${ALL_CONFIG_DOMAINS.join(', ')}`));
    process.exit(1);
  }
  enableConfigDomain(domain as ConfigDomain, opts.ide as IDEFamily | undefined);
  console.log(chalk.green(`  ✓ '${domain}' enabled${opts.ide ? ` for ${opts.ide}` : ' globally'}.`));
}

export async function configDisableCommand(domain: string, opts: { ide?: string }): Promise<void> {
  if (!ALL_CONFIG_DOMAINS.includes(domain as ConfigDomain)) {
    console.error(chalk.red(`  Unknown domain '${domain}'. Valid: ${ALL_CONFIG_DOMAINS.join(', ')}`));
    process.exit(1);
  }
  disableConfigDomain(domain as ConfigDomain, opts.ide as IDEFamily | undefined);
  console.log(chalk.dim(`  '${domain}' disabled${opts.ide ? ` for ${opts.ide}` : ' globally'}.`));
}

// ─────────────────────────── backup ──────────────────────────────

export async function configBackupCommand(): Promise<void> {
  const cfg = readConfigSyncConfig();
  const inventories = runDetectors();

  const spinner = ora('Backing up config files…').start();
  let totalFiles = 0;

  for (const inv of inventories) {
    if (!inv.ide.installed || !inv.ide.configPath) continue;

    const filesToBackup: Array<{ sourcePath: string; relativeName?: string }> = [];
    const configPath = inv.ide.configPath;

    const candidates = [
      'settings.json', 'keybindings.json', 'tasks.json', 'mcp.json', '.mcp.json',
    ];
    for (const name of candidates) {
      const p = path.join(configPath, name);
      if (fs.existsSync(p)) filesToBackup.push({ sourcePath: p });
    }

    // Snippets dir.
    const snippetsDir = path.join(configPath, 'snippets');
    if (fs.existsSync(snippetsDir)) {
      for (const f of fs.readdirSync(snippetsDir)) {
        if (f.endsWith('.json') || f.endsWith('.code-snippets')) {
          filesToBackup.push({ sourcePath: path.join(snippetsDir, f), relativeName: path.join('snippets', f) });
        }
      }
    }

    if (filesToBackup.length > 0) {
      backupFiles(filesToBackup, inv.ide.family, 'manual');
      totalFiles += filesToBackup.length;
    }
  }

  spinner.succeed(`Backed up ${totalFiles} file(s) across ${inventories.filter((i) => i.ide.installed).length} IDE(s)`);
  console.log('');
}

// ─────────────────────────── restore ─────────────────────────────

export async function configRestoreCommand(backupId: string, opts: { ide?: string; yes?: boolean }): Promise<void> {
  const inventories = runDetectors();
  const families = opts.ide
    ? [opts.ide as IDEFamily]
    : inventories.filter((inv) => inv.ide.installed).map((inv) => inv.ide.family);

  if (!opts.yes) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: `Restore backup '${backupId}' for ${families.join(', ')}?`,
      initial: false,
    });
    if (!confirmed) { console.log(chalk.dim('\n  Aborted.\n')); return; }
  }

  for (const family of families) {
    const result = runRestoreBackup({ backupId, ide: family });
    if (result.ok) {
      console.log(chalk.green(`  ✓ ${family}: restored ${result.restored.length} file(s)`));
    } else {
      console.log(chalk.red(`  ✗ ${family}: ${result.error}`));
    }
  }
  console.log('');
}

// ─────────────────────────── backups list ────────────────────────

export async function configBackupsCommand(): Promise<void> {
  const backups = runListBackups();

  if (backups.length === 0) {
    console.log(chalk.dim('\n  No backups found. Run `ide-sync config backup` to create one.\n'));
    return;
  }

  console.log('');
  console.log(chalk.bold('  Available backups'));
  console.log(`  ${RULE}`);

  for (const backup of backups) {
    const age = Math.round((Date.now() - new Date(backup.createdAt).getTime()) / 60000);
    const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
    console.log(`  ${chalk.cyan(backup.id.slice(0, 20))}…  ${chalk.dim(ageStr)}  IDEs: ${backup.ides.join(', ')}`);
  }

  console.log(`  ${RULE}`);
  console.log(`  ${backups.length} backup(s). Use \`ide-sync config restore <id>\` to restore.\n`);
}
