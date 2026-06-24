/**
 * Translation rules: Windsurf → VS Code.
 *
 * windsurf.* and codeium.* are quarantined outbound by the quarantine layer.
 * VS Code's github.copilot.* settings are meaningful when the Copilot extension
 * is installed, so they are allowed inbound (not quarantined here).
 *
 * No rename mappings are needed — Windsurf uses the same workbench.* editor.*
 * key space as VS Code for all shared settings.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules yet. windsurf.*/codeium.* quarantine is in quarantine.ts.
];
