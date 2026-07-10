import { useEffect, useState } from 'react';
import Wizard from './onboarding/Wizard.js';
import Dashboard from './dashboard/Dashboard.js';

type ViewState = 'loading' | 'onboarding' | 'dashboard';

export default function App() {
  const [view, setView] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.ideSync.setup
      .exists()
      .then((exists: boolean) => setView(exists ? 'dashboard' : 'onboarding'))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="screen">
        <h1>Something went wrong</h1>
        <p className="dim">{error}</p>
      </div>
    );
  }

  if (view === 'loading') {
    return (
      <div className="screen">
        <p className="dim">Loading…</p>
      </div>
    );
  }

  if (view === 'onboarding') {
    return <Wizard onComplete={() => setView('dashboard')} />;
  }

  return <Dashboard onRerunSetup={() => setView('onboarding')} />;
}
