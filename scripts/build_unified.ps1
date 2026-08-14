$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") `
  -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$releaseRoot = Join-Path $projectRoot "release"
$unpackedRoot = Join-Path $releaseRoot "win-unpacked"
$unpackedExecutables = @(
  Get-ChildItem -LiteralPath $unpackedRoot -Filter "*.exe" -File
)
if ($unpackedExecutables.Count -ne 1) {
  throw "Expected exactly one unpacked app executable, found $($unpackedExecutables.Count)."
}

$artifactBaseName = "WaHongShu-$version"
$buildRoot = Join-Path $projectRoot "build\unified"
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

& python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --console `
  --icon (Join-Path $projectRoot "app\assets\icon.ico") `
  --name $artifactBaseName `
  --distpath $releaseRoot `
  --workpath $buildRoot `
  --specpath $buildRoot `
  --add-data "$unpackedRoot;wahongshu-app" `
  (Join-Path $projectRoot "cli\launcher.py")
if ($LASTEXITCODE -ne 0) {
  throw "Unified executable build failed with $LASTEXITCODE"
}

$executable = Join-Path $releaseRoot "$artifactBaseName.exe"
if (-not (Test-Path -LiteralPath $executable)) {
  throw "Unified executable was not produced: $executable"
}
$hash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = "$executable.sha256"
Set-Content -LiteralPath $checksumPath -Encoding ASCII `
  -Value "$hash  $artifactBaseName.exe"

Write-Host "Unified release: $executable"
Write-Host "SHA256: $hash"
