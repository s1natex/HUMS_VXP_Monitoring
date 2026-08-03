# build-package.ps1 — builds "HUMS VXP Monitoring Install.exe" into .\Package
#
# Run this after any app change (works in Windows PowerShell 5.1 and PowerShell 7):
#     powershell -ExecutionPolicy Bypass -File .\Package\build-package.ps1
#
# What it does, every time:
#   1. Reads the version from app\frontend\package.json (bump it there first).
#   2. Builds the renderer with Vite (app\frontend\dist).
#   3. Stages a self-contained app folder (Electron runtime + app code + Python
#      scripts) into Package\build\staging — no electron-builder involved.
#   4. Downloads a portable NSIS into Package\tools on first run (no admin).
#   5. Compiles Package\installer.nsi → Package\HUMS VXP Monitoring Install.exe,
#      replacing the previous installer.
#
# The produced installer creates/updates <Desktop>\HUMS VXP Monitoring\ and
# NEVER touches the data\ folder inside it (see installer.nsi).

$ErrorActionPreference = 'Stop'

$PackageDir  = $PSScriptRoot
$RepoRoot    = Split-Path $PackageDir -Parent
$FrontendDir = Join-Path $RepoRoot 'app\frontend'
$SourceDir   = Join-Path $RepoRoot 'app\source'
$BuildDir    = Join-Path $PackageDir 'build'
$StagingDir  = Join-Path $BuildDir 'staging'
$ToolsDir    = Join-Path $PackageDir 'tools'

$NsisVersion = '3.11'
$NsisUrl     = "https://downloads.sourceforge.net/project/nsis/NSIS%203/$NsisVersion/nsis-$NsisVersion.zip"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# ── 1. Version ────────────────────────────────────────────────────────────────
$pkg     = Get-Content (Join-Path $FrontendDir 'package.json') -Raw | ConvertFrom-Json
$Version = $pkg.version
Step "Packaging HUMS VXP Monitoring v$Version"

# ── 2. Renderer build ─────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Step 'node_modules missing — running npm install'
    Push-Location $FrontendDir
    try { npm install; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } }
    finally { Pop-Location }
}

Step 'Building renderer (vite build)'
Push-Location $FrontendDir
try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'vite build failed' } }
finally { Pop-Location }

$DistDir = Join-Path $FrontendDir 'dist'
if (-not (Test-Path (Join-Path $DistDir 'index.html'))) { throw "vite build produced no $DistDir\index.html" }

# ── 3. Stage the app ──────────────────────────────────────────────────────────
$ElectronDist = Join-Path $FrontendDir 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $ElectronDist 'electron.exe'))) { throw "Electron runtime not found at $ElectronDist" }

Step 'Staging app folder'
if (Test-Path $StagingDir) { Remove-Item $StagingDir -Recurse -Force }
New-Item -ItemType Directory -Force $StagingDir | Out-Null

# Electron runtime, exe renamed to the app's name (this also flips
# app.isPackaged to true, which switches main.cjs to packaged paths).
Copy-Item "$ElectronDist\*" $StagingDir -Recurse
Rename-Item (Join-Path $StagingDir 'electron.exe') 'HUMS VXP Monitoring.exe'
Remove-Item (Join-Path $StagingDir 'resources\default_app.asar') -ErrorAction SilentlyContinue

# App code → resources\app (electron loads it via package.json "main")
$AppDir = Join-Path $StagingDir 'resources\app'
New-Item -ItemType Directory -Force (Join-Path $AppDir 'electron') | Out-Null
Copy-Item (Join-Path $FrontendDir 'package.json')          $AppDir
Copy-Item (Join-Path $FrontendDir 'electron\main.cjs')     (Join-Path $AppDir 'electron')
Copy-Item (Join-Path $FrontendDir 'electron\preload.cjs')  (Join-Path $AppDir 'electron')
Copy-Item (Join-Path $FrontendDir 'electron\updater.cjs')  (Join-Path $AppDir 'electron')
Copy-Item $DistDir (Join-Path $AppDir 'dist') -Recurse

# Python scripts → resources\source (main.cjs spawns them from there when packaged)
$StagedSource = Join-Path $StagingDir 'resources\source'
New-Item -ItemType Directory -Force $StagedSource | Out-Null
Copy-Item "$SourceDir\*.py" $StagedSource

