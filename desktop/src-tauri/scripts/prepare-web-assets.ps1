# Pre-build script: copies Next.js build output and public assets to Tauri resources
# This must be run BEFORE `tauri build` to ensure web assets are bundled

$ErrorActionPreference = "Stop"

$webRoot = Resolve-Path "$PSScriptRoot\..\..\..\web"
$tauriRoot = Resolve-Path "$PSScriptRoot\.."
$destDir = Join-Path $tauriRoot "web-assets"

Write-Host "Preparing web assets for Tauri bundle..." -ForegroundColor Cyan
Write-Host "  Source: $webRoot" -ForegroundColor Gray
Write-Host "  Dest:   $destDir" -ForegroundColor Gray

# Clean previous assets
if (Test-Path $destDir) {
    Write-Host "  Cleaning previous build..." -ForegroundColor Gray
    Remove-Item $destDir -Recurse -Force
}

# Create destination
New-Item -ItemType Directory -Path $destDir -Force | Out-Null

# Copy .next build output
if (Test-Path "$webRoot\.next") {
    Write-Host "  Copying .next build output..." -ForegroundColor Gray
    Copy-Item "$webRoot\.next" "$destDir\.next" -Recurse -Force
} else {
    Write-Host "  ERROR: .next directory not found. Run 'pnpm build' in web/ first." -ForegroundColor Red
    exit 1
}

# Copy public folder
if (Test-Path "$webRoot\public") {
    Write-Host "  Copying public assets..." -ForegroundColor Gray
    Copy-Item "$webRoot\public" "$destDir\public" -Recurse -Force
}

# Copy package.json and next.config.mjs
Copy-Item "$webRoot\package.json" "$destDir\package.json" -Force
Copy-Item "$webRoot\next.config.mjs" "$destDir\next.config.mjs" -Force

# Prepare a clean frontend dist folder for Tauri validation. The runtime
# server stays under web-assets\web, while this folder intentionally excludes
# the standalone node_modules tree.
$frontendDir = Join-Path $destDir "frontend"
if (Test-Path $frontendDir) {
    Remove-Item $frontendDir -Recurse -Force
}
New-Item -ItemType Directory -Path $frontendDir -Force | Out-Null
@"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quaz Desktop</title>
  </head>
  <body>
    <noscript>Quaz Desktop requires JavaScript.</noscript>
  </body>
</html>
"@ | Set-Content -Encoding utf8 (Join-Path $frontendDir "index.html")
Write-Host "  Prepared frontend placeholder assets..." -ForegroundColor Gray

# Get total size
$totalSize = (Get-ChildItem $destDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "  Total: $($totalSize.ToString('F0')) MB bundled" -ForegroundColor Green
Write-Host "Done!" -ForegroundColor Cyan
