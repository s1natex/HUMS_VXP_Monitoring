# HUMS VXP Monitoring — Package Instructions

## Commands

Build / refresh the installer (run from the project root):

```powershell
powershell -ExecutionPolicy Bypass -File .\Package\build-package.ps1
```

Publish a release to GitHub (the in-app auto-updater picks it up on user PCs):

```powershell
powershell -ExecutionPolicy Bypass -File .\Package\publish-release.ps1              # build + publish
powershell -ExecutionPolicy Bypass -File .\Package\publish-release.ps1 -SkipBuild   # publish existing installer
```

Silent install / update (used by the in-app auto-updater):

```
"HUMS VXP Monitoring Install.exe" /S                      # silent, default folder (Desktop)
"HUMS VXP Monitoring Install.exe" /S /D=C:\custom\dir     # silent, custom target (must be last arg, no quotes)
"HUMS VXP Monitoring Install.exe" /S /RELAUNCH /D=C:\dir  # what the in-app updater runs: also restarts the app
```

Silent mode waits up to 60 s for a running app to exit, then exits with code 5.
The install folder is recorded in `HKCU\Software\HUMS VXP Monitoring` → `InstallDir`
(the interactive installer pre-selects it).

## Instructions

**Releasing a new version (auto-update)**

CI path (default — `.github\workflows\release.yml`):

1. Bump the version in `app\frontend\package.json` (the BottomBar label reads
   it at runtime), and add a `## [x.y.z]` section to `app\CHANGELOG.md`
   (used as release notes).
2. Push to `main`. The workflow sees the version has no release yet, builds the
   installer on a Windows runner and publishes GitHub Release `vx.y.z` with the
   repo's own `GITHUB_TOKEN` — no secrets to configure. Pushes that don't
   change the version are no-ops. It can also be run manually from the
   Actions tab (workflow_dispatch), e.g. for the first release.
