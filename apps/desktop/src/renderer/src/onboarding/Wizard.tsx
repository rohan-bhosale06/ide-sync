import { useEffect, useRef, useState } from 'react';
import type { IDEInstallation } from 'ide-sync-core';
import { SUPPORTED_IDE_NAMES, type WizardState } from './types.js';

type Step = 'welcome' | 'storage' | 'test' | 'device' | 'seed' | 'done';
const STEPS: Step[] = ['welcome', 'storage', 'test', 'device', 'seed', 'done'];

const initialState: WizardState = {
  backend: 'git',
  gitRepoUrl: '',
  filesystemPath: '',
  deviceName: '',
  testPassed: false,
  remoteEmpty: false,
};

export default function Wizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [state, setState] = useState<WizardState>(initialState);

  const stepIndex = STEPS.indexOf(step);
  const goNext = () => setStep(STEPS[stepIndex + 1]);
  const goBack = () => setStep(STEPS[stepIndex - 1]);

  return (
    <div className="wizard">
      <div className="wizard-dots">
        {STEPS.map((s, i) => (
          <span key={s} className={`wizard-dot ${i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}`} />
        ))}
      </div>
      <div className="wizard-body">
        {step === 'welcome' && <WelcomeStep onNext={goNext} />}
        {step === 'storage' && (
          <StorageStep state={state} setState={setState} onNext={goNext} onBack={goBack} />
        )}
        {step === 'test' && (
          <TestStep state={state} setState={setState} onNext={goNext} onBack={goBack} />
        )}
        {step === 'device' && (
          <DeviceStep state={state} setState={setState} onNext={goNext} onBack={goBack} />
        )}
        {step === 'seed' && (
          <SeedStep state={state} onNext={goNext} onBack={goBack} />
        )}
        {step === 'done' && <DoneStep onFinish={onComplete} />}
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [ides, setIdes] = useState<IDEInstallation[] | null>(null);

  const recheck = () => {
    setIdes(null);
    window.ideSync.setup.detectIdes().then((found: IDEInstallation[]) => setIdes(found));
  };

  useEffect(() => {
    recheck();
  }, []);

  const found = ides?.filter((i) => i.installed) ?? [];

  return (
    <div className="wizard-step">
      <h1>Welcome to ide-sync</h1>
      <p>Keep your editor extensions and settings in sync across your computers.</p>

      {ides === null ? (
        <p className="dim">Checking your installed editors…</p>
      ) : found.length > 0 ? (
        <p className="dim">
          Found: {found.map((i) => i.displayName).join(', ')}
        </p>
      ) : (
        <div className="wizard-notice">
          <p>No supported editors were found on this computer.</p>
          <p className="dim">Supported: {SUPPORTED_IDE_NAMES.join(', ')}</p>
          <button className="btn-secondary" onClick={recheck}>Recheck</button>
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn-primary" onClick={onNext}>Get started</button>
      </div>
    </div>
  );
}

function StorageStep({
  state,
  setState,
  onNext,
  onBack,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canContinue =
    state.backend === 'git' ? state.gitRepoUrl.trim().length > 0 : state.filesystemPath.trim().length > 0;

  // Any change to the storage choice invalidates a previously passed connection
  // test — the user must retest before proceeding.
  const update = (patch: Partial<WizardState>) => setState({ ...state, ...patch, testPassed: false });

  const pickFolder = async () => {
    const folder = await window.ideSync.setup.pickFolder();
    if (folder) update({ filesystemPath: folder });
  };

  return (
    <div className="wizard-step">
      <h1>Where should your sync data live?</h1>
      <div className="storage-cards">
        <button
          className={`storage-card ${state.backend === 'git' ? 'selected' : ''}`}
          onClick={() => update({ backend: 'git' })}
        >
          <h3>Git repository</h3>
          <p className="dim">Recommended — a repo you own. No servers, full history.</p>
        </button>
        <button
          className={`storage-card ${state.backend === 'filesystem' ? 'selected' : ''}`}
          onClick={() => update({ backend: 'filesystem' })}
        >
          <h3>Local folder</h3>
          <p className="dim">A folder synced by Dropbox, iCloud, or Syncthing.</p>
        </button>
      </div>

      {state.backend === 'git' ? (
        <div className="field">
          <label htmlFor="repo-url">Repository URL</label>
          <input
            id="repo-url"
            placeholder="git@github.com:you/ide-sync-state.git"
            value={state.gitRepoUrl}
            onChange={(e) => update({ gitRepoUrl: e.target.value })}
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="folder-path">Folder path</label>
          <div className="field-row">
            <input
              id="folder-path"
              placeholder="Path to a Dropbox / iCloud / Syncthing folder"
              value={state.filesystemPath}
              onChange={(e) => update({ filesystemPath: e.target.value })}
            />
            <button className="btn-secondary" onClick={pickFolder}>Choose…</button>
          </div>
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" disabled={!canContinue} onClick={onNext}>Next</button>
      </div>
    </div>
  );
}

function TestStep({
  state,
  setState,
  onNext,
  onBack,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setError(null);
    const result = await window.ideSync.setup.test({
      backend: state.backend,
      gitRepoUrl: state.backend === 'git' ? state.gitRepoUrl : undefined,
      filesystemPath: state.backend === 'filesystem' ? state.filesystemPath : undefined,
    });
    setTesting(false);
    if (result.ok) {
      setState({ ...state, testPassed: true });
    } else {
      setState({ ...state, testPassed: false });
      setError(result.error ?? 'Could not reach the sync store. Check the details and try again.');
    }
  };

  return (
    <div className="wizard-step">
      <h1>Test the connection</h1>
      <p className="dim">
        {state.backend === 'git'
          ? `Checking access to ${state.gitRepoUrl}`
          : `Checking access to ${state.filesystemPath}`}
      </p>

      <div className="wizard-actions">
        <button className="btn-secondary" onClick={runTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {state.testPassed && <p className="status-ok">✓ Connected successfully</p>}
      {error && (
        <div className="wizard-notice error">
          <p>Couldn't connect.</p>
          <p className="dim">{error}</p>
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" disabled={!state.testPassed} onClick={onNext}>Next</button>
      </div>
    </div>
  );
}

function DeviceStep({
  state,
  setState,
  onNext,
  onBack,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  useEffect(() => {
    if (!state.deviceName) {
      window.ideSync.setup.hostname().then((name: string) => setState({ ...state, deviceName: name }));
    }
  }, []);

  return (
    <div className="wizard-step">
      <h1>Name this device</h1>
      <p className="dim">Other devices you sync will see this name.</p>
      <div className="field">
        <label htmlFor="device-name">Device name</label>
        <input
          id="device-name"
          value={state.deviceName}
          onChange={(e) => setState({ ...state, deviceName: e.target.value })}
        />
      </div>
      <div className="wizard-actions">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" disabled={!state.deviceName.trim()} onClick={onNext}>Next</button>
      </div>
    </div>
  );
}

function SeedStep({
  state,
  onNext,
  onBack,
}: {
  state: WizardState;
  onNext: () => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteEmpty, setRemoteEmpty] = useState<boolean | null>(null);
  const initStarted = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode's double effect invocation — runInit
    // clones the git repo / writes config and must not fire twice.
    if (initStarted.current) return;
    initStarted.current = true;
    (async () => {
      setBusy(true);
      const result = await window.ideSync.setup.init({
        backend: state.backend,
        gitRepoUrl: state.backend === 'git' ? state.gitRepoUrl : undefined,
        filesystemPath: state.backend === 'filesystem' ? state.filesystemPath : undefined,
        deviceName: state.deviceName,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? 'Setup failed.');
        return;
      }
      setRemoteEmpty(!!result.remoteEmpty);
    })();
  }, []);

  const upload = async () => {
    setBusy(true);
    setError(null);
    const result = await window.ideSync.sync.push({});
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Upload failed.');
      return;
    }
    onNext();
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    const result = await window.ideSync.sync.pull({});
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Download failed.');
      return;
    }
    onNext();
  };

  return (
    <div className="wizard-step">
      <h1>Set up your extensions</h1>

      {remoteEmpty === null && !error && <p className="dim">Finishing setup…</p>}

      {remoteEmpty === true && (
        <>
          <p>Your sync store is empty. Upload this computer's current extensions to it?</p>
          <div className="wizard-actions">
            <button className="btn-primary" onClick={upload} disabled={busy}>
              {busy ? 'Uploading…' : 'Upload my current extensions'}
            </button>
            <button className="btn-secondary" onClick={onNext} disabled={busy}>Skip for now</button>
          </div>
        </>
      )}

      {remoteEmpty === false && (
        <>
          <p>This sync store already has a setup. Bring it down to this computer now?</p>
          <div className="wizard-actions">
            <button className="btn-primary" onClick={download} disabled={busy}>
              {busy ? 'Downloading…' : 'Pull the existing setup'}
            </button>
            <button className="btn-secondary" onClick={onNext} disabled={busy}>Skip for now</button>
          </div>
        </>
      )}

      {error && (
        <div className="wizard-notice error">
          <p className="dim">{error}</p>
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn-secondary" onClick={onBack} disabled={busy}>Back</button>
      </div>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="wizard-step">
      <h1>You're all set</h1>
      <p>ide-sync is ready to keep your editors in sync.</p>
      <div className="wizard-actions">
        <button className="btn-primary" onClick={onFinish}>Go to dashboard</button>
      </div>
    </div>
  );
}
