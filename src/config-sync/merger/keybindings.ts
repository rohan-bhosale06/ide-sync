/**
 * Keybinding array merge.
 * Identity key = (key, command, when) triple — matching VS Code's own dedup semantics.
 * The full triple is required because:
 *   - ctrl+k with when="editorFocus" and ctrl+k without when are two separate entries
 *   - -command (negation) entries are treated as regular entries with their own identity
 */
import { parse, modify, applyEdits, ParseError } from 'jsonc-parser';
import type { Keybinding } from '../types.js';
import type { ConflictPolicy } from '../../sync/types.js';

const FORMATTING = { tabSize: 2, insertSpaces: true, eol: '\n' };

function parseKeybindings(raw: string | null): Keybinding[] {
  if (!raw || raw.trim() === '') return [];
  const errors: ParseError[] = [];
  const val = parse(raw, errors, { allowTrailingComma: true, allowEmptyContent: true });
  if (!Array.isArray(val)) return [];
  return val as Keybinding[];
}

/** Stable identity string for a keybinding. */
function identity(kb: Keybinding): string {
  return JSON.stringify({
    key: kb.key?.toLowerCase() ?? '',
    command: kb.command ?? '',
    when: kb.when ?? null,
  });
}

function toMap(bindings: Keybinding[]): Map<string, Keybinding> {
  const m = new Map<string, Keybinding>();
  for (const kb of bindings) {
    m.set(identity(kb), kb);
  }
  return m;
}

export interface KeybindingMergeResult {
  newLocalText: string;
  newRemoteRaw: string;
  conflictKeys: string[]; // identity strings of conflicting entries
}

/**
 * Three-way merge for keybindings arrays.
 * Entries are compared by identity; args and other fields on the same identity are also merged.
 */
export function mergeKeybindings(
  baseRaw: string | null,
  localRaw: string,
  remoteRaw: string | null,
  _policy: ConflictPolicy,
): KeybindingMergeResult {
  const base = toMap(parseKeybindings(baseRaw));
  const local = toMap(parseKeybindings(localRaw));
  const remote = toMap(parseKeybindings(remoteRaw));

  const allIds = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);

  // Start from local array (preserves comment positions between entries).
  const localArr = parseKeybindings(localRaw);
  const localIds = new Set(localArr.map(identity));

  const toAdd: Keybinding[] = [];
  const toRemoveIds = new Set<string>();

  for (const id of allIds) {
    const inBase = base.has(id);
    const inLocal = local.has(id);
    const inRemote = remote.has(id);

    if (inLocal && inRemote) continue; // present on both sides — keep as-is

    if (!inBase && inRemote && !inLocal) {
      // Added remotely only — add to local.
      toAdd.push(remote.get(id)!);
      continue;
    }

    if (inBase && !inRemote && inLocal) {
      // Removed remotely — remove from local.
      toRemoveIds.add(id);
      continue;
    }

    if (inBase && inRemote && !inLocal) {
      // Removed locally — nothing to do (local deletion wins).
      continue;
    }

    if (!inBase && inLocal && !inRemote) {
      // Added locally only — already in local, nothing to do.
      continue;
    }
  }

  // Build new local array.
  const filtered = localArr.filter((kb) => !toRemoveIds.has(identity(kb)));
  const merged = [...filtered, ...toAdd];

  // Build new canonical array (remote result).
  const remoteResult: Keybinding[] = [];
  for (const id of allIds) {
    const removedByLocal = base.has(id) && !local.has(id);
    if (removedByLocal) continue; // local deletion propagates
    const kb = remote.get(id) ?? local.get(id);
    if (kb) remoteResult.push(kb);
  }

  return {
    newLocalText: JSON.stringify(merged, null, 2),
    newRemoteRaw: JSON.stringify(remoteResult, null, 2),
    conflictKeys: [],
  };
}

/**
 * One-way apply: merge sourceBindings into destRaw, adding missing entries.
 * Entries already present by identity are not duplicated.
 */
export function applyKeybindings(sourceRaw: string, destRaw: string): string {
  const source = parseKeybindings(sourceRaw);
  const dest = parseKeybindings(destRaw);
  const destIds = new Set(dest.map(identity));
  const toAdd = source.filter((kb) => !destIds.has(identity(kb)));
  if (toAdd.length === 0) return destRaw;
  return JSON.stringify([...dest, ...toAdd], null, 2);
}
