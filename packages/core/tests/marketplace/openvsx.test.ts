import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenVSXClient } from '../../src/marketplace/openvsx.js';

const MOCK_RESPONSE = {
  namespace: 'dbaeumer',
  name: 'vscode-eslint',
  version: '3.0.5',
  allVersions: {
    '3.0.5': 'https://open-vsx.org/api/dbaeumer/vscode-eslint/3.0.5',
    '3.0.4': 'https://open-vsx.org/api/dbaeumer/vscode-eslint/3.0.4',
  },
};

function mockFetch(response: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      arrayBuffer: async () => Buffer.from('fake-vsix-content').buffer,
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenVSXClient.getExtension', () => {
  it('returns metadata for a found extension', async () => {
    mockFetch(MOCK_RESPONSE);
    const client = new OpenVSXClient();
    const meta = await client.getExtension('dbaeumer.vscode-eslint');

    expect(meta).not.toBeNull();
    expect(meta!.id).toBe('dbaeumer.vscode-eslint');
    expect(meta!.publisher).toBe('dbaeumer');
    expect(meta!.name).toBe('vscode-eslint');
    expect(meta!.latestVersion).toBe('3.0.5');
    expect(meta!.versions).toContain('3.0.4');
    expect(meta!.source).toBe('openvsx');
  });

  it('builds the correct download URL', async () => {
    mockFetch(MOCK_RESPONSE);
    const client = new OpenVSXClient();
    const meta = await client.getExtension('dbaeumer.vscode-eslint');
    expect(meta!.downloadUrl()).toBe(
      'https://open-vsx.org/api/dbaeumer/vscode-eslint/3.0.5/file/dbaeumer.vscode-eslint-3.0.5.vsix',
    );
    expect(meta!.downloadUrl('3.0.4')).toBe(
      'https://open-vsx.org/api/dbaeumer/vscode-eslint/3.0.4/file/dbaeumer.vscode-eslint-3.0.4.vsix',
    );
  });

  it('returns null for a 404', async () => {
    mockFetch({ error: 'not found' }, 404);
    const client = new OpenVSXClient();
    const meta = await client.getExtension('nobody.nonexistent');
    expect(meta).toBeNull();
  });

  it('returns null when response has an error field', async () => {
    mockFetch({ error: 'Extension not found', version: undefined });
    const client = new OpenVSXClient();
    const meta = await client.getExtension('nobody.nonexistent');
    expect(meta).toBeNull();
  });

  it('caches results and does not re-fetch', async () => {
    mockFetch(MOCK_RESPONSE);
    const client = new OpenVSXClient();
    await client.getExtension('dbaeumer.vscode-eslint');
    await client.getExtension('dbaeumer.vscode-eslint');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('caches null results for missing extensions', async () => {
    mockFetch({ error: 'not found' }, 404);
    const client = new OpenVSXClient();
    await client.getExtension('nobody.gone');
    await client.getExtension('nobody.gone');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('returns null for IDs without a dot', async () => {
    const client = new OpenVSXClient();
    const meta = await client.getExtension('nodot');
    expect(meta).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const client = new OpenVSXClient();
    const meta = await client.getExtension('pub.ext');
    expect(meta).toBeNull();
  });
});

describe('OpenVSXClient.search', () => {
  const SEARCH_RESPONSE = {
    extensions: [
      { namespace: 'dbaeumer', name: 'vscode-eslint', version: '3.0.5' },
      { namespace: 'esbenp', name: 'prettier-vscode', version: '10.1.0' },
    ],
  };

  it('maps search results to ExtensionMetadata', async () => {
    mockFetch(SEARCH_RESPONSE);
    const client = new OpenVSXClient();
    const results = await client.search('eslint');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'dbaeumer.vscode-eslint', publisher: 'dbaeumer', latestVersion: '3.0.5', source: 'openvsx' });
    expect(results[0].downloadUrl()).toBe(
      'https://open-vsx.org/api/dbaeumer/vscode-eslint/3.0.5/file/dbaeumer.vscode-eslint-3.0.5.vsix',
    );
  });

  it('includes the query and limit in the request URL', async () => {
    mockFetch(SEARCH_RESPONSE);
    const client = new OpenVSXClient();
    await client.search('eslint', 5);
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('query=eslint');
    expect(calledUrl).toContain('size=5');
  });

  it('returns an empty array on a failed request', async () => {
    mockFetch({}, 500);
    const client = new OpenVSXClient();
    const results = await client.search('eslint');
    expect(results).toEqual([]);
  });

  it('returns an empty array on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const client = new OpenVSXClient();
    const results = await client.search('eslint');
    expect(results).toEqual([]);
  });
});
