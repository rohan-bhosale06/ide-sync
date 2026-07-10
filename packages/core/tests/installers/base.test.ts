import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDEFamily } from '../../src/detectors/types.js';
import { BaseInstaller } from '../../src/installers/base.js';

// ── mocks ────────────────────────────────────────────────────────
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('../../src/utils/cli-detect.js', () => ({
  detectCli: vi.fn(),
}));

vi.mock('../../src/marketplace/resolver.js', () => ({
  resolveExtension: vi.fn(),
}));

vi.mock('../../src/marketplace/vsix.js', () => ({
  downloadVsixToCache: vi.fn(),
}));

import { execa } from 'execa';
import { detectCli } from '../../src/utils/cli-detect.js';
import { resolveExtension } from '../../src/marketplace/resolver.js';
import { downloadVsixToCache } from '../../src/marketplace/vsix.js';

// Concrete subclass for testing
class TestInstaller extends BaseInstaller {
  readonly family: IDEFamily = 'cursor';
}

function makeExecaResult(exitCode: number, stderr = ''): object {
  return { exitCode, stdout: '', stderr };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BaseInstaller.isAvailable', () => {
  it('returns true when CLI is found', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    const inst = new TestInstaller();
    expect(await inst.isAvailable()).toBe(true);
  });

  it('returns false when CLI is not found', async () => {
    vi.mocked(detectCli).mockResolvedValue(null);
    const inst = new TestInstaller();
    expect(await inst.isAvailable()).toBe(false);
  });
});

describe('BaseInstaller.install', () => {
  it('returns error when CLI is unavailable', async () => {
    vi.mocked(detectCli).mockResolvedValue(null);
    const inst = new TestInstaller();
    const result = await inst.install('pub.ext');
    expect(result.success).toBe(false);
    expect(result.method).toBe('manual');
  });

  it('succeeds via CLI on exit code 0', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa).mockResolvedValue(makeExecaResult(0) as never);
    const inst = new TestInstaller();
    const result = await inst.install('pub.ext', '1.2.3');
    expect(result.success).toBe(true);
    expect(result.method).toBe('cli');
    expect(result.version).toBe('1.2.3');
    expect(vi.mocked(execa)).toHaveBeenCalledWith('cursor', ['--install-extension', 'pub.ext@1.2.3'], expect.any(Object));
  });

  it('falls back to vsix when CLI returns non-zero', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa)
      .mockResolvedValueOnce(makeExecaResult(1, 'error: not found') as never) // CLI attempt fails
      .mockResolvedValueOnce(makeExecaResult(0) as never);                     // vsix install succeeds
    vi.mocked(resolveExtension).mockResolvedValue({
      metadata: {
        id: 'pub.ext',
        publisher: 'pub',
        name: 'ext',
        latestVersion: '2.0.0',
        versions: ['2.0.0'],
        source: 'openvsx',
        downloadUrl: () => 'https://example.com/ext.vsix',
      },
      client: {} as never,
    });
    vi.mocked(downloadVsixToCache).mockResolvedValue('/cache/pub.ext-2.0.0.vsix');

    const inst = new TestInstaller();
    const result = await inst.install('pub.ext');
    expect(result.success).toBe(true);
    expect(result.method).toBe('vsix');
    expect(result.version).toBe('2.0.0');
  });

  it('returns failure when marketplace lookup finds nothing', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa).mockResolvedValue(makeExecaResult(1, 'not found') as never);
    vi.mocked(resolveExtension).mockResolvedValue(null);

    const inst = new TestInstaller();
    const result = await inst.install('github.copilot');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/marketplace/i);
  });
});

describe('BaseInstaller.uninstall', () => {
  it('succeeds on exit code 0', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa).mockResolvedValue(makeExecaResult(0) as never);
    const inst = new TestInstaller();
    const result = await inst.uninstall('pub.ext');
    expect(result.success).toBe(true);
    expect(result.method).toBe('cli');
    expect(vi.mocked(execa)).toHaveBeenCalledWith('cursor', ['--uninstall-extension', 'pub.ext'], expect.any(Object));
  });

  it('returns failure on non-zero exit', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa).mockResolvedValue(makeExecaResult(1, 'permission denied') as never);
    const inst = new TestInstaller();
    const result = await inst.uninstall('pub.ext');
    expect(result.success).toBe(false);
    expect(result.error).toBe('permission denied');
  });

  it('returns error when CLI unavailable', async () => {
    vi.mocked(detectCli).mockResolvedValue(null);
    const inst = new TestInstaller();
    const result = await inst.uninstall('pub.ext');
    expect(result.success).toBe(false);
    expect(result.method).toBe('manual');
  });

  it('treats "is not installed" as a successful no-op', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa).mockResolvedValue(
      makeExecaResult(1, "Extension 'pub.ext' is not installed. Make sure you use the full extension ID.") as never,
    );
    const inst = new TestInstaller();
    const result = await inst.uninstall('pub.ext');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('strips node deprecation noise from error output', async () => {
    vi.mocked(detectCli).mockResolvedValue('cursor');
    vi.mocked(execa).mockResolvedValue(
      makeExecaResult(
        1,
        '(node:9156) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.\nSomething actually went wrong',
      ) as never,
    );
    const inst = new TestInstaller();
    const result = await inst.uninstall('pub.ext');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Something actually went wrong');
  });
});
