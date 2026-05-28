/**
 * JSONC 3-way merge using jsonc-parser's modify/applyEdits.
 * NEVER calls JSON.parse/stringify on settings text — all edits are surgical
 * character-level operations so comments and trailing commas survive.
 */
import { parse, modify, applyEdits, ParseError } from 'jsonc-parser';
import type { ConflictPolicy } from '../../sync/types.js';

export interface JsoncMergeResult {
  /** New text to write to the local IDE config file. */
  newLocalText: string;
  /** Canonical raw text to store in SyncState.configs. */
  newRemoteRaw: string;
  /** Keys that had conflicts (both sides changed vs base). Policy was applied. */
  conflictKeys: string[];
}

const FORMATTING = { tabSize: 2, insertSpaces: true, eol: '\n' };

/** Parse JSONC text into a flat Record; returns {} on empty/missing. */
function parseJsonc(raw: string | null): Record<string, unknown> {
  if (!raw || raw.trim() === '') return {};
  const errors: ParseError[] = [];
  const val = parse(raw, errors, { allowTrailingComma: true, allowEmptyContent: true });
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return {};
  return val as Record<string, unknown>;
}

/** Stringify a plain object to compact JSONC (no comments — used for canonical remote copy). */
function toCanonical(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2);
}

/**
 * Deep-equal check for JSON-serialisable values.
 * We serialise both sides to avoid reference-equality false negatives on objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Three-way merge for flat JSONC settings objects.
 *
 * All keys are top-level (VS Code settings.json is flat: "editor.tabSize", not nested).
 * The local file is modified surgically via modify()+applyEdits() so comments survive.
 * The canonical remote copy is rebuilt as clean JSON (no comments needed there).
 *
 * @param baseRaw   Last synced canonical text (from SyncState.configs.settings.raw).
 *                  null = first sync; remote wins for new keys.
 * @param localRaw  Current content of the IDE's settings.json.
 * @param remoteRaw Current canonical text from remote SyncState.
 *                  null = remote has nothing yet; local becomes canonical.
 * @param policy    Conflict resolution policy.
 */
export function mergeJsoncSettings(
  baseRaw: string | null,
  localRaw: string,
  remoteRaw: string | null,
  policy: ConflictPolicy,
): JsoncMergeResult {
  const base = parseJsonc(baseRaw);
  const local = parseJsonc(localRaw);
  const remote = parseJsonc(remoteRaw);

  // All keys across all three sides.
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  const conflictKeys: string[] = [];
  const localEdits: Array<[string, unknown | undefined]> = []; // [key, newValue|undefined=delete]
  const remoteResult: Record<string, unknown> = { ...remote };

  for (const key of allKeys) {
    const inBase = Object.prototype.hasOwnProperty.call(base, key);
    const inLocal = Object.prototype.hasOwnProperty.call(local, key);
    const inRemote = Object.prototype.hasOwnProperty.call(remote, key);

    const baseVal = base[key];
    const localVal = local[key];
    const remoteVal = remote[key];

    const localChanged = inLocal !== inBase || !deepEqual(localVal, baseVal);
    const remoteChanged = inRemote !== inBase || !deepEqual(remoteVal, baseVal);

    if (!localChanged && !remoteChanged) {
      // No change on either side — nothing to do.
      continue;
    }

    if (localChanged && !remoteChanged) {
      // Only local changed — push to canonical; local file already has it.
      if (inLocal) {
        remoteResult[key] = localVal;
      } else {
        delete remoteResult[key];
      }
      continue;
    }

    if (!localChanged && remoteChanged) {
      // Only remote changed — apply to local file.
      if (inRemote) {
        localEdits.push([key, remoteVal]);
      } else {
        localEdits.push([key, undefined]);
      }
      continue;
    }

    // Both changed vs base — conflict.
    if (deepEqual(localVal, remoteVal)) {
      // Both changed to the same value — no real conflict.
      if (inLocal) remoteResult[key] = localVal;
      else delete remoteResult[key];
      continue;
    }

    conflictKeys.push(key);

    let winner: unknown;
    let winnerPresent: boolean;

    if (policy === 'local') {
      winner = localVal; winnerPresent = inLocal;
    } else if (policy === 'remote') {
      winner = remoteVal; winnerPresent = inRemote;
    } else {
      // 'newest' or 'manual' — default to remote (remote is the shared canonical).
      winner = remoteVal; winnerPresent = inRemote;
    }

    if (winnerPresent) {
      localEdits.push([key, winner]);
      remoteResult[key] = winner;
    } else {
      localEdits.push([key, undefined]);
      delete remoteResult[key];
    }
  }

  // Apply local edits surgically using modify()+applyEdits() to preserve comments.
  let newLocalText = localRaw;
  for (const [key, value] of localEdits) {
    const edits = modify(newLocalText, [key], value, { formattingOptions: FORMATTING });
    newLocalText = applyEdits(newLocalText, edits);
  }

  return {
    newLocalText,
    newRemoteRaw: toCanonical(remoteResult),
    conflictKeys,
  };
}

/**
 * One-way apply: write all keys from sourceRaw into destRaw without a base.
 * Used when replicating from one IDE to another for the first time.
 * Comments in destRaw are preserved; new keys are added, existing keys overwritten.
 */
export function applyJsoncSettings(
  sourceRaw: string,
  destRaw: string,
): string {
  const source = parseJsonc(sourceRaw);
  let text = destRaw;
  for (const [key, value] of Object.entries(source)) {
    const edits = modify(text, [key], value, { formattingOptions: FORMATTING });
    text = applyEdits(text, edits);
  }
  return text;
}
