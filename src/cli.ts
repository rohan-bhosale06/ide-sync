import { Command } from 'commander';
import { scanCommand } from './commands/scan.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { replicateCommand } from './commands/replicate.js';

const program = new Command();

program.name('ide-sync').description('Sync extensions across VS Code-family IDEs').version('0.2.0');

// ── scan ──────────────────────────────────────────────────────────
program
  .command('scan')
  .description('Scan installed IDEs and list their extensions')
  .option('--json', 'Output raw manifest JSON', false)
  .option('--output <file>', 'Write manifest to a file instead of stdout')
  .option(
    '--ide <list>',
    'Comma-separated list of IDEs to scan (vscode,cursor,windsurf,antigravity,vscodium)',
  )
  .action((opts) => {
    scanCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── install ───────────────────────────────────────────────────────
program
  .command('install <extension...>')
  .description('Install one or more extensions into a target IDE')
  .requiredOption('--ide <name>', 'Target IDE (vscode|cursor|windsurf|antigravity|vscodium)')
  .option('--version <ver>', 'Pin to a specific extension version')
  .action((extensions: string[], opts) => {
    installCommand(extensions, opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── uninstall ─────────────────────────────────────────────────────
program
  .command('uninstall <extension>')
  .description('Uninstall an extension from a target IDE')
  .requiredOption('--ide <name>', 'Target IDE (vscode|cursor|windsurf|antigravity|vscodium)')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action((extension: string, opts) => {
    uninstallCommand(extension, opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── replicate ─────────────────────────────────────────────────────
program
  .command('replicate')
  .description('Mirror extensions from one IDE to another')
  .requiredOption('--from <ide>', 'Source IDE (vscode|cursor|windsurf|antigravity|vscodium)')
  .requiredOption('--to <ide>', 'Target IDE (vscode|cursor|windsurf|antigravity|vscodium)')
  .option('--dry-run', 'Show the plan without making any changes', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .option('--exclude <ids>', 'Comma-separated extension IDs to exclude')
  .option('--only-missing', 'Only install missing extensions; skip upgrades', false)
  .option('--prune', 'Uninstall extensions in target that are not in source', false)
  .option('--allow-ms-marketplace', 'Allow Microsoft Marketplace for non-VS Code IDEs (ToS risk)', false)
  .action((opts) => {
    replicateCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

program.parse();
