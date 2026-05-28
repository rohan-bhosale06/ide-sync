import { describe, it, expect } from 'vitest';
import { mergeSnippetDirectory, mergeSnippetFile } from '../../../src/config-sync/merger/snippets.js';

// ─────────────────────────── single-file merge ───────────────────

describe('mergeSnippetFile', () => {
  it('comment preservation: comments survive a no-op merge', () => {
    const raw = `{
  // My snippets
  "console.log": {
    "prefix": "log",
    "body": "console.log($1)"
  }
}`;
    const result = mergeSnippetFile(raw, raw, raw, 'remote');
    expect(result.newLocalText).toContain('// My snippets');
    expect(result.conflictKeys).toHaveLength(0);
  });

  it('adds remote-only snippet to local', () => {
    const base = '{}';
    const local = '{}';
    const remote = JSON.stringify({ 'new-snippet': { prefix: 'ns', body: 'new snippet' } }, null, 2);
    const result = mergeSnippetFile(base, local, remote, 'remote');
    expect(result.newLocalText).toContain('new-snippet');
  });

  it('removes snippet deleted remotely', () => {
    const both = JSON.stringify({ 'a': { prefix: 'a', body: 'aaa' }, 'b': { prefix: 'b', body: 'bbb' } }, null, 2);
    const remoteOnly = JSON.stringify({ 'a': { prefix: 'a', body: 'aaa' } }, null, 2);
    const result = mergeSnippetFile(both, both, remoteOnly, 'remote');
    expect(JSON.parse(result.newLocalText)).not.toHaveProperty('b');
  });
});

// ─────────────────────────── directory merge ─────────────────────

describe('mergeSnippetDirectory', () => {
  it('adds file added remotely', () => {
    const result = mergeSnippetDirectory(
      {},
      {},
      { 'typescript.json': '{ "ts-log": { "prefix": "tl", "body": "console.log" } }' },
      'remote',
    );
    expect(result.localWrites['typescript.json']).toBeDefined();
    expect(result.remoteSnippets['typescript.json']).toBeDefined();
    expect(result.localDeletes).toHaveLength(0);
  });

  it('adds file added locally to remote', () => {
    const result = mergeSnippetDirectory(
      {},
      { 'my.code-snippets': '{ "hello": { "prefix": "hw", "body": "Hello World" } }' },
      {},
      'local',
    );
    expect(result.remoteSnippets['my.code-snippets']).toBeDefined();
    expect(result.localWrites).not.toHaveProperty('my.code-snippets');
  });

  it('tombstones file deleted remotely — deletes locally', () => {
    const baseSnippets = { 'old.json': '{}' };
    const localSnippets = { 'old.json': '{}' };
    const remoteSnippets = {};  // deleted

    const result = mergeSnippetDirectory(baseSnippets, localSnippets, remoteSnippets, 'remote');
    expect(result.localDeletes).toContain('old.json');
    expect(result.remoteSnippets).not.toHaveProperty('old.json');
  });

  it('propagates local deletion to remote', () => {
    const baseSnippets = { 'old.json': '{}' };
    const localSnippets = {};   // deleted locally
    const remoteSnippets = { 'old.json': '{}' };

    const result = mergeSnippetDirectory(baseSnippets, localSnippets, remoteSnippets, 'local');
    expect(result.remoteSnippets).not.toHaveProperty('old.json');
    expect(result.localDeletes).toHaveLength(0); // already gone locally
  });

  it('merges content within a shared file', () => {
    const initial = '{ "a": { "prefix": "a", "body": "aaa" } }';
    const withB = '{ "a": { "prefix": "a", "body": "aaa" }, "b": { "prefix": "b", "body": "bbb" } }';

    const result = mergeSnippetDirectory(
      { 'shared.json': initial },
      { 'shared.json': initial },
      { 'shared.json': withB },
      'remote',
    );
    const updated = JSON.parse(result.localWrites['shared.json'] ?? '{}');
    expect(updated).toHaveProperty('b');
  });

  it('both sides deleted the same file — clean no-op', () => {
    const result = mergeSnippetDirectory(
      { 'gone.json': '{}' },
      {},
      {},
      'remote',
    );
    expect(result.localDeletes).toHaveLength(0);
    expect(result.remoteSnippets).not.toHaveProperty('gone.json');
  });
});
