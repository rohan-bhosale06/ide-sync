/**
 * Translation rules: VS Code → Cursor.
 *
 * Cursor is a very close fork of VS Code and inherits nearly all settings keys
 * unchanged. The few that differ are listed here; everything else passes through.
 *
 * Start conservative — add rules reactively as users hit issues rather than
 * trying to enumerate every possible mapping up front.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // VS Code's editor font ligatures key — identical in Cursor, passthrough.
  // Listed explicitly so we have a place to add notes.
  { match: 'editor.fontLigatures', action: 'passthrough' },

  // Cursor uses workbench.colorTheme identically.
  { match: 'workbench.colorTheme', action: 'passthrough' },

  // github.copilot.* is quarantined at the quarantine layer (not here) when target=cursor.
  // No explicit map rules needed for vscode→cursor since Cursor inherits all workbench.* keys.
];
