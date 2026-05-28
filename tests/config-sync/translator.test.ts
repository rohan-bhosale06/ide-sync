/**
 * Translator tests — every rule direction, passthrough, and quarantine.
 * Uses the synchronous translateSettingsSync() after pre-warming the cache.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { preloadRules, translateSettingsSync } from '../../src/config-sync/translator/index.js';

beforeAll(async () => {
  await preloadRules('vscode', 'cursor');
  await preloadRules('cursor', 'vscode');
  await preloadRules('vscode', 'windsurf');
});

// ─────────────────────────── identity ────────────────────────────

describe('same source and target', () => {
  it('returns input unchanged', () => {
    const settings = { 'editor.fontSize': 16, 'cursor.general.foo': 'bar' };
    const result = translateSettingsSync(settings, 'cursor', 'cursor');
    expect(result.translated).toEqual(settings);
    expect(result.quarantined).toHaveLength(0);
  });
});

// ─────────────────────────── passthrough ─────────────────────────

describe('passthrough keys', () => {
  it('copies unknown keys unchanged for vscode→cursor', () => {
    const result = translateSettingsSync({ 'editor.fontSize': 16 }, 'vscode', 'cursor');
    expect(result.translated['editor.fontSize']).toBe(16);
    expect(result.quarantined).toHaveLength(0);
  });

  it('copies editor.* keys without renaming', () => {
    const settings = { 'editor.tabSize': 2, 'editor.formatOnSave': true };
    const result = translateSettingsSync(settings, 'vscode', 'cursor');
    expect(result.translated).toMatchObject(settings);
  });
});

// ─────────────────────────── quarantine — cursor→vscode ──────────

describe('quarantine: cursor→vscode', () => {
  it('drops cursor.* keys', () => {
    const result = translateSettingsSync(
      { 'cursor.general.enableShadowWorkspace': true, 'editor.fontSize': 14 },
      'cursor', 'vscode',
    );
    expect(result.translated['editor.fontSize']).toBe(14);
    expect('cursor.general.enableShadowWorkspace' in result.translated).toBe(false);
    expect(result.quarantined).toContain('cursor.general.enableShadowWorkspace');
  });

  it('drops cursor.cpp.* keys', () => {
    const result = translateSettingsSync({ 'cursor.cpp.disabledLanguages': ['c'] }, 'cursor', 'vscode');
    expect(result.quarantined).toContain('cursor.cpp.disabledLanguages');
  });

  it('drops cursor.chat.* keys', () => {
    const result = translateSettingsSync({ 'cursor.chat.enabled': true }, 'cursor', 'vscode');
    expect(result.quarantined).toContain('cursor.chat.enabled');
  });
});

// ─────────────────────────── quarantine — vscode→cursor ──────────

describe('quarantine: vscode→cursor', () => {
  it('drops github.copilot.* keys (cursor has built-in AI)', () => {
    const result = translateSettingsSync(
      { 'github.copilot.enable': true, 'editor.fontSize': 14 },
      'vscode', 'cursor',
    );
    expect('github.copilot.enable' in result.translated).toBe(false);
    expect(result.quarantined).toContain('github.copilot.enable');
  });
});

// ─────────────────────────── universal quarantine ────────────────

describe('universal quarantine (all pairs)', () => {
  it('drops telemetry.* keys', () => {
    const result = translateSettingsSync(
      { 'telemetry.telemetryLevel': 'off', 'editor.fontSize': 16 },
      'vscode', 'cursor',
    );
    expect(result.quarantined).toContain('telemetry.telemetryLevel');
    expect(result.translated['editor.fontSize']).toBe(16);
  });

  it('drops update.* keys', () => {
    const result = translateSettingsSync(
      { 'update.mode': 'none' },
      'vscode', 'cursor',
    );
    expect(result.quarantined).toContain('update.mode');
  });

  it('drops extensions.autoUpdate', () => {
    const result = translateSettingsSync(
      { 'extensions.autoUpdate': false },
      'vscode', 'cursor',
    );
    expect(result.quarantined).toContain('extensions.autoUpdate');
  });
});

// ─────────────────────────── user overrides ──────────────────────

describe('user translation overrides', () => {
  it('maps a key to a new name via override', () => {
    const result = translateSettingsSync(
      { 'cursor.someNewKey': 42, 'editor.fontSize': 14 },
      'cursor', 'vscode',
      { 'cursor.someNewKey': 'editor.someNewKey' },
    );
    expect(result.translated['editor.someNewKey']).toBe(42);
    expect(result.mapped).toContainEqual({ from: 'cursor.someNewKey', to: 'editor.someNewKey' });
  });

  it('quarantines a key via null override', () => {
    const result = translateSettingsSync(
      { 'editor.fontSize': 14, 'someKey': 'value' },
      'vscode', 'cursor',
      { 'someKey': null },
    );
    expect('someKey' in result.translated).toBe(false);
    expect(result.quarantined).toContain('someKey');
  });
});

// ─────────────────────────── unknown pair passthrough ────────────

describe('unknown IDE pair', () => {
  it('passes through all non-quarantined keys with a warning', () => {
    const result = translateSettingsSync(
      { 'editor.fontSize': 14, 'workbench.colorTheme': 'Dark+' },
      'windsurf', 'vscodium',
    );
    expect(result.translated['editor.fontSize']).toBe(14);
    expect(result.translated['workbench.colorTheme']).toBe('Dark+');
  });
});
