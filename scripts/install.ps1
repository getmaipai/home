<#
  MaiPai Home installer for Windows. Installs the latest tagged release
  (never `main` - "the hub deploys from the latest release tag, not from
  main, so main can break without breaking the house") into a fixed
  machine-wide location, registers it as a Windows service so it runs
  without anyone logged in, and starts it.

  Windows has no native way to run an arbitrary console process (like
  `bun run start`) as a real service - it has to speak the Service
  Control Manager protocol, which nothing here does. Rather than hand-
  roll that (CLAUDE.md's "prebuilt over hand-built": a maintained library
  for a solved problem beats hand-rolled logic doing the identical job),
  this uses WinSW (https://github.com/winsw/winsw, MIT), a small,
  actively maintained wrapper built for exactly this. Downloaded once,
  pinned to a specific version, and checksum-verified before use - the
  same "pinned version, pinned URL, checksum verified" pattern this
  project already uses for every other on-demand third-party download
  (CLAUDE.md's "Third-party code and assets").

  Usage (elevated PowerShell):
    irm https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.ps1 | iex

  Idempotent: re-running upgrades an existing install in place (stop,
  replace the source tree, keep data/backups untouched, restart).
#>

$ErrorActionPreference = 'Stop'

$Repo = 'getmaipai/home'
$InstallRoot = 'C:\ProgramData\MaiPai Home'
$ServiceName = 'MaiPaiHome'
$AppPort = if ($env:MAIPAI_PORT) { [int]$env:MAIPAI_PORT } else { 3000 }

# Pinned to a specific WinSW release, verified by hash below - never
# "latest", so an upstream compromise or a bad release there can't
# silently change what this installer runs as SYSTEM.
$WinSwVersion = 'v2.12.0'
$WinSwUrl = "https://github.com/winsw/winsw/releases/download/$WinSwVersion/WinSW-x64.exe"
$WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw 'This installer registers a Windows service and must run from an elevated (Administrator) PowerShell.'
  }
}

# GitHub's own public release API, no auth - the org standard's one
# periodic outbound call, mirrored here at install time the same way
# backend/src/lib/updates.ts checks it after install (docs/dev/
# session-f.md's step 10). Run once per install/upgrade, never in a
# loop, so no rate limiter is needed at this single call site.
function Get-LatestTag {
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ Accept = 'application/vnd.github+json' }
  } catch {
    throw "Could not find a published release for $Repo yet - there is nothing to install (this project has not cut v0.1.0 yet)."
  }
  return $release.tag_name
}

# Finds a free TCP port starting at the requested one, so a box that
# already has something on 3000 gets a working install instead of a
# service that fails to bind.
function Find-FreePort([int]$Start) {
  $port = $Start
  $tries = 0
  while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    $tries++
    if ($tries -ge 50) { throw "Could not find a free port near $Start after 50 tries." }
    $port++
  }
  return $port
}

function Ensure-Bun([string]$BunHome) {
  $bunExe = Join-Path $BunHome 'bun.exe'
  if (Test-Path $bunExe) { return $bunExe }
  Write-Host "Installing the Bun runtime to $BunHome..."
  New-Item -ItemType Directory -Force $BunHome | Out-Null
  $env:BUN_INSTALL = $BunHome
  Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
  if (-not (Test-Path $bunExe)) { throw "Bun install did not produce $bunExe" }
  return $bunExe
}

