import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';

export function getCacheDir(): string {
  return path.join(os.homedir(), '.ide-sync', 'cache', 'vsix');
}

export function getVsixCachePath(publisher: string, name: string, version: string): string {
  return path.join(getCacheDir(), `${publisher}.${name}-${version}.vsix`);
}

export function vsixCacheHit(publisher: string, name: string, version: string): boolean {
  return existsSync(getVsixCachePath(publisher, name, version));
}

export async function ensureCacheDir(): Promise<void> {
  await mkdir(getCacheDir(), { recursive: true });
}