# VXP Monitoring — Project Spec v1.0.2 (VXP 1.0 MVP)
**Brook Aviation | S-76C++ Fleet | Maintenance Vibration Monitoring**

> This document is a living spec for the `./app/` codebase.
> Full historical spec lives in `Resources/docs/Project_1_0_specs.md`.

---

## 1. Overview

A desktop Electron app for monitoring helicopter vibration data (VXP system — HUMS decoupled for v1.0 MVP; see §12).
Maintenance engineers import PDF reports, review component vibration measurements against
engineering limits, sign off incidents, and track trends over time.

**Stack:** React 18 · Vite 5 · Electron 29 · Recharts 2.10 · SQLite (Python `sqlite3`)

---

## 2. Navigation Model (2.0)

```
┌─────────────────────────────────────────────────┐
│ TopBar: [Recent Imports] [Tail ▼]  Dashboard | Reports | Charts │
├─────────────────────────────────────────────────┤
│                                                 │
│  Page area (flex-1, scrollable)                 │
│                                                 │
├─────────────────────────────────────────────────┤
│ BottomBar: [↑ Import]   info label   [↓ Export] │
└─────────────────────────────────────────────────┘
```

**States:**
| `page`         | `activeTail` | `tailView`    | Description                        |
|----------------|--------------|---------------|------------------------------------|
| `default`      | null         | —             | Fleet grid (VXP tail cards)        |
| `recent-imports`| any         | —             | Full import list (all tails)       |
| `tail`         | set          | `dashboard`   | Per-tail 2×2 widget grid           |
| `tail`         | set          | `charts`      | Comp list + chart                  |
| `tail`         | set          | `reports`     | Report list + detail               |

---

## 3. Aircraft Registry

Fleet is **dynamic** — tails are managed at runtime via the Default Page Manage menu (Add / Edit / Remove) and persisted to `data/global/tail_number_tags_vxp_hums_index.json`.

**Schema v2.1** (per entry in `tails[]`):
```json
{ "tail": "4X-BHT", "system": "vxp", "aircraft_type": "S76C++", "limits_mode": "global" }
```
`limits_mode`: `"global"` | `"custom"`. (`"empty"` is deprecated — treated as `"global"` at runtime.) Custom limits stored in the tail's own data folder (see §4).

**Default fleet (first-run fallback):**

| Tail      | System | Aircraft |
|-----------|--------|----------|
| 4X-BHT    | VXP    | S76C++   |
| 4X-BHP    | VXP    | S76C++   |

HUMS tails decoupled — see §12 for re-integration spec.

---

## 4. Data Model

### 4.1 File layout
```
app/
  data/
    global/
      comp_limits_vxp.json                  # { "COMP | LOC": [lower, caution, critical] }
      comp_limits_hums.json
      report_actions_vxp.json               # string[]
      report_actions_hums.json
      report_signer.json                    # [{ id, first, last, license }]
      tail_number_tags_vxp_hums_index.json  # fleet registry (schema v2.1)
    {tail}/
      imports/
        date_import_DDMMYYYY.json           # see §4.2
      reports/
        {sanitizedCompKey}.json             # component tracker — see §4.3
        generated_reports/
          {report_id}.json                  # compiled Incident Report — see §4.3
      custom_limits.json                    # per-tail limit overrides (limitsMode='custom')
    backups/
      {tail}/
        imports/                            # import files MOVED here on tail remove
        reports/                            # report files MOVED here on tail remove
        custom_limits.json                  # custom limits MOVED here on tail remove
        removal_{ts}.json                   # removal metadata record (only written when data was actually moved)
        {COMP_KEY}_purged_{ts}.json         # per-comp purge backups (includes `comment` field)
        archived_{ts}/                      # timestamped archive on "start fresh"
          imports/
          reports/
    global/
      S76C++/
        comp_limits_vxp.json
        comp_limits_hums.json
        report_actions_vxp.json
        report_actions_hums.json
```
(SQLite `hums_vxp.db` / `db.py` removed in v0.8.2 — JSON files are the data store.)

### 4.2 Import file schema
```json
{
  "import_id":   "bht_imp_20260326",
  "date":        "26-03-2026",
  "tail":        "4X-BHT",
  "imported_at": "2026-03-26T11:15:00Z",
  "source_file": "BHT_26_03_26.pdf",
  "sessions": [
    {
      "session_id":   "bht_20260326_001",
      "log_count":    1,
      "started_at":   "2026-03-26T10:30:00",
      "completed_at": "2026-03-26T11:00:00",
      "comps": {
        "MR VERT | LHVRT+RHVRT": {
          "avg_meas": 0.412, "max_meas": 0.494,
          "status": "alert", "trend": "up"
        }
      }
    }
  ],
  "summary": { "total": 14, "white": 0, "green": 4, "yellow": 8, "red": 2,
               "up": 12, "flat": 2, "down": 0 }
}
```

### 4.3 Report file schema

> **Backup & Export:** Report files are preserved in `data/backups/{tail}/reports/` when a tail is removed, and are restored automatically when the tail is re-added. Export (v0.9.0): a generated report exports to a paged A4 PDF — from the Export modal (BottomBar) or the Export PDF button on the `GeneratedReportDoc` letterhead — via `reportToHtml` (`utils/exportUtils.js`) rendered by `main.cjs export:pdf` in a hidden window (`printToPDF`, `@page size: A4`); long reports flow over multiple pages with repeating table headers.

Two report file kinds live under `data/{tail}/reports/`:

