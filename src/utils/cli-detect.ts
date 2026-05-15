import { execa } from 'execa';
import { existsSync } from 'fs';
import type { IDEFamily } from '../detectors/types.js';

// Primary CLI binary candidates per IDE family
const CLI_CANDIDATES: Record<IDEFamily, string[]> = {
  vscode: ['code'],
  cursor: ['cursor'],
  windsurf: ['windsurf'],
  antigravity: ['antigravity'],
  vscodium: ['codium'],
};

// macOS: fallback paths inside .app bundles when the shell integration isn't installed
const MACOS_APP_BINS: Partial<Record<IDEFamily, string>> = {
  vscode: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  cursor: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
  windsurf: '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
  antigravity: '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
  vscodium: '/Applications/VSCodium.app/Contents/Resources/app/bin/codium',
};

async function isOnPath(bin: string): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = await execa(cmd, [bin], { reject: false });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function detectCli(family: IDEFamily): Promise<string | null> {
  for (const bin of CLI_CANDIDATES[family]) {
    if (await isOnPath(bin)) return bin;
  }

  if (process.platform === 'darwin') {
    const appBin = MACOS_APP_BINS[family];
    if (appBin && existsSync(appBin)) return appBin;
  }

  return null;
}

export function getCliInstallHint(family: IDEFamily): string {
  const hints: Record<IDEFamily, string> = {
    vscode: 'Open VS Code → Command Palette → "Shell Command: Install \'code\' command in PATH"',
    cursor: 'Open Cursor → Command Palette → "Shell Command: Install \'cursor\' command in PATH"',
    windsurf: 'Open Windsurf → Command Palette → "Shell Command: Install \'windsurf\' command in PATH"',
    antigravity: 'Open Antigravity → Command Palette → "Shell Command: Install in PATH"',
    vscodium: 'Open VSCodium → Command Palette → "Shell Command: Install \'codium\' command in PATH"',
  };
  return hints[family];
}