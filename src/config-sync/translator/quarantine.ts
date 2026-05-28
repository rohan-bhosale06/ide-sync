/**
 * Key patterns that are known fork-specific and should NOT be synced to other IDEs.
 * When a key matches a quarantine pattern for the given source→target pair, it is
 * silently dropped rather than copied.
 *
 * Conservative by design: a missing setting is recoverable; a wrong setting that
 * breaks the IDE is a debugging nightmare.
 */

/** Patterns quarantined when writing FROM cursor TO any other IDE. */
const CURSOR_OUTBOUND_QUARANTINE: ReadonlyArray<string | RegExp> = [
  /^cursor\./,            // all cursor.* namespace
  /^composer\./,          // cursor composer
  /^aipreview\./,         // cursor AI preview
  /^aipopup\./,           // cursor AI popup
];

/** Patterns quarantined when writing FROM any IDE TO cursor. */
const CURSOR_INBOUND_QUARANTINE: ReadonlyArray<string | RegExp> = [
  /^github\.copilot\./,   // copilot settings are meaningless in cursor (it has built-in AI)
];

/** Patterns quarantined universally (always dropped regardless of direction). */
const UNIVERSAL_QUARANTINE: ReadonlyArray<string | RegExp> = [
  /^telemetry\./,
  /^update\./,
  'extensions.autoCheckUpdates',
  'extensions.autoUpdate',
  'workbench.enableExperiments',
  'application.enableTelemetry',
  'telemetry.enableTelemetry',
  'telemetry.enableCrashReporter',
];

/** Patterns quarantined when writing FROM windsurf TO other IDEs. */
const WINDSURF_OUTBOUND_QUARANTINE: ReadonlyArray<string | RegExp> = [
  /^windsurf\./,
  /^codeium\./,
];

/** Patterns quarantined when writing FROM vscodium TO other IDEs (VSCodium-specific). */
const VSCODIUM_OUTBOUND_QUARANTINE: ReadonlyArray<string | RegExp> = [
  /^vscodium\./,
  /^workbench\.welcome\./,   // VSCodium tweaks welcome page differently
];

import type { IDEFamily } from '../../detectors/types.js';

function matches(key: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const p of patterns) {
    if (typeof p === 'string' ? key === p : p.test(key)) return true;
  }
  return false;
}

/** Returns true if this key should be dropped when translating source → target. */
export function isQuarantined(key: string, source: IDEFamily, target: IDEFamily): boolean {
  if (matches(key, UNIVERSAL_QUARANTINE)) return true;

  if (source === 'cursor' && matches(key, CURSOR_OUTBOUND_QUARANTINE)) return true;
  if (target === 'cursor' && matches(key, CURSOR_INBOUND_QUARANTINE)) return true;
  if (source === 'windsurf' && matches(key, WINDSURF_OUTBOUND_QUARANTINE)) return true;
  if (source === 'vscodium' && matches(key, VSCODIUM_OUTBOUND_QUARANTINE)) return true;

  return false;
}