**Component tracker** — one JSON per component per tail (`data/{tail}/reports/{sanitizedCompKey}.json`), accumulating **one entry per import date** (v0.8.5 — judged on the date's chronologically latest session). An entry (pending action) opens **only at import time**, when the date's latest reading is **caution/critical**, or when the trend classification has been **'up' on ≥ 3 consecutive import dates** (`TREND_STREAK_DATES`, v0.8.6 — a single fresh up call alone does not demand an action). `entry_id` is `{date}__{sanitizedCompKey}`. When a newer session arrives for a recorded date: an un-actioned entry is refreshed in place (or **removed** when the latest session no longer breaches); an actioned entry is untouched except a limit-status **escalation** (e.g. caution → alert), which refreshes the snapshot and **clears the applied action** (preserved as `prev_action`) so the worse reading drops back to pending and must be re-actioned before it can be reported. Legacy per-session duplicates are collapsed by a one-shot migration at app startup (`migrateAllTrackers`).

**Entry-level sign model (v0.8.7):** applying an action to an entry **signs that date** — there is no separate Sign Off button. Two filter tabs — **Actions Pending** (amber) and **Signed Actions** (green), no "All" tab, defaulting to Actions Pending — filter **entries as well as components**: Actions Pending shows components with ≥ 1 unactioned entry (and only their unactioned entries); Signed Actions shows components with ≥ 1 actioned entry (their actioned entries, read-only). A partially-actioned component appears in **both** lists; no pending/signed pills are shown — the tab defines the state, and pending counts are never shown inside the Signed view. A component whose entries are **all** actioned counts as signed (tracker `status: "signed"` + `signed_at` maintained on save via `allEntriesActioned()` in `reportStore.js`). **Report generation is per-entry (v0.8.9):** a component qualifies with **≥ 1 signed entry** and only its signed entries are compiled, in **chronological date order** (v0.9.2 — tracker order is scan order, which backfilled imports break) — pending entries do not exist for generation until they are actioned. The Actions Pending tab carries a **count badge** of the tail-wide unactioned entries. **Generate Report** sits next to **View Reports** at the top of the component list. Actions are assigned per entry: pick from the dropdown (staged), then persist with **Apply**; **Select** toggles multi-select bulk apply; in the Signed Actions tab the header button reads **Revert Action** (select actioned entries → clears their `action`, dates return to pending). Each entry row also has a **See Chart** button that deep-links to the Charts view with that entry's data point ring-marked and scrolled into view. **Signer identity is never stored on trackers** (`signer_id`/`signer_name` stay `null`); the signer is chosen at report generation and recorded only on the generated document.

**Sign from the chart (v0.8.9):** entries can also be signed directly on the Charts view — clicking a data point that carries a pending (unactioned) incident opens a **Sign Action modal** (`SignActionModal` in `Charts.jsx`, using the shared `ActionDropdown`); Apply & Sign persists through the same `saveComponentReport` path, so Reports, the Dashboard Actions widget and the chart's incident markers stay in sync. The modal's **Go to Reports** button deep-links to the entry on the Reports page, marked **redirected-from** (accent ring + `↩ FROM CHART` pill, scrolled into view, tab auto-selected to where the entry lives); the marker clears on manual navigation.
```json
{
  "comp_key":    "MR VERT | LHVRT+RHVRT",
  "tail":        "4X-BHT",
  "status":      "pending",
  "signer_id":   null,
  "signer_name": null,
  "signed_at":   null,
  "entries": [
    {
      "entry_id":     "26-03-2026__MR_VERT_-_LHVRT+RHVRT",
      "date":         "26-03-2026",
      "session_id":   "sess_001",
      "avg_meas":     0.42,
      "limit_status": "alert",
      "trend":        "stable",
      "reason":       "limit",
      "action":       null,
      "created_at":   "2026-03-26T11:20:00Z"
    }
  ]
}
```

**Generated (compiled) Incident Report** — a formal document compiled over a date range from fully-actioned trackers, stored under `data/{tail}/reports/generated_reports/{report_id}.json`. Generation is gated: every requested `comp_key` must have an applied action on **every** entry (`allEntriesActioned`), and a signer (AME) must be selected in the modal — the signer is recorded only on the report document. An optional **report name** can be entered in the modal (`name`, ≤ 80 chars, `null` when omitted) and is shown on the document letterhead and in the report list.
```json
{
  "report_id":  "genreport_4X-BHT_l3k9x2",
  "name":       "March 2026 vibration review",
  "tail":       "4X-BHT",
  "created_at": "2026-03-26T11:20:00Z",
  "date_from":  "01-03-2026",
  "date_to":    "31-03-2026",
  "components": [
    {
      "comp_key":      "MR VERT | LHVRT+RHVRT",
      "entries":       ["... tracker entries within range ..."],
      "latest_action": "Perform ground run check",
      "stats":         { "count": 3, "caution_count": 1, "critical_count": 1, "uptrend_count": 0 },
      "signer_id":     "sig_4x8snkk",
      "signer_name":   "N. Dvir",
      "signed_at":     "2026-03-27T09:00:00Z"
    }
  ]
}
```

---

## 5. Limits

Two limit modes, selectable per tail in the fleet registry:

| `limits_mode` | Source                                      |
|---------------|---------------------------------------------|
| `"global"`    | `data/global/comp_limits_{system}.json`     |
| `"custom"`    | `data/{tail}/custom_limits.json` (overrides global) |

Switching a tail from `"custom"` back to `"global"` via the Edit Tail modal deletes the `custom_limits.json` override file.

- **Global limits**: system-wide, 14 entries populated (real engineering values from source xlsx); 82 null (N/A → White dot). Editing the global limits modal writes to `comp_limits_{vxp|hums}.json` via IPC.
- **Custom limits**: per-tail file written to `data/{tail}/custom_limits.json` when the tail is saved with `limitsMode = 'custom'`. Only components explicitly set in the file override global; others fall through to `LIMITS` defaults. The file is backed up and restored as part of the data-package lifecycle.
- **Resolution order**: `customLimitsByTail[tail]` (loaded from file) → `fi.customLimits` (fleet registry cache, dev/browser fallback) → `LIMITS` constant.

### Colour scheme
| Colour | Status      | Condition                                          |
|--------|-------------|-----------------------------------------------------|
| White  | N/A         | No limit defined (`LIMITS[key] === null`), or no data |
| Green  | Normal      | Limit defined; avg_meas within limit (or not yet measured) |
| Yellow | Caution     | avg_meas ≥ caution threshold, < critical            |
| Red    | Critical    | avg_meas ≥ critical threshold                       |

**Trend labels:** Deteriorating (`trend: 'up'`) · Stable (`trend: 'stable'`) · Recovering (`trend: 'down'`)

---

## 6. IPC Surface

All `tail` parameters — on every channel that takes one — are validated against `/^[A-Z0-9][A-Z0-9\-]{1,14}$/`, and all `filename` parameters against a safe-filename check (no path separators / `..`, must end `.json`), before any `path.join` (v0.8.2).

| Channel                | Args                    | Returns                                  |
|------------------------|-------------------------|------------------------------------------|
| `limits:load`          | `tailType`              | limits object                            |
| `limits:save`          | `tailType, limits`      | `{ ok }`                                 |
| `imports:list`         | `tail`                  | filename[] — chronological, newest first |
| `imports:load`         | `tail, filename`        | import object — sessions sorted chronologically (normalizes legacy newest-first files) |
| `imports:delete`       | `tail, filename`        | `{ ok }` (`imports:save` removed in v0.8.4 — writes happen only via `import:pdf`) |
| `reports:list-components` | `tail`                | tracker[] — only files parsing to a valid `comp_key` |
| `reports:load-component`  | `tail, compKey`       | tracker object or `null`                 |
| `reports:save-component`  | `tail, compKey, data` | `{ ok }`                                 |
| `reports:list-generated`  | `tail`                | generated report[]                       |
| `reports:load-generated`  | `tail, filename`      | generated report object or `null`        |
| `reports:save-generated`  | `tail, filename, data`| `{ ok }`                                 |
| `signers:load`         | —                       | signer[]                                 |
| `signers:save`         | `signers`               | `{ ok }`                                 |
| `actions:load`         | `tailType`              | string[], or `null` when no file exists yet (v0.9.5 — an existing empty `[]` is a deliberately emptied list and is cached as such; the renderer keeps its built-in defaults only on `null`) |
| `actions:save`         | `tailType, actions`     | `{ ok }`                                 |
| `purge:comp`           | `tail, compKey, comment?` | `{ ok, files_modified, entries_purged }` — comment saved in backup JSON; also strips the comp's tracker entries for the purged sessions (snapshotted into the backup as `tracker_entries`). Two-pass: the backup file is written BEFORE any import file is modified (v0.9.1), so a mid-purge failure can never lose data without a backup |
| `backup:list-comp`     | `tail, compKey`         | `[{ filename, purged_at, comment, entries_count }]` newest-first |
| `backup:restore-comp`  | `tail, compKey, backupFilename?` | `{ ok, restored }` — restores named backup or most-recent; re-inserts the snapshotted tracker entries (actions intact) and reopens the tracker to `pending` |
| `fleet:load`           | —                       | `{ schema_version, tails[] }`, or `null` when the registry file is missing (v0.9.5 — an existing file with empty `tails[]` is honoured as an emptied fleet instead of falling back to the default/cached fleet) |
| `fleet:save`           | `data`                  | `{ ok }`                                 |
| `tail:create`          | `tail`                  | `{ ok }` / `{ ok:false, error }` — scaffold `imports/` `reports/` (error contract normalized v0.9.5) |
| `tail:check`           | `tail`                  | `{ importCount, reportCount, firstDate, lastDate, fromBackup }` or `null` |
| `tail:archive-data`    | `tail`                  | `{ ok }` — move files (incl. `custom_limits.json`) to `backups/{tail}/archived_{ts}/` |
| `tail:remove-backup`   | `tail`                  | `{ ok, files_moved }` — MOVE data to `backups/{tail}/`; `removal_{ts}.json` written only when data was actually moved |
| `tail:restore`         | `tail`                  | `{ ok, files_restored }` — MOVE data from `backups/{tail}/` back to `data/{tail}/` |
| `custom-limits:load`   | `tail`                  | limits object or `null`                  |
| `custom-limits:save`   | `tail, limits`          | `{ ok }` / `{ ok:false, error }` (error contract normalized v0.9.5) |
| `custom-limits:delete` | `tail`                  | `{ ok }` — removes `custom_limits.json`  |
| `backup:check-comp`    | `tail, compKey`         | `boolean` — whether a purge backup exists |
| `app:version`          | —                       | running app version string (`package.json`), shown in BottomBar (v1.0.1) |
| `update:check`         | —                       | manual update check; auto-downloads when newer (v1.0.1) |
| `update:download`      | —                       | (re)start the update download (Retry path) (v1.0.1) |
| `update:install`       | —                       | `{ ok }` / `{ ok:false, error }` — quit → silent install → relaunch; packaged only (v1.0.1) |
| `update:get-state`     | —                       | last `update:event` payload, for late subscribers (v1.0.1) |
| `update:event` (push)  | —                       | main → renderer stream: `{ status: checking\|none\|available\|downloading\|downloaded\|offline\|disabled\|error, … }` (v1.0.1) |
| `import:pdf`           | —                       | `{ ok, results[], tails, imported, skipped, failed, totalDates, totalIncidents }` — opens a **multi-select** file picker (v0.9.9) and processes the selected PDFs **sequentially** via the internal `importOnePdf()`; each `results[]` entry is `{ file, ok, tail?, files?, dates?, incidents?, skipped?, reason? }`. Per file (unchanged behaviour): spawns `import_vxp.py`, auto-detects tail from PDF (empty/undetected/ambiguous tail suffix is rejected), saves per-date JSONs, then scans for incidents with per-tail effective limits + a trend map computed **as of each import's date** — one tracker entry per (date, component), judged on the date's latest session; qualifies on caution/critical, or on a **sustained up-trend** ('up' on ≥ 3 consecutive import dates, `computeSustainedUp`, v0.8.6). A bad file no longer aborts the batch — it becomes a `skipped` (duplicate / already-imported / no new sessions) or failed (`!ok && !skipped`) result and the loop continues. `import:progress` events carry `fileIndex`/`fileCount` + overall batch pct. Duplicate PDFs are rejected by filename or content hash — a date file merged from several PDFs keeps every contributing hash in `source_hashes` (v0.9.2) so re-importing any of the originals is still detected; the block only applies while **every** session the PDF carries is still on disk (v0.9.3) — after a date file of that PDF was deleted, re-importing it is allowed and the session-level dedup merges back just the missing sessions |

---

## 7a. Trend Detection (v0.8.4, refined v0.8.5/v0.8.6)

**Purpose: anticipate deteriorating components and plan ahead** — the trend
signal is an early warning that fires on consistent growth even while a
component is still well below its limits (which is why the relative gate is
normalised by the component's own level, not its limit span).

Reference implementation: `source/trend_detection.py` — mirrored in
`electron/main.cjs` (incident scanning) and `src/utils/trendDetection.js`
(live UI recomputation). **Keep constants and classification in sync across all three.**

Per component, over its session series:
1. Aggregate to one value per date (median of that date's sessions).
2. Mid-range window: last **5** dates; require at least **4** distinct dates,
   otherwise `stable` (insufficient data — never guess from 2–3 points).
3. **Theil-Sen** slope over **calendar days** (median of all pairwise slopes,
   ips/day) — one outlier date/session cannot flip the fit, and irregular
   import spacing is weighted correctly.
4. Projected change across the window's day span (`delta = slope × span_days`)
   normalised by the window mean (`rel_change`).
5. **Mann-Kendall consistency gate**: Kendall's tau over the window values;
   `|tau| ≥ 0.5` required — a zigzag series with a small net drift stays
   `stable`; only consistent movement classifies.
6. **Residual-noise gate** (v0.8.5): `|delta|` must also be ≥ **2×** the MAD
   of the fit residuals — the projected change has to clear the series' own
   scatter, so a jittery-but-flat component never classifies as trending.
7. **Sharp-reversal veto** (fixed v0.8.6): the last date landing ≥ 35% of
   `|delta|` (floored at 0.02 ips) **off the fitted line** against the trend
   cancels the call — a comp that rose for four dates then collapsed is NOT
   flagged Deteriorating (`reversal` field carries `"fall"`/`"rise"`).
   Judged on the last date's **residual from the Theil-Sen fit**, not the
   step from the previous date, so an outlier spike one date earlier can't
   fake a reversal while the last value still sits on the trend.
8. Classify: `delta ≥ +0.02 ips` **and** `rel_change ≥ +15%` **and**
   `tau ≥ +0.5` **and** the noise gate → `up` (Deteriorating); mirrored
   negatives → `down` (Recovering); else `stable`. The relative gate scales
   with the component's level; the absolute gate stops near-zero noise from
   tripping it.

**As-of-date trend maps** (v0.8.5): `computeTrendMapsByDate` (renderer) and
`computeTrendMap(importDir, asOfDate)` (main) evaluate the trend using only
the history up to a given import date, so Recent Imports rows and incident
entries carry the trend the fleet would have seen **on that date** — rows no
longer all show today's identical counts.

Consumers (all fed from the same algorithm):
- `aggregateCompStatus` → TopBar tail-dropdown incident ▲, Dashboard
  TrendsWidget, DefaultPage TailCard trend bubbles, Charts comp-list arrows +
  trend filters, Charts header trend pill
- `computeImportSummary` → ↑/→/↓ counts on Recent Imports rows + widget,
  computed from that import date's own as-of trend map and the date's
  latest-session measurements
- `main.cjs` incident scan → tracker `entry.trend` / `entry.reason`
  (`trend` / `limit+trend`) → Dashboard ActionsWidget ↑ Deteriorating count,
  Reports entry pills, generated report Trend column. Trend-only entries
  additionally require the up call to hold **3 consecutive import dates**
  (`TREND_STREAK_DATES` / `computeSustainedUp`, v0.8.6)
- `ComponentChart` → dashed Theil-Sen segment over the fitted window (the
  textual trend tag lives only in the Charts header pill — the on-chart badge
  and its days-to-limit note were removed in v0.8.5)
- `import_vxp.py` → per-session `comps[].trend` + summary (best-effort within
  the PDF's own dates; authoritative values recomputed over full history)

## 7. Scoring (legacy — not wired)

`scoring.js` was removed in v0.8.2 (unused). The formula is kept here for future reference.

Penalty-based 0–100 health score:
- ALERT/CRITICAL → 3 pts penalty
- CAUTION → 1 pt penalty
- UP trend → +0.5 pts
- DOWN trend → −0.3 pts

`score = max(0, 100 − (penalty / count) × 10)`

---

## 8. Component List (96 VXP components)

Defined in `frontend/src/data/limits.js` as `LIMITS` dict.
Source: `non_test_data_global_limits_only.xlsx` Session 1 (10-06-2025).
14 entries have populated limits; 82 are `null` (White / N/A in UI).

Subsystems (by location suffix): MAIN ROTOR · XMSNF · XMSNL · HB 1 · HB 2 · TR FA · IGB V · HB 3 · ENG1C · ENG2C

Populated limits (`[lower, caution, critical]`):
- `MR VERT | LHVRT+RHVRT` → [0.20, 0.30, 0.50]
- `MR ROLL | LHVRT-RHVRT` → [0.20, 0.30, 0.50]
- `M/R 1P | LHVRT` → [0.20, 0.30, 0.50]
- `M/R 1P | RHLAT` → [0.20, 0.30, 0.50]
- `M/R 1P | PHVRT` → [0.20, 0.30, 0.50]
- `M/R 1P | RHVRT` → [0.20, 0.30, 0.50]
- `M/R 4P | LHVRT` → [0.60, 0.70, 0.80]
- `M/R 4P | RHLAT` → [0.60, 0.70, 0.80]
- `M/R 4P | PHVRT` → [0.60, 0.70, 0.80]
- `M/R 4P | RHVRT` → [0.60, 0.70, 0.80]
- `TRDS SO1 | HB 3` → [0.60, 0.90, 1.30]
- `TRDS SO2 | HB 3` → [1.00, 2.00, 3.00]
- `T/R DS | HB 3`   → [0.70, 1.00, 1.50]
- `T/R DS 2P | HB 3` → [0.70, 1.00, 1.50]

---

## 9. Module Status

| Module                       | Status           | Notes                                          |
|------------------------------|------------------|------------------------------------------------|
| Navigation / TopBar          | ✅ Implemented    | Dynamic fleet dropdown; per-tail incident dots; VXP badge pulse animation |
| BottomBar / Export           | ✅ Implemented    | Export button global (no tail required) opens the Export modal (v0.9.0): kind (Report PDF / Charts PDF / Data Excel) + tail pickers, per-kind controls; progress bar (green) in the BottomBar centre, toast with saved path |
| Default Page — fleet grid    | ✅ Implemented    | TailCard: 96-comp N/A·Normal·Caution·Critical + Recovering·Stable·Deteriorating bubbles |
| Default Page — fleet CRUD    | ✅ Implemented    | Add / Edit / Remove with amber/red hover UX    |
| TailModal                    | ✅ Implemented    | Tail / AC type / limits mode; restore prompt. On Restore Data with custom limits mode and nothing configured in the modal, the restored `custom_limits.json` is adopted instead of overwritten with `{}` (v0.9.7). System field hardcoded VXP (see §12 to restore) |
| Custom limits configurator   | ✅ Implemented    | LimitsPanel + EditLimitModal; writes `custom_limits.json` |
| ImportResultsModal           | ✅ Implemented (v0.9.9) | Post-import popup listing each Skipped (duplicate / already-imported) or Failed (unknown/ambiguous tail, no sessions, parse/save error) file with its reason; shown only when the batch had skips/failures |
| Fleet persistence            | ✅ Implemented    | IPC + localStorage two-tier; startup preloads all tails |
| Tail data-package lifecycle  | ✅ Implemented    | create / check / archive / remove (move) / restore |
| Dashboard (4 widgets)        | ✅ Implemented    | LimitsWidget: full pie; TrendsWidget: all 96 comps; Actions widget: latest 3 comps with pending actions, one row per comp — name · location · per-comp `xC\|xCr\|x↑` pending breakdown · latest pending date (v0.8.9); row click deep-links to Reports |
| Charts + CompList            | ✅ Implemented    | Purge: comment field + success toast; Restore: multi-backup selection modal; loading state while listing backups |
| Reports                      | ✅ Implemented    | Entry-level sign model (v0.8.7): applying an action signs that date, fully-actioned comp = Signed (no Sign Off button); Actions Pending (amber, with count badge) / Signed Actions (green) tabs filter entries + comps; Generate Report + View Reports side by side pinned at the bottom of the comp list, same plain `.btn` style and tab shape, tabs `flex:1` to match their width (v0.8.9; View Reports lists ALL generated reports for the tail, rows show the included comp names); detail-pane fallback selection respects the active tab — filter-aware 📋 empty state when nothing matches (v0.8.9); per-entry See Chart deep-link to the marked data point; `↩ FROM CHART` redirected-from marker on entries deep-linked from the chart sign modal (v0.8.9); Revert Action in Signed tab; optional report name at generation; Generate modal lists all comps with ≥ 1 actioned entry (matches the Signed tab count) — all selectable, only signed entries compiled, informational pending tag on partially-actioned rows, search box, list scrolls after 4 items (v0.8.9); signer chosen only at report generation; action pick-list user-managed, shared `ActionDropdown` component (✕ style matches signer dropdown); detail-pane entry rows sorted newest-first by date (v0.9.2) |
| Recent Imports page          | ✅ Implemented    | Header shows N Dates N Sessions; one-row entries (date · sessions · times · file · **Total: N** comps measured, v0.8.6); View File modal; select/bulk-remove |
| ComponentChart               | ✅ Implemented    | Dual X-axis (date + "N sessions"), min-width date columns that widen so each HH:MM session tick keeps ≥ 36 px (labels never mash, v0.8.6), horizontal scroll (opens at latest data; mouse-wheel, ‹ › buttons top-right, Left/Right arrow keys), pinned always-visible Y axis (v0.8.6), limit lines, dashed trend segment (no on-chart badge since v0.8.5); header shows limit-status + trend pills; incident data points tinted by status with "!" when unactioned, tooltip shows the applied action (v0.8.7); See Chart deep-link ring-marks + centres the entry's point; clicking a pending incident point opens the Sign Action modal (pointer cursor, widened hit area, click-through hover dot, v0.8.9) |
| Edit Limits Modal            | ✅ Implemented    | 2-step confirmation (global system limits)     |
| Purge Modal                  | ✅ Implemented    | Typed confirmation, backup                     |
| Signer Dropdown              | ✅ Implemented    | Add/remove with IPC write-through              |
| LoadingOverlay               | ✅ Implemented    | S-76D swept-tip SVG rotor spinner (215 px)     |
| SQLite DB                    | 🗑 Removed (v0.8.2) | `db.py` deleted — unused; JSON files are the data store |
| VXP Import pipeline          | ✅ Implemented    | `import_vxp.py` (pdfplumber); tail auto-detected from PDF header; **multi-file select** (v0.9.9) — PDFs processed sequentially, valid ones imported and skipped/failed ones reported via `ImportResultsModal`; inline toolbar progress with per-file counter |
| HUMS Import pipeline         | ⏸ Decoupled       | see §12                                        |
| Export (chart/report/excel)  | ✅ Implemented (v0.9.0) | `ExportModal.jsx` + `utils/exportUtils.js` + IPC `export:pdf`/`export:excel`; report → A4 multi-page PDF (letterhead, repeating table headers); charts → static SVG PDF over a date range, comps split into Part k/N sub-range charts above 30 points; Excel via `source/export_excel.py` (openpyxl, prototype styling, limit-driven yellow/red row fills); View Reports letterhead Export button uses the same PDF path |
| Trend detection              | ✅ Implemented (v0.8.6) | Theil-Sen over last 5 dates (min 4), median per date, residual-noise gate, residual-based reversal veto, as-of-date trend maps; `source/trend_detection.py` (reference) mirrored in `main.cjs` + `utils/trendDetection.js`; feeds all trend indicators + chart trend segment — see §7a |

---

## 10. Hard Constraints

1. Electron window: 1440×900 default, minWidth 1100, minHeight 680
2. All colours via CSS variables — no hardcoded hex in components
3. `./README.md` and `./ToDo.txt` in project root must not be modified
4. All IPC handlers that take a `tail` parameter must validate it with `isValidTail()` before any `path.join`
5. Purge always creates a backup in `data/backups/{tail}/` before deleting
6. Entry-level sign model: applying an action signs that entry (date); report generation compiles **signed entries only** — every included component must carry ≥ 1 applied action, pending entries do not exist for generation until signed — plus a signer (AME), recorded only on the generated document. A limit-status escalation clears the entry's action (kept as `prev_action`) so the worse reading must be re-actioned before it can be reported
7. `LIMITS` dict in `limits.js` is the single source of truth for comp names/locations
8. Limit resolution order: `custom_limits.json` (per-tail file) → `comp_limits_{system}.json` (global) → `LIMITS` constant
9. Fleet mutations (add/edit/remove) must set `fleetDirty.current = true` to prevent IPC hydration from overwriting them
10. All displayed stats (N/A · Normal · Caution · Critical · Deteriorating · Stable · Recovering) must be derived from `aggregateCompStatus` over `ALL_COMP_KEYS` — never from raw session measurement counts or mock data
11. Status labels: Normal / Caution / Critical (not "ok", "Alert"). Trend labels: Deteriorating / Stable / Recovering (not "Improving", "Increasing", "Decreasing"). Use `statusLabel()` / `trendLabel()` from `constants/status.js`

---

## 11. TODO / Planned Features

### 11.0 HUMS decoupling (v0.8.0)

HUMS tails, UI guards, dual-limits loading, and HUMS import routing were removed for the VXP 1.0 MVP.
Integration points are preserved (see §12). Data directories for HUMS tails are kept on disk.

### 11.1 Reports — 3-category model (not yet designed)

Reports should fall into three distinct categories based on what occurred on a given flight date:

| Category       | Trigger                                              | Behaviour                                        |
|----------------|------------------------------------------------------|--------------------------------------------------|
| **Pending**    | Incident occurred (alert/caution); no action taken   | Report awaits AME sign-off                       |
| **Signed**     | Incident occurred; action recorded + signed by AME   | Report complete                                  |
| **Non-incident** | No alert/caution on that date                      | Auto-generated default maintenance-log record    |

**Design notes:**
- Non-incident reports are generated automatically for flight dates that produce no caution/alert measurements.
- All three categories should be accessible from the Reports page; the existing filter tabs (All / Pending / Signed) may need a "Non-incident" tab.
- Report list rows already have a "View Report" button placeholder.
- Not planned yet — wireframe and data-model design required before implementation.

---

## 12. HUMS Re-Integration Spec

All HUMS code was removed in v0.8.0 (VXP 1.0 MVP). This section documents exactly what to restore.
Integration point comments (`// Integration point:`) are left in the codebase.

### 12.1 HUMS Tails (re-add to `tailIndex.js` + `fleetStore.js`)

| Tail   | System | Type   |
|--------|--------|--------|
| 4X-BEX | hums   | S76C++ |
| 4X-BHS | hums   | S76C++ |
| 4X-BOA | hums   | S76C++ |
| 4X-BOB | hums   | S76C++ |
| 4X-BOI | hums   | S76C++ |

**`tailIndex.js`** — restore:
```js
export const HUMS_TAILS = new Set(['4X-BEX', '4X-BHS', '4X-BOA', '4X-BOB', '4X-BOI'])
export const WIP_TAILS  = new Set(['4X-BEX', '4X-BHS', '4X-BOA', '4X-BOB', '4X-BOI'])

export function tailType(tail)    { return HUMS_TAILS.has(tail) ? 'hums' : 'vxp' }
export function isWip(tail)       { return WIP_TAILS.has(tail) }
export function systemBadge(tail) { return HUMS_TAILS.has(tail) ? 'HUMS' : 'VXP' }
```
Also re-add HUMS tails to the `TAILS` array and `AIRCRAFT_TYPES` map.

**`fleetStore.js`** — add back to `DEFAULT_FLEET`:
```js
{ tail: '4X-BEX', acType: 'S76C++', systemType: 'hums', limitsMode: 'global', customLimits: {} },
{ tail: '4X-BHS', acType: 'S76C++', systemType: 'hums', limitsMode: 'global', customLimits: {} },
{ tail: '4X-BOA', acType: 'S76C++', systemType: 'hums', limitsMode: 'global', customLimits: {} },
{ tail: '4X-BOB', acType: 'S76C++', systemType: 'hums', limitsMode: 'global', customLimits: {} },
{ tail: '4X-BOI', acType: 'S76C++', systemType: 'hums', limitsMode: 'global', customLimits: {} },
```

### 12.2 App.jsx

**State** — add: `const [humsLimits, setHumsLimits] = useState(null)`

**Bootstrap init()** — restore dual load:
```js
const [vxp, hums, fleetData] = await Promise.allSettled([
  api.loadLimits('vxp'),
  api.loadLimits('hums'),
  loadFleetFromIPC(),
])
if (vxp.status  === 'fulfilled' && vxp.value)  setVxpLimits(vxp.value)
if (hums.status === 'fulfilled' && hums.value)  setHumsLimits(hums.value)
```

**editableLimits useMemo** — restore HUMS branch and dependency:
```js
const override = fi.systemType === 'hums' ? humsLimits : vxpLimits
// dep array: [..., vxpLimits, humsLimits, ...]
```

**handleSaveLimit** — restore HUMS branch:
```js
const tt = fi?.systemType ?? tailType(activeTail)
// in the else block:
const updated = tt === 'hums'
  ? { ...(humsLimits ?? {}), [compKey]: values }
  : { ...(vxpLimits  ?? {}), [compKey]: values }
if (tt === 'hums') setHumsLimits(updated)
else               setVxpLimits(updated)
const result = await window.electronAPI?.saveLimits(tt, updated)
```

### 12.3 Dashboard.jsx

**LimitsWidget** — add HUMS guard before the `hasLimit` declaration:
```jsx
function LimitsWidget({ compStatus, editableLimits, onSelect, systemType }) {
  if (systemType === 'hums') {
    return (
      <div className="card" ...>
        <WidgetHeader title="Limits Status" />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 28, opacity: 0.25 }}>📊</div>
          <div style={{ fontSize: 12, color: 'var(--subtext)', fontStyle: 'italic' }}>
            No limits defined for HUMS
          </div>
        </div>
      </div>
    )
  }
  // ...
```

**TrendsWidget** — restore per-system filter:
```js
function TrendsWidget({ compStatus, onSelect, systemType }) {
  const allComps = ALL_COMP_KEYS
    .filter(key => systemType === 'vxp' ? true : !!compStatus?.[key])
    .map(key => [key, compStatus?.[key] ?? { status: 'white', trend: 'stable' }])
```

**Dashboard export** — restore `systemType` local and pass to widgets:
```jsx
const systemType = fleetItem?.systemType
// ...
<LimitsWidget ... systemType={systemType} />
<TrendsWidget ... systemType={systemType} />
```

### 12.4 Charts.jsx

Add HUMS placeholder before the main return:
```jsx
if (fleetItem?.systemType === 'hums') {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--subtext)' }}>
      <div style={{ fontSize: 40, opacity: 0.22 }}>📊</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>No charts available for HUMS</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>HUMS component limits are not yet configured.</div>
    </div>
  )
}
```

### 12.5 DefaultPage.jsx (TailCard)

```js
const pillClass = systemType === 'vxp' ? 'blue' : 'green'
const sysLabel  = systemType === 'vxp' ? 'VXP' : 'HUMS'
```

### 12.6 TopBar.jsx (TailDropdown)

```jsx
const isVxp   = systemType === 'vxp'
// ...
background: isVxp ? 'rgba(74,158,255,0.18)' : 'rgba(46,204,113,0.15)',
color:      isVxp ? '#7bc3ff'               : '#2ecc71',
// ...
{isVxp ? 'VXP' : 'HUMS'}
```

### 12.7 TailModal.jsx

Restore `useState` for systemType:
```js
const [systemType, setSystemType] = useState(initial?.systemType ?? 'vxp')
```

Re-add system selector section in the form:
```jsx
{/* System */}
<div style={{ marginBottom: 14 }}>
  <label ...>System</label>
  <div style={{ display: 'flex', gap: 8 }}>
    {['vxp', 'hums'].map(s => (
      <button key={s} onClick={() => setSystemType(s)} className={`btn ${systemType === s ? 'primary' : ''}`} style={{ flex: 1, justifyContent: 'center' }}>
        {s.toUpperCase()}
      </button>
    ))}
  </div>
</div>
```

Restore limits mode label: `'Global (VXP / HUMS)'`

### 12.8 main.cjs

**limits:load / limits:save** — restore tailType param and ternary:
```js
ipcMain.handle('limits:load', (_e, tailType) => {
  const file = tailType === 'hums' ? 'comp_limits_hums.json' : 'comp_limits_vxp.json'
  return readJson(path.join(AC_DIR, file), {})
})
ipcMain.handle('limits:save', (_e, tailType, limits) => {
  const file = tailType === 'hums' ? 'comp_limits_hums.json' : 'comp_limits_vxp.json'
  try { writeJson(path.join(AC_DIR, file), limits); return { ok: true } } catch (e) { return { ok: false, error: e.message } }
})
```

**actions:load / actions:save** — restore tailType param and ternary (same pattern with `report_actions_hums.json`).

**import:pdf** — restore HUMS guard (until `import_hums.py` is implemented):
```js
const systemType = fleetItem.system ?? 'vxp'
if (systemType === 'hums') {
  resolve({ ok: false, error: 'HUMS import is not yet implemented.' })
  return
}
```

**Dialog title** — restore: `'Select VXP / HUMS Report PDF'`

### 12.9 Python backend

`source/import_handler.py` and the other unused Python modules were removed in the v0.8.2 cleanup
(only `import_vxp.py` is spawned, directly from `main.cjs`). To re-integrate HUMS, create a
`source/import_hums.py` that mirrors `import_vxp.py`'s CLI contract (PDF path arg, `--limits` JSON,
`PROGRESS n/total` on stderr, JSON import array on stdout) and spawn it from `main.cjs` when the
resolved fleet item has `system === 'hums'`.

### 12.10 Data files (already on disk)

- `data/global/S76C++/comp_limits_hums.json` — currently `{}`, needs engineering limits
- `data/global/S76C++/report_actions_hums.json` — currently `["No action required"]`
- `data/4X-BEX/`, `data/4X-BHS/`, `data/4X-BOA/`, `data/4X-BOB/`, `data/4X-BOI/` — empty data dirs kept on disk

### 12.11 Database

`db.py` was removed in v0.8.2 (unused — JSON files are the data store). If a database is
reintroduced, the old schema supported `system IN ('vxp','hums')`; recover it from git history.

---

## 13. Packaging & Distribution (v1.0.0, auto-update v1.0.1)

Windows packaging lives in `./Package` (full guide: `Package/Instructions.md`).

- **Build**: `powershell -ExecutionPolicy Bypass -File .\Package\build-package.ps1` →
  `Package\HUMS VXP Monitoring Install.exe` (version read from `frontend/package.json`).
  Stages the Electron runtime manually (exe renamed → `app.isPackaged` true; app code in
  `resources\app`, Python in `resources\source`) and compiles `installer.nsi` with NSIS
  (portable copy in `Package\tools` → system `makensis` incl. standard install dirs →
  SourceForge download, in that order — v1.0.1). No electron-builder.
- **Installed layout**: `<chosen folder>\HUMS VXP Monitoring\` — exe + runtime, `data\`,
  `version.txt`, `Uninstall.exe`. `main.cjs` resolves `DATA_ROOT` next to the exe when
  packaged (`SOURCE_DIR` → `resources\source`); dev paths unchanged.
- **Update = same installer over the same folder**: app-owned paths are wiped by explicit
  list; `data\` is never enumerated, deleted or overwritten (hard constraint §10 in spirit —
  the installer must never touch user data). Silent: `/S [/D=dir]`, exit 5 if app running.
- **First-run seeding** (`main.cjs ensureDataSeed`): additive-only creation of the fleet
  registry (seeded with `4X-BHT`), `report_signer.json`, `comp_limits_vxp.json` and per-tail
  `imports\`/`reports\` scaffolds. Never overwrites; `report_actions_vxp.json` deliberately
  excluded (missing ⇒ built-in defaults vs `[]` ⇒ user-emptied, see `actions:load`).
- **Auto-update (v1.0.1, implemented — `electron/updater.cjs`)**: ~3 s after startup —
  `net.isOnline()` gate → unauthenticated GitHub `releases/latest` check on
  `package.json → updateRepo` (public repo `s1natex/HUMS_VXP_Monitoring`; tag `vX.Y.Z` vs
  `app.getVersion()`) → auto-download of the `.exe` asset to temp (progress events,
  write backpressure, truncation guard) → `UpdateBanner` prompts *Restart & Update* → app
  quits and a detached cmd script retries the silent installer (`/S /D=<install dir>`,
  exit 5 = still locked, ≤ 60 tries) then relaunches. Startup check failures are silent;
  the BottomBar version label (runtime `app:version`, clickable) runs manual checks with
  toast outcomes and a pulsing *Checking for updates…* indicator. Dev mode never installs.
  A re-check only short-circuits to the *Restart & Update* prompt while the downloaded
  installer still exists in temp; a stale download (temp cleanup) is discarded and
  re-fetched (v1.0.2). Uninstaller (v1.0.1) **always** keeps `data\` — the delete prompt
  was removed.
- **Release pipeline (v1.0.1)**: `Package\publish-release.ps1` (CHANGELOG section →
  release notes; `gh` CLI or `GITHUB_TOKEN` REST) and `.github\workflows\release.yml` —
  push to `main` releases automatically when the `package.json` version has no GitHub
  release yet (version bump = ship); NSIS via choco; built-in token, no secrets.
  The CHANGELOG is read as UTF-8 and the notes file is written BOM-less (v1.0.2 — PS 5.1
  otherwise decodes BOM-less UTF-8 as ANSI, publishing mojibake release notes).
