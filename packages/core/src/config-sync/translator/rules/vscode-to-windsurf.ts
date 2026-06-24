/**
 * Translation rules: VS Code → Windsurf.
 *
 * Windsurf is a VS Code fork. Most settings keys are identical.
 * Fork-specific keys are handled at the quarantine layer:
 *   - github.copilot.* dropped inbound (Windsurf uses Codeium/built-in AI)
 *   - Universal telemetry/update keys dropped
 *
 * No rename mappings are needed at this time — add them here reactively
 * when a shared key is discovered to have a different name in Windsurf.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules yet. All non-quarantined VS Code keys pass through unchanged.
];