3. Every installed app offers the update on its next startup — downloads in the
   background, then prompts "Restart & Update". No wizard, `data\` untouched.

Local path (same result, no CI): run `publish-release.ps1` yourself (needs
`gh auth login` once, or `$env:GITHUB_TOKEN`).

The old manual path still works: send users the rebuilt
`Package\HUMS VXP Monitoring Install.exe` and they run it over the same folder.

**Installing (user side)**

1. Double-click `HUMS VXP Monitoring Install.exe`.
2. Choose the install location — default is a folder on the Desktop, but any
   location can be picked.
3. The app launches when the install finishes.

**Updating (user side)**

Run the new installer and pick the same folder — app files are replaced, the
`data\` folder is untouched. Close the app first (the installer will ask if it
is still running).

**Uninstalling (user side)**

Close the app, then run `Uninstall.exe` inside the install folder (it refuses
to run while the app is open — locked files would leave a half-removed folder).
It removes the app files and the desktop shortcut. The `data\` folder is
**always kept** — the uninstaller never touches it; delete it manually if the
data is truly no longer needed.

---

## What the installer does on a user's PC

Shows a folder chooser (default: the user's Desktop, resolved through the
Windows shell so OneDrive-redirected Desktops work automatically — but any
location can be picked) and creates/updates this layout there:

```
<chosen folder>\HUMS VXP Monitoring\
├── HUMS VXP Monitoring.exe     ← the app (double-click to run)
├── resources\, locales\, *.dll ← Electron runtime + app code
├── data\                       ← ALL user data lives here
├── version.txt                 ← installed version (for the future updater)
└── Uninstall.exe               ← removes the app; asks before touching data
```

The finish page offers two checkboxes: launch the app, and create a desktop
shortcut (created only if ticked).

- **Fresh install**: creates the folder, the app, and an empty `data\` folder.
  On first launch the app seeds the baseline data files (fleet registry with
  4X-BHT, signers, limits) — seeding is strictly additive: only missing files
  are created, existing ones are never modified.
- **Update**: running a newer installer over an existing folder replaces only
  the app files. `data\` is **never deleted, overwritten, or read** by the
  installer — the guarantee is structural: `data\` simply isn't in the list of
  paths the update wipes (see `installer.nsi`).
- If the app is running during an update, the installer detects the file lock
  and asks the user to close it first.

## What the build script does

Rebuilds the renderer with Vite, stages a self-contained app (Electron runtime
+ app code + Python scripts) into `Package\build\staging`, stamps the Brook
Aviation icon and version info onto `HUMS VXP Monitoring.exe` with rcedit, and
compiles the installer with a portable NSIS it downloads into `Package\tools`
on first run (no admin rights needed). No electron-builder involved.

The icon is `app\frontend\electron\icon.ico` (tracked in git, generated from
`Resources\assets\brook_aviation_logo_round.png`). It is used for the app
`.exe`, the installer/uninstaller, the desktop shortcut and the app window.
rcedit (`rcedit-x64.exe`) is downloaded once into `Package\tools` from the
`electron/rcedit` GitHub release.

## Requirements on the user's PC

- Windows 10/11, no admin rights needed. That's it — the installer bundles its
  own Python runtime (`resources\python`: official embeddable Python with
  `pdfplumber` + `openpyxl` baked in), so PDF import and Excel export work with
  no user-side setup. If the bundle is ever missing (pre-bundle install), the
  app falls back to the system `py` launcher.

The **build machine** needs a Python with pip on PATH (`py` or `python`) — the
wheels for the bundle are fetched for the embedded interpreter (cp312/win_amd64)
regardless of the build machine's own Python version.

## How the auto-update works (implemented — `app\frontend\electron\updater.cjs`)

The auto-update is NOT the install/uninstall flow — it lives inside the app.
A few seconds after every startup:

1. **Connectivity gate** — `net.isOnline()`; offline machines skip silently.
2. **Release check** — unauthenticated `GET
   api.github.com/repos/<updateRepo>/releases/latest` (the repo in
   `package.json → updateRepo`, must be public), comparing the release tag
   `vX.Y.Z` against the running version.
3. **Download** — a newer release's `.exe` asset is streamed to the OS temp
   folder with a progress banner in the app (bottom-right).
4. **Apply** — the banner prompts "Restart & Update". On confirm the installer
   is started directly (`/S /RELAUNCH /D=<install dir>`) and the app quits; the
   installer waits for the exe to unlock, installs, and relaunches the app.
   `data\` is untouched — same structural guarantee as any update. The
   downloaded installer is removed from temp on the next start.

   No cmd script is involved (v1.0.4). Up to v1.0.3 a `.cmd` script applied the
   update, and cmd garbled non-ASCII install paths — the installer created a
   second app copy at the garbled path (empty `data\`) and started that.
   The v1.0.4+ installer repairs this when it is applied by the old script:
   silent run without `/RELAUNCH`, target has no imports, and the real install
   is known (registry, or `<Desktop>\HUMS VXP Monitoring`) → it installs into
   the real folder and turns the stray copy into a launcher for it
   (`Package\redirect\`, only its `resources\app` is replaced).

The version label in the bottom bar is clickable for a manual check.
Check/download also work in dev mode; applying is packaged-only.

Failure behaviour: offline or API errors on the startup check are silent
(manual checks toast the reason); a failed/truncated download shows Retry and
never reaches the installer; a locked app at install time is retried for up to
a minute by the installer itself.

## Files

| File                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `build-package.ps1`  | One-command build: renderer → staging → compiled installer.    |
| `publish-release.ps1`| Builds + publishes the installer as a GitHub Release (auto-update source). |
| `installer.nsi`      | NSIS source. Owns the install layout and the data-safety rule. |
| `redirect\`          | Tiny launcher the installer drops into a stray (≤ v1.0.3 mis-targeted) app copy. |
| `build\`             | Intermediates (staged app, generated `version.nsh`). Ignored.  |
| `tools\`             | Auto-downloaded portable NSIS and rcedit. Ignored.             |

Possible later polish: code-signing to avoid SmartScreen warnings.
