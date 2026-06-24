/**
 * `ide-sync search` — find extensions on the marketplace(s) configured for an IDE family.
 */
import chalk from 'chalk';
import ora from 'ora';
import { searchMarketplaces } from 'ide-sync-core';
import type { ExtensionMetadata } from 'ide-sync-core';
import type { IDEFamily } from 'ide-sync-core';

export interface SearchOptions {
  ide?: string;
  limit?: number;
  allowMsMarketplace?: boolean;
}

/** Headless search — returns structured results, no process.exit. */
export async function runSearch(query: string, opts: SearchOptions = {}): Promise<ExtensionMetadata[]> {
  const family = (opts.ide ?? 'vscode') as IDEFamily;
  return searchMarketplaces(query, family, {
    limit: opts.limit,
    allowMsMarketplace: opts.allowMsMarketplace,
  });
}

/** Interactive CLI wrapper around runSearch. */
export async function searchCommand(query: string, opts: SearchOptions = {}): Promise<void> {
  const family = (opts.ide ?? 'vscode') as IDEFamily;
  const spinner = ora(`Searching for "${query}"…`).start();
  const results = await runSearch(query, opts);
  spinner.succeed(`Found ${results.length} result${results.length !== 1 ? 's' : ''}`);

  if (results.length === 0) {
    console.log(chalk.dim('\n  No matching extensions found.\n'));
    return;
  }

  console.log('');
  console.log(`  ${chalk.bold(`Marketplace search: "${query}"`)}  ${chalk.dim(`(${family})`)}`);
  const RULE = '─'.repeat(54);
  console.log(`  ${RULE}`);
  for (const ext of results) {
    console.log(`  ${chalk.cyan(ext.id)}  ${chalk.dim(`v${ext.latestVersion}`)}  ${chalk.dim(`[${ext.source}]`)}`);
  }
  console.log(`  ${RULE}`);
  console.log(chalk.dim(`\n  Install with: ide-sync install <id> --ide ${family}\n`));
}
