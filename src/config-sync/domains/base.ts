/**
 * Base domain handler: shared JSONC read, atomic write, and path helpers.
 * Subclasses implement read() and write() for their specific file layout.
 */
import fs from 'fs';
import path from 'path';
import { parse, ParseError } from 'jsonc-parser';

export abstract class BaseDomainHandler {
  protected configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  /** Read a JSONC file; returns null if it doesn't exist. */
  protected readJsoncFile(filePath: string): { raw: string; parsed: unknown } | null {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const errors: ParseError[] = [];
    const parsed = parse(raw, errors, { allowTrailingComma: true, allowEmptyContent: true });
    return { raw, parsed };
  }

  /** Atomic write: write to .tmp then rename. Never leaves a partial write on disk. */
  protected atomicWrite(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.ide-sync.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    if (process.platform === 'win32' && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    fs.renameSync(tmp, filePath);
  }

  /** Atomic delete. */
  protected atomicDelete(filePath: string): void {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  /** List all files in a directory matching a glob-like extension filter. */
  protected listDir(dir: string, extensions: string[]): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => extensions.some((e) => f.endsWith(e)));
  }
}
