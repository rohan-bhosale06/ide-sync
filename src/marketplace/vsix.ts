import type { MarketplaceClient } from './types.js';
import { getVsixCachePath, vsixCacheHit, ensureCacheDir } from '../utils/cache.js';

export async function downloadVsixToCache(
  client: MarketplaceClient,
  id: string,
  version: string,
): Promise<string> {
  const [publisher, name] = id.split('.');
  const destPath = getVsixCachePath(publisher, name, version);

  if (vsixCacheHit(publisher, name, version)) return destPath;

  await ensureCacheDir();
  await client.downloadVsix(id, version, destPath);
  return destPath;
}