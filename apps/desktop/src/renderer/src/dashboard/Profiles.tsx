import { useEffect, useState } from 'react';
import type { ExtensionProfile } from 'ide-sync-core';

interface InstalledExtension {
  id: string;
  displayName: string;
  publisher: string;
}

export default function Profiles() {
  const [profiles, setProfiles] = useState<ExtensionProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExtensionProfile | 'new' | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = () => {
    window.ideSync.profiles
      .list()
      .then((p: ExtensionProfile[]) => setProfiles(p))
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  const remove = async (name: string) => {
    if (!confirm(`Delete profile "${name}"? This can't be undone.`)) return;
    try {
      await window.ideSync.profiles.delete(name);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const syncProfile = async (name: string) => {
    setSyncing(name);
    setError(null);
    const result = await window.ideSync.sync.sync({ profile: name });
    setSyncing(null);
    if (!result.pull?.ok || !result.push?.ok) {
      setError(result.pull?.error ?? result.push?.error ?? 'Sync failed.');
    }
  };

  if (editing) {
    return (
      <ProfileEditor
        profile={editing === 'new' ? null : editing}
        onDone={() => { setEditing(null); load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="overview">
      <div className="screen-header">
        <h1>Profiles</h1>
        <button className="btn-primary" onClick={() => setEditing('new')}>New profile</button>
      </div>
      <p className="dim">Named subsets of extensions you can sync independently.</p>

      {error && <div className="wizard-notice error"><p className="dim">{error}</p></div>}

      {profiles === null ? (
        <p className="dim">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="dim">No profiles yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Extensions</th><th>Created</th><th /></tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.extensionIds.length}</td>
                <td className="dim">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="row-actions">
                  <button className="btn-secondary" onClick={() => setEditing(p)}>Edit</button>
                  <button className="btn-secondary" onClick={() => syncProfile(p.name)} disabled={syncing === p.name}>
                    {syncing === p.name ? 'Syncing…' : 'Sync only this'}
                  </button>
                  <button className="btn-secondary" onClick={() => remove(p.name)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  onDone,
  onCancel,
}: {
  profile: ExtensionProfile | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? '');
  const [available, setAvailable] = useState<InstalledExtension[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(profile?.extensionIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.ideSync.setup.installedExtensions().then((exts: InstalledExtension[]) => setAvailable(exts));
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const ids = Array.from(selected);
      if (profile) await window.ideSync.profiles.update(profile.name, ids);
      else await window.ideSync.profiles.create(name, ids);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overview">
      <h1>{profile ? `Edit "${profile.name}"` : 'New profile'}</h1>

      {!profile && (
        <div className="field">
          <label htmlFor="profile-name">Name</label>
          <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}

      <p className="dim" style={{ marginTop: '1.25rem' }}>Choose extensions for this profile</p>
      {available === null ? (
        <p className="dim">Loading installed extensions…</p>
      ) : (
        <div className="checkbox-list">
          {available.map((ext) => (
            <label key={ext.id} className="checkbox-row">
              <input type="checkbox" checked={selected.has(ext.id)} onChange={() => toggle(ext.id)} />
              {ext.displayName} <span className="dim">({ext.publisher})</span>
            </label>
          ))}
        </div>
      )}

      {error && <div className="wizard-notice error"><p className="dim">{error}</p></div>}

      <div className="wizard-actions">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy || (!profile && !name.trim())}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
