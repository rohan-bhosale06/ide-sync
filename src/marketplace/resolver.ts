import type { ExtensionMetadata, MarketplaceClient } from './types.js';
import type { IDEFamily } from '../detectors/types.js';
import { OpenVSXClient } from './openvsx.js';
import { MicrosoftMarketplaceClient } from './microsoft.js';

export interface ResolverOptions {
  // MS Marketplace ToS technically restricts non-MS clients — opt-in only
  allowMsMarketplace?: boolean;
}

// Singletons shared across a command run (in-memory cache per process)
let openVsxClient: OpenVSXClient | null = null;
let msClient: MicrosoftMarketplaceClient | null = null;

function getOpenVSX(): OpenVSXClient {
  if (!openVsxClient) openVsxClient = new OpenVSXClient();
  return openVsxClient;
}

function getMicrosoft(): MicrosoftMarketplaceClient {
  if (!msClient) msClient = new MicrosoftMarketplaceClient();
  return msClient;
}

export function getClientsForFamily(
  family: IDEFamily,
  opts: ResolverOptions = {},
): MarketplaceClient[] {
  if (family === 'vscode') {
    // VS Code is Microsoft's product — MS Marketplace is primary
    return [getMicrosoft(), getOpenVSX()];
  }
  // All other forks: Open VSX first; MS marketplace is opt-in due to ToS
  const clients: MarketplaceClient[] = [getOpenVSX()];
  if (opts.allowMsMarketplace) clients.push(getMicrosoft());
  return clients;
}

export interface ResolvedExtension {
  metadata: ExtensionMetadata;
  client: MarketplaceClient;
}

export async function resolveExtension(
  id: string,
  family: IDEFamily,
  opts: ResolverOptions = {},
): Promise<ResolvedExtension | null> {
  const clients = getClientsForFamily(family, opts);
  for (const client of clients) {
    const metadata = await client.getExtension(id);
    if (metadata) return { metadata, client };
  }
  return null;
}

/** Search all marketplaces configured for `family`, deduped by id (first client wins). */
export async function searchMarketplaces(
  query: string,
  family: IDEFamily,
  opts: ResolverOptions & { limit?: number } = {},
): Promise<ExtensionMetadata[]> {
  const clients = getClientsForFamily(family, opts);
  const results = await Promise.all(clients.map((client) => client.search(query, opts.limit)));

  const seen = new Set<string>();
  const merged: ExtensionMetadata[] = [];
  for (const list of results) {
    for (const ext of list) {
      const key = ext.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(ext);
    }
  }
  return merged;
}

// Reset singletons — used in tests
export function resetClients(): void {
  openVsxClient = null;
  msClient = null;
}