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
import {
  daemonStartCommand,
  daemonStopCommand,
  daemonRestartCommand,
  daemonStatusCommand,
  daemonLogsCommand,
  daemonSyncNowCommand,
  daemonPauseCommand,
  daemonResumeCommand,
  daemonInstallCommand,
  daemonUninstallCommand,
} from './commands/daemon.js';
import { watchCommand } from './commands/watch.js';
import {
  configListCommand,
  configShowCommand,
  configDiffCommand,
  configReplicateCommand,
  configEnableCommand,
  configDisableCommand,
  configBackupCommand,
  configRestoreCommand,
  configBackupsCommand,
} from './commands/config.js';

const program = new Command();

program.name('ide-sync').description('Sync extensions across VS Code-family IDEs').version('0.5.0');

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

devicesCmd.action(() => {
  devicesListCommand().catch((err) => {
    console.error(err);
    process.exit(1);
  });
});

// ── daemon ────────────────────────────────────────────────────────
const daemonCmd = program
  .command('daemon')
  .description('Manage the background sync daemon');

daemonCmd
  .command('start')
  .description('Start the daemon in the background')
  .action(() => {
    daemonStartCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('stop')
  .description('Gracefully stop the running daemon')
  .action(() => {
    daemonStopCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('restart')
  .description('Stop then start the daemon')
  .action(() => {
    daemonRestartCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('status')
  .description('Show live daemon status (via IPC)')
  .action(() => {
    daemonStatusCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('logs')
  .description('Tail the daemon log file')
  .option('--since <duration>', 'Only show logs from last N seconds/minutes/hours (e.g. 30s, 5m, 1h)')
  .action((opts) => {
    daemonLogsCommand(opts).catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('sync-now')
  .description('Ask the running daemon to sync immediately')
  .action(() => {
    daemonSyncNowCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('pause')
  .description('Pause auto-sync (watchers keep observing, no jobs fire)')
  .action(() => {
    daemonPauseCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('resume')
  .description('Resume auto-sync after a pause')
  .action(() => {
    daemonResumeCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('install')
  .description('Register daemon as an OS login service (auto-start at login)')
  .action(() => {
    daemonInstallCommand().catch((err) => { console.error(err); process.exit(1); });
  });

daemonCmd
  .command('uninstall')
  .description('Remove the OS login service entry')
  .action(() => {
    daemonUninstallCommand().catch((err) => { console.error(err); process.exit(1); });
  });

// Default `ide-sync daemon` with no subcommand → show status.
daemonCmd.action(() => {
  daemonStatusCommand().catch((err) => { console.error(err); process.exit(1); });
});

// ── watch ─────────────────────────────────────────────────────────
program
  .command('watch')
  .description('Foreground watcher — same engine as the daemon, logs to stdout (Ctrl+C to stop)')
  .option('--ide <list>', 'Comma-separated IDEs to watch (default: all detected)')
  .option('--verbose', 'Show debug-level log output', false)
  .action((opts) => {
    watchCommand(opts).catch((err) => { console.error(err); process.exit(1); });
  });

// ── config ────────────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Manage IDE config sync (settings, keybindings, snippets, tasks, mcp, ui-state)');

configCmd
  .command('list')
  .description('Show which domains are enabled per IDE')
  .action(() => { configListCommand().catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('show')
  .description('Print the captured config snapshot for a domain')
  .option('--ide <name>', 'IDE family (vscode|cursor|windsurf|antigravity|vscodium)', 'vscode')
  .option('--domain <name>', 'Config domain (settings|keybindings|snippets|tasks|mcp|ui-state)', 'settings')
  .action((opts) => { configShowCommand(opts).catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('diff')
  .description('Show what would change when translating/merging configs')
  .option('--from <ide>', 'Source IDE')
  .option('--to <ide>', 'Target IDE')
  .option('--remote', 'Show remote config state instead of local diff', false)
  .action((opts) => { configDiffCommand(opts).catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('replicate')
  .description('One-shot copy of config files from one IDE to another')
  .requiredOption('--from <ide>', 'Source IDE')
  .requiredOption('--to <ide>', 'Target IDE (comma-separated for multiple)')
  .option('--domain <list>', 'Comma-separated domains to replicate (default: all)')
  .option('--dry-run', 'Show what would change without applying', false)
  .option('-y, --yes', 'Skip confirmation', false)
  .action((opts) => { configReplicateCommand(opts).catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('enable <domain>')
  .description('Enable a config domain globally, or remove an IDE-specific opt-out')
  .option('--ide <name>', 'Only enable for this IDE (removes opt-out; domain must already be globally enabled)')
  .action((domain: string, opts) => { configEnableCommand(domain, opts).catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('disable <domain>')
  .description('Disable a config domain globally, or opt out a specific IDE')
  .option('--ide <name>', 'Only disable for this specific IDE (global setting unchanged)')
  .action((domain: string, opts) => { configDisableCommand(domain, opts).catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('backup')
  .description('Snapshot all IDE config files to ~/.ide-sync/backups/ right now')
  .action(() => { configBackupCommand().catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('restore <backup-id>')
  .description('Restore config files from a named backup')
  .option('--ide <name>', 'Only restore for this IDE')
  .option('-y, --yes', 'Skip confirmation', false)
  .action((backupId: string, opts) => { configRestoreCommand(backupId, opts).catch((err) => { console.error(err); process.exit(1); }); });

configCmd
  .command('backups')
  .description('List all available config backups')
  .action(() => { configBackupsCommand().catch((err) => { console.error(err); process.exit(1); }); });

// Default `ide-sync config` with no subcommand → show list.
configCmd.action(() => { configListCommand().catch((err) => { console.error(err); process.exit(1); }); });

program.parse();
