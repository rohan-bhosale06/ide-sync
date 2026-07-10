import { useEffect, useState } from 'react';
import type { StatusResult } from 'ide-sync-core';
import ConflictResolver from './ConflictResolver.js';

type SyncKind = 'sync' | 'push' | 'pull';

interface IdeStat {
  family: string;
  displayName: string;
  installed: boolean;
  extensionCount: number;
}

interface SyncPreview {
  ok: boolean;
  error?: string;
  uploads: { id: string; type: 'add' | 'remove' }[];
  perIde: {
    family: string;
    displayName: string;
    installs: { id: string; version?: string }[];
    uninstalls: { id: string }[];
  }[];
  conflicts: number;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Overview() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [ideStats, setIdeStats] = useState<IdeStat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [confirming, setConfirming] = useState<SyncKind | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedIdes, setSelectedIdes] = useState<string[]>([]);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = () => {
    setError(null);
    window.ideSync.sync
      .status()
      .then((s: StatusResult) => setStatus(s))
      .catch((err: Error) => setError(err.message));
    window.ideSync.setup.ideStats().then((stats: IdeStat[]) => setIdeStats(stats));
  };

  useEffect(load, []);

  if (error) {
    return (
      <div className="overview">
        <div className="status-banner status-error">
          <p>Can't reach your sync store</p>
          <p className="dim">{error}</p>
          <button className="btn-secondary" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (!status) {
    return <div className="overview"><p className="dim">Loading…</p></div>;
  }

  if (resolving) {
    return (
      <ConflictResolver
        conflicts={status.conflicts}
        onDone={() => { setResolving(false); load(); }}
        onCancel={() => setResolving(false)}
      />
    );
  }

  const hasUnresolvedConflicts = status.conflicts.length > 0 && status.conflictPolicy === 'manual';
  const changeCount = status.toPush.length + status.toPull.length;

  const loadPreview = (families: string[]) => {
    setPreviewLoading(true);
    window.ideSync.sync
      .preview({ ide: families.join(',') })
      .then((p: SyncPreview) => setPreview(p))
      .catch((err: Error) => setPreview({ ok: false, error: err.message, uploads: [], perIde: [], conflicts: 0 }))
      .finally(() => setPreviewLoading(false));
  };

  const toggleIde = (family: string) => {
    const next = selectedIdes.includes(family)
      ? selectedIdes.filter((f) => f !== family)
      : [...selectedIdes, family];
    setSelectedIdes(next);
    if (next.length > 0) loadPreview(next);
    else setPreview(null);
  };

  const runAction = async (kind: SyncKind) => {
    setBusy(true);
    setActionError(null);
    const opts = { ide: selectedIdes.join(',') };
    const result =
      kind === 'sync'
        ? await window.ideSync.sync.sync(opts)
        : kind === 'push'
          ? await window.ideSync.sync.push(opts)
          : await window.ideSync.sync.pull(opts);
    setBusy(false);
    setConfirming(null);

    // A conflict that appeared since the screen loaded: refresh and open the resolver.
    const skipped = kind === 'sync' ? (result.pull?.skipped ?? result.push?.skipped) : result.skipped;
    if (skipped === 'unresolved-conflicts') {
      const fresh: StatusResult = await window.ideSync.sync.status();
      setStatus(fresh);
      setResolving(true);
      return;
    }

    const failed = kind === 'sync' ? (!result.pull?.ok || !result.push?.ok) : !result.ok;
    if (failed) {
      const msg = kind === 'sync' ? (result.pull?.error ?? result.push?.error) : result.error;
      setActionError(msg ?? 'Something went wrong.');
    }
    load();
  };

  const startAction = (kind: SyncKind) => {
    if (kind !== 'pull' && hasUnresolvedConflicts) {
      setResolving(true);
      return;
    }
    const installedFamilies = ideStats.filter((s) => s.installed).map((s) => s.family);
    setSelectedIdes(installedFamilies);
    setPreview(null);
    setConfirming(kind);
    loadPreview(installedFamilies);
  };

  return (
    <div className="overview">
      {!status.remoteReachable ? (
        <div className="status-banner status-error">
          <p>Can't reach your sync store</p>
          <button className="btn-secondary" onClick={load}>Retry</button>
        </div>
      ) : hasUnresolvedConflicts ? (
        <div className="status-banner status-error">
          <p>{status.conflicts.length} conflict{status.conflicts.length === 1 ? '' : 's'} need your decision</p>
          <button className="btn-primary" onClick={() => setResolving(true)}>Resolve</button>
        </div>
      ) : changeCount > 0 ? (
        <div className="status-banner status-warn">
          <p>{changeCount} change{changeCount === 1 ? '' : 's'} to sync</p>
        </div>
      ) : (
        <div className="status-banner status-ok-banner">
          <p>✓ Everything's in sync</p>
        </div>
      )}

      <div className="overview-meta">
        <div><span className="dim">Device:</span> {status.device.name}</div>
        <div><span className="dim">Sync store:</span> {status.backend === 'git' ? 'Git repository' : 'Local folder'}</div>
        <div><span className="dim">Last synced:</span> {timeAgo(status.lastSyncedAt)}</div>
        {status.devices.length > 0 && (
          <div><span className="dim">Other devices:</span> {status.devices.filter((d) => d.id !== status.device.id).map((d) => d.name).join(', ') || 'none'}</div>
        )}
      </div>

      {ideStats.length > 0 && (
        <div className="ide-grid">
          {ideStats.map((ide) => (
            <div key={ide.family} className={`ide-card ${ide.installed ? '' : 'ide-card-absent'}`}>
              <div className="ide-card-name">{ide.displayName}</div>
              {ide.installed ? (
                <div className="ide-card-count">
                  <span className="ide-card-number">{ide.extensionCount}</span>
                  <span className="dim"> extension{ide.extensionCount !== 1 ? 's' : ''}</span>
                </div>
              ) : (
                <div className="ide-card-count dim">Not installed</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="overview-actions">
        <button className="btn-primary" onClick={() => startAction('sync')} disabled={busy}>
          Sync now
        </button>
        <button className="btn-secondary" onClick={load} disabled={busy}>Refresh</button>
        <button className="btn-secondary" onClick={() => setShowMore((v) => !v)}>More</button>
      </div>

      {showMore && (
        <div className="overview-more">
          <button className="btn-secondary" onClick={() => startAction('push')} disabled={busy}>
            Push — upload this computer's setup
          </button>
          <button className="btn-secondary" onClick={() => startAction('pull')} disabled={busy}>
            Pull — bring down the shared setup
          </button>
        </div>
      )}

      {actionError && (
        <div className="wizard-notice error">
          <p className="dim">{actionError}</p>
        </div>
      )}

      {confirming && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <h3>
              {confirming === 'sync' && 'Sync now?'}
              {confirming === 'push' && "Push this computer's setup?"}
              {confirming === 'pull' && 'Pull the shared setup?'}
            </h3>

            <div className="preview-ide-picker">
              <p className="dim">Sync these editors:</p>
              <div className="preview-ide-checks">
                {ideStats.filter((s) => s.installed).map((s) => (
                  <label key={s.family} className="preview-ide-check">
                    <input
                      type="checkbox"
                      checked={selectedIdes.includes(s.family)}
                      onChange={() => toggleIde(s.family)}
                      disabled={busy}
                    />
                    {s.displayName}
                  </label>
                ))}
              </div>
            </div>

            <div className="preview-body">
              {selectedIdes.length === 0 ? (
                <p className="dim">Select at least one editor to sync.</p>
              ) : previewLoading || !preview ? (
                <p className="dim">Working out what would change…</p>
              ) : !preview.ok ? (
                <p className="dim">Couldn't compute the plan: {preview.error}</p>
              ) : (
                <>
                  {confirming !== 'pull' && preview.uploads.length > 0 && (
                    <div className="preview-section">
                      <p className="preview-section-title">
                        Upload to sync store ({preview.uploads.length})
                      </p>
                      <ul className="preview-list">
                        {preview.uploads.map((u) => (
                          <li key={`${u.type}-${u.id}`}>
                            <span className={u.type === 'remove' ? 'preview-remove' : 'preview-add'}>
                              {u.type === 'remove' ? '−' : '+'}
                            </span>{' '}
                            {u.id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {confirming !== 'push' &&
                    preview.perIde
                      .filter((p) => selectedIdes.includes(p.family))
                      .filter((p) => p.installs.length > 0 || p.uninstalls.length > 0)
                      .map((p) => (
                        <div key={p.family} className="preview-section">
                          <p className="preview-section-title">
                            {p.displayName} — {p.installs.length > 0 && `${p.installs.length} to install`}
                            {p.installs.length > 0 && p.uninstalls.length > 0 && ', '}
                            {p.uninstalls.length > 0 && `${p.uninstalls.length} to remove`}
                          </p>
                          <ul className="preview-list">
                            {p.installs.map((x) => (
                              <li key={`i-${x.id}`}>
                                <span className="preview-add">+</span> {x.id}
                                {x.version && <span className="dim">@{x.version}</span>}
                              </li>
                            ))}
                            {p.uninstalls.map((x) => (
                              <li key={`u-${x.id}`}>
                                <span className="preview-remove">−</span> {x.id}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}

                  {(confirming === 'pull' || preview.uploads.length === 0) &&
                    (confirming === 'push' ||
                      !preview.perIde.some(
                        (p) => selectedIdes.includes(p.family) && (p.installs.length > 0 || p.uninstalls.length > 0),
                      )) && <p className="dim">Nothing to change for the selected editors.</p>}
                </>
              )}
            </div>

            <div className="wizard-actions">
              <button className="btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => runAction(confirming)}
                disabled={busy || previewLoading || selectedIdes.length === 0}
              >
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
