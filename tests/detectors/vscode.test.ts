import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detect } from '../../src/detectors/base.js';

// Creates a minimal extension folder structure under a temp dir
function makeExtensionsDir(
  root: string,
  extensions: Array<{ dirName: string; pkg?: Record<string, unknown> }>,
): string {
  const extDir = path.join(root, 'extensions');
  fs.mkdirSync(extDir, { recursive: true });

  for (const { dirName, pkg } of extensions) {
    const extPath = path.join(extDir, dirName);
    fs.mkdirSync(extPath);
    if (pkg !== undefined) {
      fs.writeFileSync(path.join(extPath, 'package.json'), JSON.stringify(pkg), 'utf8');
    }
  }
  return extDir;
}

describe('VS Code detector (base detect())', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-sync-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('marks IDE as not installed when extensions dir is missing', () => {
    const result = detect({
      family: 'vscode',
      displayName: 'VS Code',
      extensionsPath: path.join(tmpDir, 'nonexistent', 'extensions'),
      configPath: null,
    });

    expect(result.ide.installed).toBe(false);
    expect(result.ide.extensionsPath).toBeNull();
    expect(result.extensions).toHaveLength(0);
  });

  it('detects extensions matching the <publisher>.<name>-<version> pattern', () => {
    const extDir = makeExtensionsDir(tmpDir, [
      {
        dirName: 'dbaeumer.vscode-eslint-3.0.24',
        pkg: { displayName: 'ESLint', description: 'Integrates ESLint' },
      },
      {
        dirName: 'esbenp.prettier-vscode-10.4.0',
        pkg: { displayName: 'Prettier' },
      },
    ]);

    const result = detect({
      family: 'vscode',
      displayName: 'VS Code',
      extensionsPath: extDir,
      configPath: null,
    });

    expect(result.ide.installed).toBe(true);
    expect(result.extensions).toHaveLength(2);

    const eslint = result.extensions.find((e) => e.id === 'dbaeumer.vscode-eslint');
    expect(eslint).toBeDefined();
    expect(eslint?.publisher).toBe('dbaeumer');
    expect(eslint?.name).toBe('vscode-eslint');
    expect(eslint?.version).toBe('3.0.24');
    expect(eslint?.displayName).toBe('ESLint');
    expect(eslint?.description).toBe('Integrates ESLint');
  });

  it('skips directories that do not match the extension naming pattern', () => {
    const extDir = makeExtensionsDir(tmpDir, [
      { dirName: '.cache-dir' },
      { dirName: 'not-an-extension' },
      { dirName: 'dbaeumer.vscode-eslint-3.0.24', pkg: { displayName: 'ESLint' } },
    ]);

    const result = detect({
      family: 'vscode',
      displayName: 'VS Code',
      extensionsPath: extDir,
      configPath: null,
    });

    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].id).toBe('dbaeumer.vscode-eslint');
  });

  it('gracefully handles extensions with missing package.json', () => {
    const extDir = makeExtensionsDir(tmpDir, [
      { dirName: 'publisher.ext-1.0.0' }, // no pkg provided → no package.json written
    ]);

    const result = detect({
      family: 'vscode',
      displayName: 'VS Code',
      extensionsPath: extDir,
      configPath: null,
    });

    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].displayName).toBeUndefined();
  });

  it('gracefully handles extensions with malformed package.json', () => {
    const extDir = makeExtensionsDir(tmpDir, []);
    const extPath = path.join(extDir, 'bad.ext-1.0.0');
    fs.mkdirSync(extPath);
    fs.writeFileSync(path.join(extPath, 'package.json'), '{not valid json', 'utf8');

    const result = detect({
      family: 'vscode',
      displayName: 'VS Code',
      extensionsPath: extDir,
      configPath: null,
    });

    // Extension still added, just without displayName/description
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].id).toBe('bad.ext');
    expect(result.extensions[0].displayName).toBeUndefined();
  });

  it('handles platform-suffixed extension dir names', () => {
    const extDir = makeExtensionsDir(tmpDir, [
      {
        dirName: 'anthropic.claude-code-2.1.126-win32-x64',
        pkg: { displayName: 'Claude Code' },
      },
    ]);

    const result = detect({
      family: 'vscode',
      displayName: 'VS Code',
      extensionsPath: extDir,
      configPath: null,
    });

    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].id).toBe('anthropic.claude-code');
    expect(result.extensions[0].version).toBe('2.1.126');
  });
});
