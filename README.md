# ide-sync

A CLI tool to scan, compare, and sync extensions across VS Code-family IDEs — locally and across multiple machines.

**Phase 3 of 5** — cloud sync backend with 3-way merge, tombstone propagation, and multi-machine reconciliation.

## Supported IDEs

| IDE | Extensions path | CLI binary |
|---|---|---|
| VS Code | `~/.vscode/extensions` | `code` |
| Cursor | `~/.cursor/extensions` | `cursor` |
| Windsurf | `~/.codeium/windsurf/extensions` | `windsurf` |
| Antigravity | `~/.antigravity/extensions` | `antigravity` |
| VSCodium | `~/.vscode-oss/extensions` | `codium` |

On Windows, `~` resolves to `%USERPROFILE%`.

## Install

```bash
npm install
npm run build

# Run directly
node dist/cli.js scan

# Or link globally
npm link
ide-sync scan
```

Requires Node 20+.

---

## Phase 3: Cloud Sync

### Quick start

```bash
# One-time setup per machine
ide-sync init

# Everyday sync loop
ide-sync sync
```

### Setup (`init`)

`init` is interactive by default and asks for:
1. **Backend** — git repository (recommended) or local folder
2. **Repo URL / folder path** — where state lives
3. **Device name** — defaults to hostname

```bash
# Interactive
ide-sync init

# Non-interactive — git backend
ide-sync init --backend git --repo git@github.com:you/ide-sync-state.git

# Non-interactive — filesystem backend (great with Dropbox / iCloud / Syncthing)
ide-sync init --backend filesystem --path ~/Dropbox/ide-sync

# Custom device name
ide-sync init --backend filesystem --path ~/Dropbox/ide-sync --device "work-laptop"
```

Config is stored at `~/.ide-sync/config.json`. The git backend clones the repo to `~/.ide-sync/repo/`.

### Everyday sync workflow

```bash
# The one command you'll use every day
ide-sync sync

# Non-interactive (cron / automation)
ide-sync sync --yes

# Scope to specific IDEs
ide-sync sync --ide vscode,cursor

# Preview without making changes
ide-sync sync --dry-run

# Exclude extensions from sync
ide-sync sync --exclude github.copilot,ms-python.python
```

`sync` = `pull` then `push`. Pull runs first so local changes are applied on top of the latest remote state.

### Push and pull separately

```bash
# Push local state to remote
ide-sync push
ide-sync push --dry-run

# Pull remote state and apply locally
ide-sync pull
ide-sync pull --dry-run
ide-sync pull --keep-local-extensions   # skip uninstalls
```

### Status

```bash
# Read-only — shows drift between local and remote
ide-sync status
```

Example output:
```
  Sync Status
  ──────────────────────────────────────────────────────
  Device:   my-laptop (a1b2c3d4…)
  Backend:  git (git@github.com:you/ide-sync-state.git)
  Policy:   newest
  Last sync: 19/5/2026, 10:30:00  (2h ago)

  ──────────────────────────────────────────────────────
  Remote: 42 extensions   Local: 45 extensions

  Would push (3):
    + esbenp.prettier-vscode  added locally since last sync
    + bradlc.vscode-tailwindcss  added locally since last sync
    ↑ dbaeumer.vscode-eslint  local updated to 3.1.0

  Would pull (1):
    + github.copilot  added remotely

  Run ide-sync sync to synchronise.
```

### Devices

```bash
# List all registered devices
ide-sync devices
ide-sync devices list

# Remove a device
ide-sync devices remove <device-id>
```

---

## How the 3-way merge works

When `ide-sync pull` or `ide-sync sync` runs, it performs a **3-way merge** using three inputs:

| Input | What it is |
|-------|-----------|
| **base** | The last `SyncState` this device successfully applied (`~/.ide-sync/last-synced-state.json`) |
| **local** | What's actually installed right now (from Phase 1 scan) |
| **remote** | The current state from the backend |

By comparing *base → local* and *base → remote*, the engine can tell what each side changed — rather than naively comparing local vs remote, which would silently lose extensions or resurrect deleted ones.

### Merge truth table

| In base | Installed locally | In remote | In remote.removed | Action |
|---------|------------------|-----------|-------------------|--------|
| ✗ | ✓ | ✗ | ✗ | Push to remote (locally added) |
| ✗ | ✓ | ✓ | ✗ | Same version: no-op. Different: **version conflict** |
| ✗ | ✓ | ✗ | ✓ | **Resurrection conflict** — added locally, deleted remotely |
| ✗ | ✗ | ✓ | ✗ | Install locally (remotely added) |
| ✗ | ✗ | ✗ | ✓ | No-op (remote tombstone, nothing local to delete) |
| ✓ | ✓ | ✓ | ✗ | Both at same: no-op. Only remote changed: accept it. Only local changed: push it. Both changed differently: **version conflict** |
| ✓ | ✓ | ✗ | ✗ | Push back (remote lost it without tombstone) |
| ✓ | ✓ | ✗ | ✓ | Remote deleted. Local unchanged: uninstall. Local version changed: **resurrection conflict** |
| ✓ | ✗ | ✓ | ✗ | Write tombstone to remote (locally deleted) |
| ✓ | ✗ | ✗ | ✗ | No-op (already gone everywhere) |
| ✓ | ✗ | ✗ | ✓ | Both deleted — GC candidate |

### Tombstones — how deletes propagate

Without tombstones, deleting an extension on machine-A would have no effect on machine-B — the next sync would just re-add it from B's installed set.

When you delete an extension (or `ide-sync pull` removes one), the merge engine writes a **tombstone** (`removed` record in the state file) containing who deleted it and when. Other machines see the tombstone and uninstall the extension locally.

