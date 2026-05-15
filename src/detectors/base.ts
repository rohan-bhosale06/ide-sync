import path from 'path';
import { dirExists, listSubdirs, readJsonFile } from '../utils/fs.js';
import type { Extension, IDEFamily, IDEInstallation, IDEInventory } from './types.js';

// Matches: publisher.name-1.2.3 or publisher.name-1.2.3-win32-x64
// Name segment uses greedy (.+) with backtracking so hyphenated names (vscode-eslint) work.
const EXT_DIR_RE = /^([^.]+)\.(.+)-(\d+\.\d+\.\d+(?:\.\d+)?)(?:-[a-z0-9_-]+)?$/i;

interface PackageJson {
  displayName?: string;
  description?: string;
}

function parseExtensionDir(
  dirName: string,
  dirPath: string,
): Extension | null {
  const match = EXT_DIR_RE.exec(dirName);
  if (!match) return null;

  const [, publisher, name, version] = match;
  const pkg = readJsonFile<PackageJson>(path.join(dirPath, 'package.json'));

  if (!pkg && !dirName) return null; // skip completely unreadable dirs

  return {
    id: `${publisher}.${name}`,
    publisher,
    name,
    version,
    displayName: pkg?.displayName,
    description: pkg?.description,
    path: dirPath,
  };
}

export interface DetectorConfig {
  family: IDEFamily;
  displayName: string;
  extensionsPath: string;
  configPath: string | null;
}

export function detect(cfg: DetectorConfig): IDEInventory {
  const installed = dirExists(cfg.extensionsPath);

  const ide: IDEInstallation = {
    family: cfg.family,
    displayName: cfg.displayName,
    installed,
    extensionsPath: installed ? cfg.extensionsPath : null,
    configPath: cfg.configPath,
  };

  if (!installed) {
    return { ide, extensions: [] };
  }

  const extensions: Extension[] = [];
  for (const dirName of listSubdirs(cfg.extensionsPath)) {
    const dirPath = path.join(cfg.extensionsPath, dirName);
    const ext = parseExtensionDir(dirName, dirPath);
    if (ext) {
      extensions.push(ext);
    }
    // Malformed dirs are silently skipped per spec
  }

  return { ide, extensions };
}
