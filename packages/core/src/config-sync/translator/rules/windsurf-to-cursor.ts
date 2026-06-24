/**
 * Translation rules: Windsurf → Cursor.
 *
 * windsurf.* and codeium.* are quarantined outbound by the quarantine layer.
 * github.copilot.* is quarantined inbound to Cursor (Cursor has built-in AI).
 *
 * Shared workbench.*editor.* settings pass through unchanged.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules. Outbound windsurf.*/codeium.* and inbound github.copilot.*
  // quarantine are in quarantine.ts.
];
