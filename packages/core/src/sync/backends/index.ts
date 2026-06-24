import { resolveHome } from '../../utils/paths.js';
import { GitBackend } from './git.js';
import { FilesystemBackend } from './filesystem.js';
import type { Config, SyncBackend } from '../types.js';

/** Factory — create the appropriate backend from config. */
export function createBackend(config: Config): SyncBackend {
  if (config.backend === 'git') {
    const repoUrl = config.gitRepoUrl;
    if (!repoUrl) throw new Error('Git backend requires gitRepoUrl in config.');
    const localPath = resolveHome('.ide-sync', 'repo');
    return new GitBackend(repoUrl, localPath);
  }

  if (config.backend === 'filesystem') {
    const dirPath = config.filesystemPath;
    if (!dirPath) throw new Error('Filesystem backend requires filesystemPath in config.');
    return new FilesystemBackend(dirPath);
  }

  throw new Error(`Unknown backend: ${String((config as Config).backend)}`);
}

export { GitBackend, PushConflictError } from './git.js';
export { FilesystemBackend } from './filesystem.js';
export type { SyncBackend } from '../types.js';
