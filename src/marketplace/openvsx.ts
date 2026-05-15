import { writeFile } from 'fs/promises';
import type { ExtensionMetadata, MarketplaceClient } from './types.js';

const BASE = 'https://open-vsx.org/api';

interface OpenVSXResponse {
  error?: string;
  version?: string;
  namespace?: string;
  name?: string;
  allVersions?: Record<string, string>;
}

export class OpenVSXClient implements MarketplaceClient {
  readonly source = 'openvsx' as const;

  private cache = new Map<string, ExtensionMetadata | null>();

  async getExtension(id: string): Promise<ExtensionMetadata | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;

    const [publisher, name] = id.split('.');
    if (!publisher || !name) {
      this.cache.set(id, null);
      return null;
    }

    try {
      const res = await fetch(`${BASE}/${publisher}/${name}`);
      if (!res.ok) {
        this.cache.set(id, null);
        return null;
      }

      const data = (await res.json()) as OpenVSXResponse;
      if (data.error || !data.version) {
        this.cache.set(id, null);
        return null;
      }

      const latestVersion = data.version;
      const versions = Object.keys(data.allVersions ?? { [latestVersion]: '' });

      const metadata: ExtensionMetadata = {
        id,
        publisher,
        name,
        latestVersion,
        versions,
        source: 'openvsx',
        downloadUrl: (version?: string) => {
          const v = version ?? latestVersion;
          return `${BASE}/${publisher}/${name}/${v}/file/${publisher}.${name}-${v}.vsix`;
        },
      };

      this.cache.set(id, metadata);
      return metadata;
    } catch {
      this.cache.set(id, null);
      return null;
    }
  }

  async downloadVsix(id: string, version: string, destPath: string): Promise<void> {
    const [publisher, name] = id.split('.');
    const url = `${BASE}/${publisher}/${name}/${version}/file/${publisher}.${name}-${version}.vsix`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open VSX download failed: HTTP ${res.status}`);

    const buf = await res.arrayBuffer();
    await writeFile(destPath, Buffer.from(buf));
  }
}