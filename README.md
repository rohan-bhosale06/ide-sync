# ide-sync

A CLI tool to scan, compare, and sync extensions **and full IDE configuration** across VS Code-family IDEs — locally and across multiple machines, with a background daemon that makes it fully automatic.

**Phase 5 of 5 complete** — settings, keybindings, snippets, tasks, MCP config, and UI state sync with comment-preserving 3-way merge, fork-translation engine, and automatic backup.

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

## Phase 4: Background Daemon

The daemon watches each IDE's extension directory, debounces changes, and automatically syncs — no manual commands needed. Install an extension in Cursor and it appears in VS Code 10–30 seconds later, on the same machine and on your other laptop.

### The everyday workflow

```
ide-sync init          # one-time setup
ide-sync daemon start  # from this point on, you basically never type sync again
```

That's it. The daemon handles everything: it watches for local changes, periodically pulls from the remote, and applies the 3-way merge automatically. Every action is logged. Conflicts are surfaced as desktop notifications (opt-in).

### Daemon lifecycle

```bash
ide-sync daemon start       # spawn detached background process
ide-sync daemon stop        # graceful shutdown (drains queue first)
ide-sync daemon restart     # stop then start
ide-sync daemon status      # live status via IPC socket
```

`status` output:

```
  ide-sync daemon · active (pid 84211, uptime 3h 22m)
  ─────────────────────────────────────────────────────────
  Watching:
    ✓ vscode        last event 12m ago
    ✓ cursor        last event 4s ago    [debouncing — sync in ~6s]
    ✓ windsurf      last event never

  Queue:        0 running, 1 pending
  Last sync:    2m ago  · ↓1 ↑0 · no conflicts
  Periodic:     */5 * * * *
  State:        active
  Memory:       48.3 MB RSS
```

### Logs

```bash
ide-sync daemon logs              # tail the rotating log file
ide-sync daemon logs --since 1h   # only show last hour (supports: 30s, 5m, 1h, 2d)
```

Logs live at `~/.ide-sync/logs/daemon.log`, rotated daily, kept for 7 days.

### On-demand and pause controls

```bash
ide-sync daemon sync-now    # trigger an immediate sync without waiting for a debounce or cron tick
ide-sync daemon pause       # stop firing jobs (watchers keep observing — nothing is missed)
ide-sync daemon resume      # resume; any changes observed while paused sync immediately
```

**When to pause:** before installing a batch of extensions you don't want auto-synced yet. Pause → install → verify → resume. The daemon catches up on resume.

### Auto-start at login

```bash
ide-sync daemon install     # register with the OS service manager
ide-sync daemon uninstall   # remove the service entry
```

| Platform | Mechanism |
|---|---|
| **Windows** | Task Scheduler (`schtasks`), runs at logon, user-level |
| **macOS** | launchd (`~/Library/LaunchAgents/com.user.ide-sync.plist`) |
| **Linux** | systemd user unit (`~/.config/systemd/user/ide-sync.service`) |

**macOS:** writes `~/Library/LaunchAgents/com.user.ide-sync.plist` and calls `launchctl bootstrap gui/<uid>`. `KeepAlive: { SuccessfulExit: false }` so it restarts on crash but not on clean stop. Logs to `~/.ide-sync/logs/daemon.log`.

**Linux:** writes `~/.config/systemd/user/ide-sync.service` and calls `systemctl --user enable --now`. If you want it running without an active login session, run `loginctl enable-linger $USER` separately — the tool won't do this automatically.

### Foreground mode (debugging)

```bash
ide-sync watch                          # same engine as the daemon, logs to stdout
ide-sync watch --ide cursor,vscode      # limit to specific IDEs
ide-sync watch --verbose                # debug-level output
```

`watch` is useful for understanding exactly what the watcher and debouncer are doing. Press Ctrl+C to stop.

---

## How the daemon works

### Three loops, one serial queue

```
FS watcher loop   ──┐
                    ├──▶  [ local-change | remote-check | manual-sync ]  ──▶  one sync at a time
Periodic pull loop ─┤
IPC loop          ──┘
```

**FS watcher loop** — chokidar watches each detected IDE's extension directory (reusing Phase 1 detection). On `addDir`/`unlinkDir` events matching the `publisher.name-semver` directory shape, a debounced `local-change` job is enqueued.

