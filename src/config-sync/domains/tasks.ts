import path from 'path';
import { BaseDomainHandler } from './base.js';
import type { DomainData } from '../types.js';

export class TasksDomainHandler extends BaseDomainHandler {
  private get filePath(): string {
    return path.join(this.configPath, 'tasks.json');
  }

  read(): DomainData['tasks'] {
    const result = this.readJsoncFile(this.filePath);
    if (!result) return null;
    return { raw: result.raw, parsed: result.parsed };
  }

  write(text: string): void {
    this.atomicWrite(this.filePath, text);
  }

  get path(): string {
    return this.filePath;
  }
}
