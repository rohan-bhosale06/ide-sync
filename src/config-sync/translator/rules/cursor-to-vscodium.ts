/**
 * Translation rules: Cursor → VSCodium.
 *
 * cursor.*, composer.*, aipreview.*, aipopup.* are quarantined outbound (quarantine.ts).
 * Universal telemetry/update keys are quarantined universally.
 *
 * github.copilot.* can pass through — if the user installed an open-source Copilot
 * alternative in VSCodium that reads the same settings keys, they should work.
 * Add an explicit quarantine rule here if that causes issues in practice.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules yet. cursor.* quarantine is in quarantine.ts.
];
