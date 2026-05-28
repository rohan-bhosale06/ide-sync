import path from 'path';
import { BaseDomainHandler } from './base.js';
import type { DomainData } from '../types.js';

export class SettingsDomainHandler extends BaseDomainHandler {
  private get filePath(): string {
    return path.join(this.configPath, 'settings.json');
  }

  read(): DomainData['settings'] {
    const result = this.readJsoncFile(this.filePath);
    if (!result) return null;
    const parsed = (typeof result.parsed === 'object' && result.parsed !== null && !Array.isArray(result.parsed))
      ? result.parsed as Record<string, unknown>
      : {};
    return { raw: result.raw, parsed };
  }

  write(text: string): void {
    this.atomicWrite(this.filePath, text);
  }

  get path(): string {
    return this.filePath;
  }
}
