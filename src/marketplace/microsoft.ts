import { writeFile } from 'fs/promises';
import type { ExtensionMetadata, MarketplaceClient } from './types.js';

const GALLERY_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

// Flags: IncludeVersions(1) + IncludeFiles(2) + IncludeAssetUri(128) + IncludeLatestVersionOnly(512)
const FLAGS = 1 | 2 | 128 | 512;

interface GalleryVersion {
  version: string;
  assetUri: string;
  fallbackAssetUri?: string;
}

interface GalleryExtension {
  publisher: { publisherName: string };
  extensionName: string;
  versions: GalleryVersion[];
}

interface GalleryResponse {
  results?: Array<{ extensions?: GalleryExtension[] }>;
}

export class MicrosoftMarketplaceClient implements MarketplaceClient {
  readonly source = 'microsoft' as const;

  private cache = new Map<string, ExtensionMetadata | null>();

  async getExtension(id: string): Promise<ExtensionMetadata | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;

    const [publisher, name] = id.split('.');
    if (!publisher || !name) {
      this.cache.set(id, null);
      return null;
    }

    try {
      const res = await fetch(GALLERY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;api-version=7.2-preview.1',
          'User-Agent': 'ide-sync/0.2.0',
        },
        body: JSON.stringify({
          filters: [{ criteria: [{ filterType: 7, value: id }] }],
          flags: FLAGS,
        }),
      });

      if (!res.ok) {
        this.cache.set(id, null);
        return null;
      }

      const data = (await res.json()) as GalleryResponse;
      const ext = data.results?.[0]?.extensions?.[0];
      if (!ext || !ext.versions?.length) {
        this.cache.set(id, null);
        return null;
      }

      const latestVersion = ext.versions[0].version;
      const versions = ext.versions.map((v) => v.version);

      const getAssetUri = (version?: string): string => {
        const target = version
          ? ext.versions.find((v) => v.version === version) ?? ext.versions[0]
          : ext.versions[0];
        return target.assetUri;
      };

      const metadata: ExtensionMetadata = {
        id,
        publisher,
        name,
        latestVersion,
        versions,
        source: 'microsoft',
        downloadUrl: (version?: string) =>
          `${getAssetUri(version)}/Microsoft.VisualStudio.Services.VSIXPackage`,
      };

      this.cache.set(id, metadata);
      return metadata;
    } catch {
      this.cache.set(id, null);
      return null;
    }
  }

  async downloadVsix(id: string, version: string, destPath: string): Promise<void> {
    const meta = await this.getExtension(id);
    if (!meta) throw new Error(`${id} not found on Microsoft Marketplace`);

    const url = meta.downloadUrl(version);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MS Marketplace download failed: HTTP ${res.status}`);

    const buf = await res.arrayBuffer();
    await writeFile(destPath, Buffer.from(buf));
  }
}