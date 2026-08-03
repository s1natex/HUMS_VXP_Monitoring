# Changelog
**HUMS/VXP Monitoring — Brook Aviation | S-76C++ · App v2.0 Rewrite**

All notable changes are documented here.
Format: `[version] — date — platform`

---

## [1.0.1] — 2026-08-03 — React/Electron

**In-app auto-update via GitHub Releases**, plus the CI pipeline that publishes them. On every startup the app checks `github.com/s1natex/HUMS_VXP_Monitoring` for a newer release, downloads it in the background and prompts *Restart & Update* — the silent installer replaces app files only and `data\` is never touched (now including uninstall).

### Added
- **Auto-updater** (`electron/updater.cjs`): startup flow *connectivity gate (`net.isOnline`) → GitHub `releases/latest` check (tag `vX.Y.Z` vs running version) → streamed download to temp with progress + backpressure + truncation guard → detached apply script* that waits for the app to exit (installer exit code 5 = locked, retried up to a minute), runs the installer `/S /D=<install dir>` and relaunches. Repo slug lives in `package.json → updateRepo`; empty string disables the feature. Check/download failures at startup are silent; manual checks report outcomes as toasts. Dev mode can check/download but never installs.
- **Update UI**: `UpdateBanner.jsx` (bottom-right: download progress with MB counter → *Restart & Update* prompt → error + Retry), pulsing *Checking for updates…* indicator in the BottomBar version slot, and the version label is clickable for a manual check. New IPC: `update:check`, `update:download`, `update:install`, `update:get-state`, `update:event` stream, `app:version`.
- **Release pipeline**: `Package\publish-release.ps1` (builds installer, extracts this version's CHANGELOG section as release notes, creates release `vX.Y.Z` and uploads the asset via `gh` CLI or `GITHUB_TOKEN` REST) and `.github\workflows\release.yml` (windows runner; on push to `main` releases automatically when `package.json`'s version has no release yet — version bump = ship; installs NSIS via choco; built-in `GITHUB_TOKEN`, no secrets).
- **Root `.gitignore`**: keeps `node_modules`, build output, installers (`*.exe` — they ship as release assets), runtime `app/data\` and local `Resources\` out of the public repo.

### Changed
- **Uninstaller never touches data**: the *Also delete the data folder?* prompt was removed — `Uninstall.exe` always keeps `data\` (delete manually if truly unwanted), matching the install/update guarantee.
- **BottomBar version label reads `package.json` at runtime** (`app:version` IPC) instead of a hardcoded string — a release bump is now `package.json` + CHANGELOG only.
- **`build-package.ps1` NSIS resolution**: portable copy → system `makensis` (PATH, then standard install dirs) → SourceForge download, so CI runners and dev machines both build without manual setup.

### Docs
- **`Package/Instructions.md`**: releasing via CI or `publish-release.ps1`, auto-update flow documentation, updated uninstall behaviour.

---

## [1.0.0] — 2026-07-28 — React/Electron

First distributable release: **Windows packaging, installer/updater and uninstaller** under `./Package`, plus first-run data seeding in the app. No changes to monitoring features.

### Added
- **`Package/` build pipeline** (`build-package.ps1`): one command produces `HUMS VXP Monitoring Install.exe` — builds the renderer (Vite), stages a self-contained app (Electron runtime with the exe renamed, app code in `resources\app`, Python scripts in `resources\source`) and compiles the installer with a portable NSIS auto-downloaded into `Package\tools` on first run. No electron-builder, no admin rights. Re-running it replaces the installer with the current `package.json` version — that exe is the whole deliverable for fresh installs *and* updates.
- **Installer** (`installer.nsi`, NSIS/MUI2): modern wizard (welcome → directory → progress → finish) with a per-build generated app-themed sidebar, Segoe UI, DPI-aware. Install target is chosen by the user (default: a `HUMS VXP Monitoring` folder on the Desktop, shell-resolved so OneDrive-redirected Desktops work). Creates the app + `data\` + `version.txt` marker + `Uninstall.exe`; finish page offers *Launch app* and *Create desktop shortcut* (made only if ticked) checkboxes. Updating = running a newer installer over the same folder: app-owned paths are wiped by explicit list and `data\` is **never** touched (structural guarantee). Silent mode for the future in-app auto-updater: `/S [/D=dir]`, exit code 5 when the app is running.
- **Uninstaller**: refuses to run while the app is open (same lock probe as install — prevents half-removed, locked folders), removes app files + desktop shortcut, asks before deleting `data\` (default keep; silent always keeps), and reports leftovers held by other programs (e.g. OneDrive sync) instead of failing silently.
- **First-run data seeding** (`main.cjs ensureDataSeed`, on `app.whenReady`): a fresh or partial `data\` folder gets the baseline files imports depend on — fleet registry seeded with `4X-BHT` (without it every PDF import failed with *Aircraft not found in fleet*), `report_signer.json` (`[]`), `comp_limits_vxp.json` (`{}`), and `imports\`/`reports\` scaffolds for every registered tail. Strictly additive: only missing files are created, existing ones are never modified — an emptied fleet stays empty and removed tails are not resurrected. `report_actions_vxp.json` is deliberately not seeded (missing = built-in defaults vs existing `[]` = user emptied the list, see `actions:load`).

### Changed
- **`main.cjs` packaged path resolution**: `DATA_ROOT` resolves next to the exe when packaged (`data\` beside `HUMS VXP Monitoring.exe`) and `SOURCE_DIR` to `resources\source`; dev mode keeps the repo-tree paths unchanged.

### Docs
- **`Package/Instructions.md`**: build/release commands, user install/update/uninstall instructions, installer behaviour and data-safety rules, silent usage, future auto-update design (startup repo check → download → silent install → restart).
- **Root `README.md`**: project description, quick-use guide for all components, links to all docs.
- **`project_spec.md`**: title → v1.0.0; new §13 Packaging & Distribution.

---

## [0.9.9] — 2026-07-27 — React/Electron

Feature: **multi-file PDF import**. The Import button now accepts several VXP PDFs in one selection; each file is processed exactly as before (auto-routed to its own detected tail, individually validated and deduped) and the valid ones import while any bad ones are skipped without aborting the batch.

### Added
- **Multi-select import** (`main.cjs import:pdf`): the file dialog opens with `multiSelections`, and the former single-file body is refactored into a reusable `importOnePdf()` that *returns* an outcome instead of aborting the handler. Selected PDFs are processed **sequentially** (so two files targeting the same tail/date still merge correctly through the existing session-level dedup + duplicate guard), and the handler returns an aggregate `{ ok, results[], tails, imported, skipped, failed, totalDates, totalIncidents }`. Progress events now carry `fileIndex`/`fileCount` and an overall batch percentage.
- **Import Results popup** (`ImportResultsModal.jsx`): after a multi-file import, a modal lists every file that was **Skipped** (duplicate / already-imported / no new sessions) or **Failed** (unknown/ambiguous tail, no sessions, parse/save error) with its reason. Shown only when something was skipped or failed; a fully clean batch just shows the success toast. A single-file import keeps its original friendly wording and behaviour.

### Changed
- **`App.jsx handleImport`**: handles the aggregate result — batch progress label (`File i/N — …`), summary toast, and `refreshTailData` now runs for **every** affected tail rather than a single one.
- **`preload.cjs`**: updated the `importPdf` return-shape documentation.

### Docs
- **`project_spec.md`**: title → v0.9.9; documents multi-file import and the ImportResultsModal.

---

## [0.9.7] — 2026-07-23 — React/Electron

Deep code + logic review of `./app/` (renderer, Electron main process, Python backend) — 2 correctness fixes, no new features. Reviewed main.cjs, preload.cjs, every renderer component and util, and import_vxp.py / trend_detection.py / export_excel.py.

### Fixed — renderer
- **Restore Data could silently destroy a tail's restored custom limits** (`TailModal.jsx finalize`): re-adding a removed custom-limits tail with *Yes, Restore Data* moves the backed-up `custom_limits.json` back into the tail directory — and then the save step immediately overwrote that file with the modal's own `customLimits`, which is an empty `{}` on a fresh add unless the user re-entered every limit by hand. The restore's only copy of the tail's per-component custom limits was wiped, and the fleet-registry entry was written with `customLimits: {}` to match, so every view silently fell back to global limits. On the restore path with nothing configured in the modal, the freshly restored file is now loaded and adopted (written back unchanged and carried into the registry item), so `limitsForTail`'s registry fallback agrees with disk before the tail is ever opened. Explicitly configured limits still win — only the empty default no longer clobbers a restore.
- **A pending tail select could override the user's next navigation** (`App.jsx`): `handleTailSelect` applies the actual switch on a 500ms delayed timer (the spinner beat), but no other navigation handler cancelled that timer — clicking a fleet card (or a tail in the TopBar dropdown) and then, inside that window, clicking Recent Imports / Default Page / a view button let the stale tail select fire *after* the navigation and yank the app to that tail's dashboard the user had already navigated away from. All navigation handlers now cancel the pending tail select first (last click wins), including the early-return paths, where the cancel also clears the `loading` flag the pending select had set — otherwise those paths (which show no spinner of their own) would have stranded the overlay on forever.

### Docs
- **`project_spec.md`**: title → v0.9.7; TailModal row documents the restore-path custom-limits adoption.

---

## [0.9.6] — 2026-07-21 — React/Electron

Deep code + logic review of `./app/` (JS, Electron main process, and the Python backend) — 1 correctness fix, no new features. Reviewed main.cjs, preload.cjs, every renderer component and util, and import_vxp.py / trend_detection.py / export_excel.py; the codebase held up across five prior review passes and only one real gap remained.

### Fixed — renderer
- **Generate Report modal could be dismissed mid-save** (`Reports.jsx GenerateReportModal`): a backdrop click or Cancel while *Generate & Sign* was writing the compiled report to disk unmounted the modal — a failed `generateReport()` call then had nowhere to surface its inline error, and the user was left not knowing whether the report was actually saved. Every other modal with an in-flight async save in this codebase (`ExportModal`, `TailModal`, the chart's `SignActionModal`) already blocks closing while saving; `GenerateReportModal` was the one modal missing that guard. Backdrop click and the Cancel button are now both disabled while `generating` is true, matching the established pattern.

### Docs
- **`project_spec.md`**: title → v0.9.6.

---

## [0.9.5] — 2026-07-20 — React/Electron

Code + logic review of `./app/` — 6 correctness fixes, no new features. All imported test data reset to a clean slate (`app/data/`) ahead of import testing.

### Fixed — main process
- **Deleting the last saved action or every fleet tail was reverted on next launch** (`actions:load`, `fleet:load`): both handlers fell back to a NON-null default (`[]` / `{ tails: [] }`) when the JSON file was missing, so the renderer's `data.length` / `data.tails.length` guards could not tell "no file yet" from "file exists and is deliberately empty" — a user who removed their last saved action or their last fleet tail got it silently back on the next app start. Both handlers now return `null` only when the file is genuinely missing; an existing empty file is returned as-is and honoured.
- **`tail:create` and `custom-limits:save` could throw instead of reporting `{ ok:false }`** (`main.cjs`): every other write handler catches its `fs` call and resolves an error object; these two let a write failure (e.g. a locked file, a full disk) reject the IPC invoke instead — `TailModal`'s `.catch(() => {})` on both calls silently swallowed it, so Add Tail / a custom-limit save could fail with zero feedback. Both now follow the same try/catch/`{ ok:false, error }` contract as the rest of the file.

### Fixed — renderer
- **Bootstrap and every tail load fetched import files one at a time** (`App.jsx`): the per-date `date_import_*.json` files were read in a sequential `for` loop with `await` per file, so a tail's load time scaled linearly with its import history — noticeable on fleet preload at startup and on every tail select. Extracted into a shared `fetchTailData()` that fetches a tail's import files in parallel via `Promise.all`, used by bootstrap, tail select, and `refreshTailData` alike (also collapses three near-identical load blocks into one).
- **A failed background refresh could throw as an unhandled rejection** (`App.jsx refreshTailData`): callers like `handleAddTail` don't await this helper, and a per-file load failure previously rejected out of the loop with no catch — now caught and logged; the existing cache is kept and the next tail select reloads from disk.
- **Export modal's generated-reports list could show the wrong tail** (`ExportModal.jsx`): switching the tail dropdown while the previous tail's `syncGeneratedReports` call was still in flight let the stale response land after the new one and clobber the list (and the preselected report) with the wrong tail's data. Guarded with an alive-flag cleanup, same pattern the deep-link effects in `Reports.jsx` already use — `Reports.jsx`'s own generated-reports load picked up the same guard for consistency (its version only race-loses on an unusually fast tail switch, but the fix is free).

### Docs
- **`project_spec.md`**: title → v0.9.5; `actions:load` / `fleet:load` / `tail:create` / `custom-limits:save` IPC rows document the `null`-vs-empty distinction and the normalized error contract.

---

## [0.9.3] — 2026-07-19 — React/Electron

Code + logic review of `./app/` — 6 correctness fixes, no new features.

### Fixed — main process
- **Deleted dates were unrecoverable from their own PDF** (`import:pdf` duplicate guard): a multi-date PDF stamps its hash onto *every* date file it writes, so after one of those dates was removed (`imports:delete`) the surviving files still matched the hash and the blanket duplicate block made the deleted date impossible to re-import — the only source of that data was rejected with "already been imported". The guard now collects the session ids on disk and only blocks when **every** session the PDF carries is still present (session ids are deterministic, so a re-parse reproduces them); otherwise the import proceeds and the session-level dedup merges back just the missing sessions.

### Fixed — renderer
- **Sign Action modal could be dismissed mid-save** (`Charts.jsx SignActionModal`): a backdrop click, Cancel or Go to Reports while *Apply & Sign* was persisting unmounted the modal — a failed save then had nowhere to surface its inline error and the user walked away believing the date was signed. Closing and navigation are now blocked while saving (same guard as ExportModal / TailModal).
- **Custom-limit edits never synced the fleet-registry copy** (`App.jsx handleSaveLimit`): editing a limit on a custom-limits tail wrote `custom_limits.json` and the in-memory cache but left `customLimits` in the fleet registry stale forever. `limitsForTail` falls back to that registry copy for tails whose file hasn't been loaded yet (fresh app start before the tail is opened), so fleet cards and TopBar incident dots coloured statuses from the outdated limits until a tail select. The registry entry (and its JSON file) now updates alongside the limits file.
- **A failed cache refresh reported a successful import as failed** (`App.jsx handleImport`): `refreshTailData` runs inside the import's try-block, so a refresh hiccup after the files were already saved produced the red "import failed" progress message — and a retry then hit the duplicate guard. The refresh is now fault-isolated; the caches reload on the next tail select anyway.
- **Export modal date range could stay empty forever** (`ExportModal.jsx`): the range initialises from the tail's import span, but the initialiser effect only re-runs on tail change — opening the modal while the app bootstrap was still loading that tail's imports left From/To blank ('' span at mount) with no path back except picking dates by hand. A late-fill effect now populates the range when the dates arrive, without clobbering user-picked values.
- **Selected components could get trapped checked-but-disabled** (`ExportModal.jsx` charts kind): narrowing the date range after selecting a component could drop it to 0 points in range — the checkbox disabled while still checked, impossible to uncheck, and the export then errored (or silently skipped it). Only *unchecked* empty comps are disabled now, so an emptied selection can always be unchecked.

### Docs
- **`project_spec.md`**: title → v0.9.3; `import:pdf` IPC row documents the missing-session bypass of the duplicate guard.

---

## [0.9.2] — 2026-07-15 — React/Electron

Pre-deployment code + logic review of `./app/` — 6 correctness fixes, no new features.

### Fixed — main process
- **Duplicate-PDF guard forgot merged originals** (`import:pdf`): merging a second PDF's sessions into an existing date file overwrote that file's `source_file`/`source_hash` with the newest PDF's identity, so re-importing the ORIGINAL PDF was no longer detected as a duplicate (it re-ran as a silent no-op import). Merged date files now accumulate every contributing PDF's hash in `source_hashes`, and the guard checks it.
- **Incidents could be recorded into an invisible tracker** (`scanImportForIncidents`): a corrupt/legacy tracker file missing `comp_key` accepted new entries but is filtered out of `reports:list-components`, hiding every incident written into it forever. The scan now heals `comp_key`/`tail` on such trackers before writing.

### Fixed — renderer
- **Generated reports listed dates out of order** (`reportStore.js generateReport`): compiled entries followed tracker insertion order (scan order), so a backfilled older-dated PDF import produced a formal Incident Report document with mixed date order. Entries are now compiled chronologically per component; `latest_action` derives from the last entry after the sort.
- **Reports detail rows out of date order after backfill** (`Reports.jsx ComponentDetail`): entry rows rendered in tracker insertion order for the same reason — now sorted newest-first by date.
- **Export modal could be dismissed mid-export** (`ExportModal.jsx`): a backdrop click (or Cancel) while an export ran unmounted the modal — the in-flight IPC call kept running with no owner, its inline error was silently lost, and React warned on the orphaned setState. Backdrop close and Cancel are now blocked while exporting (same guard as TailModal's saving state).
- **Import completion message counted unsaved dates** (`App.jsx handleImport`): the "Done — N date(s) saved" toast used `result.dates` (every date in the PDF), so an overlap import that wrote nothing still claimed dates were saved. Now counts `result.files` (date files actually written) and reads "no new sessions (already imported)" when zero.

### Docs
- **`project_spec.md`**: title → v0.9.2; `import:pdf` IPC row documents the `source_hashes` duplicate guard; §4.3 chronological report compilation; §9 Reports row notes newest-first entry rows.
- **`Reports.jsx`**: stale GenerateReportModal comment claimed the signer is "stamped onto every included tracker" — corrected to the actual model (signer recorded only on the generated document).

---

## [0.9.1] — 2026-07-14 — React/Electron

Full code + logic review of `./app/` — 9 correctness fixes, no new features.

### Fixed — renderer
- **Dashboard Limits pie coloured the wrong slices** (`Dashboard.jsx`): colours were assigned by position *after* zero-value categories were filtered out of the pie, so e.g. with 0 Normal comps the Caution slice rendered green and Critical rendered amber. Each datum now carries its own colour.
- **Purge left stale pending actions on screen** (`App.jsx handlePurgeComp`): `main.cjs` deletes the purged comp's tracker on disk, but the in-memory `componentReportsByTail` cache kept it — Reports and the Dashboard Actions widget kept showing the purged comp's actions until a full reload. The cache now drops the tracker too.
- **Reports detail pane showed stale entries** (`Reports.jsx ComponentDetail`): the local `entries` copy was taken once at mount (the `key` only remounts on comp switch), so a PDF import scanned while Reports was open refreshed the trackers without the open detail ever showing the new/refreshed entries. Local state now re-syncs when the tracker prop changes (no-op after the pane's own saves).
- **Redirected signed entries never scrolled into view** (`Reports.jsx`): the `↩ FROM CHART` scroll effect fired before the parent switched to the Signed tab, so the target row wasn't rendered yet and the effect never re-fired. The effect now also fires on tab change.
- **Restored tail cards read "No Imports Yet"** (`App.jsx handleAddTail`): re-adding a tail with *Yes, Restore Data* updated only the fleet registry — imports/trackers weren't loaded into the caches until the tail was opened. New shared `refreshTailData(tail)` helper (also replaces the duplicated reload block in `handleImport`) loads them on add.
- **Chart scroll snapped away after signing from the chart** (`ComponentChart.jsx`): the scroll-to-latest layout effect re-ran whenever the data pipeline rebuilt — which includes tracker-entry changes — so Apply & Sign on an older (scrolled-to) incident point jumped the chart back to the right edge. Auto-scroll is now keyed to (comp, range, highlight) and ignores data-only rebuilds.

### Fixed — main process
- **Incident scan judged only the new PDF's sessions** (`import:pdf`): "the date's latest session" was resolved against the raw PDF object, so a backfill PDF adding an *earlier* session to an already-imported date could overwrite a tracker entry with the older session's reading. The scan now runs on the merged saved import for each date.
- **Purge could delete data before the backup existed** (`purge:comp`): files were modified one-by-one during collection and the backup JSON was written last — a mid-loop failure purged data with no backup, contradicting constraint 5. Restructured to two passes: collect → write backup → then delete.
- **Windows rename collisions broke tail remove/restore cycles** (`moveJsonFiles` + custom-limits moves): `fs.renameSync` throws on Windows when the destination exists, so remove → re-add → import → remove failed outright once `backups/{tail}/` held same-named files (likewise `custom_limits.json` and a pre-existing `generated_reports/`). New `moveFile()` overwrites the stale destination; `generated_reports/` merges file-by-file.

### Fixed — stores
- **Generated-reports ordering inconsistent across restarts** (`reportStore.js syncGeneratedReports`): disk listing is directory order (≈ oldest-first) while in-session generation prepends newest-first — after a restart the Export modal's default radio picked the *oldest* report. Now normalized to newest-first by `created_at`.
- **Report signer name could render "undefined"** (`generateReport`): a signer record without `first` fell through to `signer.name`, which legacy records may lack — falls back to `name` → `last` → `—`.

### Docs
- **`project_spec.md`**: title → v0.9.1; `purge:comp` IPC row notes the backup-before-delete two-pass ordering.

---

## [0.9.0] — 2026-07-13 — React/Electron

### Added — Export (report PDF · charts PDF · Excel data)
- **Export modal** (`components/ExportModal.jsx`): the BottomBar Export button now opens a picker instead of the WIP notice — choose **what** to export (Report PDF / Charts PDF / Data Excel) and **which aircraft** (defaults to the active tail; works from any page). Each kind gets its own controls: a generated-report radio list, a component multi-select + date range, or a date range with a live *N sessions across M dates* summary. Errors surface inline; progress streams into the BottomBar bar (green), success shows a toast with the saved path.
- **Report → PDF** (`utils/exportUtils.js reportToHtml` + `main.cjs export:pdf`): a generated Incident Report renders to a standard **A4 paged document** — the on-screen letterhead (logo · Brook Aviation · report name · tail · range) followed by per-component entry tables. Long reports flow over multiple pages: table headers repeat per page, rows and summary blocks never split mid-element (`@page size: A4` + `printToPDF({ preferCSSPageSize })` in a hidden window).
- **Charts → PDF** (`chartsToHtml` / `renderChartSvg` / `buildChartSegments`): exports static SVG vibration charts for the selected components over a date range — light print theme, status-coloured data points, dashed CAUTION/CRITICAL limit lines with values, thinned date ticks, y-axis in ips. **Cramped charts split automatically**: above 30 data points a component's range is cut into consecutive sub-range charts of the same comp (*Part k/N*, whole dates never split across charts); one chart block per segment, blocks never break across pages.
- **Data → Excel** (`buildExcelPayload` + `main.cjs export:excel` + **`source/export_excel.py`**, new): all sessions in the selected date range (a date may carry several sessions) flatten into a styled workbook modelled on `Resources/prototypes/src_prototypes/pdf_to_excel.py` — navy header row, one banner row per session (date · session № · logs · started/completed), Arial data rows, frozen header. Columns: SESSION · COMP/CONDITION · LOCATION · AVG MEAS · UNIT · CHANGE IN AVG (delta vs the comp's previous session in range) · MAX MEAS · STATUS · DATE · TIME. Highlighting is limit-driven instead of the prototype's hardcoded thresholds: **caution rows yellow, alert rows red** (per the tail's effective limits). Spawned via the same Python pattern as `import:pdf`.
- **View Reports → Export PDF**: the Export button on the generated-report letterhead (`GeneratedReportDoc`) now really exports that report through the same PDF pipeline (was a "coming in a future version" hint); inline saved-path / error feedback.
- **IPC — `export:pdf` / `export:excel`** (`main.cjs`, `preload.cjs exportPdf/exportExcel`): both open a save dialog (cancel-aware); PDF renders the renderer-built self-contained HTML (inline CSS, data-URI logo, inline SVG) in a hidden window; Excel writes the payload to a temp JSON and spawns `export_excel.py`, returning the script's JSON result.

### Docs
- **`project_spec.md`**: title → v0.9.0; §10 Export row → Implemented; §4.3 export note updated.

## [0.8.9] — 2026-07-09 — React/Electron

### Changed — sign actions from the chart
- **Clicking a pending incident data point opens a Sign Action modal** on the Charts view (`SignActionModal` in `Charts.jsx`): entry summary row (date · avg · status/trend pills, same anatomy as the Reports rows) + the shared Action dropdown. **Apply & Sign** persists through the same `saveComponentReport` path as the Reports page (entry-level sign model — tracker `status`/`signed_at` derived via `allEntriesActioned`) and pushes the updated trackers up to App, so the Reports page, the Dashboard Actions widget and the chart's own incident tint/`!` marker update immediately; success toast on save, save errors surface inside the modal.
- **Go to Reports** button in the modal deep-links to the Reports page on that component with the entry marked **redirected-from**: accent ring + `↩ FROM CHART` pill, scrolled into view, and the tab (Actions Pending / Signed Actions) auto-selected to wherever the entry actually lives. The marker clears on any manual navigation (comp select / tab switch).
- **Pending incident dots are clickable affordances** (`ComponentChart.jsx`): pointer cursor + enlarged invisible hit area (r 11); the hover activeDot is `pointerEvents: none` so it can't swallow the click (recharts calls activeDot handlers with the config object, not the point payload); tooltip adds a *Click the point to sign this action* hint under the no-action marker.

### Changed — Dashboard Actions widget
- **One row per component** (latest 3 comps with pending actions, most recently touched first) instead of one row per entry. Row layout: status dot · **comp name · location** · per-comp pending breakdown **`2C|1Cr|3↑`** (Recent Imports notation — caution amber, critical red, up-trend red) · latest pending entry date. Row click still deep-links to that component in Reports.

### Changed — Reports UI
- **Generate Report restyled to the same plain `.btn` as View Reports** (was primary), and both buttons take the filter tabs' shape (border-radius 5, 3px 10px padding); the **Actions Pending / Signed Actions tabs are now `flex: 1`** with the same row padding/gap as the button row, so tabs and buttons render at identical widths — the two rows read as one aligned control block.
- **Generate Report + View Reports moved to the bottom of the component list** (pinned below the scrolling list, border-top).
- **Filter-aware default message when no component is selected**: the detail pane no longer force-selects the first tracker regardless of the tab — the fallback selection must match the active filter, and when nothing matches, a 📋 empty state explains why (no tracked incidents yet / no pending components — all actioned / no signed components yet) with a next-step hint.
- **Report generation is per-entry — signed entries only** (`generateReport` in `reportStore.js`): a component qualifies with **≥ 1 signed (actioned) entry**; only its signed entries are compiled into the report, and pending entries **do not exist for generation until signed** (they stay pending and can go into a later report once actioned). Previously the gate required EVERY entry actioned, so a partially-actioned component blocked entirely.
- **Generate Report modal — component list reconciles with the Signed Actions tab**: the modal now lists (and lets you select) EVERY component with ≥ 1 actioned entry — the same set the Signed Actions tab shows, so its count no longer reads lower than the tab. A partially-actioned row carries an informational amber *N pending* tag (tooltip: only the signed entries will be included); the date range spans signed entries only. Added a **search box** above the list, and the list is compact — it **scrolls after 4 items**.

### Refactor
- **`ActionDropdown` extracted** from `Reports.jsx` into `components/ActionDropdown.jsx` — one implementation shared by the Reports entry rows, the bulk/quick-apply bars and the chart's Sign Action modal.

### Docs
- **`project_spec.md`**: title → v0.8.9; §4.3 sign-from-chart path + redirected-from marker; §9 Dashboard / Reports / ComponentChart rows.

---

## [0.8.7] — 2026-07-08 — React/Electron

### Changed — entry-level sign model (Reports)
- **Applying an action signs that date** — the Sign Off Component button and the per-row Sign Off quick-action are removed. A component whose entries are *all* actioned counts as **Signed** automatically (`allEntriesActioned()` in `reportStore.js`, single definition shared by the UI and the report-generation gate); tracker `status`/`signed_at` are maintained on save.
- **Two filter tabs — Actions Pending (amber) / Signed Actions (green)** — the All tab is removed; the page opens on Actions Pending. Tabs filter **entries as well as components**: Actions Pending shows components with ≥ 1 unactioned entry (only their unactioned entries); Signed Actions shows components with ≥ 1 actioned entry (their actioned entries, read-only, with **Revert Action** select-mode to clear actions back to pending). A partially-actioned component appears in both lists; pending/signed pills removed — the tab defines the state, and pending info never shows inside the Signed view. The Actions Pending tab carries a **count badge** of the tail-wide unactioned entries.
- **Escalation forces re-review** (`main.cjs`): a limit-status escalation on an actioned entry (e.g. caution → alert) now **clears the applied action** (preserved as `prev_action`) so the worse reading drops back to pending — under the entry-derived model this is what keeps it visible and blocks report generation until re-actioned.
- **Generate Report + View Reports side by side** at the top of the component list; **View Reports lists ALL generated reports** for the tail (no longer filtered by the selected component) and each row shows the included **component names**, date range, count and generation time.
- **Optional report name**: new field in the Generate Report modal (≤ 80 chars, stored as `name` on the report JSON, `null` when omitted); shown on the document letterhead and in the report list rows.

### Changed — Charts
- **Incident markers on data points** (`ComponentChart.jsx`): tracker entries are matched to their data point (session_id, falling back to the date's latest session) — incident dots are tinted by status (caution amber / critical red / trend-only red) with a **!** above unactioned ones; the hover tooltip shows the incident label (Caution/Critical/↑ Deteriorating) plus the **applied action**, or a *No action taken yet* marker.
- **See Chart deep-link**: every report entry row has a See Chart button (left of Apply) that opens Charts on that component with the entry's data point **ring-marked**, a dashed marker line beneath it, and the chart scrolled to centre it; any manual pick from the comp list dismisses the marker. `extractCompSeries` points now carry `session_id`.

### Changed — UI polish
- **Action-delete ✕** in the Action dropdown restyled to match the signer dropdown's ✕ exactly.
- **Manage dropdown** (fleet page) closes on any outside click, same pattern as the other dropdowns.

### Fixed
- **Failed tracker saves are no longer silent**: `saveComponentReport` throws on a failed IPC write, the localStorage cache is only updated after a successful disk write (no phantom trackers), and the Reports detail rolls the UI back and shows a Save failed message; staged/apply state is only cleared on success.
- **Tab switches no longer discard staged actions**: the detail pane re-renders instead of remounting when the filter tab changes (selection state resets, staged dropdown choices survive).
- **Dense-chart dot perf preserved**: above 300 points ordinary data points render no DOM nodes again (the incident/highlight markers still draw).
- **Consistent incident colour**: dot, ! marker and tooltip share one `incidentColor()` (was: red dot with amber tooltip for trend-only incidents); tooltip trend label uses `trendLabel()`/`trendArrow()`; date conversions reuse `toSortableDate`.

### Docs
- **`project_spec.md`**: title → v0.8.7; §4.3 entry-level sign model + escalation `prev_action` + report `name` field; §9 Reports/ComponentChart rows; §10 constraint 6 rewritten.

---

## [0.8.6] — 2026-07-07 — React/Electron

### Fixed — trend detection (3-way mirror: `trend_detection.py` / `main.cjs` / `trendDetection.js`)
- **Sharp-reversal veto judged against the fit, not the previous date**: the veto compared the last date's value to the *previous date's* value, so an outlier spike one date earlier read as a "reversal" even when the last value sat exactly on the fitted trend line — e.g. MR VERT 4P's clear uptrend (delta +0.0415, rel +78%, tau 0.6) was vetoed by the 12-04 spike. The veto now uses the last date's **residual from the Theil-Sen fit** (`lastResid ≤ −vetoSize` for up / `≥ +vetoSize` for down); a genuine last-date collapse still cancels the call.

### Changed — incident tracking (action popups)
- **Trend-only incidents require a sustained up-trend**: a tracker entry (pending action) opens on import when the limit status is **caution/critical**, or when the trend classification has been **'up' on ≥ 3 consecutive import dates** (`TREND_STREAK_DATES`, as-of-date trend maps via new `computeSustainedUp`) — a single fresh up call no longer demands an action by itself. Limit hits qualify regardless of trend, and entries are still created only at import time, one per (date, component).
- **Action pick-list is fully user-managed**: hovering an option in the Action dropdown reveals a ✕ that deletes it from the persisted list (`report_actions_vxp.json`, new `removeAction`) — already-applied entries keep their action text. Signers were already deletable; signer identity remains relevant only at report generation (Generate Report modal), never on trackers.

### Changed — UI
- **Recent Imports (widget + page)**: each row now shows **Total: N** — the number of distinct components measured on that date — to the left of the limit/trend indicators (`computeImportSummary` gained a `total` count).
- **`ComponentChart.jsx` — session time labels never mash**: date columns are no longer strictly equal-width — a date keeps a 64 px minimum but widens so every HH:MM session tick gets ≥ 36 px (`PX_PER_SESSION`), so days with many sessions spread out instead of overlapping their time labels. Scroll/zoom behaviour, day dividers, alternating day fills and the trend segment all follow the variable-width columns.
- **`ComponentChart.jsx` — Y axis always visible**: the AVG MEAS (ips) axis is now a pinned overlay outside the horizontal scroll container — it stays on screen at any scroll position while the plot slides underneath; scrolling, wheel and arrow-key behaviour unchanged.

### Docs
- **`project_spec.md`**: title → v0.8.6; §4.3 incident-qualification rule (sustained up-trend streak); §7a reversal-veto description; §9 ComponentChart + Recent Imports rows.

---

## [0.8.5] — 2026-07-06 — React/Electron

### Fixed — trend detection & per-date accuracy
- **`main.cjs` — incident scanning never ran (crash in `computeTrendMap`)**: `classifyTrend` was called with a single argument (the values array) instead of `(dates, values)`, so the trend-map build threw on every import and the whole incident scan silently failed (`Incident scan failed` warning only). Now called correctly — imports create tracker entries again.
- **Recent Imports rows all showed identical ↑/→/↓ counts**: `computeImportSummary` received the tail's *current* trend map for every row. New `computeTrendMapsByDate` computes the trend **as of each import date** (history up to and including that date); each row now reflects its own date. App's `trendMapByTail` is derived from the newest date's map (no duplicate computation).
- **Import summaries used the wrong session**: merged import files store sessions newest-first, so the per-comp "latest" (last-write-wins over array order) actually kept the **oldest** session's value. `computeImportSummary` (and the `import_vxp.py` mirror) now order sessions by `started_at` and count each comp from the date's chronologically latest session.

### Changed — incidents are per (date, component)
- **`main.cjs` `scanImportForIncidents`**: one tracker entry per component per import date — judged on the date's **latest session** — instead of one per (session, component). `entry_id` is now `{date}__{sanitizedCompKey}`; a newer session arriving for the same date refreshes an un-actioned entry in place (entries with an applied action are never touched). Trend snapshot on the entry is computed **as of that import's date** (`computeTrendMap(importDir, asOfDate)`), so older dates in a multi-date PDF no longer inherit today's trend.
- **Legacy tracker migration**: `reports:list-components` / `reports:load-component` collapse old per-session duplicates on first read — each date group keeps its latest session's entry (session ids embed the start timestamp), carrying over an applied action from a discarded duplicate when the kept entry has none.

### Changed — trend detection accuracy (3-way mirror: `trend_detection.py` / `main.cjs` / `trendDetection.js`)
- **Residual-noise gate** (`NOISE_GATE = 2.0`): `|delta|` must clear 2× the MAD of the Theil-Sen fit residuals — the projected change has to exceed the series' own scatter, so jittery-but-flat components no longer produce false trend calls. `detect_trend` results now include `noise`.
- `main.cjs` `theilSenSlope` → `theilSen` (slope **and** intercept, mirroring the other two implementations) to support the residual computation.

### Changed — UI
- **`ComponentChart.jsx`**: removed the on-chart trend badge and its trailing note (↑ DETERIORATING · "~N d to CAUTION/CRITICAL" projection / SHARP DROP text) — the chart keeps only the dashed trend segment; the limit-status and trend tags live in the Charts header pills.
- **`Reports.jsx`**: swapped button positions — **Generate Report** (primary) now sits in the component-detail header; **View Reports** moved to the left-panel slot below the filter tabs (disabled until a component is selected).

### Fixed (code review)
- **`main.cjs` `scanImportForIncidents` — stale incidents survived a clean newer session**: the qualifies-check `continue` ran before the existing-entry lookup, so when a date's latest session no longer breached, the old un-actioned entry was never refreshed or removed. The scan now resolves the existing entry first: still qualifying → refreshed in place; cleared → the un-actioned entry is removed (tracker file deleted when it empties).
- **`main.cjs` `scanImportForIncidents` — escalations were silently swallowed**: an entry with an applied action blocked all updates, so a newer session that *worsened* (e.g. caution → alert) never surfaced and a signed tracker stayed signed. A limit-status escalation now refreshes the snapshot (keeping the applied action) and reopens the tracker to `pending` for re-review.
- **`main.cjs` `scanImportForIncidents` — corrupt tracker aborted the whole scan**: a tracker JSON without an `entries` array threw `TypeError` on `.find`, and the import handler's catch swallowed every incident for the PDF. Now guarded (`entries` coerced to `[]`).
- **`main.cjs` `backup:restore-comp` — legacy-id duplicates on restore**: restore dedups by `entry_id`, but pre-v0.8.5 purge backups carry per-session ids that can't match migrated per-date ids, re-inserting duplicate same-date entries. The merge now runs `collapseTrackerEntries` before writing.
- **`Reports.jsx` — Generate Report could be unreachable**: after the button swap the only Generate button lives in ComponentDetail, which renders only with a selection; trackers load asynchronously, so `selectedKey` could stay `null` forever. `selected` now falls back to the first tracker.
- **`trendDetection.js` `computeTrendMapsByDate` — dates without numeric measurements got no map**: such an import row fell back to all-flat trends. Every import date now gets a map, carrying trends over from the history before it.
- **`main.cjs` — legacy tracker migration moved from the read path to startup**: `collapseTrackerEntries` ran (with a write-back) inside `reports:list-components`/`reports:load-component` on every call forever; now a one-shot `migrateAllTrackers()` pass at `app.whenReady` and the read handlers are read-only again.
- **`main.cjs` — session order normalized at the source**: the `import:pdf` merge now stores sessions chronologically (was newest-first — the root cause consumers had to sort around) and `imports:load` sorts legacy files on read, fixing reverse-chronological session times on Recent Imports rows and the View File session tabs.
- **`main.cjs` — `computeTrendMap` re-read the whole import dir once per date**: multi-date PDFs re-read/parsed every JSON per date; new `loadImportFiles()` reads once and `computeTrendMap` takes the preloaded array.
- **`main.cjs` — reuse/simplification**: shared `toSortableDate` / `newTracker` / `bySessionStart` helpers replace four inline DD-MM-YYYY conversions and duplicated tracker literals; `collapseTrackerEntries` single-pass over the date-group map (dropped the redundant `seen`-Set second pass); `Reports.jsx` dead `selectedKey &&` guard removed.

### Docs
- **`project_spec.md`**: title → v0.8.5; §4.3 tracker schema (per-date entries, startup migration, escalation/clear semantics); §6 `import:pdf` + `imports:load` rows; §7a noise gate, as-of-date trend maps, badge removal; §9 module table.

---

## [0.8.4] — 2026-07-05 — React/Electron

### Added — trend detection (STABLE / RECOVERING / DETERIORATING)
Goal: **anticipate deteriorating components and plan ahead** — the trend signal is an early warning that fires on consistent growth even below limits.
- **`source/trend_detection.py`** (new — reference implementation, with CLI for testing): per component, sessions are aggregated to one value per date (median), a **Theil-Sen** slope (median of pairwise slopes — robust to a single outlier date/session) is fitted over **calendar days** of the last **5** dates (minimum **4** distinct dates, otherwise `stable` / insufficient data; real day spacing weights irregular import schedules correctly), and the projected change across the window is classified against a relative gate (≥ 15% of the window mean) **and** an absolute gate (≥ 0.02 ips), a **Mann-Kendall consistency gate** (|tau| ≥ 0.5 — zigzag series with a small net drift stay stable), and a **sharp-reversal veto** (a last-date move against the trend of ≥ 35% of the projected change cancels the call and is reported via `reversal`) → `up` (Deteriorating) / `down` (Recovering) / `stable`. Mirrored line-for-line in `main.cjs` (`computeTrendMap` + `classifyTrend`, replacing the always-stable `detectTrend()` stub) and in new `src/utils/trendDetection.js` for live UI recomputation — the three carry sync-reminder comments.
- **Indicators now fed by the algorithm** (previously hardcoded `'stable'`):
  - `aggregateCompStatus` carries the real per-comp trend → TopBar tail-dropdown ▲ indicator, Dashboard **TrendsWidget** columns, DefaultPage **TailCard** ↓ → ↑ bubbles, Charts comp-list arrows + ↑/↓/→ trend filters, Charts header trend pill.
  - `computeImportSummary` counts real ↑ / → / ↓ per import → Dashboard Recent Imports widget + Recent Imports page rows.
  - `main.cjs` incident scan stamps `entry.trend` / `entry.reason` from the tail's **full import history** (computed after the new files are saved) — up-trending components now open tracker entries even below limits (`reason: 'trend'` / `'limit+trend'`) → Dashboard ActionsWidget ↑ Deteriorating count, Reports entry ↑ DETERIORATING pills, generated-report Trend column.
  - `import_vxp.py` fills per-session `comps[].trend` + summary via the same module (best-effort within the PDF's own dates; downstream consumers recompute over full history).
- **`ComponentChart.jsx` — chart trend indicator**: dashed Theil-Sen segment drawn across the fitted window (last 5 visible dates) plus a **fixed badge pinned top-left of the chart area** (clear of the Y axis, data and top-right controls — never overlaps chart content). The badge shows ↑ DETERIORATING **with a days-to-limit projection** ("~N d to CAUTION/CRITICAL", extrapolated at the calendar-day slope, capped at 365 d) / ↓ RECOVERING / a sharp-reversal note ("SHARP DROP — up-trend cleared") when a last-date move just broke a qualified trend; hidden when plainly stable so flat charts stay clean.
- **Actions for trend-triggered entries**: tracker entries opened by rising trend while still inside limits no longer show a misleading amber NORMAL pill — they get a neutral grey **IN LIMITS** pill next to the red ↑ DETERIORATING pill; `DEFAULT_VXP_ACTIONS` gained planning actions for the early-warning path (Trend watch — increased monitoring interval · Plan maintenance before limit exceedance · Rotor track & balance).
- **Reports — quick-apply workflow**: new always-visible quick bar on pending components: pick one action and **Set all unactioned** entries in a single click (no select mode), plus **Apply staged (N)** to commit several individually chosen actions in one save. Select-mode bulk apply and per-entry Apply remain.
- **Renderer efficiency**: per-tail trend maps are computed once in App (`trendMapByTail`) and shared by `compStatus`, `compStatusByTail` and the import summaries (previously recomputed by each consumer); `DefaultPage` now reuses App's `compStatusByTail` instead of re-aggregating status for every fleet card.

### Fixed (code review)
- **`main.cjs` — `compLimitStatus` null-threshold false alerts**: thresholds cleared in EditLimitModal are stored as `null`; `avgMeas >= null` coerces to `>= 0`, so a limit like `[0.2, 0.3, null]` flagged **every** measurement as `alert` during incident scanning (renderer and Python guarded correctly — the main process didn't). Each level now null-guarded.
- **`App.jsx` — stuck loading overlay**: re-selecting the already-active tail from Recent Imports or a non-dashboard view set `loading = true` but never changed `activeTail`, so the effect responsible for clearing it never re-ran. Now bumps `reloadTrigger` in that case (also refreshes the tail's data).
- **`main.cjs` — `import:pdf` empty tail suffix**: when the PDF header tail couldn't be detected, the empty suffix matched **every** fleet tail via `endsWith('')` — a single-tail fleet silently imported an unidentified PDF into that tail. Empty suffix is now rejected with a clear error.
- **`App.jsx` — import summaries ignored effective limits**: `computeImportSummary` was called without a limits map (hardcoded `LIMITS`), so Recent Imports N/C/Cr counts disagreed with every other view after a global/custom limit edit, and summaries went stale after purges. Summaries are now derived at render time (`summarizedImportsByTail` memo) from `limitsForTail` + the live trend map.
- **`App.jsx` — ghost data after tail removal**: `handleRemoveTails` left `importsByTail` / `componentReportsByTail` / `customLimitsByTail` cache entries, so re-adding the tail with Start Fresh rendered the archived stats from memory until the tail was opened. Caches now dropped on removal.
- **`main.cjs` — purge left orphaned tracker entries**: `purge:comp` removed a component's measurements but left its incident-tracker entries pointing at deleted data (phantom pending actions), inconsistent with `imports:delete` which strips them. Purge now removes the comp's tracker entries for the purged sessions and snapshots them (incl. applied actions) into the backup; `backup:restore-comp` re-inserts them (deduped on `entry_id`) and reopens the tracker to `pending`.
- **`main.cjs` — `tail:archive-data` skipped `custom_limits.json`**: Start Fresh archived only `imports/` and `reports/`, leaving a stale per-tail limits file that would shadow fresh registry custom limits in `getEffectiveLimits`. Now archived alongside the data.
- **`reportStore.js` — `generateReport` fire-and-forget disk write**: a failed IPC save left the signed report only in the localStorage cache with no feedback. The disk write now happens first and is awaited; on failure nothing is cached and the Generate modal shows the error.
- **`EditLimitModal.jsx` — no range validation**: out-of-order (`lower > caution > critical`) and typed negative values saved fine and produced nonsense statuses. Limits must now be non-negative and ascending among the set values, with an inline error message.
- **`Dashboard.jsx` — ActionsWidget dot always yellow**: entry rows now colour the status dot by `limit_status` (red for critical entries) via `dotClass`.
- **`import_vxp.py` — silent date fallback**: sessions with an unparseable start date were silently reassigned to today's date; now emits a stderr WARNING.
- **`App.jsx` — bootstrap race**: `init()` replaced `importsByTail`/`componentReportsByTail` wholesale, clobbering anything loaded between mount and preload completion; now merges under fresher entries.
- **`TailModal.jsx`**: restore prompt mislabelled the import **file/date** count as "Import sessions" → "Import dates".
- **`App.jsx`**: mock signers are now seeded into localStorage only in browser dev mode (no `electronAPI`) — an Electron first run no longer briefly offers fake AMEs.
- **`DefaultPage.jsx`**: corrected the per-tail stats comment — TailCard trend bubbles count measured comps only, while TrendsWidget's Stable column additionally lists no-data comps.

### Removed (dead code)
- **`main.cjs` / `preload.cjs` — `imports:save` / `saveImport`**: never called from the renderer (imports are written only by `import:pdf`); its merge path could also clobber `source_hash` and defeat the duplicate-PDF guard.
- **`importLoader.js` — `loadImports`**: unused export.
- **`frontend/__test_chart.cjs`**: leftover dev scratch file.

### Docs
- **`project_spec.md`**: title → v0.8.4; new **§7a Trend Detection** (algorithm, constants, mirror locations, consumer list); §6 IPC table (removed `imports:save`, documented purge/restore tracker snapshotting, `tail:archive-data` custom-limits note, `import:pdf` incident/trend behaviour); §9 module table — trend detection ✅ Implemented.

---

## [0.8.2] — 2026-07-03 — React/Electron

### Fixed (code review)
- **`main.cjs` — `imports:list`**: sorted DD-MM-YYYY filenames lexically (`.sort().reverse()`), so import order was wrong across month boundaries (e.g. `30-03` sorted as newer than `13-04`). Dashboard's Recent Imports widget displayed the wrong "recent" files. Now sorts chronologically, newest first.
- **`RecentImportsPage.jsx`**: same lexical DD-MM-YYYY sort on `imp.date`; now converts via `toSortableDate` before comparing.
- **`App.jsx` — cross-tail custom-limit leakage**: a single `editableLimits` (resolved for the *active* tail, including its custom limits) was used to compute status for *every* tail (TopBar incident dots, fleet cards). New `limitsForTail(tail)` resolves each tail's own effective limits; `compStatusByTail` and DefaultPage stats use it.
- **`main.cjs` — incident scan ignored custom limits**: `scanImportForIncidents` always used global limits; `getEffectiveLimits(tail, fleetItem)` now layers the tail's `custom_limits.json` when `limits_mode === 'custom'`, matching the UI.
- **`App.jsx` — stale custom-limits cache**: editing a tail's custom limits in TailModal didn't invalidate `customLimitsByTail` (which takes precedence), so the UI kept old limits until restart; a deleted custom-limits file also left a stale cache entry. Both now invalidate.
- **`main.cjs` — `imports:save`**: merge path appended sessions without `session_id` dedup (unlike `import:pdf`); now deduped.
- **`main.cjs` — IPC input validation**: `imports:*`, `reports:*`, `purge:comp`, `backup:*` accepted unvalidated `tail`/`filename` (path-traversal risk); all now guarded with `isValidTail` + new `isSafeFilename`.
- **`import_vxp.py` — `get_status`**: returned `"ok"` for missing limits / below-lower measurements, disagreeing with the JS `getLimitStatus` (`"white"`). Aligned.

### Changed
- **Reports — action/sign-off flow rework**: the detail-view signer dropdown is removed. Actions are staged per entry and persisted with a new **Apply** button; a **Select** button in the detail header (left of View Reports) toggles multi-select mode — checkboxes, whole-row click selection, plus a bulk bar that applies one action to many entries at once. A **Sign Off Component** button below the entries (enabled once every entry has an applied action) moves the tracker to the Signed category; the component list also shows a per-row **Sign Off** quick-action on eligible pending components, so individual components can be signed off without opening them. On signed components the header button becomes **Revert** — select entries to send back to pending (clears their action, reopens the tracker to `"pending"`). Signer (AME) selection lives only in the Generate Report modal (gated on signed-off components) and is recorded **only on the generated report document** — trackers never store signer identity (`signer_id`/`signer_name` stay `null`) and the tracker list/detail no longer display signer names. Entry trend pill renamed ↑ TREND → ↑ DETERIORATING. Entries render on one row.
- **Recent Imports — one-row entries**: import rows (date · sessions · times · file · badges · buttons) render on a single row.
- **`ComponentChart.jsx`**: chart opens scrolled to the right edge so the latest data is visible by default; mouse-wheel scrolls horizontally, ‹ › arrow buttons (top-right of the chart) and the Left/Right arrow keys scroll ~3 date columns per press (keys are ignored while typing in an input); the Charts header shows a trend pill (↑ Deteriorating / → Stable / ↓ Recovering) next to the limit-status pill; a **Date Range** button (top-right, next to the arrows) opens a from/to picker — default shows all data, an active range is shown on the button (accent-highlighted) with an **← All** button to go back, and the range resets when switching component; the component-list **Manage** button responds to cursor hover; data pipeline memoized (`useMemo`) and component wrapped in `React.memo` so filter/search keystrokes no longer rebuild it.
- **`App.jsx` — nav re-click resets view**: pressing the already-active TopBar button (Charts / Reports / Recent Imports) remounts that view to its default state (e.g. "Select a component") without the loading screen.
- **`Dashboard.jsx` — Actions widget**: fixed at the 3 latest pending entries, no internal scroll; the total (white) now has a Caution / Critical / ↑ Deteriorating breakdown to its right (always coloured amber/red; an entry can count in both a limit bucket and the trend bucket); the per-row "→ Reports" button is removed — the whole row is clickable and responds to the cursor (hover highlight). The Default-page TailCard pending count stays amber.
- **Data reset**: removed `data/4X-BHP/` and `data/backups/`; `report_signer.json` and `report_actions_vxp.json` reset to `[]` (actions fall back to the built-in defaults); `4X-BHP` removed from `DEFAULT_FLEET` (fleetStore) and `tailIndex.js` — fleet is 4X-BHT only.
- **`main.cjs` — `tail:remove-backup`**: backup directory and `removal_{ts}.json` metadata are only created when the tail actually had data; removing an empty tail leaves no trace in `backups/`.
- **`App.jsx`**: repaired double-encoded (mojibake) comment headers; added unmount cleanup for the tail-select timer.
- **`importLoader.js` — `computeImportSummary`**: limit-defined check now uses the same limits map as the status computation (was hardcoded to the static `LIMITS`).

### Removed (dead code)
- **`source/`**: `db.py`, `database_handler.py`, `import_handler.py`, `trend_detection.py`, `export_chart.py`, `export_excel.py`, `export_filter.py`, `export_report.py` — none were referenced; only `import_vxp.py` is spawned.
- **`frontend/src/utils/`**: `scoring.js`, `mockSeries.js` (unimported); `mockData.js` trimmed to `MOCK_SIGNERS` (removed unused `MOCK_IMPORTS` fixtures).
- **`reportStore.js`**: `signComponentReport` (superseded by signing inside `generateReport`).

### Docs
- **`project_spec.md`**: title → v0.8.2; §4.1 file layout (tracker/generated-report filenames, SQLite removed); §4.3 rewritten for the apply-then-sign-at-generation workflow; §6 IPC notes (validation on all channels, chronological `imports:list`, conditional removal metadata); §7 scoring marked legacy; §9 module table refreshed; §10 constraint 6 updated; §12.9/§12.11 updated for removed Python modules.

---

## [0.8.1] — 2026-07-02 — React/Electron

### Fixed (code review — 5 issues)
- **`reportStore.js` — `generateReport`**: was reading component trackers from a `localStorage` cache that App.jsx never populates (App.jsx hydrates React state directly via IPC, bypassing `syncComponentReports`/`setLocalComponentReports`). A component signed in an earlier session — or untouched this session — would be wrongly rejected as "not fully signed off" even though it clearly is. Now fetches trackers via `syncComponentReports` (IPC) instead.
- **`reportStore.js` — `generateReport`**: `latest_action` picked `entries[0]`, assuming tracker entries are always in date order; backfilling an older-dated PDF import after a newer one had already been scanned would surface a stale action. Now derives the chronologically latest entry explicitly.
- **`App.jsx` / `Reports.jsx` — deep-link navigation**: `reportsInitComp` was never cleared after being consumed, so clicking the same Dashboard "pending action" row twice (with a manual reselect in between) silently failed to re-navigate, and the stale component key could leak into a freshly-opened Reports view for a different tail. `Reports` now calls back via `onInitialCompConsumed` to reset it immediately after use.
- **`main.cjs` — `reports:list-components`**: loaded any `.json` file under `data/{tail}/reports/` as a component tracker with no schema check; a stray or legacy-format file would crash the Reports page on `tracker.comp_key.split(...)`. Added a `comp_key` guard.
- **`main.cjs` — `tail:archive-data`**: used its own inline file-move loop instead of the existing `moveJsonFiles` helper, so the `generated_reports/` subdirectory was left behind on "start fresh" (contradicting the helper's own doc comment) and silently caused the source-directory cleanup to fail (`ENOTEMPTY`, swallowed). Now reuses `moveJsonFiles` like `tail:remove-backup`/`tail:restore` already do.

### Changed
- **`data/global/report_signer.json`**: reset to `[]` — cleared test signer ahead of release.
- **`project_spec.md §4.3`**: report file schema section described the old single-file incident-report format; rewritten to document the actual component-tracker + generated-report schemas.
- **`project_spec.md §6`**: IPC surface table's `reports:*` rows were stale (`reports:list/load/save/delete`); replaced with the real channels (`reports:list-components`, `reports:load-component`, `reports:save-component`, `reports:list-generated`, `reports:load-generated`, `reports:save-generated`).

---

## [0.8.2] — 2026-07-01 — React/Electron

### Fixed
- **`ComponentChart.jsx` — chart slider**: `Brush` now only renders when the dataset exceeds 100 data points. Below that threshold all data is shown with no scroll restriction. When shown, `startIndex` starts at 0 so the full range is visible by default (TradingView-style — drag handles inward to zoom).
- **`App.jsx` — `handleDeleteImport`**: report state cleanup no longer depends on `result.reportDeleted`. The matching report filename is now derived directly from `imp._filename` (same logic as the IPC handler) and filtered by `r._filename`, making it reliable regardless of date format.

### Changed
- **`project_spec.md §4.3`**: added note on report backup and planned export behaviour.

---

## [0.8.0] — 2026-06-30 — React/Electron

### Fixed (code review — 6 issues)
- **`main.cjs` — `spawn('python')`**: hardcoded `'python'` replaced with `process.platform === 'win32' ? 'py' : 'python3'`; uses Python Launcher on Windows so imports work regardless of how Python 3 is installed.
- **`fleetStore.js` — `loadFleetFromIPC`**: added `.filter(fi => VXP_ONLY.has(fi.systemType))` — HUMS entries in the on-disk JSON file can no longer slip into the in-memory fleet or be written back to localStorage.
- **`main.cjs` — `import:pdf` sessions guard**: `impToSave.sessions.length` → `(impToSave.sessions ?? []).length`; prevents TypeError and partial disk writes if Python returns an import object without a `sessions` field.
- **`main.cjs` — `actions:load`**: handler signature changed from `() =>` to `(_e) =>` — consistent with every other `ipcMain.handle` callback in the file.
- **`fleetStore.js` — `VXP_ONLY` Set**: hoisted from inside `loadFleet()` to module scope; now shared by both `loadFleet` and `loadFleetFromIPC`.

### Changed
- **`TopBar.jsx`**: inactive nav button text brightened from `#cce0ff` to `rgba(255,255,255,0.88)`.
- **`Reports.jsx`**: filter tabs (`All` / `Default` / `Pending` / `Signed`) now respond to hover — border and text lighten on mouse-over.
- **`Charts.jsx`**: `FilterBtn` and `AllBtn` now respond to hover — background tints, border brightens.
- **`RecentImportsPage.jsx`**: `Select`, `Select All`, `Remove`, `Yes`, `No`, `Cancel` buttons now respond to hover via new `SmBtn` component.