**Periodic pull loop** — cron-driven (default `*/5 * * * *`), enqueues a `remote-check` job that runs pull non-interactively. Catches changes from other machines.

**IPC loop** — Unix socket (`~/.ide-sync/daemon.sock`) or Windows named pipe (`\\.\pipe\ide-sync-daemon`). Commands from the CLI are dispatched here: `status`, `sync-now`, `pause`, `resume`.

### The debouncer

Installing one extension fires dozens of filesystem events as the IDE writes files progressively. Naive sync-on-every-event would thrash. The debouncer coalesces bursts into a single job.

Algorithm: **trailing debounce with hard max-delay cap**, one debouncer per IDE:

- Any FS event starts (or resets) a quiet-period timer (default 10 s)
- If no further events for 10 s → one sync job fires
- If events keep trickling in indefinitely → the job fires after 60 s regardless

This means a normal extension install (30 events over 8 s) → one sync after 10 s. A continuous trickle → fires after 60 s. A VS Code update that rewrites the whole extensions dir → absorbed by the quiet period into one job.

Cursor and VS Code have **independent debouncers** — an event in one does not reset the other's timer.

### Job queue

Strictly serial — two syncs never run concurrently. Dedup rules:

| Job type | Dedup rule |
|---|---|
| `local-change` for IDE X | If one is already pending for IDE X, collapse into it |
| `remote-check` | Globally deduplicated — one pending pull is enough |
| `manual-sync` | Never deduplicated — always queues |

Queue is in-memory only. On daemon restart, the watcher's initial detection + one periodic pull reconciles any drift.

### Large-change safety gate

If a sync job's plan would change more than 50% of extensions (configurable), and `autoApplyLargeChanges` is false, the daemon skips the sync and logs a `WARN`. A desktop notification is sent if enabled. This catches scenarios like an IDE update nuking and rewriting its entire extension directory — the debouncer's quiet period absorbs the burst, but the gate prevents a mass-uninstall from being applied silently.

To bypass: run `ide-sync sync` manually to review the plan, or set `autoApplyLargeChanges: true` in `~/.ide-sync/config.json`.

### Safety guarantees

The daemon never reimplements sync logic. Every job calls the same `runPull` / `runSync` functions the CLI uses. All of Phase 3's safety rails apply:
- Merge base only advances on full success
- Conflicts are reported (and optionally notified)
- The process lock prevents concurrent corruption
- `kill -9` is always safe — no state is lost

---

## Configuration

Daemon settings live in `~/.ide-sync/config.json` under the `daemon` key. All fields have defaults and the key is optional.

```json
{
  "daemon": {
    "debounceMs": 10000,
    "maxDebounceMs": 60000,
    "periodicPullCron": "*/5 * * * *",
    "pausedUntil": null,
    "autoApplyLargeChanges": false,
    "largeChangeThresholdPercent": 50,
    "notifications": {
      "enabled": true,
      "onSync": false,
      "onConflict": true,
      "onError": true
    }
  }
}
```

| Field | Default | Effect |
|---|---|---|
| `debounceMs` | `10000` | Quiet period before a watcher event triggers sync |
| `maxDebounceMs` | `60000` | Hard cap — sync fires even during a continuous trickle |
| `periodicPullCron` | `*/5 * * * *` | How often to check for remote changes |
| `pausedUntil` | `null` | Set by `daemon pause`; cleared by `daemon resume` |
| `autoApplyLargeChanges` | `false` | Bypass the large-change safety gate |
| `largeChangeThresholdPercent` | `50` | % of extensions changed to trigger the gate |
| `notifications.enabled` | `true` | Master switch for desktop notifications |
| `notifications.onSync` | `false` | Notify on every successful sync |
| `notifications.onConflict` | `true` | Notify when conflicts are auto-resolved |
| `notifications.onError` | `true` | Notify on sync errors |

---

## Troubleshooting

**Daemon won't start**

```bash
ide-sync daemon logs --since 5m    # check for startup errors
```

If the PID file is stale (e.g. after a hard reboot), delete it manually:
```bash
rm ~/.ide-sync/daemon.pid          # Unix
del %USERPROFILE%\.ide-sync\daemon.pid   # Windows
```

**Changes not syncing**

