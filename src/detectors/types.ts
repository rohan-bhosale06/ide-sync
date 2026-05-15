export type IDEFamily = 'vscode' | 'cursor' | 'windsurf' | 'antigravity' | 'vscodium';

export interface IDEInstallation {
  family: IDEFamily;
  displayName: string;
  installed: boolean;
  extensionsPath: string | null;
  configPath: string | null;
}

export interface Extension {
  id: string;
  publisher: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  path: string;
}

export interface IDEInventory {
  ide: IDEInstallation;
  extensions: Extension[];
}

export interface UnifiedManifest {
  generatedAt: string;
  hostname: string;
  platform: NodeJS.Platform;
  inventories: IDEInventory[];
}
