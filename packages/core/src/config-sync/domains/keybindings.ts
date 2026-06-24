import path from 'path';
import { BaseDomainHandler } from './base.js';
import type { DomainData, Keybinding } from '../types.js';

export class KeybindingsDomainHandler extends BaseDomainHandler {
  private get filePath(): string {
    return path.join(this.configPath, 'keybindings.json');
  }

  read(): DomainData['keybindings'] {
    const result = this.readJsoncFile(this.filePath);
    if (!result) return null;
    const parsed = Array.isArray(result.parsed) ? result.parsed as Keybinding[] : [];
    return { raw: result.raw, parsed };
  }

  write(text: string): void {
    this.atomicWrite(this.filePath, text);
  }

  get path(): string {
    return this.filePath;
  }
}
