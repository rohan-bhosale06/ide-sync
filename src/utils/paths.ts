import os from 'os';
import path from 'path';

function homeDir(): string {
  // On Windows, os.homedir() returns the correct path (%USERPROFILE%)
  return os.homedir();
}

export function resolveHome(...segments: string[]): string {
  return path.join(homeDir(), ...segments);
}

export function resolveAppData(...segments: string[]): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(homeDir(), 'AppData', 'Roaming');
    return path.join(appData, ...segments);
  }
  // macOS: ~/Library/Application Support
  if (process.platform === 'darwin') {
    return path.join(homeDir(), 'Library', 'Application Support', ...segments);
  }
  // Linux: ~/.config
  return path.join(homeDir(), '.config', ...segments);
}

export type PlatformPaths = {
  extensions: string;
  config: string;
};

export function idePaths(
  homeDotDir: string,
  configSubPath?: string,
): PlatformPaths {
  const extensions = resolveHome(homeDotDir, 'extensions');
  const config = configSubPath
    ? resolveAppData(configSubPath)
    : resolveHome(homeDotDir);
  return { extensions, config };
}
