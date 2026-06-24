export type MarketplaceSource = 'openvsx' | 'microsoft';

export interface ExtensionMetadata {
  id: string;
  publisher: string;
  name: string;
  latestVersion: string;
  versions: string[];
  source: MarketplaceSource;
  downloadUrl: (version?: string) => string;
}

export interface MarketplaceClient {
  source: MarketplaceSource;
  getExtension(id: string): Promise<ExtensionMetadata | null>;
  search(query: string, limit?: number): Promise<ExtensionMetadata[]>;
  downloadVsix(id: string, version: string, destPath: string): Promise<void>;
}