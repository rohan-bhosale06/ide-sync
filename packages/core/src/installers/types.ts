import type { IDEFamily } from '../detectors/types.js';

export interface InstallResult {
  extensionId: string;
  success: boolean;
  version?: string;
  error?: string;
  method: 'cli' | 'vsix' | 'manual';
}

export interface Installer {
  family: IDEFamily;
  isAvailable(): Promise<boolean>;
  install(extensionId: string, version?: string): Promise<InstallResult>;
  installFromVsix(vsixPath: string, extensionId?: string): Promise<InstallResult>;
  uninstall(extensionId: string): Promise<InstallResult>;
}