function Fetch-ReleaseSource([string]$Tag, [string]$Dest) {
  Write-Host "Fetching $Repo@$Tag..."
  $tmp = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $archive = Join-Path $tmp 'src.zip'
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/tags/$Tag.zip" -OutFile $archive
    Expand-Archive -Path $archive -DestinationPath $tmp -Force
    # GitHub's zip wraps everything in one top-level "<repo>-<tag>" dir.
    $inner = Get-ChildItem -Path $tmp -Directory | Where-Object { $_.Name -ne '__MACOSX' } | Select-Object -First 1
    New-Item -ItemType Directory -Force $Dest | Out-Null
    Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $Dest -Recurse -Force
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

function Sync-Upgrade([string]$NewSrc, [string]$Dest) {
  # robocopy /MIR mirrors NewSrc into Dest, deleting anything Dest has
  # that NewSrc doesn't (a file the new release removed) - but data/,
  # backups/, and received-backups/ (lib/paths.ts's own layout, direct
  # children of the install root, siblings of backend/) are real runtime
  # state, never part of a release archive, and must never be deleted
  # just because a fresh checkout doesn't have them. /XD excludes them
  # from the mirror entirely, in both directions.
  & robocopy $NewSrc $Dest /MIR /NFL /NDL /NJH /NJS `
    /XD (Join-Path $Dest 'data') (Join-Path $Dest 'backups') (Join-Path $Dest 'received-backups') | Out-Null
  # robocopy's success exit codes are 0-7, not just 0.
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed while syncing the upgrade (exit $LASTEXITCODE)." }
}

function Build-App([string]$Dir, [string]$BunExe) {
  Write-Host 'Installing dependencies and building the frontend (this can take a minute)...'
  Push-Location (Join-Path $Dir 'backend')
  & $BunExe install --production
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'backend bun install failed.' }
  Pop-Location
  Push-Location (Join-Path $Dir 'frontend')
  & $BunExe install
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'frontend bun install failed.' }
  & $BunExe run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'frontend build failed.' }
  Pop-Location
}

function Ensure-WinSw([string]$Dir) {
  $exe = Join-Path $Dir 'winsw.exe'
  if (Test-Path $exe) { return $exe }
  Write-Host 'Fetching WinSW (the Windows service wrapper)...'
  Invoke-WebRequest -Uri $WinSwUrl -OutFile $exe
  $actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash
  if ($actual -ne $WinSwSha256) {
    Remove-Item $exe -Force
    throw "WinSW download failed its checksum check (expected $WinSwSha256, got $actual) - refusing to install a service wrapper that doesn't match what this installer pinned."
  }
  return $exe
}

function Install-Service([string]$Dir, [string]$BunExe, [int]$Port) {
  $winswExe = Ensure-WinSw $Dir
  $configPath = Join-Path $Dir 'maipai-home-service.xml'
  $logDir = Join-Path $Dir 'data\logs'
  New-Item -ItemType Directory -Force $logDir | Out-Null
  $backendDir = Join-Path $Dir 'backend'

  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    & $winswExe stop $configPath 2>$null | Out-Null
    & $winswExe uninstall $configPath 2>$null | Out-Null
  }

  [xml]$config = New-Object System.Xml.XmlDocument
  $config.LoadXml(@"
<service>
  <id>$ServiceName</id>
  <name>MaiPai Home</name>
  <description>MaiPai Home - your private family AI hub.</description>
  <executable>$BunExe</executable>
  <arguments>run start</arguments>
  <workingdirectory>$backendDir</workingdirectory>
  <env name="NODE_ENV" value="production"/>
  <env name="PORT" value="$Port"/>
  <logpath>$logDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="5 sec"/>
  <resetfailure>1 hour</resetfailure>
</service>
"@)
  $config.Save($configPath)

  & $winswExe install $configPath
  if ($LASTEXITCODE -ne 0) { throw 'WinSW service install failed.' }
  & $winswExe start $configPath
  if ($LASTEXITCODE -ne 0) { throw 'WinSW service start failed.' }
}

function Main {
  Assert-Admin
  $tag = Get-LatestTag
  $port = Find-FreePort $AppPort
  if ($port -ne $AppPort) { Write-Host "Port $AppPort is already in use - using $port instead." }

  $upgrading = Test-Path $InstallRoot
  if ($upgrading) {
    Write-Host "Existing install found at $InstallRoot - upgrading to $tag."
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
      $winswExe = Join-Path $InstallRoot 'winsw.exe'
      $configPath = Join-Path $InstallRoot 'maipai-home-service.xml'
      if (Test-Path $winswExe) { & $winswExe stop $configPath 2>$null | Out-Null }
    }
    $newSrc = "$InstallRoot.new"
    if (Test-Path $newSrc) { Remove-Item -Recurse -Force $newSrc }
    Fetch-ReleaseSource $tag $newSrc
    Sync-Upgrade $newSrc $InstallRoot
    Remove-Item -Recurse -Force $newSrc
  } else {
    Fetch-ReleaseSource $tag $InstallRoot
  }

  $bunHome = Join-Path $InstallRoot '.bun'
  $bunExe = Ensure-Bun $bunHome
  Build-App $InstallRoot $bunExe
  Install-Service $InstallRoot $bunExe $port

  Write-Host ''
  Write-Host "MaiPai Home $tag is installed and running at http://localhost:$port"
  Write-Host 'Open that address in a browser to finish setup.'
}

Main
