export interface ServiceInstaller {
  install(daemonScriptPath: string): Promise<void>;
  uninstall(): Promise<void>;
}

export class NotImplementedInstaller implements ServiceInstaller {
  constructor(private readonly platform: string) {}

  async install(_daemonScriptPath: string): Promise<void> {
    throw new Error(
      `OS service installation is not yet implemented for ${this.platform}.\n` +
      `You can still run the daemon manually with: ide-sync daemon start\n` +
      `Track platform support at: https://github.com/rohan-bhosale06/ide-sync`,
    );
  }

  async uninstall(): Promise<void> {
    throw new Error(`OS service uninstallation is not yet implemented for ${this.platform}.`);
  }
}
