import { useState } from 'react';
import type { ConflictItem } from 'ide-sync-core';

type Resolution = 'keep-local' | 'keep-remote';

export default function ConflictResolver({
  conflicts,
  onDone,
  onCancel,
}: {
  conflicts: ConflictItem[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOne = (id: string, value: Resolution) => setResolutions((r) => ({ ...r, [id]: value }));
  const setAll = (value: Resolution) =>
    setResolutions(Object.fromEntries(conflicts.map((c) => [c.extensionId, value])));

  const allResolved = conflicts.every((c) => resolutions[c.extensionId]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    const result = await window.ideSync.sync.sync({ manualResolutions: resolutions });
    setBusy(false);
    if (result.pull && !result.pull.ok) {
      setError(result.pull.error ?? 'Could not apply your choices.');
      return;
    }
    if (result.push && !result.push.ok) {
      setError(result.push.error ?? 'Could not apply your choices.');
      return;
    }
    onDone();
  };

  return (
    <div className="conflict-resolver">
      <h1>Resolve conflicts</h1>
      <p className="dim">
        These extensions changed differently on this computer and your sync store. Choose which version to keep.
      </p>

      <div className="conflict-bulk">
        <button className="btn-secondary" onClick={() => setAll('keep-local')} disabled={busy}>
          Keep all mine
        </button>
        <button className="btn-secondary" onClick={() => setAll('keep-remote')} disabled={busy}>
          Keep all theirs
        </button>
      </div>

      <div className="conflict-list">
        {conflicts.map((c) => (
          <div className="conflict-row" key={c.extensionId}>
            <div className="conflict-row-id">{c.extensionId}</div>
            <div className="conflict-row-versions">
              <span className="dim">This computer: {c.localVersion ?? '(removed)'}</span>
              <span className="dim">Shared store: {c.remoteVersion ?? '(removed)'}</span>
            </div>
            <div className="conflict-row-choice">
              <label>
                <input
                  type="radio"
                  name={c.extensionId}
                  checked={resolutions[c.extensionId] === 'keep-local'}
                  onChange={() => setOne(c.extensionId, 'keep-local')}
                  disabled={busy}
                />
                Keep mine
              </label>
              <label>
                <input
                  type="radio"
                  name={c.extensionId}
                  checked={resolutions[c.extensionId] === 'keep-remote'}
                  onChange={() => setOne(c.extensionId, 'keep-remote')}
                  disabled={busy}
                />
                Keep theirs
              </label>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="wizard-notice error">
          <p className="dim">{error}</p>
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={apply} disabled={!allResolved || busy}>
          {busy ? 'Applying…' : 'Apply & sync'}
        </button>
      </div>
    </div>
  );
}
