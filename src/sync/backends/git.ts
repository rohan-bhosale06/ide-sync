import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { migrateSyncState } from '../state.js';
import type { SyncBackend, SyncState } from '../types.js';

const STATE_FILE = 'sync-state.json';

export class PushConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushConflictError';
  }
}

/**
 * Git backend — state lives as `sync-state.json` in a user-owned git repo.
 *
 * Auth uses whatever credentials git already has (SSH keys, credential helper,
 * HTTPS tokens).  We never prompt for or store credentials.
 *
 * Clone destination: localRepoPath (e.g. ~/.ide-sync/repo/)
 */
export class GitBackend implements SyncBackend {
  constructor(
    private readonly remoteUrl: string,
    private readonly localRepoPath: string,
  ) {}

  /** Lazy git instance — only valid after the local repo directory exists. */
  private getGit() {
    return simpleGit(this.localRepoPath);
  }

  /** Detect the default remote branch (main or master). */
  private async defaultBranch(): Promise<string> {
    try {
      const result = await this.getGit().raw(['symbolic-ref', '--short', 'HEAD']);
      return result.trim() || 'main';
    } catch {
      return 'main';
    }
  }

  private get stateFile(): string {
    return path.join(this.localRepoPath, STATE_FILE);
  }

  async isInitialized(): Promise<boolean> {
    return fs.existsSync(path.join(this.localRepoPath, '.git'));
  }

  async init(): Promise<void> {
    if (await this.isInitialized()) return;
    fs.mkdirSync(this.localRepoPath, { recursive: true });
    await simpleGit().clone(this.remoteUrl, this.localRepoPath);
  }

  /** Pull latest before reading to get the freshest remote state. */
  async readState(): Promise<SyncState | null> {
    await this.pullLatest();
    if (!fs.existsSync(this.stateFile)) return null;
    const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as unknown;
    return migrateSyncState(raw);
  }

  /**
   * Write state, commit, and push.
   *
   * Throws `PushConflictError` on push rejection so the command layer can
   * re-read remote state, re-merge, and retry once.
   */
  async writeState(state: SyncState, message: string): Promise<void> {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');

    const git = this.getGit();
    await git.add(STATE_FILE);

    // Skip commit if nothing staged (state was identical).
    const status = await git.status();
    if (status.staged.length === 0) return;

    await git.commit(message);

    const branch = await this.defaultBranch();
    try {
      await git.push('origin', branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('rejected') ||
        msg.includes('non-fast-forward') ||
        msg.includes('fetch first')
      ) {
        throw new PushConflictError(
          `Push rejected (remote has new commits). Re-pull and retry.\n${msg}`,
        );
      }
      throw err;
    }
  }

  private async pullLatest(): Promise<void> {
    if (!(await this.isInitialized())) return;
    try {
      const branch = await this.defaultBranch();
      await this.getGit().pull('origin', branch, { '--rebase': null });
    } catch {
      // If pull fails (e.g. no upstream yet) we proceed with whatever local has.
    }
  }
}