1. Check the daemon is running: `ide-sync daemon status`
2. Check if paused: status output shows `paused` state
3. Watch what's happening in real time: `ide-sync daemon logs`
4. Trigger manually: `ide-sync daemon sync-now`
5. Fall back to the CLI: `ide-sync sync`

**Sync triggered but nothing installed**

The large-change gate may have blocked it. Check the log for `large-change gate` warnings:
```bash
ide-sync daemon logs --since 1h | grep large-change
```
Run `ide-sync sync` manually to review the plan and apply it.

**IPC not responding**

`ide-sync daemon status` falls back gracefully if the IPC socket is unavailable and shows the PID from the PID file instead.

**Where things live**

| Path | What |
|---|---|
| `~/.ide-sync/config.json` | Sync + daemon configuration |
| `~/.ide-sync/last-synced-state.json` | Merge base (last successfully synced state) |
| `~/.ide-sync/daemon.pid` | Running daemon PID |
| `~/.ide-sync/daemon.sock` | IPC socket (Unix) |
| `~/.ide-sync/logs/daemon.log` | Current log file |
| `~/.ide-sync/logs/daemon.log.YYYY-MM-DD` | Rotated daily logs (kept 7 days) |
| `~/.ide-sync/cache/vsix/` | Downloaded extension VSIX cache |
| `~/.ide-sync/repo/` | Cloned git backend repo |

---

## Phase 3: Cloud Sync

### Quick start

```bash
# One-time setup per machine
ide-sync init

# Manual sync (not needed once the daemon is running)
ide-sync sync
```

### Setup (`init`)

```bash
# Interactive
ide-sync init

# Git backend
ide-sync init --backend git --repo git@github.com:you/ide-sync-state.git

# Filesystem backend (Dropbox / iCloud / Syncthing)
ide-sync init --backend filesystem --path ~/Dropbox/ide-sync

# Custom device name
ide-sync init --backend git --repo git@github.com:you/ide-sync-state.git --device "work-laptop"
```

### Manual sync commands

```bash
ide-sync sync                          # pull then push
ide-sync sync --yes                    # non-interactive
ide-sync sync --ide vscode,cursor      # scope to specific IDEs
ide-sync sync --dry-run                # preview without changes

ide-sync push                          # push local state to remote
ide-sync pull                          # pull remote state and apply locally
ide-sync pull --keep-local-extensions  # pull but skip uninstalls
ide-sync pull --dry-run

ide-sync status                        # read-only drift summary
ide-sync devices                       # list registered devices
ide-sync devices remove <device-id>
```

### How the 3-way merge works

When `sync`, `push`, or `pull` runs, it performs a **3-way merge** using three inputs:

| Input | What it is |
|---|---|
| **base** | The last `SyncState` this device successfully applied (`~/.ide-sync/last-synced-state.json`) |
| **local** | What's actually installed right now (from Phase 1 scan) |
| **remote** | The current state from the backend |

By comparing *base → local* and *base → remote*, the engine knows what each side changed — rather than naively diffing local vs remote, which would silently lose extensions or resurrect deleted ones.

### Merge truth table

| In base | Installed locally | In remote | In remote.removed | Action |
|---|---|---|---|---|
| ✗ | ✓ | ✗ | ✗ | Push to remote |
| ✗ | ✓ | ✓ | ✗ | Same version: no-op. Different: **version conflict** |
| ✗ | ✓ | ✗ | ✓ | **Resurrection conflict** |
| ✗ | ✗ | ✓ | ✗ | Install locally |
| ✗ | ✗ | ✗ | ✓ | No-op |
| ✓ | ✓ | ✓ | ✗ | Same: no-op. Remote changed: accept. Local changed: push. Both changed: **version conflict** |
| ✓ | ✓ | ✗ | ✗ | Push back (remote lost it) |
| ✓ | ✓ | ✗ | ✓ | Local unchanged: uninstall. Local changed: **resurrection conflict** |
| ✓ | ✗ | ✓ | ✗ | Write tombstone to remote |
| ✓ | ✗ | ✗ | ✗ | No-op |
| ✓ | ✗ | ✗ | ✓ | Both deleted — GC candidate |

### Tombstones — how deletes propagate

Deleting an extension writes a **tombstone** (`removed` record) so other machines know to uninstall it too, rather than re-adding it on the next sync.

Tombstones are garbage-collected after 90 days once all registered devices have synced past the deletion date.

### Conflict resolution

