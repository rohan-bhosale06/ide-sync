import { describe, it, expect } from 'vitest';
import { parse } from 'jsonc-parser';
import { mergeJsoncSettings, applyJsoncSettings } from '../../../src/config-sync/merger/jsonc.js';

/** Parse JSONC (allowing comments) for assertions. */
function parseJSONC(text: string): Record<string, unknown> {
  return parse(text, [], { allowTrailingComma: true }) as Record<string, unknown>;
}

// ─────────────────────────── helpers ──────────────────────────────

const base = (obj: Record<string, unknown>) => JSON.stringify(obj, null, 2);

// ─────────────────────────── comment preservation ─────────────────

describe('comment preservation', () => {
  it('preserves comments on unchanged keys when remote adds a new key', () => {
    const localRaw = `{
  // My font size — do not change
  "editor.fontSize": 16
}`;
    const remoteRaw = base({ 'editor.fontSize': 16, 'editor.tabSize': 2 });

    const result = mergeJsoncSettings(null, localRaw, remoteRaw, 'remote');

    expect(result.newLocalText).toContain('// My font size — do not change');
    expect(result.newLocalText).toContain('"editor.tabSize": 2');
    expect(result.conflictKeys).toHaveLength(0);
  });

  it('preserves comments when a remote key is updated', () => {
    const localRaw = `{
  // Terminal font
  "terminal.integrated.fontSize": 14,
  "editor.fontSize": 16
}`;
    const baseRaw = base({ 'terminal.integrated.fontSize': 14, 'editor.fontSize': 16 });
    const remoteRaw = base({ 'terminal.integrated.fontSize': 15, 'editor.fontSize': 16 });

    const result = mergeJsoncSettings(baseRaw, localRaw, remoteRaw, 'remote');

    expect(result.newLocalText).toContain('// Terminal font');
    expect(result.newLocalText).toContain('"terminal.integrated.fontSize": 15');
  });

  it('survives a full round-trip with multiple comment styles', () => {
    const localRaw = `{
  // Line 1
  "a": 1, // inline
  /* block */
  "b": 2
}`;
    const result = mergeJsoncSettings(
      base({ a: 1, b: 2 }),
      localRaw,
      base({ a: 1, b: 2 }),
      'remote',
    );
    // No remote changes → local text is identical.
    expect(result.newLocalText).toBe(localRaw);
    expect(result.conflictKeys).toHaveLength(0);
  });
});

// ─────────────────────────── 3-way merge cases ────────────────────

describe('3-way merge', () => {
  it('no-op when all three sides agree', () => {
    const raw = base({ 'editor.fontSize': 16 });
    const result = mergeJsoncSettings(raw, raw, raw, 'newest');
    expect(result.newLocalText).toBe(raw);
    expect(result.conflictKeys).toHaveLength(0);
  });

  it('applies remote-only change to local', () => {
    const b = base({ 'editor.fontSize': 16 });
    const local = b; // unchanged
    const remote = base({ 'editor.fontSize': 18 });
    const result = mergeJsoncSettings(b, local, remote, 'remote');
    const parsed = JSON.parse(result.newLocalText);
    expect(parsed['editor.fontSize']).toBe(18);
  });

  it('keeps local-only change and pushes it to remote', () => {
    const b = base({ 'editor.fontSize': 16 });
    const local = base({ 'editor.fontSize': 20 });
    const remote = b; // unchanged
    const result = mergeJsoncSettings(b, local, remote, 'local');
    expect(JSON.parse(result.newLocalText)['editor.fontSize']).toBe(20);
    expect(JSON.parse(result.newRemoteRaw)['editor.fontSize']).toBe(20);
  });

  it('adds remote-only key to local', () => {
    const b = base({ a: 1 });
    const result = mergeJsoncSettings(b, b, base({ a: 1, b: 2 }), 'remote');
    expect(JSON.parse(result.newLocalText)['b']).toBe(2);
  });

  it('removes key deleted remotely from local', () => {
    const b = base({ a: 1, b: 2 });
    const result = mergeJsoncSettings(b, b, base({ a: 1 }), 'remote');
    const parsed = JSON.parse(result.newLocalText);
    expect('b' in parsed).toBe(false);
  });

  it('first-sync (null base) — remote wins for new keys', () => {
    const local = base({ 'editor.fontSize': 14 });
    const remote = base({ 'editor.fontSize': 16, 'editor.tabSize': 2 });
    const result = mergeJsoncSettings(null, local, remote, 'remote');
    const parsed = JSON.parse(result.newLocalText);
    expect(parsed['editor.tabSize']).toBe(2);
  });
});

// ─────────────────────────── conflict handling ────────────────────

describe('conflict resolution', () => {
  it('policy=remote: remote wins the conflict', () => {
    const b = base({ 'editor.fontSize': 16 });
    const local = base({ 'editor.fontSize': 18 });
    const remote = base({ 'editor.fontSize': 20 });
    const result = mergeJsoncSettings(b, local, remote, 'remote');
    expect(JSON.parse(result.newLocalText)['editor.fontSize']).toBe(20);
    expect(result.conflictKeys).toContain('editor.fontSize');
  });

  it('policy=local: local wins the conflict', () => {
    const b = base({ 'editor.fontSize': 16 });
    const local = base({ 'editor.fontSize': 18 });
    const remote = base({ 'editor.fontSize': 20 });
    const result = mergeJsoncSettings(b, local, remote, 'local');
    expect(JSON.parse(result.newLocalText)['editor.fontSize']).toBe(18);
    expect(result.conflictKeys).toContain('editor.fontSize');
  });

  it('no conflict when both sides set same value independently', () => {
    const b = base({ x: 1 });
    const local = base({ x: 2 });
    const remote = base({ x: 2 });
    const result = mergeJsoncSettings(b, local, remote, 'manual');
    expect(result.conflictKeys).toHaveLength(0);
    expect(JSON.parse(result.newLocalText)['x']).toBe(2);
  });
});

// ─────────────────────────── applyJsoncSettings ───────────────────

describe('applyJsoncSettings (one-way)', () => {
  it('merges source keys into dest, preserving dest comments', () => {
    const dest = `{
  // my comment
  "a": 1
}`;
    const result = applyJsoncSettings(base({ a: 2, b: 3 }), dest);
    expect(result).toContain('// my comment');
    // Use jsonc-parser to parse the result (which may still contain comments).
    const parsed = parseJSONC(result);
    expect(parsed['a']).toBe(2);
    expect(parsed['b']).toBe(3);
  });
});
