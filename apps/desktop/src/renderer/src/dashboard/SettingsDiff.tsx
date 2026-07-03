import { useEffect, useState } from 'react';
import type { ConfigDomain, IDEFamily } from 'ide-sync-core';

interface ConfigKeyChange {
  key: string;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
  status: 'unchanged' | 'local-only' | 'remote-only' | 'converged' | 'conflict';
}

const FAMILIES: { id: IDEFamily; label: string }[] = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'vscodium', label: 'VSCodium' },
  { id: 'kiro', label: 'Kiro' },
];

function fmt(v: unknown): string {
  if (v === undefined) return '(none)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export default function SettingsDiff() {
  const [family, setFamily] = useState<IDEFamily>('vscode');
  const [diff, setDiff] = useState<Partial<Record<ConfigDomain, ConfigKeyChange[]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    window.ideSync.config
      .diff(family)
      .then((d: Partial<Record<ConfigDomain, ConfigKeyChange[]>>) => setDiff(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [family]);

  const domains = diff ? (Object.keys(diff) as ConfigDomain[]).filter((d) => (diff[d]?.length ?? 0) > 0) : [];

  return (
    <div className="overview">
      <h1>Settings Diff</h1>
      <p className="dim">Compares this computer's settings with the shared sync store.</p>

      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="diff-family">Editor</label>
        <select id="diff-family" value={family} onChange={(e) => setFamily(e.target.value as IDEFamily)}>
          {FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {loading && <p className="dim">Loading…</p>}
      {error && (
        <div className="wizard-notice error">
          <p className="dim">{error}</p>
          <button className="btn-secondary" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && domains.length === 0 && (
        <p className="dim">No differences found.</p>
      )}

      {domains.map((domain) => (
        <div key={domain} className="diff-section">
          <h3>{domain}</h3>
          <table className="data-table">
            <thead>
              <tr><th>Key</th><th>This computer</th><th>Shared store</th><th>Status</th></tr>
            </thead>
            <tbody>
              {diff![domain]!.filter((c) => c.status !== 'unchanged').map((c) => (
                <tr key={c.key}>
                  <td>{c.key}</td>
                  <td className="dim">{fmt(c.localValue)}</td>
                  <td className="dim">{fmt(c.remoteValue)}</td>
                  <td><span className={`badge badge-${c.status}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
