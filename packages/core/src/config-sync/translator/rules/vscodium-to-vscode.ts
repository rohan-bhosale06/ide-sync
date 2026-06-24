/**
 * Translation rules: VSCodium → VS Code.
 *
 * vscodium.* and workbench.welcome.* are quarantined outbound by the quarantine layer.
 * All other shared settings pass through unchanged.
 *
 * No rename mappings are needed — VSCodium does not rename VS Code's editor/workbench
 * settings keys; it only adds its own vscodium.* namespace and removes telemetry paths.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules yet. vscodium.*/workbench.welcome.* quarantine is in quarantine.ts.
];
