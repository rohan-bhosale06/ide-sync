import path from 'path';
import fs from 'fs';
import { BaseDomainHandler } from './base.js';
import type { DomainData } from '../types.js';

/** Candidate MCP config filenames to probe in order. */
const MCP_CANDIDATES = ['mcp.json', '.mcp.json'];

export class McpDomainHandler extends BaseDomainHandler {
  private get filePath(): string {
    // Check for existing file first (user may have either name).
    for (const name of MCP_CANDIDATES) {
      const p = path.join(this.configPath, name);
      if (fs.existsSync(p)) return p;
    }
    return path.join(this.configPath, 'mcp.json');
  }

  read(): DomainData['mcp'] {
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
