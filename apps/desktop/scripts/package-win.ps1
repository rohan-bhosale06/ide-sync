# package-win.ps1 - manual Windows packaging without electron-builder.
# Uses the Electron binary already installed via npm, so no extra downloads needed.
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads BOM-less scripts as ANSI,
# and multi-byte punctuation (em dashes etc.) decodes into curly quotes that the
# parser treats as string delimiters, silently corrupting the code.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root     = Split-Path $PSScriptRoot -Parent                # apps/desktop
$repoRoot = Split-Path (Split-Path $root -Parent) -Parent   # repo root (for node_modules)
$outDir   = Join-Path $root "dist-package\ide-sync-win-x64"
$zipPath  = Join-Path $root "dist-package\ide-sync-win-x64.zip"
$electronSrc = Join-Path $repoRoot "node_modules\electron\dist"

Write-Host "==> Building app..."
Set-Location $root
npm run build

Write-Host "==> Cleaning output dir..."
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Force $outDir | Out-Null

Write-Host "==> Copying Electron runtime..."
Copy-Item -Recurse "$electronSrc\*" "$outDir\"

Write-Host "==> Renaming electron.exe to ide-sync.exe..."
Rename-Item "$outDir\electron.exe" "ide-sync.exe"

Write-Host "==> Removing default app placeholder..."
Remove-Item -Force "$outDir\resources\default_app.asar" -ErrorAction SilentlyContinue

Write-Host "==> Copying app files..."
$appDir = "$outDir\resources\app"
New-Item -ItemType Directory -Force $appDir | Out-Null
Copy-Item "$root\package.json" "$appDir\"
New-Item -ItemType Directory -Force "$appDir\out" | Out-Null
Copy-Item -Recurse "$root\out\*" "$appDir\out\"

Write-Host "==> Bundling background-sync daemon..."
$daemonJs = Join-Path $repoRoot "packages\cli\dist\daemon.js"
if (-not (Test-Path $daemonJs)) {
    Write-Host "    daemon.js not built yet - building CLI package..."
    Set-Location $repoRoot
    npm run build
    Set-Location $root
}
if (Test-Path $daemonJs) {
    Copy-Item $daemonJs (Join-Path $appDir "daemon.js")
} else {
    Write-Warning "daemon.js not found - background sync will be unavailable in this package."
}
if (-not (Test-Path (Join-Path $appDir "daemon.js"))) {
    throw "daemon.js missing from package after copy step (src: $daemonJs)"
}

Write-Host "==> Creating zip archive..."
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path "$outDir\*" -DestinationPath $zipPath

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host "  Folder : $outDir\ide-sync.exe  (run directly)"
Write-Host "  Zip    : $zipPath  ($sizeMB MB)"
