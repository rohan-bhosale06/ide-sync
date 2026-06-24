/**
 * Translation rules: VS Code → VSCodium.
 *
 * VSCodium is a de-Microsoft'd build of VS Code. Most settings keys are identical.
 * Universal telemetry/update keys are quarantined by the quarantine layer.
 *
 * Keys that reference Microsoft services specifically (e.g. ms-vsliveshare.*,
 * github.copilot.*) are harmless to pass through — the settings will be ignored
 * if the extension isn't installed in VSCodium. Quarantine them here only if they
 * are confirmed to cause startup errors or noisy warnings in VSCodium.
 */
import type { TranslationRule } from '../../types.js';

export const rules: TranslationRule[] = [
  // No rename rules yet. Telemetry/update quarantine is in quarantine.ts.
];
