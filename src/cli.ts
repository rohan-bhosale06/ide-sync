import { Command } from 'commander';
import { scanCommand } from './commands/scan.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { replicateCommand } from './commands/replicate.js';
import { initCommand } from './commands/init.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { syncCommand } from './commands/sync-cmd.js';
import { statusCommand } from './commands/status.js';
import { devicesListCommand, devicesRemoveCommand } from './commands/devices.js';

const program = new Command();

program.name('ide-sync').description('Sync extensions across VS Code-family IDEs').version('0.3.0');

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

// ── init ──────────────────────────────────────────────────────────
program
  .command('init')
  .description('Set up cloud sync (configure backend, register device)')
  .option('--backend <type>', 'Backend type: git | filesystem')
  .option('--repo <url>', 'Git repository URL (for --backend git)')
  .option('--path <dir>', 'Directory path (for --backend filesystem)')
  .option('--device <name>', 'Device display name')
  .option('-y, --yes', 'Skip confirmation prompts', false)
  .action((opts) => {
    initCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── push ──────────────────────────────────────────────────────────
program
  .command('push')
  .description('Push local extension state to the remote backend')
  .option('--dry-run', 'Show what would be pushed without making changes', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .option('--ide <list>', 'Comma-separated IDEs to include')
  .option('--conflict <policy>', 'Conflict resolution: newest|local|remote|manual')
  .action((opts) => {
    pushCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── pull ──────────────────────────────────────────────────────────
program
  .command('pull')
  .description('Pull remote state and apply locally (shows plan, confirms)')
  .option('--dry-run', 'Show what would change without applying', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .option('--ide <list>', 'Comma-separated IDEs to target')
  .option('--conflict <policy>', 'Conflict resolution: newest|local|remote|manual')
  .option('--keep-local-extensions', 'Do not uninstall local extensions even if remote removed them', false)
  .action((opts) => {
    pullCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── sync ──────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Pull then push in one shot (the everyday sync command)')
  .option('--dry-run', 'Show what would change without applying', false)
  .option('-y, --yes', 'Non-interactive (for cron / automation)', false)
  .option('--ide <list>', 'Comma-separated IDEs to include')
  .option('--conflict <policy>', 'Conflict resolution: newest|local|remote|manual')
  .option('--keep-local-extensions', 'Do not uninstall local extensions even if remote removed them', false)
  .action((opts) => {
    syncCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── status ────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show local vs remote drift summary')
  .option('--ide <list>', 'Comma-separated IDEs to include')
  .action((opts) => {
    statusCommand(opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// ── devices ───────────────────────────────────────────────────────
const devicesCmd = program
  .command('devices')
  .description('Manage registered sync devices');

devicesCmd
  .command('list')
  .description('List all registered devices')
  .action(() => {
    devicesListCommand().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

devicesCmd
  .command('remove <device-id>')
  .description('Remove a device from the sync state')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action((deviceId: string, opts) => {
    devicesRemoveCommand(deviceId, opts).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });

// Make `ide-sync devices` without a subcommand show list.
devicesCmd.action(() => {
  devicesListCommand().catch((err) => {
    console.error(err);
    process.exit(1);
  });
});

program.parse();
