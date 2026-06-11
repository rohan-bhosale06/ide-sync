/**
 * Translation rules: VS Code → Kiro.
 *
 * Kiro is a VS Code-based fork from AWS. Core editor and workbench keys are
 * identical. github.copilot.* is quarantined at the quarantine layer when
 * target=kiro (Kiro uses Amazon Q built-in AI).
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No renames needed — Kiro inherits all VS Code workbench.* and editor.* keys.
  // Add explicit renames here if key drift is discovered.
];
