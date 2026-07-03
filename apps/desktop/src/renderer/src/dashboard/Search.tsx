import { useState } from 'react';
import type { ExtensionMetadata, IDEFamily } from 'ide-sync-core';

const FAMILIES: { id: IDEFamily; label: string }[] = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'vscodium', label: 'VSCodium' },
  { id: 'kiro', label: 'Kiro' },
];

type RowState = 'idle' | 'installing' | 'installed' | 'failed';

export default function Search() {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<IDEFamily>('vscode');
  const [results, setResults] = useState<ExtensionMetadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const found: ExtensionMetadata[] = await window.ideSync.search.search(query.trim(), family);
      setResults(found);
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const install = async (id: string) => {
    setRowState((s) => ({ ...s, [id]: 'installing' }));
    const result = await window.ideSync.search.install([id], { ide: family });
    const entry = result.results?.find((r: { id: string }) => r.id === id);
    if (entry?.success) {
      setRowState((s) => ({ ...s, [id]: 'installed' }));
    } else {
      setRowState((s) => ({ ...s, [id]: 'failed' }));
      setRowError((s) => ({ ...s, [id]: entry?.error ?? 'Install failed.' }));
    }
  };

  return (
    <div className="overview">
      <h1>Find Extensions</h1>

      <div className="field-row" style={{ marginTop: '0.5rem' }}>
        <input
          placeholder="Search by name or publisher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <select value={family} onChange={(e) => setFamily(e.target.value as IDEFamily)}>
          {FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={search} disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {!results && !loading && !error && (
        <p className="dim" style={{ marginTop: '1.25rem' }}>Search the marketplace for extensions to install.</p>
      )}

      {error && (
        <div className="wizard-notice error">
          <p>Search failed.</p>
          <p className="dim">{error}</p>
          <button className="btn-secondary" onClick={search}>Retry</button>
        </div>
      )}

      {results && results.length === 0 && !error && (
        <p className="dim" style={{ marginTop: '1.25rem' }}>No results for "{query}".</p>
      )}

      {results && results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Publisher</th><th>Version</th><th>Source</th><th /></tr>
          </thead>
          <tbody>
            {results.map((ext) => {
              const state = rowState[ext.id] ?? 'idle';
              return (
                <tr key={ext.id}>
                  <td>{ext.name}</td>
                  <td className="dim">{ext.publisher}</td>
                  <td className="dim">{ext.latestVersion}</td>
                  <td><span className="badge">{ext.source}</span></td>
                  <td className="row-actions">
                    {state === 'installed' ? (
                      <span className="status-ok">Installed</span>
                    ) : state === 'failed' ? (
                      <span title={rowError[ext.id]} className="dim">Failed — retry</span>
                    ) : null}
                    <button
                      className="btn-secondary"
                      onClick={() => install(ext.id)}
                      disabled={state === 'installing' || state === 'installed'}
                    >
                      {state === 'installing' ? 'Installing…' : 'Install'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
