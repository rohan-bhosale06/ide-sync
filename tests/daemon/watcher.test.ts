import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

// Module-level variable updated per-test. vi.mock is hoisted, so the factory
// needs to close over a mutable reference rather than a local variable.
let _mockExtensionsDir = '';
let _mockFamily = 'vscode';

vi.mock('../../src/detectors/index.js', () => ({
  runDetectors: () => [
    {
      ide: {
        family: _mockFamily,
        installed: true,
        extensionsPath: _mockExtensionsDir,
        configPath: null,
        displayName: 'Mock IDE',
      },
      extensions: [],
    },
  ],
  ALL_FAMILIES: ['vscode', 'cursor'],
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ide-sync-watcher-'));
}

function makeExtDir(parent: string, name: string): string {
  const p = path.join(parent, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe('IDEWatcher', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('fires event when extension-shaped dir is added', async () => {
    const { IDEWatcher } = await import('../../src/daemon/watcher.js');

    const extensionsDir = path.join(tmpRoot, 'extensions');
    fs.mkdirSync(extensionsDir);
    _mockExtensionsDir = extensionsDir;
    _mockFamily = 'vscode';

    const events: string[] = [];
    const watcher = new IDEWatcher((ide) => events.push(ide), silentLogger);
    watcher.start();

    // Wait for chokidar to set up its watchers.
    await new Promise((r) => setTimeout(r, 400));

    makeExtDir(extensionsDir, 'ms-python.python-2024.1.0');

    await new Promise((r) => setTimeout(r, 600));
    await watcher.stop();

    expect(events).toContain('vscode');
  }, 5000);

  it('does NOT fire for non-extension-shaped directories', async () => {
    const { IDEWatcher } = await import('../../src/daemon/watcher.js');

    const extensionsDir = path.join(tmpRoot, 'extensions');
    fs.mkdirSync(extensionsDir);
    _mockExtensionsDir = extensionsDir;
    _mockFamily = 'cursor';

    const events: string[] = [];
    const watcher = new IDEWatcher((ide) => events.push(ide), silentLogger);
    watcher.start();
    await new Promise((r) => setTimeout(r, 400));

    // Plain directory — not publisher.name-version shaped.
    fs.mkdirSync(path.join(extensionsDir, 'some-random-dir'));

    await new Promise((r) => setTimeout(r, 500));
    await watcher.stop();

    expect(events).not.toContain('cursor');
  }, 5000);

  it('fires event when extension dir is removed (unlinkDir)', async () => {
    const { IDEWatcher } = await import('../../src/daemon/watcher.js');

    const extensionsDir = path.join(tmpRoot, 'extensions');
    fs.mkdirSync(extensionsDir);
    const extPath = makeExtDir(extensionsDir, 'dbaeumer.vscode-eslint-3.0.1');
    _mockExtensionsDir = extensionsDir;
    _mockFamily = 'vscode';

    const events: string[] = [];
    const watcher = new IDEWatcher((ide) => events.push(ide), silentLogger);
    watcher.start();
    await new Promise((r) => setTimeout(r, 400));

    fs.rmSync(extPath, { recursive: true });

    await new Promise((r) => setTimeout(r, 600));
    await watcher.stop();

    expect(events).toContain('vscode');
  }, 5000);

  it('extension dir name regex matches valid patterns', () => {
    const EXT_DIR_RE = /^[a-z0-9_-]+\.[a-z0-9_-]+-\d+\.\d+\.\d+$/i;

    expect(EXT_DIR_RE.test('ms-python.python-2024.1.0')).toBe(true);
    expect(EXT_DIR_RE.test('dbaeumer.vscode-eslint-3.0.1')).toBe(true);
    expect(EXT_DIR_RE.test('GitHub.copilot-1.234.0')).toBe(true);
    expect(EXT_DIR_RE.test('some-random-dir')).toBe(false);
    expect(EXT_DIR_RE.test('.hidden')).toBe(false);
    expect(EXT_DIR_RE.test('noversion.ext')).toBe(false);
    expect(EXT_DIR_RE.test('publisher.name-1.0')).toBe(false);
  });
});
