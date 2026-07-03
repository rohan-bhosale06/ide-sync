import { useEffect, useState } from 'react';
import type { BackupEntry, IDEInstallation } from 'ide-sync-core';

export default function Backups() {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [ides, setIdes] = useState<IDEInstallation[]>([]);
  const [selected, setSelected] = useState<BackupEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<IDEInstallation | null>(null);

  useEffect(() => {
    window.ideSync.config.listBackups().then((b: BackupEntry[]) => setBackups(b));
    window.ideSync.setup.detectIdes().then((found: IDEInstallation[]) => setIdes(found));
  }, []);

  const restore = async (ide: IDEInstallation) => {
    if (!selected || !ide.configPath) return;
    setRestoring(ide.family);
    setError(null);
    try {
      await window.ideSync.config.restoreBackup(selected.id, ide.family, ide.configPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(null);
      setConfirmTarget(null);
    }
  };

  return (
    <div className="overview">
      <h1>Backups</h1>
      <p className="dim">Snapshots of your config files taken before each sync.</p>

      {backups === null ? (
        <p className="dim">Loading…</p>
      ) : backups.length === 0 ? (
        <p className="dim">No backups yet.</p>
      ) : (
        <div className="backups-layout">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Editors</th><th /></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className={selected?.id === b.id ? 'row-selected' : ''}>
                  <td>{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="dim">{b.ides.join(', ')}</td>
                  <td><button className="btn-secondary" onClick={() => setSelected(b)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          {selected && (
            <div className="backup-detail">
              <h3>Backup from {new Date(selected.createdAt).toLocaleString()}</h3>
              <p className="dim">Contains config files for: {selected.ides.join(', ')}</p>
              {selected.ides.map((family) => {
                const ide = ides.find((i) => i.family === family);
                return (
                  <div key={family} className="backup-restore-row">
                    <span>{ide?.displayName ?? family}</span>
                    <button
                      className="btn-secondary"
                      disabled={!ide?.configPath || restoring === family}
                      onClick={() => setConfirmTarget(ide ?? null)}
                    >
                      {restoring === family ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <div className="wizard-notice error"><p className="dim">{error}</p></div>}

      {confirmTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Restore {confirmTarget.displayName}?</h3>
            <p>This will overwrite the current settings, keybindings, and snippets at:</p>
            <p className="dim">{confirmTarget.configPath}</p>
            <div className="wizard-actions">
              <button className="btn-secondary" onClick={() => setConfirmTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => restore(confirmTarget)}>Restore</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
