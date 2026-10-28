<#
.SYNOPSIS
  Build the Book-to-Game Windows player (M1b-2) in one command.

.DESCRIPTION
  Toolchain used — ONLY what is already installed on the build PC (no global installs, no tauri-cli):
    * rustup / cargo (stable, x86_64-pc-windows-msvc host)   * VS Build Tools 2022 "Desktop C++" (MSVC linker + Windows SDK)
    * WebView2 Runtime (only needed to RUN the smoke test, not to build)
  tauri-cli is NOT needed: there is no installer/bundle, so this is a plain `cargo build --release` of the Tauri app
  (the `custom-protocol` feature in Cargo.toml makes that a production build). Crates are fetched by cargo into
  the normal cargo cache and compiled into apps\player-host\target\ (git-ignored). Node is NOT required unless you
  pass -SampleHtml (even then the sample exe is assembled by this script itself, in PowerShell).

  Run from anywhere:
      powershell -ExecutionPolicy Bypass -File apps\player-host\scripts\build-windows.ps1
  Optional smoke artefact (player + an exported .html → a runnable game exe, same footer as the exporter):
      powershell -ExecutionPolicy Bypass -File apps\player-host\scripts\build-windows.ps1 -SampleHtml "C:\path\雾渡-v1.html"

  Output (copy BOTH files back to the author box):
      <repo>\dist\player\btg-player-windows-x64.exe        the bare player (MZ, no footer)
      <repo>\dist\player\btg-player-windows-x64.json       {version, hostApiVersion, sha256, size, builtAt, rustc}
      <repo>\dist\player\sample-<name>.exe                 only with -SampleHtml
#>
[CmdletBinding()]
param(
  [string]$SampleHtml = '',
  [switch]$Clean
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$HostApiVersion = 1             # must equal HOST_API_VERSION in src/payload.rs and play-runtime host-api.ts
$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$RepoRoot   = Resolve-Path (Join-Path $ProjectDir '..\..')
$OutDir     = Join-Path $RepoRoot 'dist\player'
$OutExe     = Join-Path $OutDir 'btg-player-windows-x64.exe'
$OutMeta    = Join-Path $OutDir 'btg-player-windows-x64.json'
$Target     = 'x86_64-pc-windows-msvc'

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found on PATH. $hint" }
}

Write-Host "== btg-player build ==" -ForegroundColor Cyan
Need 'cargo'  'Install Rust via rustup (stable, MSVC host).'
Need 'rustc'  'Install Rust via rustup (stable, MSVC host).'
$rustcV = (& rustc -V).Trim()
$hostTriple = ((& rustc -vV) | Where-Object { $_ -like 'host:*' }) -replace 'host:\s*', ''
Write-Host "rustc : $rustcV ($hostTriple)"
if ($hostTriple -ne $Target) {
  throw "Expected an MSVC x64 host toolchain ($Target), got '$hostTriple'. Use: rustup default stable-$Target (no install needed if already present)."
}
if (-not (Get-Command 'link.exe' -ErrorAction SilentlyContinue)) {
  # cargo finds MSVC through vswhere even when link.exe is not on PATH; this is only a hint.
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) { Write-Warning 'vswhere.exe not found — make sure VS Build Tools 2022 (Desktop C++) is installed.' }
}

Push-Location $ProjectDir
try {
  if ($Clean) { & cargo clean; if ($LASTEXITCODE) { throw 'cargo clean failed' } }
  $lockArgs = @(); if (Test-Path 'Cargo.lock') { $lockArgs = @('--locked') }
  Write-Host "cargo build --release $lockArgs (in $ProjectDir)"
  & cargo build --release @lockArgs
  if ($LASTEXITCODE) { throw "cargo build failed ($LASTEXITCODE)" }
} finally { Pop-Location }

$Built = Join-Path $ProjectDir 'target\release\btg-player.exe'
if (-not (Test-Path $Built)) { throw "Build finished but $Built is missing" }
$bytes = [IO.File]::ReadAllBytes($Built)
if ($bytes.Length -lt 2 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { throw 'Built file is not a PE (no MZ header)' }
$tail = [Text.Encoding]::ASCII.GetString($bytes, [Math]::Max(0, $bytes.Length - 52), [Math]::Min(8, $bytes.Length))
if ($tail -eq 'BTGPKG01') { throw 'Built player already ends with a BTGPKG01 footer — refusing (exporter would reject it)' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $Built $OutExe -Force
$version = ((Select-String -Path (Join-Path $ProjectDir 'Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value)
$sha = (Get-FileHash -Algorithm SHA256 $OutExe).Hash.ToLowerInvariant()
$meta = [ordered]@{
  version        = $version
  hostApiVersion = $HostApiVersion
  sha256         = $sha
  size           = (Get-Item $OutExe).Length
  builtAt        = (Get-Date).ToUniversalTime().ToString('o')
  rustc          = $rustcV
  target         = $Target
}
# UTF-8 without BOM (the server JSON.parse()s it)
[IO.File]::WriteAllText($OutMeta, ($meta | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Write-Host "player : $OutExe  ($($meta.size) bytes, sha256 $sha)" -ForegroundColor Green
Write-Host "meta   : $OutMeta"

if ($SampleHtml) {
  # Same layout as apps/server/src/modules/exports/domain/exe-trailer.ts:
  #   [player][payload][ "BTGPKG01" | u64 LE length | sha256 raw (32) | u32 LE hostApiVersion ]
  $payload = [IO.File]::ReadAllBytes((Resolve-Path $SampleHtml))
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($payload)
  $name = [IO.Path]::GetFileNameWithoutExtension($SampleHtml)
  $sample = Join-Path $OutDir ("sample-$name.exe")
  $fs = [IO.File]::Create($sample)
  try {
    $w = New-Object IO.BinaryWriter($fs)
    $w.Write($bytes); $w.Write($payload)
    $w.Write([Text.Encoding]::ASCII.GetBytes('BTGPKG01'))
    $w.Write([UInt64]$payload.Length)       # BinaryWriter is little-endian
    $w.Write($hash)
    $w.Write([UInt32]$HostApiVersion)
    $w.Flush()
  } finally { $fs.Dispose() }
  Write-Host "sample : $sample (double-click to play)" -ForegroundColor Green
}
