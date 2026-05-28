import { describe, it, expect } from 'vitest';
import { mergeKeybindings, applyKeybindings } from '../../../src/config-sync/merger/keybindings.js';
import type { Keybinding } from '../../../src/config-sync/types.js';

const raw = (bindings: Keybinding[]) => JSON.stringify(bindings, null, 2);

const KB_A: Keybinding = { key: 'ctrl+k', command: 'editor.action.killLine', when: 'editorFocus' };
const KB_B: Keybinding = { key: 'ctrl+shift+p', command: 'workbench.action.showCommands' };
const KB_NEG: Keybinding = { key: 'ctrl+k', command: '-workbench.action.deleteLeft' };

describe('keybinding merge — add', () => {
  it('adds remote-only entry to local', () => {
    const base = raw([KB_A]);
    const local = raw([KB_A]);
    const remote = raw([KB_A, KB_B]);
    const result = mergeKeybindings(base, local, remote, 'remote');
    const parsed: Keybinding[] = JSON.parse(result.newLocalText);
    expect(parsed.some((kb) => kb.command === KB_B.command)).toBe(true);
  });

  it('pushes local-only entry to canonical remote', () => {
    const base = raw([KB_A]);
    const local = raw([KB_A, KB_B]);
    const remote = raw([KB_A]);
    const result = mergeKeybindings(base, local, remote, 'local');
    const remoteArr: Keybinding[] = JSON.parse(result.newRemoteRaw);
    expect(remoteArr.some((kb) => kb.command === KB_B.command)).toBe(true);
  });
});

describe('keybinding merge — remove', () => {
  it('removes entry deleted remotely from local', () => {
    const base = raw([KB_A, KB_B]);
    const local = raw([KB_A, KB_B]);
    const remote = raw([KB_A]);
    const result = mergeKeybindings(base, local, remote, 'remote');
    const parsed: Keybinding[] = JSON.parse(result.newLocalText);
    expect(parsed.some((kb) => kb.command === KB_B.command)).toBe(false);
  });

  it('local deletion propagates to canonical', () => {
    const base = raw([KB_A, KB_B]);
    const local = raw([KB_A]);
    const remote = raw([KB_A, KB_B]);
    const result = mergeKeybindings(base, local, remote, 'local');
    const remoteArr: Keybinding[] = JSON.parse(result.newRemoteRaw);
    expect(remoteArr.some((kb) => kb.command === KB_B.command)).toBe(false);
  });
});

describe('keybinding identity — when clause is part of tuple', () => {
  it('treats same key+command with different when as separate entries', () => {
    const kbWith: Keybinding = { key: 'ctrl+k', command: 'foo', when: 'editorFocus' };
    const kbWithout: Keybinding = { key: 'ctrl+k', command: 'foo' };
    const base = raw([kbWith]);
    const local = raw([kbWith]);
    const remote = raw([kbWith, kbWithout]);
    const result = mergeKeybindings(base, local, remote, 'remote');
    const parsed: Keybinding[] = JSON.parse(result.newLocalText);
    expect(parsed).toHaveLength(2);
  });
});

describe('negation entries (-command)', () => {
  it('treats negation entries as normal keybindings with their own identity', () => {
    const base = raw([]);
    const local = raw([KB_NEG]);
    const remote = raw([]);
    const result = mergeKeybindings(base, local, remote, 'local');
    const remoteArr: Keybinding[] = JSON.parse(result.newRemoteRaw);
    expect(remoteArr.some((kb) => kb.command === KB_NEG.command)).toBe(true);
  });
});

describe('applyKeybindings (one-way)', () => {
  it('adds missing entries without duplicating existing ones', () => {
    const result = applyKeybindings(raw([KB_A, KB_B]), raw([KB_A]));
    const parsed: Keybinding[] = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed.filter((kb) => kb.command === KB_A.command)).toHaveLength(1);
  });
});