Tombstones are garbage-collected after 90 days (configurable in `config.json`) once all registered devices have synced past the deletion date.

### Conflict resolution

When both machines change the same extension in incompatible ways, the engine raises a conflict. The `--conflict` flag (or `conflictPolicy` in config) controls resolution:

| Policy | Behaviour |
|--------|-----------|
| `newest` (default) | The side with the newer timestamp wins |
| `local` | Local always wins |
| `remote` | Remote always wins |
| `manual` | Abort and print conflicts — re-run with another policy to resolve |

```bash
ide-sync sync --conflict newest   # default
ide-sync sync --conflict local    # my machine wins everything
ide-sync sync --conflict remote   # remote wins everything
ide-sync pull --conflict manual   # abort on conflicts, inspect and decide
```

Conflicts are always printed regardless of policy so you can see what was auto-resolved.

---

## Backends

### Git (recommended)

State is stored as `sync-state.json` in a git repository you own. Every push creates a commit with a message like:

```
sync: my-laptop +3 -1 @ 2024-05-19T10:30:00.000Z
```

This gives you full history, conflict audit trail, and any git host works (GitHub, GitLab, Gitea, self-hosted).

Auth uses whatever credentials git already has on the machine (SSH keys, credential helpers, HTTPS tokens). `ide-sync` never prompts for or stores credentials.

On push rejection (another machine pushed first), `ide-sync` automatically re-pulls, re-merges, and retries once.

### Filesystem

State is stored as a single JSON file in a local directory. Point it at a folder synced by Dropbox, iCloud, Syncthing, or any other file-sync service for zero-setup multi-machine sync:

```bash
ide-sync init --backend filesystem --path ~/Dropbox/ide-sync
```

The filesystem backend is a first-class shipping feature, not a test stub. It gives full multi-machine sync with no git setup required.

---

## Sync state schema

The cross-machine contract, versioned from day one:

```ts
interface SyncState {
  schemaVersion: 1;
  updatedAt: string;              // ISO timestamp
  updatedByDevice: string;        // device id
  extensions: Record<string, {
    desiredVersion: string;       // semver or "latest"
    families: IDEFamily[];        // which IDE families should have this
    addedBy: string;              // device id
    addedAt: string;              // ISO timestamp
  }>;
  removed: Record<string, {       // tombstones — propagate deletes
    removedBy: string;            // device id
    removedAt: string;            // ISO timestamp
  }>;
  devices: Record<string, {
    id: string;
    name: string;
    platform: string;
    lastSyncedAt: string | null;
    lastSyncedStateHash: string | null;  // merge base fingerprint
  }>;
}
```

The state file contains **only extension IDs, versions, device names, and timestamps** — no tokens, no secrets. Git auth uses the user's existing credentials; the tool never sees or stores them.

---

## Phase 1 & 2: Local operations

### Scan

```bash
ide-sync scan
ide-sync scan --ide vscode,cursor
ide-sync scan --json
ide-sync scan --output manifest.json
```

### Install

```bash
ide-sync install dbaeumer.vscode-eslint --ide cursor
ide-sync install dbaeumer.vscode-eslint esbenp.prettier-vscode --ide cursor
ide-sync install dbaeumer.vscode-eslint --ide cursor --version 3.0.4
```

### Uninstall

```bash
ide-sync uninstall dbaeumer.vscode-eslint --ide cursor
ide-sync uninstall dbaeumer.vscode-eslint --ide cursor --yes
```

### Replicate

Mirror one IDE's extensions to another without touching the cloud backend:

```bash
ide-sync replicate --from vscode --to cursor --dry-run
ide-sync replicate --from vscode --to cursor
ide-sync replicate --from vscode --to cursor --exclude ms-python.python,github.copilot
ide-sync replicate --from vscode --to cursor --only-missing
ide-sync replicate --from vscode --to cursor --prune
```

---

## Install strategy

Each install attempt follows this fallback chain:

1. **CLI** — `<ide-cli> --install-extension <id>[@version]`
2. **VSIX fallback** — downloads `.vsix` from marketplace, installs from file
3. **Failure** — reports error without aborting the rest of the run

VSIX files are cached at `~/.ide-sync/cache/vsix/`.

## Marketplace strategy

| IDE | Default | Notes |
|---|---|---|
| VS Code | Microsoft → Open VSX fallback | |
| Cursor | Open VSX only | `--allow-ms-marketplace` to opt in |
| Windsurf | Open VSX only | Same |
| Antigravity | Open VSX only | Same |
| VSCodium | Open VSX only | Same |

Proprietary extensions (`github.copilot`, `ms-vscode-remote.*`) aren't on Open VSX and show as `skip` in replicate plans.

## Safety

- `pull` and `sync` show the full plan and confirm before applying anything (unless `--yes`)
- `--dry-run` is strict: no git writes, no installs, no state file writes
- A lockfile (`~/.ide-sync/.lock`) prevents concurrent `push`/`pull`/`sync` runs from corrupting the merge base
- The merge base (`last-synced-state.json`) is only written after a fully successful apply — a crash mid-apply means the next run retries cleanly
- No telemetry

## Development

```bash
npm run dev        # Run without building (tsx)
npm test           # Run vitest suite (114 tests)
npm run lint       # ESLint
npm run format     # Prettier
npm run build      # tsup → dist/cli.js
```

## Roadmap

| Phase | Description | Status |
|---|---|---|
| 1 | Local inventory scanner | ✅ Done |
| 2 | Install / uninstall / replicate | ✅ Done |
| 3 | Cloud sync — git & filesystem backends, 3-way merge | ✅ Done |
| 4 | Settings sync — keybindings, snippets, settings.json | Planned |
| 5 | Team profiles — shared named profiles, import/export | Planned |
