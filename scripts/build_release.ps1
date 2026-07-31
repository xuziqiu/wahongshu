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
foreach ($name in @("app", "core", "tests", "scripts")) {
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
  & npm.cmd run dist -- --config.electronDist=electron-dist
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

# electron-builder marks portable launchers as Windows GUI applications. The
# product intentionally uses one EXE for both GUI and CLI modes, so mark the
# outer portable launcher as a console application. Double-clicking may show a
# console window, while terminal callers receive stdout, stderr and exit codes.
$executableBytes = [IO.File]::ReadAllBytes($destination)
if (
  $executableBytes.Length -lt 512 -or
  $executableBytes[0] -ne 0x4D -or
  $executableBytes[1] -ne 0x5A
) {
  throw "Built release is not a valid PE executable: $destination"
}
$peOffset = [BitConverter]::ToInt32($executableBytes, 0x3C)
$subsystemOffset = $peOffset + 92
if ($subsystemOffset + 1 -ge $executableBytes.Length) {
  throw "Built release has an invalid PE optional header: $destination"
}
$executableBytes[$subsystemOffset] = 3
$executableBytes[$subsystemOffset + 1] = 0
[IO.File]::WriteAllBytes($destination, $executableBytes)

$hash = Get-FileHash -LiteralPath $destination -Algorithm SHA256
$hashLine = "$($hash.Hash.ToLowerInvariant())  $($builtExe.Name)`r`n"
[IO.File]::WriteAllText(
  (Join-Path $releaseRoot "$($builtExe.Name).sha256"),
  $hashLine,
  [Text.UTF8Encoding]::new($false)
)

Write-Host "Release: $destination"
Write-Host "SHA256: $($hash.Hash.ToLowerInvariant())"
