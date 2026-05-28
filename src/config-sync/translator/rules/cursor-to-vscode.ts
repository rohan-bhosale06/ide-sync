/**
 * Translation rules: Cursor → VS Code.
 *
 * cursor.* keys are quarantined at the quarantine layer (they mean nothing in VS Code).
 * Any key that Cursor renamed from a VS Code original is mapped back here.
 *
 * Currently empty because Cursor inherits VS Code settings keys rather than renaming them.
 * This file exists as the canonical place to add map rules when Cursor diverges further.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules yet — cursor.* quarantine is handled in quarantine.ts.
  // Add entries here when Cursor renames a shared key, e.g.:
  // { match: 'cursor.editor.someFeature', action: 'map', targetKey: 'editor.someFeature' },
];
