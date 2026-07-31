$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") `
  -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$releaseRoot = Join-Path $projectRoot "release"
$guiExecutables = @(
  Get-ChildItem -LiteralPath $releaseRoot -Filter "*.exe" -File |
    Where-Object {
      $_.BaseName -notmatch "-CLI-" -and
      $_.BaseName -match "-$([regex]::Escape($version))$"
    }
)
if ($guiExecutables.Count -ne 1) {
  throw "Expected exactly one GUI executable, found $($guiExecutables.Count)."
}
$guiExecutable = $guiExecutables[0].FullName
$artifactBaseName = $guiExecutables[0].BaseName -replace "-$([regex]::Escape($version))$", ""

$cliBaseName = "$artifactBaseName-CLI-$version"
$buildRoot = Join-Path $projectRoot "build\cli"
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

& python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --console `
  --name $cliBaseName `
  --distpath $releaseRoot `
  --workpath $buildRoot `
  --specpath $buildRoot `
  --add-binary "$guiExecutable;." `
  (Join-Path $projectRoot "cli\launcher.py")
if ($LASTEXITCODE -ne 0) {
  throw "CLI build failed with $LASTEXITCODE"
}

$cliExecutable = Join-Path $releaseRoot "$cliBaseName.exe"
if (-not (Test-Path -LiteralPath $cliExecutable)) {
  throw "CLI executable was not produced: $cliExecutable"
}
$hash = (Get-FileHash -LiteralPath $cliExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = "$cliExecutable.sha256"
Set-Content -LiteralPath $checksumPath -Encoding ASCII `
  -Value "$hash  $cliBaseName.exe"

Write-Host "CLI release: $cliExecutable"
Write-Host "SHA256: $hash"
