import chalk from 'chalk';
import ora from 'ora';
import { ALL_FAMILIES, runDetectors } from 'ide-sync-core';
import type { IDEFamily } from 'ide-sync-core';
import { buildManifest } from 'ide-sync-core';
import { writeManifest } from 'ide-sync-core';

interface ScanOptions {
  json: boolean;
  output?: string;
  ide?: string;
}

function parseIdeFilter(raw: string): IDEFamily[] {
  const valid = new Set<string>(ALL_FAMILIES);
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => {
      if (!valid.has(s)) {
        console.error(chalk.yellow(`Warning: unknown IDE "${s}", skipping`));
        return false;
      }
      return true;
    }) as IDEFamily[];
}

function renderTable(inventories: ReturnType<typeof runDetectors>): void {
  const COL_IDE = 13;
  const COL_STATUS = 14;
  const COL_EXT = 10;

  const header =
    chalk.bold('IDE'.padEnd(COL_IDE)) +
    chalk.bold('Status'.padEnd(COL_STATUS)) +
    chalk.bold('Extensions');
  const separator = '─'.repeat(COL_IDE + COL_STATUS + COL_EXT);

  console.log(header);
  console.log(separator);

  for (const { ide, extensions } of inventories) {
    const statusText = ide.installed
      ? chalk.green('✓ installed')
      : chalk.red('✗ not found');
    const extCount = ide.installed ? chalk.cyan(String(extensions.length)) : chalk.dim('—');

    console.log(
      ide.displayName.padEnd(COL_IDE) +
        statusText.padEnd(COL_STATUS + (ide.installed ? 0 : 1)) +
        extCount,
    );
  }
}

export async function scanCommand(opts: ScanOptions): Promise<void> {
  const families =
    opts.ide ? parseIdeFilter(opts.ide) : [...ALL_FAMILIES];

  if (families.length === 0) {
    console.error(chalk.red('No valid IDEs to scan.'));
    process.exit(1);
  }

  const spinner = ora({ text: 'Scanning IDEs…', stream: process.stderr }).start();

  let inventories: ReturnType<typeof runDetectors>;
  try {
    inventories = runDetectors(families);
    spinner.succeed('Scan complete');
  } catch (err) {
    spinner.fail('Scan failed');
    throw err;
  }

  const manifest = buildManifest(inventories);

  if (opts.output) {
    writeManifest(manifest, opts.output);
    console.log(chalk.green(`Manifest written to ${opts.output}`));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  renderTable(inventories);
}
