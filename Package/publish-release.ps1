# publish-release.ps1 — publishes the installer as a GitHub Release, which the
# app's startup auto-updater (electron\updater.cjs) picks up on user machines.
#
#     powershell -ExecutionPolicy Bypass -File .\Package\publish-release.ps1
#     powershell -ExecutionPolicy Bypass -File .\Package\publish-release.ps1 -SkipBuild
#
# What it does:
#   1. Reads version + updateRepo ("owner/repo") from app\frontend\package.json.
#   2. Runs build-package.ps1 (unless -SkipBuild) so the installer matches.
#   3. Extracts this version's section from app\CHANGELOG.md as release notes.
#   4. Creates (or reuses) release tag v<version> on the GitHub repo and uploads
#      the installer as the release asset (space-free name, replacing any
#      previous asset of the same name).
#
# Auth — one of:
#   - GitHub CLI:  winget install GitHub.cli   then   gh auth login
#   - Token:       $env:GITHUB_TOKEN = "<personal access token with repo scope>"
#
# Requirements: the GitHub repo must exist, be PUBLIC (the in-app check is
# unauthenticated) and have at least one commit pushed (releases tag a commit).
#
# Releasing a new version end-to-end:
#   1. Bump the version in app\frontend\package.json (the app displays it at
#      runtime) and add a "## [x.y.z]" section to app\CHANGELOG.md.
#   2. Run this script (or just push — .github\workflows\release.yml runs it).
#      Users get the update banner on their next app start.

param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$PackageDir  = $PSScriptRoot
$RepoRoot    = Split-Path $PackageDir -Parent
$FrontendDir = Join-Path $RepoRoot 'app\frontend'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# ── 1. Version + target repo ──────────────────────────────────────────────────
$pkg     = Get-Content (Join-Path $FrontendDir 'package.json') -Raw | ConvertFrom-Json
$Version = $pkg.version
$Repo    = $pkg.updateRepo
if (-not $Repo) { throw 'updateRepo is not set in app\frontend\package.json (expected "owner/repo")' }
$Tag       = "v$Version"
$AssetName = "HUMS-VXP-Monitoring-Setup-$Version.exe"   # GitHub asset names must not contain spaces
Step "Publishing HUMS VXP Monitoring $Tag to github.com/$Repo"

# ── 2. Build the installer ────────────────────────────────────────────────────
if (-not $SkipBuild) {
    & (Join-Path $PackageDir 'build-package.ps1')
}
$Installer = Join-Path $PackageDir 'HUMS VXP Monitoring Install.exe'
if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer (run build-package.ps1 first)" }

# Stage a copy under the space-free asset name.
$AssetPath = Join-Path $env:TEMP $AssetName
Copy-Item $Installer $AssetPath -Force

# ── 3. Release notes from CHANGELOG ───────────────────────────────────────────
# Grabs the "## [x.y.z]" section for this version, up to the next "## [" line.
$NotesFile = Join-Path $env:TEMP "hums_vxp_release_notes_$Version.md"
$Notes = "HUMS VXP Monitoring $Tag"
$Changelog = Join-Path $RepoRoot 'app\CHANGELOG.md'
if (Test-Path $Changelog) {
    # -Encoding UTF8: Windows PowerShell 5.1 otherwise reads BOM-less UTF-8 as
    # ANSI, mangling em dashes/arrows in the published release notes.
    $lines = Get-Content $Changelog -Encoding UTF8
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^##\s*\[$([regex]::Escape($Version))\]") { $start = $i; break }
    }
    if ($start -ge 0) {
        $end = $lines.Count
        for ($i = $start + 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^##\s*\[') { $end = $i; break }
        }
        $section = $lines[$start..($end - 1)] | Where-Object { $_ -notmatch '^---\s*$' }
        $Notes = ($section -join "`n").Trim()
    } else {
        Write-Warning "No '## [$Version]' section found in CHANGELOG.md - using a generic note"
    }
}
# WriteAllText with BOM-less UTF-8: Out-File -Encoding utf8 in PS 5.1 writes a
# BOM, which gh would pass through as an invisible U+FEFF in the release body.
[IO.File]::WriteAllText($NotesFile, $Notes, [Text.UTF8Encoding]::new($false))

# ── 4. Create the release + upload the asset ──────────────────────────────────
$gh = Get-Command gh -ErrorAction SilentlyContinue

if ($gh) {
    Step 'Using GitHub CLI'
    # gh writes "release not found" to stderr; in PS 5.1 with EAP=Stop a
    # redirected native stderr becomes a terminating error, so relax EAP
    # around the probe (the exit code is what matters).
    $ErrorActionPreference = 'Continue'
    gh release view $Tag --repo $Repo 2>$null | Out-Null
    $ReleaseExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = 'Stop'
    if (-not $ReleaseExists) {
        Step "Creating release $Tag"
        gh release create $Tag --repo $Repo --title "HUMS VXP Monitoring $Tag" --notes-file $NotesFile --latest
        if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
    } else {
        Step "Release $Tag already exists - replacing its asset"
    }
    Step "Uploading $AssetName"
    gh release upload $Tag $AssetPath --repo $Repo --clobber
    if ($LASTEXITCODE -ne 0) { throw 'gh release upload failed' }
}
elseif ($env:GITHUB_TOKEN) {
    Step 'Using GitHub REST API (GITHUB_TOKEN)'
    $Headers = @{
        Authorization = "Bearer $env:GITHUB_TOKEN"
        Accept        = 'application/vnd.github+json'
        'User-Agent'  = 'HUMS-VXP-Monitoring-Publisher'
    }
    $Api = "https://api.github.com/repos/$Repo"

    $release = $null
    try { $release = Invoke-RestMethod "$Api/releases/tags/$Tag" -Headers $Headers -ErrorAction Stop } catch {}
    if (-not $release) {
        Step "Creating release $Tag"
        $body = @{
            tag_name = $Tag
            name     = "HUMS VXP Monitoring $Tag"
            body     = $Notes
        } | ConvertTo-Json
        $release = Invoke-RestMethod "$Api/releases" -Method Post -Headers $Headers `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'
    } else {
        Step "Release $Tag already exists - replacing its asset"
    }

    # Replace an existing asset of the same name (re-publish of the same version).
    foreach ($a in @($release.assets)) {
        if ($a.name -eq $AssetName) {
            Invoke-RestMethod "$Api/releases/assets/$($a.id)" -Method Delete -Headers $Headers | Out-Null
        }
    }

    Step "Uploading $AssetName ($([math]::Round((Get-Item $AssetPath).Length / 1MB, 1)) MB)"
    $uploadUrl = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=$AssetName"
    Invoke-RestMethod $uploadUrl -Method Post -Headers $Headers `
        -InFile $AssetPath -ContentType 'application/octet-stream' | Out-Null
}
else {
    throw @'
No GitHub auth found. Either:
  - install the GitHub CLI:  winget install GitHub.cli   then run:  gh auth login
  - or set a token:          $env:GITHUB_TOKEN = "<personal access token with repo scope>"
then re-run this script.
'@
}

Remove-Item $AssetPath, $NotesFile -Force -ErrorAction SilentlyContinue
Step "Done: https://github.com/$Repo/releases/tag/$Tag - apps will offer $Tag on next startup"
