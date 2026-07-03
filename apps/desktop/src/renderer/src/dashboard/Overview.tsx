import { useEffect, useState } from 'react';
import type { StatusResult } from 'ide-sync-core';
import ConflictResolver from './ConflictResolver.js';

type SyncKind = 'sync' | 'push' | 'pull';

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
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [confirming, setConfirming] = useState<SyncKind | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    window.ideSync.sync
      .status()
      .then((s: StatusResult) => setStatus(s))
      .catch((err: Error) => setError(err.message));
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

  const runAction = async (kind: SyncKind) => {
    setBusy(true);
    setActionError(null);
    const result =
      kind === 'sync'
        ? await window.ideSync.sync.sync({})
        : kind === 'push'
          ? await window.ideSync.sync.push({})
          : await window.ideSync.sync.pull({});
    setBusy(false);
    setConfirming(null);

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
    setConfirming(kind);
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

      <div className="overview-actions">
        <button className="btn-primary" onClick={() => startAction('sync')} disabled={busy}>
          Sync now
        </button>
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
          <div className="modal">
            <h3>
              {confirming === 'sync' && 'Sync now?'}
              {confirming === 'push' && "Push this computer's setup?"}
              {confirming === 'pull' && 'Pull the shared setup?'}
            </h3>
            {confirming !== 'pull' && status.toPush.length > 0 && (
              <p>{status.toPush.length} change{status.toPush.length === 1 ? '' : 's'} will be uploaded.</p>
            )}
            {confirming !== 'push' && status.toPull.length > 0 && (
              <p>{status.toPull.length} extension{status.toPull.length === 1 ? '' : 's'} will be installed or removed on this computer.</p>
            )}
            {status.toPush.length === 0 && status.toPull.length === 0 && <p className="dim">No changes detected.</p>}
            <div className="wizard-actions">
              <button className="btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={() => runAction(confirming)} disabled={busy}>
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
