/**
 * Snippet file merge.
 * Each file (e.g. typescript.json, my-project.code-snippets) is an independent unit.
 * Within a file: same JSONC 3-way merge as settings (keyed by snippet name).
 * Across files: add/remove tracking via a tombstone-like set.
 */
import type { ConflictPolicy } from '../../sync/types.js';
import { mergeJsoncSettings, type ConfigKeyChange } from './jsonc.js';

export interface SnippetFileMergeResult {
  newLocalText: string;
  newRemoteRaw: string;
  conflictKeys: string[];
  changes: ConfigKeyChange[];
}

/** Merge a single snippet file using the same JSONC key-level strategy as settings. */
export function mergeSnippetFile(
  baseRaw: string | null,
  localRaw: string,
  remoteRaw: string | null,
  policy: ConflictPolicy,
): SnippetFileMergeResult {
  return mergeJsoncSettings(baseRaw, localRaw, remoteRaw, policy);
}

export interface SnippetDirMergeResult {
  /** Files to write locally: filename → new text */
  localWrites: Record<string, string>;
  /** Files to delete locally (removed remotely and not modified locally) */
  localDeletes: string[];
  /** New canonical snippets record for SyncState */
  remoteSnippets: Record<string, string>; // filename → canonical raw
  conflictFiles: Array<{ filename: string; conflictKeys: string[] }>;
  /** Per-file diff: whole-file add/remove status, or per-key changes when both sides have the file. */
  fileChanges: Array<{ filename: string; status: ConfigKeyChange['status']; keyChanges?: ConfigKeyChange[] }>;
}

/**
 * Three-way merge for an entire snippets directory.
 *
 * @param baseSnippets   Last-synced snippets: filename → raw (from SyncState base)
 * @param localSnippets  Current local files: filename → raw
 * @param remoteSnippets Current remote snippets: filename → raw
 */
export function mergeSnippetDirectory(
  baseSnippets: Record<string, string>,
  localSnippets: Record<string, string>,
  remoteSnippets: Record<string, string>,
  policy: ConflictPolicy,
): SnippetDirMergeResult {
  const allFiles = new Set([
    ...Object.keys(baseSnippets),
    ...Object.keys(localSnippets),
    ...Object.keys(remoteSnippets),
  ]);

  const localWrites: Record<string, string> = {};
  const localDeletes: string[] = [];
  const newRemote: Record<string, string> = { ...remoteSnippets };
  const conflictFiles: Array<{ filename: string; conflictKeys: string[] }> = [];
  const fileChanges: SnippetDirMergeResult['fileChanges'] = [];

  for (const filename of allFiles) {
    const inBase = filename in baseSnippets;
    const inLocal = filename in localSnippets;
    const inRemote = filename in remoteSnippets;

    if (inLocal && inRemote) {
      // Both sides have it — content-level merge.
      const result = mergeSnippetFile(
        baseSnippets[filename] ?? null,
        localSnippets[filename]!,
        remoteSnippets[filename]!,
        policy,
      );
      if (result.newLocalText !== localSnippets[filename]) {
        localWrites[filename] = result.newLocalText;
      }
      newRemote[filename] = result.newRemoteRaw;
      if (result.conflictKeys.length > 0) {
        conflictFiles.push({ filename, conflictKeys: result.conflictKeys });
      }
      const status: ConfigKeyChange['status'] = result.conflictKeys.length > 0
        ? 'conflict'
        : result.changes.some((c) => c.status !== 'unchanged') ? 'converged' : 'unchanged';
      fileChanges.push({ filename, status, keyChanges: result.changes });
      continue;
    }

    if (!inBase && inRemote && !inLocal) {
      // Added remotely — write to local.
      localWrites[filename] = remoteSnippets[filename]!;
      newRemote[filename] = remoteSnippets[filename]!;
      fileChanges.push({ filename, status: 'remote-only' });
      continue;
    }

    if (!inBase && inLocal && !inRemote) {
      // Added locally only — push to remote.
      newRemote[filename] = localSnippets[filename]!;
      fileChanges.push({ filename, status: 'local-only' });
      continue;
    }

    if (inBase && !inRemote && inLocal) {
      // Removed remotely — delete locally (remote deletion propagates).
      localDeletes.push(filename);
      delete newRemote[filename];
      fileChanges.push({ filename, status: 'remote-only' });
      continue;
    }

    if (inBase && inRemote && !inLocal) {
      // Removed locally — propagate deletion to remote.
      delete newRemote[filename];
      fileChanges.push({ filename, status: 'local-only' });
      continue;
    }

    if (inBase && !inRemote && !inLocal) {
      // Removed on both sides — nothing to do.
      fileChanges.push({ filename, status: 'unchanged' });
      continue;
    }
  }

  return { localWrites, localDeletes, remoteSnippets: newRemote, conflictFiles, fileChanges };
}