| Policy | Behaviour |
|---|---|
| `newest` (default) | The side with the newer timestamp wins |
| `local` | Local always wins |
| `remote` | Remote always wins |
| `manual` | Abort and print conflicts |

```bash
ide-sync sync --conflict newest
ide-sync sync --conflict local
ide-sync sync --conflict remote
ide-sync pull --conflict manual
```

### Backends

**Git (recommended)** — state stored as `sync-state.json` in a git repo you own. Every push creates a commit. Full history, any git host.

**Filesystem** — state stored as a single JSON file in a local directory. Point it at a Dropbox/iCloud/Syncthing folder for zero-setup multi-machine sync.

---

## Phase 1 & 2: Local operations

```bash
# Scan
ide-sync scan
ide-sync scan --ide vscode,cursor
ide-sync scan --json

# Install / uninstall
ide-sync install dbaeumer.vscode-eslint --ide cursor
ide-sync install dbaeumer.vscode-eslint --ide cursor --version 3.0.4
ide-sync uninstall dbaeumer.vscode-eslint --ide cursor

# Replicate one IDE to another (no cloud backend needed)
ide-sync replicate --from vscode --to cursor --dry-run
ide-sync replicate --from vscode --to cursor
ide-sync replicate --from vscode --to cursor --prune
ide-sync replicate --from vscode --to cursor --exclude ms-python.python,github.copilot
```

### Install strategy

1. **CLI** — `<ide-cli> --install-extension <id>[@version]`
2. **VSIX fallback** — downloads `.vsix` from marketplace, installs from file
3. **Failure** — reports error without aborting the rest of the run

VSIX files are cached at `~/.ide-sync/cache/vsix/`.

### Marketplace strategy

| IDE | Default marketplace |
|---|---|
| VS Code | Microsoft → Open VSX fallback |
| Cursor, Windsurf, Antigravity, VSCodium | Open VSX only (`--allow-ms-marketplace` to opt in) |

---

## Phase 5: Config Sync

Phase 5 extends sync from extensions to the full IDE configuration surface. "My extensions follow me" becomes "my entire dev environment follows me."

### What gets synced

| Domain | Files | Merge strategy |
|---|---|---|
| `settings` | `settings.json` | Key-level 3-way merge, JSONC comments preserved |
| `keybindings` | `keybindings.json` | Array merge by `(key, command, when)` identity |
| `snippets` | `snippets/*.json`, `*.code-snippets` | Per-file 3-way merge + add/remove tracking |
| `tasks` | `tasks.json` | Key-level 3-way merge |
| `mcp` | `mcp.json` / `.mcp.json` | Key-level 3-way merge |
| `ui-state` | `globalStorage/storage.json` (subset) | Whitelist-only, last-write-wins |

**All domains are opt-in.** On first upgrade, nothing is synced until you explicitly enable domains. Extension sync (Phases 1–4) continues unchanged.

### Getting started

```bash
# See what's currently enabled
ide-sync config list

# Enable specific domains
ide-sync config enable settings
ide-sync config enable keybindings
ide-sync config enable snippets

# Opt a single IDE out of keybindings sync (your keybindings are very personal)
ide-sync config disable keybindings --ide cursor

# From this point on, push/pull/sync/daemon all include config domains automatically
ide-sync push
```

### One-shot local replication

Copy config from one IDE to another without using the remote backend:

```bash
# All enabled domains
ide-sync config replicate --from vscode --to cursor

# Specific domains only
ide-sync config replicate --from vscode --to cursor --domain settings,keybindings

# Preview what would change
ide-sync config replicate --from vscode --to cursor --dry-run
```

### Inspecting config state

```bash
# Print the settings.json captured for VS Code
ide-sync config show --ide vscode --domain settings

# Diff what would change when translating vscode→cursor locally
ide-sync config diff --from vscode --to cursor

# Check what's stored on the remote backend
ide-sync config diff --remote
```

### Translation system

VS Code forks disagree on some settings keys. The translator handles three cases:

| Behavior | Example |
|---|---|
| **Passthrough** (default) | `editor.fontSize` — identical across all forks |
| **Quarantine** | `cursor.*` dropped when writing to VS Code; `github.copilot.*` dropped when writing to Cursor or Windsurf (both have built-in AI) |
| **Map** | Explicit key rename for forks that renamed a shared key |

