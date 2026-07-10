import { useEffect, useState } from 'react';
import Overview from './Overview.js';
import Profiles from './Profiles.js';
import Search from './Search.js';
import SettingsDiff from './SettingsDiff.js';
import Backups from './Backups.js';
import Settings from './Settings.js';

type Screen = 'overview' | 'profiles' | 'search' | 'diff' | 'backups' | 'settings';

const NAV: { id: Screen; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'search', label: 'Find Extensions' },
  { id: 'diff', label: 'Settings Diff' },
  { id: 'backups', label: 'Backups' },
];

function DaemonPill() {
  const [running, setRunning] = useState<boolean | null>(null);

  useEffect(() => {
    const check = () => window.ideSync.daemon.status().then((s: { running: boolean }) => setRunning(s.running));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  if (running === null) return null;
  return (
    <div className={`daemon-pill ${running ? 'watching' : 'manual'}`}>
      {running ? 'Watching' : 'Manual'}
    </div>
  );
}

export default function Dashboard({ onRerunSetup }: { onRerunSetup: () => void }) {
  const [screen, setScreen] = useState<Screen>('overview');

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div>
          <DaemonPill />
          <div className="sidebar-nav">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`sidebar-item ${screen === n.id ? 'active' : ''}`}
                onClick={() => setScreen(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
        <button
          className={`sidebar-item sidebar-settings ${screen === 'settings' ? 'active' : ''}`}
          onClick={() => setScreen('settings')}
        >
          ⚙ Settings
        </button>
      </aside>

      <main className="dashboard-main">
        {screen === 'overview' && <Overview />}
        {screen === 'profiles' && <Profiles />}
        {screen === 'search' && <Search />}
        {screen === 'diff' && <SettingsDiff />}
        {screen === 'backups' && <Backups />}
        {screen === 'settings' && <Settings onRerunSetup={onRerunSetup} />}
      </main>
    </div>
  );
}
