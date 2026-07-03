import { useEffect, useState } from 'react';
import type { Config, ConflictPolicy, ConfigDomain } from 'ide-sync-core';

const CONFLICT_POLICIES: { id: ConflictPolicy; label: string; description: string }[] = [
  { id: 'newest', label: 'Newest wins', description: 'Automatically keep whichever version changed most recently.' },
  { id: 'local', label: 'Always this computer', description: "This computer's version always wins conflicts." },
  { id: 'remote', label: 'Always the shared store', description: 'The shared store always wins conflicts.' },
  { id: 'manual', label: 'Ask me each time', description: "You'll be asked to choose for every conflict." },
];

const DOMAINS: { id: ConfigDomain; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'snippets', label: 'Snippets' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'ui-state', label: 'UI state' },
];

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [enabledDomains, setEnabledDomains] = useState<Set<ConfigDomain>>(new Set());
  const [daemonRunning, setDaemonRunning] = useState<boolean | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    window.ideSync.config.readConfig().then((c: Config) => { setConfig(c); setDeviceName(c.deviceName); });
    window.ideSync.config.readConfigSyncConfig().then((cfg: { enabledDomains: ConfigDomain[] }) =>
      setEnabledDomains(new Set(cfg.enabledDomains)),
    );
    window.ideSync.daemon.status().then((s: { running: boolean }) => setDaemonRunning(s.running));
  };

  useEffect(load, []);

  const saveDeviceName = async () => {
    if (!config || deviceName === config.deviceName) return;
    setBusy(true);
    setError(null);
    try {
      await window.ideSync.config.writeConfig({ ...config, deviceName });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const setPolicy = async (policy: ConflictPolicy) => {
    if (!config) return;
    setError(null);
    try {
      await window.ideSync.config.writeConfig({ ...config, conflictPolicy: policy });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDomain = async (domain: ConfigDomain) => {
    setError(null);
    try {
      if (enabledDomains.has(domain)) await window.ideSync.config.disableDomain(domain);
      else await window.ideSync.config.enableDomain(domain);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDaemon = async () => {
    setBusy(true);
    setError(null);
    try {
      if (daemonRunning) await window.ideSync.daemon.stop();
      else await window.ideSync.daemon.start();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <div className="overview"><p className="dim">Loading…</p></div>;

  return (
    <div className="overview">
      <h1>Settings</h1>

      {error && <div className="wizard-notice error"><p className="dim">{error}</p></div>}

      <section className="settings-section">
        <h3>Device name</h3>
        <div className="field-row">
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          <button className="btn-secondary" onClick={saveDeviceName} disabled={busy || deviceName === config.deviceName}>
            Save
          </button>
        </div>
        {saved && <p className="status-ok">Saved</p>}
      </section>

      <section className="settings-section">
        <h3>Sync store</h3>
        <p className="dim">
          {config.backend === 'git' ? `Git repository — ${config.gitRepoUrl}` : `Local folder — ${config.filesystemPath}`}
        </p>
        <p className="dim">To change the sync store, run setup again from a fresh install.</p>
      </section>

      <section className="settings-section">
        <h3>Conflict policy</h3>
        {CONFLICT_POLICIES.map((p) => (
          <label key={p.id} className="radio-row">
            <input type="radio" checked={config.conflictPolicy === p.id} onChange={() => setPolicy(p.id)} />
            <div>
              <div>{p.label}</div>
              <div className="dim">{p.description}</div>
            </div>
          </label>
        ))}
      </section>

      <section className="settings-section">
        <h3>Sync config files</h3>
        <p className="dim">Choose which kinds of editor config also sync, in addition to extensions.</p>
        {DOMAINS.map((d) => (
          <label key={d.id} className="checkbox-row">
            <input type="checkbox" checked={enabledDomains.has(d.id)} onChange={() => toggleDomain(d.id)} />
            {d.label}
          </label>
        ))}
      </section>

      <section className="settings-section">
        <h3>Background sync</h3>
        <p className="dim">
          {daemonRunning === null ? 'Checking…' : daemonRunning ? 'Watching for changes and syncing automatically.' : 'Off — sync manually from Overview.'}
        </p>
        <button className="btn-secondary" onClick={toggleDaemon} disabled={busy || daemonRunning === null}>
          {daemonRunning ? 'Turn off background sync' : 'Turn on background sync'}
        </button>
      </section>
    </div>
  );
}
