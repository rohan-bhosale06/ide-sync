/**
 * Translation engine.
 * Translates settings keys from one IDE family's format to another.
 *
 * Canonical format = VS Code-family (the shared subset that all forks understand).
 *
 * On push:   translate(localSettings, sourceIDE, 'vscode') → canonical to store in SyncState
 * On pull:   translate(canonical, 'vscode', targetIDE)     → what to write to target IDE
 *
 * Rules are loaded lazily and cached per pair.  For pairs without a rules file,
 * every key passes through with a warning logged (conservative default).
 *
 * Users can override via ConfigSyncConfig.translationOverrides:
 *   { "cursor.someKey": "editor.someKey" } → explicit map
 *   { "cursor.someKey": null }             → explicit quarantine
 */
import type { IDEFamily } from '../../detectors/types.js';
import type { TranslationRule } from '../types.js';
import { isQuarantined } from './quarantine.js';

// Lazy-loaded rule cache, keyed by "source:target".
const ruleCache = new Map<string, TranslationRule[]>();

async function loadRules(source: IDEFamily, target: IDEFamily): Promise<TranslationRule[]> {
  const key = `${source}:${target}`;
  if (ruleCache.has(key)) return ruleCache.get(key)!;

  let rules: TranslationRule[] = [];
  try {
    const mod = await import(`./rules/${source}-to-${target}.js`).catch(() => null);
    if (mod && Array.isArray(mod.rules)) {
      rules = mod.rules as TranslationRule[];
    }
  } catch {
    // No rules file for this pair — passthrough everything (quarantine still applies).
  }

  ruleCache.set(key, rules);
  return rules;
}

function applyRule(
  key: string,
  rules: TranslationRule[],
): { action: 'map' | 'quarantine' | 'passthrough'; targetKey: string } {
  for (const rule of rules) {
    const matched = typeof rule.match === 'string'
      ? key === rule.match
      : rule.match.test(key);

    if (matched) {
      return {
        action: rule.action,
        targetKey: rule.action === 'map' ? (rule.targetKey ?? key) : key,
      };
    }
  }
  return { action: 'passthrough', targetKey: key };
}

export interface TranslationResult {
  translated: Record<string, unknown>;
  quarantined: string[];   // keys that were dropped
  mapped: Array<{ from: string; to: string }>; // keys that were renamed
  warnings: string[];      // unknown pairs, etc.
}

/**
 * Translate a flat settings object from one IDE family to another.
 * Also applies user-supplied translationOverrides from ConfigSyncConfig.
 */
export async function translateSettings(
  settings: Record<string, unknown>,
  source: IDEFamily,
  target: IDEFamily,
  userOverrides: Record<string, string | null> = {},
): Promise<TranslationResult> {
  if (source === target) {
    return { translated: { ...settings }, quarantined: [], mapped: [], warnings: [] };
  }

  const rules = await loadRules(source, target);
  const translated: Record<string, unknown> = {};
  const quarantined: string[] = [];
  const mapped: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(settings)) {
    // User overrides take priority.
    if (Object.prototype.hasOwnProperty.call(userOverrides, key)) {
      const override = userOverrides[key];
      if (override === null) {
        quarantined.push(key);
        continue;
      }
      if (override !== key) mapped.push({ from: key, to: override });
      translated[override] = value;
      continue;
    }

    // Quarantine layer.
    if (isQuarantined(key, source, target)) {
      quarantined.push(key);
      continue;
    }

    // Rule matching.
    const { action, targetKey } = applyRule(key, rules);
    if (action === 'quarantine') {
      quarantined.push(key);
    } else {
      if (targetKey !== key) mapped.push({ from: key, to: targetKey });
      translated[targetKey] = value;
    }
  }

  if (rules.length === 0 && source !== 'vscode' && target !== 'vscode') {
    warnings.push(`No translation rules for ${source}→${target}; all non-quarantined keys passed through.`);
  }

  return { translated, quarantined, mapped, warnings };
}

/**
 * Synchronous variant for use in tests and where async is inconvenient.
 * Uses only the quarantine layer + loaded (already-cached) rules.
 * Call loadRulesSync to pre-warm the cache if needed.
 */
export function translateSettingsSync(
  settings: Record<string, unknown>,
  source: IDEFamily,
  target: IDEFamily,
  userOverrides: Record<string, string | null> = {},
): TranslationResult {
  if (source === target) {
    return { translated: { ...settings }, quarantined: [], mapped: [], warnings: [] };
  }

  const key = `${source}:${target}`;
  const rules = ruleCache.get(key) ?? [];
  const translated: Record<string, unknown> = {};
  const quarantined: string[] = [];
  const mapped: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];

  for (const [k, value] of Object.entries(settings)) {
    if (Object.prototype.hasOwnProperty.call(userOverrides, k)) {
      const override = userOverrides[k];
      if (override === null) { quarantined.push(k); continue; }
      if (override !== k) mapped.push({ from: k, to: override });
      translated[override] = value;
      continue;
    }
    if (isQuarantined(k, source, target)) { quarantined.push(k); continue; }
    const { action, targetKey } = applyRule(k, rules);
    if (action === 'quarantine') {
      quarantined.push(k);
    } else {
      if (targetKey !== k) mapped.push({ from: k, to: targetKey });
      translated[targetKey] = value;
    }
  }
  return { translated, quarantined, mapped, warnings };
}

/** Pre-warm the rule cache for a pair (call once at startup if needed). */
export async function preloadRules(source: IDEFamily, target: IDEFamily): Promise<void> {
  await loadRules(source, target);
}
