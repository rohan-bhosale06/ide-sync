import fs from 'fs';
import path from 'path';
import { BaseDomainHandler } from './base.js';
import type { DomainData, SnippetFile } from '../types.js';

const SNIPPET_EXTENSIONS = ['.json', '.code-snippets'];

export class SnippetsDomainHandler extends BaseDomainHandler {
  private get snippetsDir(): string {
    return path.join(this.configPath, 'snippets');
  }

  read(): DomainData['snippets'] {
    const dir = this.snippetsDir;
    const result: DomainData['snippets'] = {};

    for (const filename of this.listDir(dir, SNIPPET_EXTENSIONS)) {
      const filePath = path.join(dir, filename);
      const fileResult = this.readJsoncFile(filePath);
      if (!fileResult) continue;
      const parsed = (typeof fileResult.parsed === 'object' && fileResult.parsed !== null && !Array.isArray(fileResult.parsed))
        ? fileResult.parsed as SnippetFile
        : {};
      result[filename] = { raw: fileResult.raw, parsed };
    }

    return result;
  }

  writeFile(filename: string, text: string): void {
    const filePath = path.join(this.snippetsDir, filename);
    this.atomicWrite(filePath, text);
  }

  deleteFile(filename: string): void {
    const filePath = path.join(this.snippetsDir, filename);
    this.atomicDelete(filePath);
  }

  listFiles(): string[] {
    return this.listDir(this.snippetsDir, SNIPPET_EXTENSIONS);
  }

  get dirPath(): string {
    return this.snippetsDir;
  }

  /** Collect all snippet files as filename→raw map. */
  readRaw(): Record<string, string> {
    const dir = this.snippetsDir;
    const result: Record<string, string> = {};
    for (const filename of this.listDir(dir, SNIPPET_EXTENSIONS)) {
      if (!fs.existsSync(path.join(dir, filename))) continue;
      result[filename] = fs.readFileSync(path.join(dir, filename), 'utf8');
    }
    return result;
  }
}