# ── 4. NSIS: system install if available, else portable download (first run) ──
$MakeNsis = Join-Path $ToolsDir "nsis-$NsisVersion\makensis.exe"
if (-not (Test-Path $MakeNsis)) {
    # A system-wide makensis (e.g. preinstalled on GitHub Actions runners)
    # avoids the SourceForge download entirely. The runners install NSIS but
    # do NOT put it on PATH, so probe the standard locations too.
    $SysNsis = Get-Command makensis -ErrorAction SilentlyContinue
    if ($SysNsis) { $MakeNsis = $SysNsis.Source }
    else {
        foreach ($p in @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe")) {
            if ($p -and (Test-Path $p)) { $MakeNsis = $p; break }
        }
    }
}
if (-not (Test-Path $MakeNsis)) {
    Step "Downloading portable NSIS $NsisVersion (one-time, ~2 MB)"
    New-Item -ItemType Directory -Force $ToolsDir | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $ToolsDir 'nsis.zip'
    $isZip = { param($f) $b = [IO.File]::ReadAllBytes($f)[0..1]; ($b[0] -eq 80 -and $b[1] -eq 75) }
    curl.exe -sL -A 'Mozilla/5.0' -o $zip $NsisUrl
    if (-not (& $isZip $zip)) {
        # SourceForge often serves an HTML landing page first; pull the
        # tokenized mirror link out of it and download that instead.
        $landing = [IO.File]::ReadAllText($zip)
        if ($landing -notmatch 'https://[^"'']*nsis[^"'']*\.zip[^"'']*') {
            throw 'NSIS download failed: no zip and no mirror link on the SourceForge page'
        }
        $direct = $Matches[0] -replace '&amp;', '&'
        curl.exe -sL -A 'Mozilla/5.0' -o $zip $direct
        if (-not (& $isZip $zip)) { throw 'NSIS download failed: response is not a zip file' }
    }
    Expand-Archive $zip $ToolsDir -Force
    Remove-Item $zip
    if (-not (Test-Path $MakeNsis)) { throw "NSIS download/extract failed — expected $MakeNsis" }
}

# ── 5. Installer sidebar bitmap (164x314, app-themed gradient) ────────────────
Step 'Generating installer sidebar bitmap'
New-Item -ItemType Directory -Force $BuildDir | Out-Null
Add-Type -AssemblyName System.Drawing
$SidebarBmp = Join-Path $BuildDir 'sidebar.bmp'
$bmp = New-Object System.Drawing.Bitmap 164, 314, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$rect = New-Object System.Drawing.Rectangle 0, 0, 164, 314
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
    ([System.Drawing.Color]::FromArgb(24, 32, 40)), ([System.Drawing.Color]::FromArgb(38, 84, 126)), 90
$g.FillRectangle($grad, $rect)
$soft = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(14, 255, 255, 255))
$g.FillEllipse($soft, -70, 170, 240, 240)
$g.FillEllipse($soft, 60, -80, 200, 200)
$g.FillEllipse($soft, 110, 120, 120, 120)
$white  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$dimmed = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 255, 255, 255))
$g.DrawString('HUMS VXP',   (New-Object System.Drawing.Font 'Segoe UI', 15, ([System.Drawing.FontStyle]::Bold)), $white, 10, 238)
$g.DrawString('MONITORING', (New-Object System.Drawing.Font 'Segoe UI', 8.5), $dimmed, 12, 268)
$g.Dispose()
$bmp.Save($SidebarBmp, [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

# ── 6. Compile installer ──────────────────────────────────────────────────────
Step 'Compiling installer'
@"
; generated by build-package.ps1 — do not edit
!define APP_VERSION "$Version"
!define STAGING_DIR "$StagingDir"
!define SIDEBAR_BMP "$SidebarBmp"
"@ | Out-File (Join-Path $BuildDir 'version.nsh') -Encoding utf8

& $MakeNsis /V2 (Join-Path $PackageDir 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'makensis failed' }

$Installer = Join-Path $PackageDir 'HUMS VXP Monitoring Install.exe'
$SizeMb    = [math]::Round((Get-Item $Installer).Length / 1MB, 1)
Step "Done: $Installer  (v$Version, $SizeMb MB)"
