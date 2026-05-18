import { pullCommand } from './pull.js';
import { pushCommand } from './push.js';
import type { PullOptions } from './pull.js';
import type { PushOptions } from './push.js';

export interface SyncOptions {
  ide?: string;
  dryRun?: boolean;
  yes?: boolean;
  conflict?: string;
  exclude?: string;
  keepLocalExtensions?: boolean;
}

/**
 * `ide-sync sync` — pull then push in one shot.
 *
 * Pull is run first so we get the latest remote state before we push local
 * changes.  This avoids a common race where two machines both push without
 * pulling, which the git backend would reject anyway but is cleaner to avoid.
 */
export async function syncCommand(opts: SyncOptions): Promise<void> {
  const shared: PullOptions & PushOptions = {
    ide: opts.ide,
    dryRun: opts.dryRun,
    yes: opts.yes,
    conflict: opts.conflict,
    keepLocalExtensions: opts.keepLocalExtensions,
  };

  await pullCommand(shared);
  await pushCommand(shared);
}
