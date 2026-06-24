/**
 * Translation rules: Kiro → VS Code.
 *
 * Kiro is a VS Code-based fork from AWS. Core editor and workbench keys are
 * identical. Kiro-specific AI keys (kiro.*, amazonq.*, aws.*) are handled
 * by the quarantine layer, not here.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // Kiro inherits VS Code's workbench and editor namespaces unchanged.
  // Add explicit renames here if key drift is discovered.
];