Quarantined key prefixes (always dropped):
- `cursor.*`, `windsurf.*`, `codeium.*`, `vscodium.*` — fork-specific namespaces
- `github.copilot.*` — dropped when writing to Cursor or Windsurf (both have built-in AI)
- `telemetry.*`, `update.*`, `extensions.autoUpdate` — per-machine preferences

To add custom translation overrides, set `translationOverrides` in `~/.ide-sync/config-sync.json`:

```json
{
  "translationOverrides": {
    "cursor.someRenamedKey": "editor.originalKey",
    "my.private.key": null
  }
}
```

A value of `null` quarantines the key. A string value renames it.

### Comment preservation

**Comments in your settings files are never lost.** The merger uses `jsonc-parser`'s `modify()` + `applyEdits()` to perform surgical character-level edits — it never round-trips through `JSON.parse`/`JSON.stringify`.

```jsonc
{
  // My preferred font — keep this in sync
  "editor.fontSize": 16,   // baseline
  "editor.tabSize": 2
}
```

If a remote device changes `editor.tabSize` to `4`, the merger applies exactly `"editor.tabSize": 4` as a targeted edit. Every other character in the file — including the comments — is preserved verbatim.

### Backup and restore

Every write to an IDE config file is preceded by an automatic backup. You can also snapshot manually:

```bash
# Snapshot all IDE configs now
ide-sync config backup

# List available backups (newest first)
ide-sync config backups

# Restore a specific backup
ide-sync config restore 2026-05-26T10-30-00-000Z-config-sync

# Restore only for one IDE
ide-sync config restore 2026-05-26T10-30-00-000Z-config-sync --ide cursor
```

Backups live in `~/.ide-sync/backups/`. Auto-pruning keeps at least the last 20 regardless of age, and deletes entries older than 30 days.

### UI-state sync

`ui-state` is **always opt-in** (even if globally enabled) and syncs only a conservative whitelist of keys from `globalStorage/storage.json`. Most of that file is per-machine state (window positions, recent file lists) that you do **not** want synced.

Default whitelist:
- `workbench.activityBar.pinnedViewlets`
- `workbench.welcome.experimental.hidden`
- `workbench.colorTheme`
- `workbench.iconTheme`
- `workbench.productIconTheme`

Add extra keys via `uiStateWhitelistExtra` in `~/.ide-sync/config-sync.json`.

### Schema migration (v1 → v2)

Phase 5 bumps the sync-state schema from v1 to v2. Migration happens automatically on the first push/pull after upgrading. The old state is preserved as `last-synced-state.json.v1.bak`.

If you have multiple machines, upgrade them before pushing from a v2 device. If a v2 device detects v1 state from another active device, it will refuse to push and print the device IDs that need upgrading:

```
Older device detected: laptop-abc (last synced 2h ago).
Upgrade it to ide-sync v0.5.0+ before pushing config state.
```

### Daemon integration

The daemon (Phase 4) automatically watches config files in addition to extension directories. Config file changes use a **30-second debounce** (vs 10s for extensions) so that adjusting three settings in the IDE UI doesn't trigger three separate syncs.

Config watching activates automatically once at least one domain is enabled.

---

## Safety

- The daemon never applies a sync without going through Phase 3's safety rails
- The process lock (`~/.ide-sync/.lock`) prevents concurrent syncs from corrupting the merge base
- The merge base is only written after a fully successful apply — a crash mid-apply means the next run retries cleanly
- `kill -9` the daemon at any time — no state is lost
- Large-change gate prevents mass-uninstall events from being auto-applied silently
- No telemetry. No phone-home. No auto-update

---

## Development

```bash
npm run dev        # Run without building (tsx)
npm test           # Run vitest suite (180 tests)
npm run lint       # ESLint
npm run format     # Prettier
npm run build      # tsup → dist/cli.js + dist/daemon.js
```

---

## Roadmap

| Phase | Description | Status |
|---|---|---|
| 1 | Local inventory scanner | ✅ Done |
| 2 | Install / uninstall / replicate | ✅ Done |
| 3 | Cloud sync — git & filesystem backends, 3-way merge | ✅ Done |
| 4 | Background daemon — file watching, debounced auto-sync, OS service | ✅ Done |
| 5 | Full config sync — settings, keybindings, snippets, tasks, MCP, UI state | ✅ Done |
