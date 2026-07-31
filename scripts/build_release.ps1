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
foreach ($name in @("app", "core", "design", "tests", "scripts")) {
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

$builtExe = Get-ChildItem -LiteralPath (Join-Path $stagingRoot "release") `
  -Filter "*.exe" -File |
  Select-Object -First 1
if (-not $builtExe) {
  throw "The portable executable was not produced."
}

$releaseRoot = Join-Path $projectRoot "release"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$destination = Join-Path $releaseRoot $builtExe.Name
Copy-Item -LiteralPath $builtExe.FullName -Destination $destination -Force
$builtChecksum = "$($builtExe.FullName).sha256"
if (-not (Test-Path -LiteralPath $builtChecksum)) {
  throw "Release checksum was not produced: $builtChecksum"
}
$checksumDestination = "$destination.sha256"
Copy-Item -LiteralPath $builtChecksum -Destination $checksumDestination -Force
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash

Write-Host "Release: $destination"
Write-Host "SHA256: $($hash.ToLowerInvariant())"
