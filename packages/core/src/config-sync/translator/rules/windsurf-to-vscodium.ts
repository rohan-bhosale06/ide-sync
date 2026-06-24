/**
 * Translation rules: Windsurf → VSCodium.
 *
 * windsurf.* and codeium.* are quarantined outbound (quarantine.ts).
 * Universal telemetry/update keys are quarantined universally.
 *
 * All other shared workbench.*\/editor.* settings pass through unchanged.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules. windsurf.*/codeium.* quarantine is in quarantine.ts.
];