---

## [0.7.9] — 2026-06-29 — React/Electron

### Changed (breaking — HUMS decoupled for VXP 1.0 MVP)
- **`tailIndex.js`**: removed `HUMS_TAILS`, `WIP_TAILS`; fleet reduced to `['4X-BHT', '4X-BHP']`; `tailType()` always returns `'vxp'`; `isWip()` always returns `false`; integration-point comments preserved for re-enable.
- **`fleetStore.js`**: `DEFAULT_FLEET` reduced to the two VXP tails; `loadFleet()` now filters out any entries with `systemType !== 'vxp'` so stale HUMS data in localStorage can never surface in the fleet.
- **`App.jsx`**: removed `humsLimits` state and `api.loadLimits('hums')` from bootstrap; `editableLimits` always resolves from `vxpLimits`; removed dead `tailType` import; removed `activeTail`, `fleetItem`, and `onEditLimit` from `<Dashboard>` call (these props are no longer in Dashboard's signature).
- **`Dashboard.jsx`**: removed `activeTail`, `fleetItem`, `onEditLimit` from props signature (none were used inside the component); removed `const systemType` derivation; `TrendsWidget` always receives all 96 `ALL_COMP_KEYS`.
- **`Charts.jsx`**: removed HUMS early-return guard.
- **`DefaultPage.jsx`**: `TailCard` pill class and label hardcoded to `'blue'` / `'VXP'`.
- **`TopBar.jsx`**: badge hardcoded to VXP blue; removed `isVxp` conditional.
- **`TailModal.jsx`**: `systemType` is now a constant `'vxp'`; removed system selector (`vxp` / `hums` button row) from the form.
- **`EditLimitModal.jsx`**: updated comment — `systemType` comment narrowed from `'vxp' | 'hums' | null` to `'vxp' | null`.
- **`main.cjs`**: `limits:load` / `limits:save` / `actions:load` / `actions:save` hardcoded to VXP files; `import:pdf` removed HUMS branch; dialog title updated to "Select VXP Report PDF"; `limits:load` handler now correctly accepts `(_e, _tailType)` params for API consistency.
- **`preload.cjs`**: updated stale `'vxp' | 'hums'` comment on `loadLimits` to `'vxp'`.
- **`import_handler.py`**: VXP-only dispatch; HUMS branch removed; integration-point comment added.
- **`import_hums.py`**: deleted.
- **`source/__init__.py`**: updated package docstring — notes HUMS decoupling and spec reference.
- **`data/global/tail_number_tags_vxp_hums_index.json`**: fleet registry trimmed to 4X-BHT and 4X-BHP only (system: "vxp").
- **`data/backups/`**: empty HUMS backup directories (4X-BEX, 4X-BHS, 4X-BOA, 4X-BOB, 4X-BOC, 4X-BOI) deleted.

### Added
- **`project_spec.md §12`**: full HUMS re-integration spec — exact code snippets for every decoupled site across all 13 changed files, plus DB schema notes and Python backend restore guide.

---

## [0.7.7] — 2026-06-28 — React/Electron

### Added
- **Global app-level error toast (`App.jsx`)**: a `showAppToast(text, ok)` helper now surfaces IPC errors that were previously swallowed silently. A styled toast renders above the BottomBar (green for success, red for error) and auto-dismisses after 4 s.
- **Charts — purge success toast**: `handlePurge` now shows a "Data purged and backed up for {comp}" toast on success via `showRestoreMsg`.
- **Charts — restore backup loading state**: `ManageModal` receives a new `loadingBackups` prop. While `listCompBackups` IPC is in flight the Restore button reads "Loading backups…" and is disabled; the modal stays open rather than silently freezing.
- **Charts — restore IPC error distinction**: `handleRestoreOpen` now distinguishes an IPC error (shows "Failed to list backups: …") from a true empty result ("No purge backup found…").

### Fixed
- **`handlePurge`**: now checks `result.ok` from the `purge:comp` IPC and shows an error toast instead of silently assuming success.
- **`handleSaveLimit`**: awaits IPC result; shows `appToast` error if `result.ok` is false or call throws.
- **`handleDeleteImport`**: only removes the entry from UI state when the disk delete IPC returns `ok: true`; surfaces error via `appToast` if the file could not be deleted.
- **`handleRemoveTails`**: captures per-tail backup errors and surfaces a warning via `appToast` (removal still proceeds to avoid blocking fleet changes).
- **`main.cjs` — `limits:save`**: wrapped `writeJson` in try/catch; returns `{ ok: false, error }` on failure.
- **`main.cjs` — `imports:save`**: same treatment.
- **`main.cjs` — `reports:save`**: same treatment.
- **`main.cjs` — `signers:save`**: same treatment.
- **`main.cjs` — `actions:save`**: same treatment.
- **`main.cjs` — `fleet:save`**: same treatment.

---

## [0.7.6] — 2026-06-28 — React/Electron

### Added
- **VXP Import — RMS component key fix**: `import_vxp.py` now appends ` RMS` to the component name for RMS measurement rows (e.g. `BEVEL GMX2 RMS | XMSNF`). This prevents RMS and order-frequency rows sharing the same key and correctly maps measurements to `DEFAULT_LIMITS` entries.
- **HUMS — empty Limits widget placeholder**: when the active tail is HUMS, the Dashboard Limits widget now shows a "No limits defined for HUMS" placeholder instead of 96 N/A entries. `systemType` is forwarded from `fleetItem` into `LimitsWidget`.
- **HUMS — empty Charts placeholder**: when the active tail is HUMS, the Charts view shows a "No charts available for HUMS / HUMS component limits are not yet configured" placeholder instead of the full component list and chart panel.
- **Export button — WIP modal window**: clicking Export now opens a centred modal overlay ("Export — Work in Progress") with a close button (×) and backdrop-click-to-close. The BottomBar shows a static "Exporting…" progress bar at 5% while the modal is open; both are cleared when the modal is dismissed. Removed the fake step-animation previously used.

---

## [0.7.5] — 2026-06-28 — React/Electron

### Added
- **Workspace rules — `CLAUDE.md`**: project-root `CLAUDE.md` formalises the coding conventions: working dir is `./app/` only; `./Resources/` is read-only; `README.md` and `ToDo.txt` are off-limits.
- **Export button — global WIP animation**: Export button in BottomBar is now always enabled (no longer requires an active tail). Clicking shows an animated green progress bar in the BottomBar centre area with the message "WIP — Export coming soon", identical in layout to the import progress bar. Introduced `exportProgress` state in `App.jsx`; `BottomBar` now accepts `exportProgress` and merges it with `importProgress` so only one progress bar is ever visible.
- **VXP/HUMS system type badge pulse**: the small VXP / HUMS badge next to each tail in the tail dropdown now gently pulses (CSS `vxp-badge-pulse` keyframe added to `globals.css`), making it easier to distinguish system types at a glance.
- **Dashboard — Reports widget: pending-only list with redirect button**: widget now shows only pending reports (not all reports). The clickable-row navigation behaviour is replaced with an explicit **"→ Reports"** button on each row; clicking navigates to the Reports view. Signed and default reports no longer appear in this widget.
- **Dashboard — Trends widget: VXP shows all 96 comps pre-import**: for VXP tails, the Trends widget now populates all 96 components even before any imports are loaded — unmeasured components appear in the Stable column. For HUMS tails the original behaviour (only measured comps shown) is preserved. `systemType` is now derived from `fleetItem` and passed through `Dashboard → TrendsWidget`.
- **Dashboard — Limits widget: full pie when single slice**: `paddingAngle` on the donut chart is now `0` when only one slice is present (e.g. all 96 comps are N/A before first import), eliminating the phantom gap that previously appeared.
- **Reports — "Default" filter tab**: a **Default** filter button has been added between **All** and **Pending** in the report list sidebar. Selecting it shows only reports with `status === 'default'` (non-incident dates).
- **Charts — Purge: comment field**: `PurgeModal` now includes a free-text **Backup comment** field above the `PURGE` confirmation input. The comment is passed to the `purge:comp` IPC channel and stored in the backup JSON under `comment`; it is used to identify the backup when restoring.
- **Charts — Restore: backup selection modal**: instead of always restoring the most-recent backup, clicking **↩ Restore from Backup** now opens a `RestoreSelectModal` listing all available purge backups for the component (newest first), each showing the user-supplied comment, purge timestamp, and entry count. The user selects one to restore. New `backup:list-comp` IPC channel added.
- **Recent Imports — header summary**: page header changed from `Imports {tail} N total` to `Imports {tail} N Dates N Sessions` where N Dates is the number of import files and N Sessions is the total session count across all imports.

### Changed
- **`preload.cjs purgeComp`**: signature updated to `purgeComp(tail, compKey, comment)` — comment is forwarded to the main process.
- **`preload.cjs restoreCompBackup`**: signature updated to `restoreCompBackup(tail, compKey, backupFilename?)` — when `backupFilename` is provided the specific backup is restored; otherwise falls back to most-recent (backwards compatible).
- **`preload.cjs listCompBackups`**: new exposure — `listCompBackups(tail, compKey)` → `[{ filename, purged_at, comment, entries_count }]`.
- **`main.cjs purge:comp`**: now accepts third arg `comment`; saves it in the backup JSON.
- **`main.cjs backup:restore-comp`**: now accepts optional third arg `backupFilename`; resolves to most-recent backup when omitted.
- **`main.cjs backup:list-comp`** (new): reads all `{compKey}_purged_*.json` files for a tail and returns metadata array sorted newest first.
- **`BottomBar`**: `activeTail` prop removed — Export button no longer depends on tail selection. `busy` derived from `importing || exporting`.

---

## [0.7.2] — 2026-06-25 — React/Electron

### Added
- **VXP Import — global, tail auto-detected**: Import button in the bottom toolbar is now always enabled; no tail needs to be selected first. The handler detects the aircraft tail suffix from the PDF header line (`A/C # 760658_BHT` → `BHT`) via `detect_tail_suffix()`, then resolves it to the full fleet tail (`4X-BHT`) using the fleet registry. Saves to the correct tail's `imports/` directory automatically.
- **`import:pdf` IPC channel**: opens a native file-picker dialog, spawns `import_vxp.py`, streams `PROGRESS N/TOTAL` stderr lines as `import:progress` IPC events, deduplicates sessions by `session_id`, saves one `date_import_DD-MM-YYYY.json` per date, and returns `{ ok, tail, files, dates }`.
- **`import_vxp.py` — full VXP PDF parser**: reads the PDF with `pdfplumber`, extracts session headers (`N logs of data, started …, completed …`), parses all 96 component rows per session, computes `status` (ok/caution/alert/critical) and `trend` (up/down/stable) against `DEFAULT_LIMITS`, groups sessions by date, and outputs a JSON array to stdout. One import object per date, each with `sessions`, `summary` (white/green/yellow/red + up/flat/down counts), `tail`, and `tail_suffix`.
- **Inline import progress in BottomBar**: while an import is running the centre of the bottom toolbar shows a horizontal fill bar and page-progress label (`Importing… (page N / total)`). Error state renders the bar in red with the error message. Version label (`v0.7.2`) restores automatically after import completes or is dismissed.

### Changed
- **`App.jsx handleImport`**: removed `!activeTail` guard; after a successful import, reloads imports for the returned `tail` (not the previously active tail) via `listImports` + `loadImport`.
- **`preload.cjs importPdf`**: signature changed from `importPdf(tail)` to `importPdf()` — tail is now determined server-side.
- **`BottomBar` Import button**: `disabled` condition changed from `!activeTail || importing` to `importing` only.

---

## [0.7.1] — 2026-06-25 — React/Electron

### Added
- **Reports — "View Report" button**: each row in the report list now has a small inline button that selects the report, making it easier to open a report without needing to click the row text area.
- **Charts — empty-data state**: when a component has no import data, the chart panel shows a `📭 No import data for this component` placeholder instead of a blank chart area.

### Changed
- **Charts — removed mock-series fallback**: `generateMockSeries` is no longer called when real import data is absent. Components with no measurements show the empty state instead of synthetic data.
- **Charts — unmeasured comps treated as N/A in status filter**: components with no measurement data are now bucketed as `na` (N/A) in the status filter regardless of whether a limit is defined for them, consistent with LimitsWidget behaviour.
- **Dashboard LimitsWidget — requires real measurement**: a component is only counted as Normal / Caution / Critical if it has been measured (`compStatus` has an entry). Components with a defined limit but no measurement data are shown in the N/A column.
- **Dashboard TrendsWidget — only measured comps shown**: the three trend columns now omit components that have no measurements; previously all 96 were shown with a synthetic `stable` default.
- **DefaultPage TailCard stats — measurement-gated**: N/A count now includes comps with limits defined but not yet measured. Normal / Caution / Critical / trend counts only count comps that have actual measurement data. `flat` trend count only counts measured comps.
- **TailModal — normalize legacy `'empty'` limitsMode**: on open, `limitsMode === 'empty'` (or missing) is mapped to `'global'` so the UI never shows the deprecated empty option.
- **TailModal — delete custom limits on mode switch**: when editing a tail that had `limitsMode === 'custom'` and the user switches to `'global'`, `custom_limits.json` is now deleted via IPC so the global limits take immediate effect.
- **Test data cleared**: per-tail import and report data files removed from `data/4X-BHT/` and `data/4X-BHP/` to start clean for real import testing.

---

## [0.7.0] — 2026-06-24 — React/Electron

### Added
- **Dashboard — LimitsWidget: 4-column status lists**: right panel now shows four scrollable columns (N/A / Normal / Caution / Critical). N/A column holds all components whose limit entry is `null` (no engineering limit defined). Normal column holds components with a defined limit that are not in caution or critical. All 96 components distributed across the four columns; each entry clickable and navigates to the component chart. Column headers show the location sub-label (same layout as TrendsWidget).
- **Dashboard — LimitsWidget: brighter pie tooltip**: Tooltip on the donut chart now renders with higher contrast (bold text, dark panel2 background, drop shadow) so it's clearly readable on hover.
- **Dashboard — TrendsWidget: show all 96 components**: widget now maps all `ALL_COMP_KEYS` entries, not just those with measurements. Unmeasured components default to Stable, so all 96 are always visible across the three trend columns.
- **Dashboard — RecentImportsWidget: inline stats row**: import summary row now shows `{N}N {C}C {Cr}Cr | {→} → {↑} ↑ {↓} ↓` on one line with increased spacing between items.
- **Charts — Manage button + ManageModal**: the three per-row hover buttons (Limits / Purge / ↩ Restore) are replaced by a single **Manage** button. Clicking opens a modal with all three actions. Reduces clutter on the component list.
- **Recent Imports — session time ranges**: each import row now shows the time span for every session in `hh:mm-hh:mm` format (uses `started_at` / `completed_at` from session data).
- **Recent Imports — inline stats row**: import rows show `{N}N {C}C {Cr}Cr | {→} → {↑} ↑ {↓} ↓` on one line with spacing consistent with the widget.
- **Recent Imports — View File button**: each import entry has a **View File** button that opens a modal displaying the raw import JSON. When an import has multiple sessions, a tab strip lets you select which session to inspect.
- **App-wide N/A for null-limit components**: components whose `LIMITS` entry is `null` (82 of 96) now show as N/A (white) consistently across every surface:
  - `aggregateCompStatus` forces `status: 'white'` for null-limit comps regardless of importer value.
  - `computeImportSummary` classifies null-limit comps as `white` (not `green`).
  - `LimitsWidget` uses `editableLimits` to assign N/A vs Normal/Caution/Critical columns.
  - `Charts` `filteredKeys` treats "has-limit, not-measured" as Normal (green bucket) to match LimitsWidget counts.
  - `DefaultPage` TailCard computes 96-comp stats from `ALL_COMP_KEYS + LIMITS` so fleet overview numbers match the per-tail Dashboard exactly.
- **App-wide data from JSON only**: `App.jsx` initial state changed from `MOCK_IMPORTS`/`MOCK_REPORTS` to `{}`. `init()` now preloads all fleet tails' imports and reports at startup so fleet overview and TopBar incident dots show real data immediately. `loadImports` returns `[]` instead of mock data fallback.
- **App-wide terminology consistency**: status labels use Normal / Caution / Critical; trend labels use Deteriorating / Stable / Recovering throughout. `statusLabel()` and `trendLabel()` helpers added to `constants/status.js`; all components use them instead of raw status strings. "Improving" → "Recovering" on DefaultPage TailCard trend bubbles.
- **importLoader — import summary de-duplication**: `computeImportSummary` now collapses all sessions by comp key (last session per comp wins) before counting. Multi-session imports no longer double-count components that appear in more than one session.
- **importLoader — auto-compute summary**: `loadImports` computes `summary` from session data when the JSON file does not already have it, ensuring pills are populated for all real imports.

### Changed
- **Recent Imports — Remove label**: the delete button in the header's select-mode sequence is now labelled **Remove (N)** instead of **Delete (N)** for consistency with the per-row button.
- **Recent Imports — bigger select-mode buttons**: select-mode header buttons (Select All / Remove / Yes / No / Cancel) bumped from `10px/3px` to `11px/5px` for easier click targets.
- **Recent Imports — removed "Imported: …" timestamp**: the `Imported: date, time` detail line removed from import rows; date and session count are sufficient.
- **Recent Imports — outside-click dismisses Remove confirm**: clicking anywhere outside the inline "Sure? Yes / No" confirm buttons dismisses it without deleting.
- **Recent Imports — "2 sess." → "2 Sessions"**: session count label now uses full word.
- **Reports — incident pill**: status pill now shows CRITICAL (not ALERT) using `statusLabel()`.
- **DefaultPage — TailCard trend label**: "Improving" renamed to "Recovering" (amber colour) to match app-wide terminology.

---

## [0.6.9] — 2026-06-23 — React/Electron

### Added
- **TopBar — per-tail incident indicators**: pulsing coloured dot in the tail dropdown per tail, positioned to the right of the VXP/HUMS system tag. Dot colour reflects worst component status (red = alert/critical, amber = caution/warning, green = ok). Red ▲ trend arrow shown alongside when any component has `trend = 'up'`. Both dot and arrow shown simultaneously when status and trend are both triggered.
- **Chart X-axis session count**: date labels on the `ComponentChart` X-axis now show "N sessions" below the date using a custom SVG two-line tick renderer.
- **Charts — Restore from backup button**: each component row in Charts now shows an "↩ Restore" button on hover. Clicking restores the most-recent purge backup for that component via IPC; shows a success/error toast and reloads tail data on success.
- **BottomBar — WIP export modal**: clicking Export now opens a centred modal overlay with "WIP" heading, ✕ close button, and backdrop-click-to-close; replaces the inline progress bar.
- **IPC — `tail:restore`**: new channel moves data from `data/backups/{tail}/` back into `data/{tail}/` on re-add, including `custom_limits.json`.
- **IPC — `backup:restore-comp` / `backup:check-comp`**: restore a purged component's data from the most-recent purge backup; check whether a backup exists.
- **Global data path per aircraft type**: limits and actions JSONs moved to `data/global/S76C++/`; `main.cjs` uses `AC_DIR` constant. Adding a new aircraft type requires only a new subdirectory with its own JSON files.

### Changed
- **Tail remove → move, not metadata-only**: `tail:remove-backup` now moves `imports/`, `reports/`, and `custom_limits.json` to `data/backups/{tail}/` rather than only writing a metadata record. `tail:check` detects data in both live and backup directories; restore prompt shows "from backup" context when applicable.
- **`handleSaveLimit` — custom-limits routing**: when `limitsMode === 'custom'`, edits write to `customLimitsByTail` + `custom-limits:save` IPC instead of corrupting the global system limits file.
- **`EditLimitModal` — context-aware confirmation**: confirmation message shows "global HUMS/VXP limits — affects all tails" or "custom limit — this tail only" based on `systemType` and `limitsMode` props.
- **`compStatusByTail` computed fleet-wide** in `App.jsx` and passed to `TopBar`; enables per-tail incident dots without re-computing on each dropdown open.
- **4X-BOC removed** from active fleet; empty data dirs deleted; backup scaffold at `data/backups/4X-BOC/`.

### Fixed
- **`backup:restore-comp` — data loss**: backup file was deleted even when `restored === 0` (e.g. import files re-imported with different session IDs), permanently losing purged data. Fix: backup only deleted when `restored > 0`.
- **`backup:restore-comp` — unconditional `writeJson`**: import file written back to disk for every backup entry, even when no `session_id` matched. Fix: write only when `fileModified === true`; entries batched by file to eliminate duplicate reads/writes.
- **`tail:remove-backup` — ENOTEMPTY**: `rmdirSync` on tail root silently failed when `custom_limits.json` existed there (non-empty directory). Fix: `custom_limits.json` explicitly moved to backup before attempting `rmdirSync`.
- **`tail:restore` — custom limits not restored**: `custom_limits.json` was not moved back on restore. Fix: `tail:restore` now also restores `custom_limits.json` from the backup directory.
- **`handleRestore` — false success on `restored === 0`**: `onRestoreComp()` was called and a success toast shown even when no data was actually written. Fix: distinct "no matching sessions" message shown; `onRestoreComp` only called when `restored > 0`.
- **`handlePurge` — silent error**: IPC failure closed the modal but showed no feedback. Fix: error toast shown on purge failure.
- **`Charts.jsx` — `setTimeout` stale closure**: restore-message timer was fire-and-forget; could call `setRestoreMsg` on unmounted component. Fix: timer stored in `useRef`, cleared in `useEffect` cleanup.
- **`TopBar.jsx` — amber dot wrong hex**: `DOT_COLORS.yellow.bg` was `#f39c12`, mismatching `--amber: #f0a500`. Fixed.
- **`api.loadCustomLimits?.catch` TypeError**: missing `?.` before `.catch()` caused a crash when IPC was absent. Fixed.
- **`syncSigners` / `syncActions`** wrapped in `try/catch` to prevent unhandled IPC rejections from bubbling.

---

## [0.6.4] — 2026-06-22 — React/Electron

### Added
- **Per-tail custom limits file**: when `limitsMode === 'custom'`, a `custom_limits.json` file is written to `data/{tail}/custom_limits.json` alongside the tail's imports and reports. This file overrides the global system limits for that tail and is loaded automatically when navigating to the tail. It travels with the data package through archive, backup, and restore flows.
- **IPC channels**: `custom-limits:load(tail)` / `custom-limits:save(tail, limits)`; preload exposes `loadCustomLimits` / `saveCustomLimits`. App holds `customLimitsByTail` state and hydrates it per tail on load.

### Changed
- **LoadingOverlay**: display size reduced from 260 px to 215 px (~17% smaller); internal coordinate space and blade geometry unchanged.
- **BottomBar / package.json**: version bumped to `v0.6.4`.

---

## [0.6.3] — 2026-06-22 — React/Electron

### Fixed (10 findings from code review)
- **TailModal — critical data loss** (was line 166): `finalize()` called `archiveTailData` on `mode='edit'`, wiping all live import/report data on every metadata save. Guard added: `archiveTailData` and `createTail` are now inside `if (mode === 'add')` only.
- **main.cjs — path traversal**: unsanitized `tail` used in `path.join` across all `tail:*` IPC handlers. `isValidTail()` guard (`/^[A-Z0-9][A-Z0-9\-]{1,14}$/`) added to every handler.
- **main.cjs — `tail:archive-data` no error handling**: partial archive on a locked file left data split with no error returned. Wrapped in `try/catch` returning `{ ok: false, error }`.
- **main.cjs — empty dirs after archive**: `tail:archive-data` left empty `imports/` and `reports/` dirs, causing `tail:check` to return null on re-add (restore prompt never shown). Empty source dirs now removed after files are moved.
- **fleetStore.js — `.catch()` on undefined**: `saveFleet` called `.catch()` outside the optional-chain, throwing `TypeError` in browser/dev context. Fixed to `?.catch(() => {})`.
- **fleetStore.js — `loadFleet()` no normalization**: raw `JSON.parse` output returned without field defaults; old localStorage entries missing `limitsMode`/`customLimits` reached the UI. Each entry now normalized with `?? defaults`.
- **App.jsx — init race**: `setFleet(ipcData)` in bootstrap `init()` could overwrite user fleet edits made during the ~300 ms IPC startup window. `fleetDirty` ref added; IPC hydration skipped if any mutation occurred after mount.
- **TailModal.jsx — backdrop dismiss during async save**: clicking outside the modal during an in-flight IPC call called `onClose`, unmounting the component mid-operation. Backdrop `onClick` now `saving ? undefined : onClose`.
- **TailModal.jsx — double `onClose()`**: `finalize()` called `onClose()` after `onSave()`, which already unmounted the component. `onClose()` removed from `finalize()`.
- **DefaultPage.jsx — `aggregateCompStatus` in render map**: ran O(tails × imports) on every hover/state update. Moved into `useMemo` keyed on `fleet` + `importsByTail`.

---

## [0.6.2] — 2026-06-21 — React/Electron

### Added
- **Fleet management — Add / Edit / Remove on Default Page**: Manage dropdown triggers Add (TailModal), Edit (amber hover, metadata-only), and Remove (red hover, single-card confirm). Remove writes a backup metadata record to `backups/{tail}/removal_{ts}.json`; data stays on disk.
- **TailModal — full Add/Edit modal**: fields for Tail Number, Aircraft Type, System (VXP / HUMS), Limits Mode (Empty / Global / Custom). Custom mode exposes a LimitsPanel listing all 96 components with per-entry override via EditLimitModal sub-modal.
- **TailModal — restore prompt**: on re-add, `tail:check` detects existing data and shows a RestoreStep panel (import count, report count, date range) with Restore / Start Fresh / Cancel.
- **Fleet persistence — JSON + IPC**: fleet registry persisted to `data/global/tail_number_tags_vxp_hums_index.json` (schema v2.1). Two-tier load: synchronous localStorage for instant first render + async IPC hydration in useEffect. Writes go to both simultaneously.
- **Tail data-package lifecycle**:
  - `tail:create` — scaffolds `imports/` and `reports/` on add (idempotent).
  - `tail:check` — returns `{ importCount, reportCount, firstDate, lastDate }` or `null`.
  - `tail:archive-data` — moves live files to `backups/{tail}/archived_{ts}/` on "start fresh".
  - `tail:remove-backup` — writes `removal_{ts}.json` metadata when tail is removed from fleet.
- **TopBar — dynamic fleet**: tail dropdown now iterates the live `fleet` prop passed from App; the static `TAILS` import is removed.
- **LoadingOverlay — S-76D swept-tip blade**: blade planform replaced with an asymmetric scimitar profile. Trailing edge: straight to r=90, gentle 2 px inward cubic sweep to tip. Leading edge: straight to r=88, dramatic 6 px sweep past centreline to same tip. Tip offset 2 px toward trailing edge. One solid filled `var(--accent)` path, no separate cap or stroke.

### Changed
- **fleetStore.js** (full rewrite): `fromJsonEntry`/`toJsonEntry` converters; `loadFleet()` (sync, localStorage); `loadFleetFromIPC()` (async IPC); `saveFleet()` writes both. Defaults `limitsMode`, `customLimits`, `systemType` on all entries.
- **App.jsx**: two-step fleet bootstrap; `handleAddTail`, `handleEditTail`, `handleRemoveTails` (async, `Promise.all`); `fleet` prop forwarded to TopBar and DefaultPage.
- **DefaultPage.jsx**: `confirmRemove` state is `null | tail-string` (no checkbox multi-select); TailCard shows "✕ Remove" on hover in remove mode (red border), mirroring Edit's amber pattern.

---

## [0.6.1] — 2026-06-18 — React/Electron

### Changed
- **LoadingOverlay — rotor refinement**: hub assembly scaled down (~35%), blades narrowed to 8 px chord with a more pronounced parabolic swept tip (tip narrows to 2 px at apex), spin slowed from 0.5 s to 1.4 s/rev; motion-blur ghost trail angles reduced to match.
- **Default Page — full-window grid**: fleet cards now fill the entire window with no whitespace border.
- **Default Page — Manage button**: emoji removed from label.
- **BottomBar**: version label updated to `v0.6.1`.

---

## [0.6.0] — 2026-06-17 — React/Electron

### Added
- **Default Page — TailCard redesign**: 3-section layout (Header · Limits+Reports · Trends). Each card shows 4 Limits bubbles (N/A / Normal / Caution / Alert), 3 Reports rows (Total / Pending / Signed), and 3 Trend bubbles (↓ Improving / → Stable / ↑ Deteriorating).
- **Default Page — fleet fits on screen**: card density tightened (reduced padding, bubble size, grid gap) so all 7 tail cards fit in a single viewport without scrolling.
- **BottomBar — click animation**: buttons scale to 0.93 on mouse-down and restore on release.
- **BottomBar — WIP progress bar**: Import / Export buttons trigger a 5-second amber message with a filling progress bar; version label hides during the animation.
- **TopBar — WIP tags removed** from the tail dropdown.
- **Per-tail Dashboard — widget reorder**: Recent Imports (1) · Reports (2) · Limits (3) · Trends (4). Dashboard grid fills the full window height (`1fr 1fr` rows, `overflow: hidden`).
- **Per-tail Dashboard — TrendsWidget**: replaced bar chart with 3-column list (Deteriorating / Stable / Recovering) matching prototype v1.3.0. Clicking a component navigates directly to its chart.
- **Per-tail Charts — multi-select filters**: status and trend filters are now Sets; multiple filters can be active simultaneously. "All" button clears all filters.
- **Per-tail Recent Imports — Select mode**: checkbox selection, Select All / Deselect All, bulk Delete with "Are you sure?" confirmation; back button removed.
- **App opens fullscreen** by default (`fullscreen: true` in BrowserWindow).
- **Loading overlay** on Recent Imports and Default Page navigation (200 ms).
- **`imports:save` IPC merges sessions**: new sessions prepend to an existing date file instead of overwriting.
- **96-component list updated to real engineering data** (`limits.js` replaced with exact keys from `non_test_data_global_limits_only.xlsx`): 14 limits populated (Main Rotor, M/R 4P, HB 3, XMSNF null, XMSNL null, TR FA null, IGB V null, ENG1C/ENG2C null); 82 null. Mock data rewritten with matching real component keys and values scaled to real limit thresholds.

---

## [0.5.2] — 2026-06-15 — React/Electron

### Changed
- TopBar: removed "HUMS/VXP Monitoring" title text and "Brook Aviation · S-76C++" label
- TopBar: replaced "Recent Imports" left button with "Default Page" home button; Recent Imports moved to right nav tabs alongside Dashboard / Reports / Charts
- TopBar: all nav buttons now light up on hover (semi-transparent white, full white text)
- BottomBar: Import button styled blue/white; Export button styled green/white; version label `v0.5.2` added to far right
- LoadingOverlay: replaced rotor geometry with exact prototype swept-blade planform (4 blades at 45° intervals, solid `#0d1117` background, hub + mast cap ring + white spindle, 0.75s spin)
- Navigation: clicking Dashboard / Reports / Charts while on Recent Imports page now correctly navigates away
- Recent Imports page: now scoped to the selected tail only — tail filter dropdown removed
- Default Page: removed "Brook Aviation — S-76C++ · HUMS/VXP Monitoring" subtitle

---

## [0.5.0] — 2026-06-15 — React/Electron (2.0 rewrite)

Initial scaffold of the 2.0 architecture. MVP — frontend + database only.
Import/export/trend-detection are stubs; real parsing wired in future versions.

### Architecture
- **New navigation model** — Default Page (fleet grid) → Tail select → Dashboard / Reports / Charts
- **Top Toolbar** — Recent Imports button · Tail dropdown (all 7 tails) · Dashboard/Reports/Charts tabs (tail-scoped)
- **Bottom Toolbar** — Import stub · Info label · Export stub (disabled)
- **No sidebar** — component list is now a left panel within the Charts page

### Data layer (2.0)
- **`data/global/`** — system-wide config: `comp_limits_vxp.json`, `comp_limits_hums.json`, `report_actions_vxp.json`, `report_actions_hums.json`, `report_signer.json`, `tail_number_tags_vxp_hums_index.json`
- **`data/{tail}/imports/date_import_DDMMYYYY.json`** — per-tail import files (replaces flat `imports/DD-MM-YYYY.json`)
- **`data/{tail}/reports/report_DDMMYYYY.json`** — per-tail report files (replaces `data/incidents/tails/{tail}/`)
- **`data/backups/{tail}/`** — purge backups folder
- **Limits scope** — VXP limits apply to all VXP tails (4X-BHT, 4X-BHP); HUMS limits apply to all HUMS tails; no per-tail overrides in 2.0

### IPC API (new surface)
- `limits:load(tailType)` / `limits:save(tailType, limits)` — `tailType` = `'vxp'` | `'hums'`
- `imports:list(tail)` / `imports:load(tail, filename)` / `imports:save(...)` / `imports:delete(...)`
- `reports:list(tail)` / `reports:load(tail, filename)` / `reports:save(...)` / `reports:delete(...)`
- `signers:load()` / `signers:save(signers)`
- `actions:load(tailType)` / `actions:save(tailType, actions)`
- `purge:comp(tail, compKey)` — backs up to `data/backups/{tail}/`, removes from all import files

### Default Page
- Fleet grid — one `TailCard` per tail; shows status counts (N/A / Normal / Caution / Alert), trend counts, pending report count, last import date
- Click any tail card to navigate to that tail's Dashboard

### Dashboard (per-tail, 2×2 grid)
- **Recent Imports widget** — 5 most recent imports with colour-coded summary pills
- **Trends widget** — rising/stable/recovering counts + list of rising components
- **Limits widget** — donut pie + flagged comp list
- **Reports widget** — pending/signed counts + recent report list

### Charts page
- **Left panel** (360px) — searchable component list with status and trend filters; shows 96 VXP components
- **Each comp row** — status dot · name · location · (hover) Limits button · Purge button · trend arrow
- **Right panel** — stat strip (Latest / Change / Dates / Sessions / Last import) + Recharts ComposedChart
- Chart identical to 1.3.x: dual X-axis (HH:MM + date), session ReferenceArea bands, Brush slider, limit reference lines
- **Edit Limits modal** — two-step confirmation; applies to all tails in the same system (VXP or HUMS)
- **Purge modal** — requires typing `PURGE`; backs up before deleting; no undo within app

### Reports page (replaces Incidents)
- Left panel — filter tabs (All / Pending / Signed) + report list
- Right panel — incident list with ActionDropdown per incident + SignerDropdown + Submit & Sign
- Report sign-off requires: signer set + all incidents actioned
- Reports saved to `data/{tail}/reports/report_DDMMYYYY.json` via IPC

### Recent Imports page
- Full list view of all imports across all tails
- Filter by tail pill buttons
- Per-row summary colour pills + inline remove confirmation (No / Yes)

### Limit colour scheme (2.0)
- White = N/A (no limit defined)
- Green = Normal (≥ lower limit, < caution)
- Yellow = Caution (≥ caution limit, < critical)
- Red = Critical/Alert (≥ critical limit)

### Python source
- `source/db.py` — fully implemented SQLite backend (`aircraft`, `sessions`, `measurements` tables)
- `source/database_handler.py` — top-level DB accessor
- `source/import_handler.py` — orchestrator (stub, calls parsers)
- `source/import_vxp.py` — VXP PDF parser (stub)
- `source/import_hums.py` — HUMS parser (stub)
- `source/export_filter.py` — data filter for export (stub)
- `source/export_chart.py` — chart PNG/PDF export (stub)
- `source/export_report.py` — report PDF export (stub)
- `source/export_excel.py` — Excel export (stub)
- `source/trend_detection.py` — linear regression trend (stub)

### Mock data (from test_data_BHT.pdf structure)
- 4X-BHT: 4 imports across 4 dates (05-Mar / 12-Mar / 19-Mar / 26-Mar 2026), 7 sessions total
- 4X-BHP: 4 imports across 4 dates (03-Mar / 10-Mar / 17-Mar / 24-Mar 2026)
- Pre-seeded reports: 2×BHT (1 pending, 1 signed), 2×BHP (1 pending, 1 signed)
- Pre-seeded signers: D. Cohen, Y. Shapiro, N. Levine
- 14 populated VXP limits (Main Rotor, TR Drive, Tail Rotor, Engines); 82 null

### Constraints
- Version starts at 0.5.0 (2.0 rewrite MVP; below 1.0.0 to distinguish from prototype 1.x line)
- `./README.md` and `./ToDo.txt` (project root) not modified
- No trend-detection wired — trends stored in import JSON files; recalculation pending backend

---

_(Earlier history lives in `Resources/prototypes/app_v1.3.0/CHANGELOG.md` — v0.1.0 through v1.3.2)_
