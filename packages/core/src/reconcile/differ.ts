import type { Extension } from '../detectors/types.js';

export interface DiffResult {
  /** In source, missing from target — should be installed */
  toInstall: Extension[];
  /** In both IDEs but different version — source version wins */
  toUpgrade: Array<{ from: Extension; to: Extension }>;
  /** In both IDEs with identical version — no action needed */
  same: Extension[];
  /** In target only — left alone by default, prunable with --prune */
  targetOnly: Extension[];
}

export function diffExtensions(source: Extension[], target: Extension[]): DiffResult {
  const sourceMap = new Map(source.map((e) => [e.id.toLowerCase(), e]));
  const targetMap = new Map(target.map((e) => [e.id.toLowerCase(), e]));

  const toInstall: Extension[] = [];
  const toUpgrade: Array<{ from: Extension; to: Extension }> = [];
  const same: Extension[] = [];
  const targetOnly: Extension[] = [];

  for (const [id, srcExt] of sourceMap) {
    const tgtExt = targetMap.get(id);
    if (!tgtExt) {
      toInstall.push(srcExt);
    } else if (srcExt.version !== tgtExt.version) {
      // from = current target version, to = desired source version
      toUpgrade.push({ from: tgtExt, to: srcExt });
    } else {
      same.push(srcExt);
    }
  }

  for (const [id, tgtExt] of targetMap) {
    if (!sourceMap.has(id)) {
      targetOnly.push(tgtExt);
    }
  }

  return { toInstall, toUpgrade, same, targetOnly };
}
