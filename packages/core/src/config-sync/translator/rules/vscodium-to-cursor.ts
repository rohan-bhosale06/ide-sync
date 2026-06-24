/**
 * Translation rules: VSCodium → Cursor.
 *
 * vscodium.* and workbench.welcome.* are quarantined outbound (quarantine.ts).
 * github.copilot.* is quarantined inbound to Cursor (Cursor has built-in AI).
 *
 * All other shared editor/workbench settings pass through unchanged.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules. vscodium.* outbound and github.copilot.* inbound quarantine
  // are handled in quarantine.ts.
];
