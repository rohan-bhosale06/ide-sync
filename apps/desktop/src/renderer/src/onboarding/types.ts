export interface WizardState {
  backend: 'git' | 'filesystem';
  gitRepoUrl: string;
  filesystemPath: string;
  deviceName: string;
  testPassed: boolean;
  remoteEmpty: boolean;
}

export const SUPPORTED_IDE_NAMES = ['VS Code', 'Cursor', 'Windsurf', 'Antigravity', 'VSCodium', 'Kiro'];
