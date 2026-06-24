/**
 * Translation rules: Cursor → Windsurf.
 *
 * Both are AI-first VS Code forks with mutually incompatible AI namespaces:
 *   - cursor.*, composer.*, aipreview.*, aipopup.* quarantined outbound (quarantine.ts)
 *   - windsurf.*, codeium.* are inbound to Windsurf — not present in Cursor output so no action
 *   - github.copilot.* quarantined inbound to Windsurf (Windsurf has built-in AI)
 *
 * Shared workbench.*editor.* settings are identical and pass through.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules. AI-namespace quarantine is in quarantine.ts.
];
