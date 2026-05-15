# ide-sync

A CLI tool to scan, compare, and sync extensions across VS Code-family IDEs.

**Phase 2 of 5** — install, uninstall, and replicate extensions across IDEs. No cloud sync yet.

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

## Usage

### Scan

```bash
# Summary table of all IDEs
ide-sync scan

# Filter to specific IDEs
ide-sync scan --ide vscode,cursor

# Output raw JSON
ide-sync scan --json

# Write manifest to file
ide-sync scan --output manifest.json
```

### Install

```bash
# Install one or more extensions
ide-sync install dbaeumer.vscode-eslint --ide cursor
ide-sync install dbaeumer.vscode-eslint esbenp.prettier-vscode --ide cursor

# Pin to a specific version
ide-sync install dbaeumer.vscode-eslint --ide cursor --version 3.0.4
```

### Uninstall

```bash
# Uninstall an extension (prompts for confirmation)
ide-sync uninstall dbaeumer.vscode-eslint --ide cursor

# Skip confirmation
ide-sync uninstall dbaeumer.vscode-eslint --ide cursor --yes
```

### Replicate

Mirror extensions from one IDE into another.

```bash
# Preview the plan without making changes
ide-sync replicate --from vscode --to cursor --dry-run

# Apply interactively (shows plan, asks to confirm)
ide-sync replicate --from vscode --to cursor

# Skip confirmation
ide-sync replicate --from vscode --to cursor --yes

# Exclude specific extensions
ide-sync replicate --from vscode --to cursor --exclude ms-python.python,github.copilot

# Only add missing extensions — don't upgrade existing ones
ide-sync replicate --from vscode --to cursor --only-missing

# Also remove extensions in the target that aren't in the source
ide-sync replicate --from vscode --to cursor --prune

# Allow Microsoft Marketplace for non-VS Code IDEs (see caveats below)
ide-sync replicate --from vscode --to cursor --allow-ms-marketplace
```

#### Example plan output

```
   Plan: vscode → cursor
   ────────────────────────────────────────────────────────
   + install   dbaeumer.vscode-eslint@3.0.5
   + install   esbenp.prettier-vscode@10.4.0
   ↑ upgrade   github.vscode-pull-request-github  0.120.2 → 0.140.0
   · skip      github.copilot  (not found on marketplace)
   · skip      ms-vscode-remote.remote-ssh  (not found on marketplace)
   ────────────────────────────────────────────────────────
   2 installs, 1 upgrade, 2 skips
```

## Install strategy

Each install attempt follows this fallback chain:

1. **CLI first** — runs `<ide-cli> --install-extension <id>[@version]`. The IDE uses whatever marketplace it's configured with internally.
2. **VSIX fallback** — if the CLI fails, downloads the `.vsix` from the marketplace and installs via `<ide-cli> --install-extension <path>`.
3. **Failure** — if both fail, reports the error without aborting the rest of the run.

Downloaded `.vsix` files are cached in `~/.ide-sync/cache/vsix/` so repeat runs are fast.

## Marketplace caveats

| IDE | Default marketplace | Notes |
|---|---|---|
| VS Code | Microsoft → Open VSX fallback | First-party client |
| Cursor | Open VSX only | Use `--allow-ms-marketplace` to also try MS |
| Windsurf | Open VSX only | Same |
| Antigravity | Open VSX only | Same |
| VSCodium | Open VSX only | Same |

**`--allow-ms-marketplace`**: The Microsoft Marketplace ToS technically restricts direct API access from non-Microsoft clients. This flag opts in anyway — use at your own risk.

**Proprietary extensions** (`github.copilot`, `ms-vscode-remote.*`, etc.) are not published on Open VSX. They will show as `skip (not found on marketplace)` in replicate plans. This is expected, not a bug. You can install them manually via the IDE's built-in marketplace.

## Enabling IDE CLIs

All write commands require the IDE's CLI binary to be on `PATH`. Enable it from the Command Palette inside each IDE:

| IDE | Command |
|---|---|
| VS Code | `Shell Command: Install 'code' command in PATH` |
| Cursor | `Shell Command: Install 'cursor' command in PATH` |
| Windsurf | `Shell Command: Install 'windsurf' command in PATH` |
| Antigravity | `Shell Command: Install in PATH` |
| VSCodium | `Shell Command: Install 'codium' command in PATH` |

## Development

```bash
npm run dev        # Run without building (tsx)
npm test           # Run vitest suite (40 tests)
npm run lint       # ESLint
npm run format     # Prettier
npm run build      # tsup → dist/cli.js
```

## Manifest schema (Phase 1)

```ts
interface UnifiedManifest {
  generatedAt: string;     // ISO timestamp
  hostname: string;
  platform: string;
  inventories: Array<{
    ide: {
      family: 'vscode' | 'cursor' | 'windsurf' | 'antigravity' | 'vscodium';
      displayName: string;
      installed: boolean;
      extensionsPath: string | null;
      configPath: string | null;
    };
    extensions: Array<{
      id: string;           // "publisher.name"
      publisher: string;
      name: string;
      version: string;
      displayName?: string;
      description?: string;
      path: string;
    }>;
  }>;
}
```

## Roadmap

| Phase | Description | Status |
|---|---|---|
| 1 | Local inventory scanner | ✅ Done |
| 2 | Install / uninstall / replicate | ✅ Done |
| 3 | Profile management — named profiles, import/export | Planned |
| 4 | Cloud sync — store manifest remotely, sync across machines | Planned |
| 5 | Settings sync — keybindings, snippets, settings.json | Planned |
