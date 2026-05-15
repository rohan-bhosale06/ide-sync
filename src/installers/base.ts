import { execa } from 'execa';
import type { IDEFamily } from '../detectors/types.js';
import type { InstallResult, Installer } from './types.js';
import { detectCli } from '../utils/cli-detect.js';
import { resolveExtension } from '../marketplace/resolver.js';
import { downloadVsixToCache } from '../marketplace/vsix.js';
import type { ResolverOptions } from '../marketplace/resolver.js';

export abstract class BaseInstaller implements Installer {
  abstract readonly family: IDEFamily;

  protected resolverOpts: ResolverOptions = {};

  private _cli: string | null | undefined = undefined;

  async getCliPath(): Promise<string | null> {
    if (this._cli === undefined) {
      this._cli = await detectCli(this.family);
    }
    return this._cli;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getCliPath()) !== null;
  }

  async install(extensionId: string, version?: string): Promise<InstallResult> {
    const cli = await this.getCliPath();
    if (!cli) {
      return {
        extensionId,
        success: false,
        error: `No CLI binary found for ${this.family}`,
        method: 'manual',
      };
    }

    // Try CLI install first — the IDE will use its own configured marketplace
    const idArg = version ? `${extensionId}@${version}` : extensionId;
    try {
      const result = await execa(cli, ['--install-extension', idArg], { reject: false });
      if (result.exitCode === 0) {
        return { extensionId, success: true, version, method: 'cli' };
      }
    } catch {
      // CLI invocation failed entirely; fall through to vsix
    }

    // Fall back: download .vsix from marketplace and install via CLI
    try {
      const resolved = await resolveExtension(extensionId, this.family, this.resolverOpts);
      if (!resolved) {
        return {
          extensionId,
          success: false,
          error: `Not found on any configured marketplace`,
          method: 'vsix',
        };
      }

      const vsixVersion = version ?? resolved.metadata.latestVersion;
      const vsixPath = await downloadVsixToCache(resolved.client, extensionId, vsixVersion);
      const vsixResult = await this.installFromVsix(vsixPath, extensionId);

      return { ...vsixResult, version: vsixVersion };
    } catch (err) {
      return {
        extensionId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        method: 'vsix',
      };
    }
  }

  async installFromVsix(vsixPath: string, extensionId?: string): Promise<InstallResult> {
    const id = extensionId ?? vsixPath;
    const cli = await this.getCliPath();
    if (!cli) {
      return { extensionId: id, success: false, error: `No CLI for ${this.family}`, method: 'vsix' };
    }

    try {
      const result = await execa(cli, ['--install-extension', vsixPath], { reject: false });
      return {
        extensionId: id,
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? (result.stderr || result.stdout) : undefined,
        method: 'vsix',
      };
    } catch (err) {
      return {
        extensionId: id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        method: 'vsix',
      };
    }
  }

  async uninstall(extensionId: string): Promise<InstallResult> {
    const cli = await this.getCliPath();
    if (!cli) {
      return {
        extensionId,
        success: false,
        error: `No CLI binary found for ${this.family}`,
        method: 'manual',
      };
    }

    try {
      const result = await execa(cli, ['--uninstall-extension', extensionId], { reject: false });
      return {
        extensionId,
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? (result.stderr || result.stdout) : undefined,
        method: 'cli',
      };
    } catch (err) {
      return {
        extensionId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        method: 'cli',
      };
    }
  }
}
