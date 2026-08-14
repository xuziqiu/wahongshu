$ErrorActionPreference = "Stop"
$env:PYGAME_HIDE_SUPPORT_PROMPT = "1"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$temporaryRoot = [IO.Path]::GetFullPath($env:TEMP)
$stagingRoot = [IO.Path]::GetFullPath(
  (Join-Path $temporaryRoot "wahongshu-release-build")
)

if (
  $stagingRoot -eq $temporaryRoot -or
  -not $stagingRoot.StartsWith(
    $temporaryRoot.TrimEnd("\") + "\",
    [StringComparison]::OrdinalIgnoreCase
  )
) {
  throw "Unsafe staging path: $stagingRoot"
}

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingRoot | Out-Null

foreach ($name in @(
  "package.json",
  "package-lock.json",
  "LICENSE",
  "DISCLAIMER.md",
  "README.md"
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stagingRoot
}
foreach ($name in @("app", "cli", "core", "design", "tests", "scripts")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stagingRoot -Recurse
}
$electronDistSource = Join-Path $projectRoot "node_modules\electron\dist"
if (-not (Test-Path -LiteralPath (Join-Path $electronDistSource "electron.exe"))) {
  throw "Electron runtime is missing. Run npm install in the project first."
}
Copy-Item -LiteralPath $electronDistSource `
  -Destination (Join-Path $stagingRoot "electron-dist") -Recurse

Push-Location $stagingRoot
try {
  & npm.cmd ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with $LASTEXITCODE" }
  & npm.cmd run dist:staged
  if ($LASTEXITCODE -ne 0) { throw "release build failed with $LASTEXITCODE" }
} finally {
  Pop-Location
}

$releaseRoot = Join-Path $projectRoot "release"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") `
  -Encoding UTF8 | ConvertFrom-Json
$artifactName = "WaHongShu-$($package.version).exe"
$builtAssets = Get-ChildItem -LiteralPath (Join-Path $stagingRoot "release") `
  -File | Where-Object {
    $_.Name -in @($artifactName, "$artifactName.sha256")
  }
if ($builtAssets.Count -ne 2) {
  throw "Expected one EXE and one SHA-256 file, found $($builtAssets.Count)."
}
foreach ($asset in $builtAssets) {
  $destination = Join-Path $releaseRoot $asset.Name
  Copy-Item -LiteralPath $asset.FullName -Destination $destination -Force
  Write-Host "Release asset: $destination"
}
