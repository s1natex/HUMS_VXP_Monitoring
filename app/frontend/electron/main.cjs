const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { initUpdater } = require('./updater.cjs')

// Packaged: the exe sits in the install root (Desktop\HUMS VXP Monitoring) with
// data\ beside it — updates replace app files only and must never touch data\.
// Dev: resolves into the repo's app\ tree as before.
const APP_ROOT   = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', '..')
const DATA_ROOT  = path.join(APP_ROOT, 'data')
const GLOBAL_DIR = path.join(DATA_ROOT, 'global')           // signers + fleet
const AC_DIR     = path.join(GLOBAL_DIR, 'S76C++')          // per-type limits + actions

// Default VXP limits — mirrors import_vxp.py DEFAULT_LIMITS (only the keyed entries).
const VXP_DEFAULT_LIMITS = {
  'MR VERT | LHVRT+RHVRT':  [0.20, 0.30, 0.50],
  'MR ROLL | LHVRT-RHVRT':  [0.20, 0.30, 0.50],
  'M/R 1P | LHVRT':         [0.20, 0.30, 0.50],
  'M/R 4P | LHVRT':         [0.60, 0.70, 0.80],
  'M/R 1P | RHLAT':         [0.20, 0.30, 0.50],
  'M/R 4P | RHLAT':         [0.60, 0.70, 0.80],
  'M/R 1P | PHVRT':         [0.20, 0.30, 0.50],
  'M/R 4P | PHVRT':         [0.60, 0.70, 0.80],
  'M/R 1P | RHVRT':         [0.20, 0.30, 0.50],
  'M/R 4P | RHVRT':         [0.60, 0.70, 0.80],
  'TRDS SO2 | HB 3':        [1.00, 2.00, 3.00],
  'T/R DS 2P | HB 3':       [0.70, 1.00, 1.50],
  'T/R DS | HB 3':          [0.70, 1.00, 1.50],
  'TRDS SO1 | HB 3':        [0.60, 0.90, 1.30],
}

function getEffectiveLimits(tail, fleetItem) {
  const overrides = readJson(path.join(AC_DIR, 'comp_limits_vxp.json'), {})
  const base = { ...VXP_DEFAULT_LIMITS, ...overrides }
  // Per-tail custom limits override the global set, mirroring the renderer's
  // editableLimits so incident scanning agrees with what the UI shows.
  if (tail && fleetItem?.limits_mode === 'custom') {
    const custom = readJson(path.join(DATA_ROOT, tail, 'custom_limits.json'), null)
      ?? fleetItem.custom_limits ?? {}
    return { ...base, ...custom }
  }
  return base
}

// Individual thresholds may be null (user cleared the field in EditLimitModal);
// `avgMeas >= null` coerces null to 0 and would flag everything, so each level
// is guarded — mirrors the renderer's getLimitStatus and Python's get_status.
function compLimitStatus(compKey, avgMeas, limits) {
  const t = limits[compKey]
  if (!t || typeof avgMeas !== 'number') return 'white'
  const [lower, caution, critical] = t
  if (critical != null && avgMeas >= critical) return 'alert'
  if (caution  != null && avgMeas >= caution)  return 'caution'
  if (lower    != null && avgMeas >= lower)    return 'ok'
  return 'white'
}

// Filenames for per-component tracker JSONs must be filesystem-safe; comp keys
// contain '/' and '|' which are not. 96 fixed keys → collisions are not a concern.
function sanitizeCompKey(compKey) {
  return compKey.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_')
}

// DD-MM-YYYY → YYYY-MM-DD (chronologically sortable); mirrors the renderer's
// toSortableDate. Returns the input unchanged when it isn't a 3-part date.
function toSortableDate(ddmmyyyy) {
  const p = (ddmmyyyy ?? '').split('-')
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (ddmmyyyy ?? '')
}

// Fresh per-component incident tracker (see §4.3 of the spec).
function newTracker(compKey, tail) {
  return {
    comp_key: compKey, tail, status: 'pending',
    signer_id: null, signer_name: null, signed_at: null, entries: [],
  }
}

// Chronological session order; merged import files historically stored
// sessions newest-first, so writers and readers both normalize explicitly.
function bySessionStart(a, b) {
  return (a.started_at ?? '').localeCompare(b.started_at ?? '')
}

// ── Trend detection ───────────────────────────────────────────────────────────
// Mirrors app/source/trend_detection.py (reference implementation) and the
// renderer's src/utils/trendDetection.js — keep all three in sync.
//
// Per component: aggregate sessions to one value per date (median), fit a
// Theil-Sen slope over CALENDAR DAYS of the last TREND_WINDOW dates (need at
// least TREND_MIN_DATES), gate the projected change on relative + absolute
// thresholds and on the fit's residual noise, require Mann-Kendall
// consistency (|tau| ≥ TREND_MIN_TAU), and veto the call when the last date
// landed sharply off the fitted line against the trend.
const TREND_WINDOW        = 5     // analyse the last N import dates
const TREND_MIN_DATES     = 4     // fewer dates → 'stable' (insufficient data)
const TREND_REL_THRESHOLD = 0.15  // |projected change| ≥ 15% of window mean
const TREND_ABS_MIN_DELTA = 0.02  // …and ≥ 0.02 ips, so near-zero noise never trips
const TREND_MIN_TAU       = 0.5   // Mann-Kendall: |tau| ≥ 0.5 for a trend call
const TREND_REVERSAL_VETO = 0.35  // last date ≥ 35% of |delta| below the fit cancels
const TREND_NOISE_GATE    = 2.0   // …and |delta| ≥ 2× the residual MAD (fit noise)
// Incident scanning only: a trend-triggered action entry requires the 'up'
// classification to hold on this many CONSECUTIVE import dates (as-of-date
// maps). Limit hits (caution/alert) always qualify regardless of trend.
const TREND_STREAK_DATES  = 3

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// 'YYYY-MM-DD' → whole days since epoch, or null if unparseable.
function dayNumber(dateStr) {
  const t = Date.parse(`${dateStr}T00:00:00Z`)
  return Number.isNaN(t) ? null : Math.round(t / 86400000)
}

// Theil-Sen fit → { slope, intercept }: slope = median of all pairwise slopes,
// intercept = median residual at x = 0 (mirrors trendDetection.js theilSen).
function theilSen(xs, values) {
  const slopes = []
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (xs[j] !== xs[i]) slopes.push((values[j] - values[i]) / (xs[j] - xs[i]))
    }
  }
  if (!slopes.length) return { slope: 0, intercept: values.length ? median(values) : 0 }
  const slope = median(slopes)
  const intercept = median(values.map((v, i) => v - slope * xs[i]))
  return { slope, intercept }
}

// Median absolute deviation — robust scatter estimate of the fit residuals.
function medianAbsDev(values) {
  const m = median(values)
  return median(values.map(v => Math.abs(v - m)))
}

// Mann-Kendall consistency: (concordant − discordant) / all pairs ∈ [−1, 1].
function kendallTau(values) {
  const n = values.length
  if (n < 2) return 0
  let c = 0, d = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i]
      if (diff > 0) c++
      else if (diff < 0) d++
    }
  }
  return (c - d) / (n * (n - 1) / 2)
}

// dailyDates / dailyValues: per-date aggregates in chronological order.
function classifyTrend(dailyDates, dailyValues) {
  if (dailyValues.length < TREND_MIN_DATES) return 'stable'
  const dates = dailyDates.slice(-TREND_WINDOW)
  const vals  = dailyValues.slice(-TREND_WINDOW)

  const days = dates.map(dayNumber)
  const xs = days.every(d => d !== null)
    ? days.map(d => d - days[0])
    : vals.map((_, i) => i)

  const { slope, intercept } = theilSen(xs, vals)
  const delta = slope * (xs[xs.length - 1] - xs[0])
  const ref   = Math.max(vals.reduce((a, b) => a + b, 0) / vals.length, 1e-9)
  const rel   = delta / ref
  const tau   = kendallTau(vals)

  // Noise gate: the projected change must clear the scatter around the fit
  // (residual MAD) — a "trend" smaller than the series' own noise never
  // classifies (mirrors trendDetection.js / trend_detection.py).
  const noise = medianAbsDev(vals.map((v, i) => v - (intercept + slope * xs[i])))
  if (Math.abs(delta) < TREND_NOISE_GATE * noise) return 'stable'

  // Sharp-reversal veto on the last date's residual from the fit (not the
  // step from the previous date), so an outlier spike one date earlier can't
  // fake a reversal while the last value still sits on the trend.
  const lastResid = vals[vals.length - 1] - (intercept + slope * xs[xs.length - 1])
  const vetoSize = Math.max(TREND_ABS_MIN_DELTA, TREND_REVERSAL_VETO * Math.abs(delta))

  if (delta >= TREND_ABS_MIN_DELTA && rel >= TREND_REL_THRESHOLD && tau >= TREND_MIN_TAU) {
    return lastResid <= -vetoSize ? 'stable' : 'up'
  }
  if (delta <= -TREND_ABS_MIN_DELTA && rel <= -TREND_REL_THRESHOLD && tau <= -TREND_MIN_TAU) {
    return lastResid >= vetoSize ? 'stable' : 'down'
  }
  return 'stable'
}

// Reads and parses every import file of a tail once — computeTrendMap callers
// that need multiple as-of dates (multi-date PDFs) reuse the same array
// instead of re-reading the directory per date.
function loadImportFiles(importDir) {
  let files = []
  try {
    files = fs.readdirSync(importDir).filter(f => f.startsWith('date_import_') && f.endsWith('.json'))
  } catch {
    return []
  }
  return files.map(f => readJson(path.join(importDir, f), null)).filter(Boolean)
}

// Builds { compKey: 'up' | 'down' | 'stable' } from a tail's import objects
// (loadImportFiles), so incident scanning sees the trend over the full
// history, not just one PDF. asOfDate ('YYYY-MM-DD', optional): ignore dates
// after it, so incidents for an older date inside a multi-date PDF get the
// trend AS OF that date.
function computeTrendMap(importObjects, asOfDate = null) {
  const byComp = {}   // compKey → { 'YYYY-MM-DD' → [avg_meas…] }
  for (const imp of importObjects) {
    if ((imp?.date ?? '').split('-').length !== 3) continue   // DD-MM-YYYY
    const sortable = toSortableDate(imp.date)
    if (asOfDate && sortable > asOfDate) continue
    for (const session of (imp.sessions ?? [])) {
      for (const [key, meas] of Object.entries(session.comps ?? {})) {
        if (typeof meas?.avg_meas !== 'number') continue
        const dates = byComp[key] ?? (byComp[key] = {})
        ;(dates[sortable] ?? (dates[sortable] = [])).push(meas.avg_meas)
      }
    }
  }
  const map = {}
  for (const [key, dates] of Object.entries(byComp)) {
    const sorted = Object.keys(dates).sort()
    map[key] = classifyTrend(sorted, sorted.map(d => median(dates[d])))
  }
  return map
}

// Comp keys whose trend is 'up' on asOfDate AND on the TREND_STREAK_DATES − 1
// import dates before it — i.e. the up-trend has held at least
// TREND_STREAK_DATES import dates in a row. Feeds the trend criterion of
// scanImportForIncidents; mapFor caches computeTrendMap per as-of date so a
// multi-date PDF import doesn't recompute the same maps.
function computeSustainedUp(importObjects, asOfDate, mapFor) {
  const allDates = [...new Set(
    importObjects.map(i => toSortableDate(i.date)).filter(d => d.split('-').length === 3)
  )].sort()
  const idx = allDates.indexOf(asOfDate)
  const sustained = new Set()
  if (idx < TREND_STREAK_DATES - 1) return sustained
  const streakDates = allDates.slice(idx - (TREND_STREAK_DATES - 1), idx + 1)
  const maps = streakDates.map(mapFor)
  for (const [key, trend] of Object.entries(maps[maps.length - 1])) {
    if (trend === 'up' && maps.every(m => m[key] === 'up')) sustained.add(key)
  }
  return sustained
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// Filenames received over IPC must stay inside their intended directory.
function isSafeFilename(name) {
  return typeof name === 'string' && /^[^/\\]+\.json$/.test(name) && !name.includes('..')
}

// rename that tolerates an existing destination — on Windows renameSync throws
// when the target exists (e.g. remove → re-add → remove leaves same-named files
// in backups/), so the newer file replaces the stale one instead of aborting.
function moveFile(src, dst) {
  fs.rmSync(dst, { force: true })
  fs.renameSync(src, dst)
}

// Move all JSON files from srcDir into dstDir (creates dstDir only when there
// is something to move). Also moves the generated_reports/ subdirectory
// if present, so compiled Incident Report documents survive tail
// remove/restore/archive. Returns { files, movedGenerated }.
function moveJsonFiles(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return { files: 0, movedGenerated: false }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  const files = entries.filter(d => d.isFile() && d.name.endsWith('.json')).map(d => d.name)
  if (files.length) fs.mkdirSync(dstDir, { recursive: true })
  for (const f of files) {
    moveFile(path.join(srcDir, f), path.join(dstDir, f))
  }
  const genSrc = path.join(srcDir, 'generated_reports')
  const movedGenerated = fs.existsSync(genSrc)
  if (movedGenerated) {
    const genDst = path.join(dstDir, 'generated_reports')
    if (fs.existsSync(genDst)) {
      // Destination dir already exists (earlier removal) — merge file-by-file.
      for (const f of fs.readdirSync(genSrc)) {
        moveFile(path.join(genSrc, f), path.join(genDst, f))
      }
      try { fs.rmdirSync(genSrc) } catch {}
    } else {
      fs.mkdirSync(dstDir, { recursive: true })
      fs.renameSync(genSrc, genDst)
    }
  }
  return { files: files.length, movedGenerated }
}

// ── Limits (per aircraft type: S76C++) ────────────────────────────────────────

ipcMain.handle('limits:load', (_e, _tailType) => {
  return readJson(path.join(AC_DIR, 'comp_limits_vxp.json'), {})
})

ipcMain.handle('limits:save', (_e, _tailType, limits) => {
  try {
    writeJson(path.join(AC_DIR, 'comp_limits_vxp.json'), limits)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Imports ───────────────────────────────────────────────────────────────────

ipcMain.handle('imports:list', (_e, tail) => {
  if (!isValidTail(tail)) return []
  const dir = path.join(DATA_ROOT, tail, 'imports')
  try {
    // Filenames embed DD-MM-YYYY; flip to YYYY-MM-DD so the sort is
    // chronological (lexical order on day-first dates is wrong), newest first.
    const sortKey = f => f.slice('date_import_'.length, -'.json'.length).split('-').reverse().join('-')
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('date_import_') && f.endsWith('.json'))
      .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  } catch {
    return []
  }
})

ipcMain.handle('imports:load', (_e, tail, filename) => {
  if (!isValidTail(tail) || !isSafeFilename(filename)) return null
  const imp = readJson(path.join(DATA_ROOT, tail, 'imports', filename), null)
  // Normalize legacy newest-first files so the renderer always sees sessions
  // in chronological order (times list, session tabs, series extraction).
  if (Array.isArray(imp?.sessions)) imp.sessions = [...imp.sessions].sort(bySessionStart)
  return imp
})

ipcMain.handle('imports:delete', (_e, tail, filename) => {
  if (!isValidTail(tail) || !isSafeFilename(filename)) {
    return { ok: false, error: 'Invalid arguments' }
  }
  try {
    fs.unlinkSync(path.join(DATA_ROOT, tail, 'imports', filename))
    // Strip any tracker entries whose data came from this import date — that data
    // no longer exists. Deletes the tracker file entirely if it becomes empty.
    const date = filename.replace('date_import_', '').replace('.json', '')
    let entriesRemoved = 0
    const dir = compReportsDir(tail)
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.json'))
      for (const d of files) {
        const filePath = path.join(dir, d.name)
        const tracker = readJson(filePath, null)
        if (!tracker?.entries?.length) continue
        const before = tracker.entries.length
        tracker.entries = tracker.entries.filter(en => en.date !== date)
        entriesRemoved += before - tracker.entries.length
        if (!tracker.entries.length) fs.unlinkSync(filePath)
        else if (tracker.entries.length !== before) writeJson(filePath, tracker)
      }
    } catch {}
    return { ok: true, entriesRemoved }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Reports: per-component incident trackers ───────────────────────────────────
// One JSON per component per tail (data/{tail}/reports/{sanitizedCompKey}.json).
// Each tracker accumulates entries — individual sessions where the component hit
// caution/critical limits or an up-trend was detected. Signing is a bulk action
// over the whole tracker (see reports:save-component) and requires every entry to
// already have an action. A new entry after signing reopens the tracker.
// Compiled, formal Incident Report documents live separately under generated_reports/.

function compReportsDir(tail) {
  return path.join(DATA_ROOT, tail, 'reports')
}

function generatedReportsDir(tail) {
  return path.join(compReportsDir(tail), 'generated_reports')
}

// Legacy migration: trackers written before v0.8.5 hold one entry per
// (session, component); the model is now one entry per (date, component) based
// on the date's latest session. Collapses each date group to the entry of its
// latest session (session ids embed the start timestamp, so lexical order is
// chronological), carrying over an applied action from a discarded duplicate
// when the kept entry has none. Returns true when the tracker changed.
function collapseTrackerEntries(tracker) {
  const entries = tracker?.entries
  if (!Array.isArray(entries) || !entries.length) return false
  const byDate = new Map()   // insertion order == first-seen entry order
  for (const en of entries) {
    const group = byDate.get(en.date) ?? []
    group.push(en)
    byDate.set(en.date, group)
  }
  if ([...byDate.values()].every(g => g.length === 1)) return false

  tracker.entries = [...byDate.values()].map(group => {
    if (group.length === 1) return group[0]
    const kept = { ...group.reduce((a, b) => ((a.session_id ?? '') >= (b.session_id ?? '') ? a : b)) }
    kept.entry_id = `${kept.date}__${sanitizeCompKey(tracker.comp_key)}`
    kept.action = kept.action ?? group.find(g => g.action)?.action ?? null
    return kept
  })
  return true
}

// One-shot pass at startup: collapse legacy per-session tracker entries for
// every tail on disk, so the read handlers stay read-only and pay no
// per-call migration cost.
function migrateAllTrackers() {
  let dirs = []
  try {
    dirs = fs.readdirSync(DATA_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && isValidTail(d.name))
      .map(d => d.name)
  } catch {
    return
  }
  for (const tail of dirs) {
    const dir = compReportsDir(tail)
    let files = []
    try {
      files = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.json'))
    } catch {
      continue
    }
    for (const d of files) {
      const filePath = path.join(dir, d.name)
      const tracker = readJson(filePath, null)
      if (tracker && typeof tracker.comp_key === 'string' && collapseTrackerEntries(tracker)) {
        try { writeJson(filePath, tracker) } catch (e) {
          console.warn(`Tracker migration failed for ${filePath}:`, e.message)
        }
      }
    }
  }
}

ipcMain.handle('reports:list-components', (_e, tail) => {
  if (!isValidTail(tail)) return []
  const dir = compReportsDir(tail)
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.json'))
      .map(d => readJson(path.join(dir, d.name), null))
      // Guards against stray/legacy JSON files in reports/ that aren't component
      // trackers (e.g. an old-schema report_*.json) — those lack comp_key and
      // would crash the renderer's `tracker.comp_key.split(' | ')`.
      .filter(t => t && typeof t.comp_key === 'string')
  } catch {
    return []
  }
})

ipcMain.handle('reports:load-component', (_e, tail, compKey) => {
  if (!isValidTail(tail)) return null
  return readJson(path.join(compReportsDir(tail), `${sanitizeCompKey(compKey)}.json`), null)
})

ipcMain.handle('reports:save-component', (_e, tail, compKey, data) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  try {
    writeJson(path.join(compReportsDir(tail), `${sanitizeCompKey(compKey)}.json`), data)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Limit-status severity order, for the escalation check below
// ('critical' is the legacy alias of 'alert').
const LIMIT_SEVERITY = { ok: 0, caution: 1, alert: 2, critical: 2 }

// Scans a newly-saved import for caution/critical limit hits or a SUSTAINED
// up-trend (classified 'up' on at least TREND_STREAK_DATES consecutive import
// dates — a single up call is not enough to demand an action), keeping ONE
// entry per (date, component) in that component's tracker — judged on the
// date's chronologically LATEST session, not every session.
// Re-scanning the same session is a no-op. When a newer session arrives for
// an already-recorded date:
//   - un-actioned entry + still qualifying → refreshed in place (pending)
//   - un-actioned entry + latest session clean → entry removed (the date no
//     longer has an incident)
//   - actioned entry → untouched, EXCEPT a limit-status escalation (e.g.
//     caution → alert), which refreshes the snapshot and CLEARS the applied
//     action (preserved as prev_action) so the worse reading returns to
//     pending — under the entry-level sign model an entry counts as signed
//     exactly when it has an action, so clearing it is what forces re-review.
function scanImportForIncidents(tail, imp, limits, trendMap = {}, sustainedUp = new Set()) {
  const reportDir = compReportsDir(tail)
  fs.mkdirSync(reportDir, { recursive: true })
  const now = new Date().toISOString()
  let created = 0

  // Per comp: the measurement from the date's latest session (merged import
  // files may store sessions newest-first, so order by started_at explicitly).
  const ordered = [...(imp.sessions ?? [])].sort(bySessionStart)
  const latest = {}   // compKey → { meas, sessionId }
  for (const session of ordered) {
    for (const [compKey, meas] of Object.entries(session.comps ?? {})) {
      latest[compKey] = { meas, sessionId: session.session_id }
    }
  }

  for (const [compKey, { meas, sessionId }] of Object.entries(latest)) {
    const limitStatus = compLimitStatus(compKey, meas.avg_meas, limits)
    // Trend at scan time over the tail's import history up to this date;
    // stored on the entry as a snapshot of why the incident was recorded.
    const trend = trendMap[compKey] ?? 'stable'
    const limitHit  = limitStatus === 'caution' || limitStatus === 'alert'
    // Trend alone only opens an incident when the up call has held for
    // TREND_STREAK_DATES consecutive import dates (computed by the caller).
    const upTrend   = sustainedUp.has(compKey)
    const qualifies = limitHit || upTrend

    const file = path.join(reportDir, `${sanitizeCompKey(compKey)}.json`)
    const tracker = readJson(file, null)
    // Corrupt/old-schema tracker without an entries array must not abort the
    // whole scan (the import handler's catch would swallow every incident).
    if (tracker && !Array.isArray(tracker.entries)) tracker.entries = []
    // A tracker missing comp_key is filtered out of reports:list-components,
    // so every incident recorded into it would be invisible forever — heal it.
    if (tracker && typeof tracker.comp_key !== 'string') tracker.comp_key = compKey
    if (tracker && typeof tracker.tail !== 'string') tracker.tail = tail

    const entryId = `${imp.date}__${sanitizeCompKey(compKey)}`
    const snapshot = {
      date:         imp.date,
      session_id:   sessionId,
      avg_meas:     meas.avg_meas,
      limit_status: limitHit ? limitStatus : 'ok',
      trend,
      reason:       limitHit && upTrend ? 'limit+trend' : limitHit ? 'limit' : 'trend',
    }

    // One entry per date: match the per-date id or any legacy per-session
    // entry recorded for the same date.
    const existing = tracker?.entries.find(en => en.entry_id === entryId || en.date === imp.date)

    if (!existing) {
      if (!qualifies) continue
      const t = tracker ?? newTracker(compKey, tail)
      t.entries.unshift({ entry_id: entryId, ...snapshot, action: null, created_at: now })
      t.status = 'pending'
      writeJson(file, t)
      created++
      continue
    }

    if (existing.session_id === sessionId) continue   // same session — nothing new

    if (!existing.action) {
      if (qualifies) {
        Object.assign(existing, snapshot, { entry_id: entryId })
        tracker.status = 'pending'
      } else {
        // The date's latest session cleared the incident — drop the stale
        // un-actioned entry (and the tracker file when it empties out).
        tracker.entries = tracker.entries.filter(en => en !== existing)
        if (!tracker.entries.length) {
          try { fs.unlinkSync(file) } catch {}
          continue
        }
      }
      writeJson(file, tracker)
      continue
    }

    // Actioned entry: only an escalation may touch it — the worse reading must
    // be re-reviewed, so the applied action is cleared (kept as prev_action)
    // and the date drops back to pending. The renderer derives signed purely
    // from entries having actions, so this is the only way the escalation
    // stays visible (and blocks report generation) until re-actioned.
    if (qualifies &&
        (LIMIT_SEVERITY[snapshot.limit_status] ?? 0) > (LIMIT_SEVERITY[existing.limit_status] ?? 0)) {
      Object.assign(existing, snapshot, { entry_id: entryId, prev_action: existing.action, action: null })
      tracker.status = 'pending'
      writeJson(file, tracker)
    }
  }
  return created
}

// ── Reports: generated (compiled) Incident Report documents ────────────────────

ipcMain.handle('reports:list-generated', (_e, tail) => {
  if (!isValidTail(tail)) return []
  const dir = generatedReportsDir(tail)
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => readJson(path.join(dir, f), null))
      .filter(Boolean)
  } catch {
    return []
  }
})

ipcMain.handle('reports:load-generated', (_e, tail, filename) => {
  if (!isValidTail(tail) || !isSafeFilename(filename)) return null
  return readJson(path.join(generatedReportsDir(tail), filename), null)
})

ipcMain.handle('reports:save-generated', (_e, tail, filename, data) => {
  if (!isValidTail(tail) || !isSafeFilename(filename)) {
    return { ok: false, error: 'Invalid arguments' }
  }
  try {
    writeJson(path.join(generatedReportsDir(tail), filename), data)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Signers ───────────────────────────────────────────────────────────────────

ipcMain.handle('signers:load', () => {
  return readJson(path.join(GLOBAL_DIR, 'report_signer.json'), [])
})

ipcMain.handle('signers:save', (_e, signers) => {
  try {
    writeJson(path.join(GLOBAL_DIR, 'report_signer.json'), signers)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Actions (per aircraft type) ───────────────────────────────────────────────

ipcMain.handle('actions:load', (_e) => {
  // null (not []) when the file is missing/corrupt — the renderer must be able
  // to tell "no saved list yet" (keep the built-in defaults) from "the user
  // deliberately emptied the list" (an existing file holding []).
  return readJson(path.join(AC_DIR, 'report_actions_vxp.json'), null)
})

ipcMain.handle('actions:save', (_e, _tailType, actions) => {
  try {
    writeJson(path.join(AC_DIR, 'report_actions_vxp.json'), actions)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Purge ─────────────────────────────────────────────────────────────────────

ipcMain.handle('purge:comp', (_e, tail, compKey, comment) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  const importDir = path.join(DATA_ROOT, tail, 'imports')
  const backupDir = path.join(DATA_ROOT, 'backups', tail)
  fs.mkdirSync(backupDir, { recursive: true })

  const purgedData = []
  let fileCount = 0

  try {
    // Pass 1: collect what would be purged WITHOUT touching any file, so the
    // backup can be written before the first deletion — a failure anywhere
    // must never leave purged data with no backup on disk.
    const files = fs.readdirSync(importDir).filter(f => f.endsWith('.json'))
    const toModify = []   // { file, data, sessions: [session refs holding compKey] }
    for (const file of files) {
      const data = readJson(path.join(importDir, file))
      if (!data) continue
      const hit = []
      for (const session of (data.sessions || [])) {
        if (session.comps && session.comps[compKey] !== undefined) {
          purgedData.push({ file, session_id: session.session_id, value: session.comps[compKey] })
          hit.push(session)
        }
      }
      if (hit.length) toModify.push({ file, data, sessions: hit })
    }

    // Tracker entries for the purged sessions get stripped too — the data they
    // reference no longer exists (mirrors imports:delete). The removed entries
    // (incl. applied actions) are snapshotted into the backup so a restore can
    // bring them back exactly as they were.
    const purgedSessionIds = new Set(purgedData.map(p => p.session_id))
    const trackerFile = path.join(compReportsDir(tail), `${sanitizeCompKey(compKey)}.json`)
    const tracker = readJson(trackerFile, null)
    const removedTrackerEntries =
      (tracker?.entries ?? []).filter(en => purgedSessionIds.has(en.session_id))

    // Backup FIRST…
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupKey = compKey.replace(/[|\/\s]/g, '_')
    writeJson(path.join(backupDir, `${backupKey}_purged_${timestamp}.json`), {
      tail, compKey, purged_at: new Date().toISOString(),
      comment: comment || '',
      entries: purgedData,
      tracker_entries: removedTrackerEntries,
    })

    // …then apply the deletions.
    for (const { file, data, sessions } of toModify) {
      for (const session of sessions) delete session.comps[compKey]
      writeJson(path.join(importDir, file), data)
      fileCount++
    }
    if (removedTrackerEntries.length) {
      tracker.entries = tracker.entries.filter(en => !purgedSessionIds.has(en.session_id))
      if (!tracker.entries.length) fs.unlinkSync(trackerFile)
      else writeJson(trackerFile, tracker)
    }

    return { ok: true, files_modified: fileCount, entries_purged: purgedData.length }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Backup: list purge backups for a component ────────────────────────────────

ipcMain.handle('backup:list-comp', (_e, tail, compKey) => {
  if (!isValidTail(tail)) return []
  const backupDir = path.join(DATA_ROOT, 'backups', tail)
  const backupKey = compKey.replace(/[|\/\s]/g, '_')
  try {
    if (!fs.existsSync(backupDir)) return []
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(backupKey + '_purged_') && f.endsWith('.json'))
      .sort().reverse() // newest first
    return files.map(f => {
      const data = readJson(path.join(backupDir, f), {})
      return {
        filename:     f,
        purged_at:    data.purged_at ?? null,
        comment:      data.comment   ?? '',
        entries_count: (data.entries ?? []).length,
      }
    })
  } catch {
    return []
  }
})

// ── Backup: restore a purged component from a specific (or most-recent) backup ─

ipcMain.handle('backup:restore-comp', (_e, tail, compKey, backupFilename) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  if (backupFilename && !isSafeFilename(backupFilename)) {
    return { ok: false, error: 'Invalid backup filename' }
  }
  const backupDir = path.join(DATA_ROOT, 'backups', tail)
  const importDir = path.join(DATA_ROOT, tail, 'imports')
  const backupKey = compKey.replace(/[|\/\s]/g, '_')

  try {
    if (!fs.existsSync(backupDir)) return { ok: false, error: 'No backup directory found' }

    // Use specified backup file, or fall back to most-recent
    let targetFile = backupFilename
    if (!targetFile) {
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(backupKey + '_purged_') && f.endsWith('.json'))
        .sort()
      if (!files.length) return { ok: false, error: 'No purge backup found for this component' }
      targetFile = files[files.length - 1]
    }

    const backup = readJson(path.join(backupDir, targetFile))
    if (!backup?.entries?.length) return { ok: false, error: 'Backup is empty' }

    // Group entries by file so each file is read/written at most once.
    const byFile = {}
    for (const entry of backup.entries) {
      if (!byFile[entry.file]) byFile[entry.file] = []
      byFile[entry.file].push(entry)
    }

    let restored = 0
    for (const [file, entries] of Object.entries(byFile)) {
      const importPath = path.join(importDir, file)
      const data = readJson(importPath)
      if (!data) continue
      let fileModified = false
      for (const entry of entries) {
        for (const session of (data.sessions || [])) {
          if (session.session_id === entry.session_id) {
            session.comps = session.comps || {}
            session.comps[compKey] = entry.value
            restored++
            fileModified = true
          }
        }
      }
      // Only write back when at least one session was actually updated.
      if (fileModified) writeJson(importPath, data)
    }

    // Re-insert the tracker entries removed at purge time (incl. their applied
    // actions), deduped on entry_id. The tracker reopens to 'pending' so the
    // restored incidents get re-reviewed.
    if (restored > 0 && backup.tracker_entries?.length) {
      const trackerFile = path.join(compReportsDir(tail), `${sanitizeCompKey(compKey)}.json`)
      const tracker = readJson(trackerFile, null) ?? newTracker(compKey, tail)
      const existingIds = new Set(tracker.entries.map(en => en.entry_id))
      const toInsert = backup.tracker_entries.filter(en => !existingIds.has(en.entry_id))
      if (toInsert.length) {
        tracker.entries = [...toInsert, ...tracker.entries]
        // Pre-v0.8.5 backups carry per-session entry ids that the id-based
        // dedup above can't match against migrated per-date ids — collapse
        // any same-date duplicates the merge just introduced.
        collapseTrackerEntries(tracker)
        tracker.status = 'pending'
        writeJson(trackerFile, tracker)
      }
    }

    // Only delete the backup when data was successfully restored; preserve it if
    // no sessions matched (e.g. import files were re-imported with different IDs).
    if (restored > 0) {
      fs.unlinkSync(path.join(backupDir, targetFile))
    }

    return { ok: true, restored }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Check whether a purge backup exists for a given comp
ipcMain.handle('backup:check-comp', (_e, tail, compKey) => {
  if (!isValidTail(tail)) return false
  const backupDir = path.join(DATA_ROOT, 'backups', tail)
  const backupKey = compKey.replace(/[|\/\s]/g, '_')
  try {
    if (!fs.existsSync(backupDir)) return false
    return fs.readdirSync(backupDir)
      .some(f => f.startsWith(backupKey + '_purged_') && f.endsWith('.json'))
  } catch {
    return false
  }
})

// ── Tail data-package management ──────────────────────────────────────────────

// Guard against path-traversal: tail must be alphanumeric + hyphens, no slashes or dots.
function isValidTail(tail) {
  return typeof tail === 'string' && /^[A-Z0-9][A-Z0-9\-]{1,14}$/.test(tail)
}

// Create directory scaffold when a new tail is added to the fleet. Idempotent.
ipcMain.handle('tail:create', (_e, tail) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  try {
    fs.mkdirSync(path.join(DATA_ROOT, tail, 'imports'), { recursive: true })
    fs.mkdirSync(path.join(DATA_ROOT, tail, 'reports'), { recursive: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Check whether data exists for a tail — checks live dir first, then backup.
// Returns null if nothing found, or { importCount, reportCount, firstDate, lastDate, fromBackup } if found.
ipcMain.handle('tail:check', (_e, tail) => {
  if (!isValidTail(tail)) return null

  function scanDir(importDir, reportDir) {
    const imports = fs.existsSync(importDir)
      ? fs.readdirSync(importDir).filter(f => f.startsWith('date_import_') && f.endsWith('.json'))
      : []
    const reports = fs.existsSync(reportDir)
      ? fs.readdirSync(reportDir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.json'))
      : []
    return { imports, reports }
  }

  // Check live tail directory first
  const live = scanDir(
    path.join(DATA_ROOT, tail, 'imports'),
    path.join(DATA_ROOT, tail, 'reports'),
  )
  if (live.imports.length || live.reports.length) {
    return buildCheckResult(live.imports, live.reports, false)
  }

  // Check backup directory
  const backup = scanDir(
    path.join(DATA_ROOT, 'backups', tail, 'imports'),
    path.join(DATA_ROOT, 'backups', tail, 'reports'),
  )
  if (backup.imports.length || backup.reports.length) {
    return buildCheckResult(backup.imports, backup.reports, true)
  }

  return null
})

function buildCheckResult(imports, reports, fromBackup) {
  const dates = imports
    .map(f => f.replace('date_import_', '').replace('.json', ''))
    .filter(d => /^\d{2}-\d{2}-\d{4}$/.test(d))
    .sort((a, b) => {
      const toISO = s => { const p = s.split('-'); return `${p[2]}-${p[1]}-${p[0]}` }
      return toISO(a).localeCompare(toISO(b))
    })
  return {
    importCount: imports.length,
    reportCount: reports.length,
    firstDate:   dates[0] ?? null,
    lastDate:    dates[dates.length - 1] ?? null,
    fromBackup,
  }
}

// Remove tail: MOVE data from data/{tail}/ to data/backups/{tail}/ then write
// metadata. A backup (and its metadata record) is only created when the tail
// actually had data — removing an empty tail leaves no trace in backups/.
ipcMain.handle('tail:remove-backup', (_e, tail) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  try {
    const backupDir = path.join(DATA_ROOT, 'backups', tail)

    let totalMoved = 0
    let movedAnything = false
    for (const sub of ['imports', 'reports']) {
      const srcDir = path.join(DATA_ROOT, tail, sub)
      const dstDir = path.join(backupDir, sub)
      const { files, movedGenerated } = moveJsonFiles(srcDir, dstDir)
      totalMoved += files
      movedAnything = movedAnything || files > 0 || movedGenerated
      try { if (fs.existsSync(srcDir)) fs.rmdirSync(srcDir) } catch {}
    }
    // Move custom_limits.json to backup if present; it lives in the tail root,
    // not in imports/ or reports/, so moveJsonFiles doesn't touch it.
    const customLimitsPath = path.join(DATA_ROOT, tail, 'custom_limits.json')
    if (fs.existsSync(customLimitsPath)) {
      fs.mkdirSync(backupDir, { recursive: true })
      moveFile(customLimitsPath, path.join(backupDir, 'custom_limits.json'))
      movedAnything = true
    }
    // Now that the tail root should be empty, remove it.
    try { fs.rmdirSync(path.join(DATA_ROOT, tail)) } catch {}

    if (movedAnything) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      writeJson(path.join(backupDir, `removal_${timestamp}.json`), {
        tail,
        removed_at:  new Date().toISOString(),
        files_moved: totalMoved,
        note: 'Data moved to backup on removal. Re-add tail to restore.',
      })
    }
    return { ok: true, files_moved: totalMoved }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Restore tail data from backup/ back into data/{tail}/.
ipcMain.handle('tail:restore', (_e, tail) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  try {
    const backupDir = path.join(DATA_ROOT, 'backups', tail)
    let totalMoved = 0
    for (const sub of ['imports', 'reports']) {
      const srcDir = path.join(backupDir, sub)
      const dstDir = path.join(DATA_ROOT, tail, sub)
      const { files } = moveJsonFiles(srcDir, dstDir)
      totalMoved += files
      try { if (fs.existsSync(srcDir)) fs.rmdirSync(srcDir) } catch {}
    }
    // Restore custom_limits.json if it was backed up alongside the data.
    const backedUpCustomLimits = path.join(backupDir, 'custom_limits.json')
    if (fs.existsSync(backedUpCustomLimits)) {
      fs.mkdirSync(path.join(DATA_ROOT, tail), { recursive: true })
      moveFile(backedUpCustomLimits, path.join(DATA_ROOT, tail, 'custom_limits.json'))
    }
    return { ok: true, files_restored: totalMoved }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Archive existing tail data to a timestamped backup ("start fresh" path).
ipcMain.handle('tail:archive-data', (_e, tail) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  try {
    const tailDir    = path.join(DATA_ROOT, tail)
    const backupDir  = path.join(DATA_ROOT, 'backups', tail)
    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const archiveDir = path.join(backupDir, `archived_${timestamp}`)

    for (const sub of ['imports', 'reports']) {
      const srcDir = path.join(tailDir, sub)
      const dstDir = path.join(archiveDir, sub)
      moveJsonFiles(srcDir, dstDir)
      try { if (fs.existsSync(srcDir)) fs.rmdirSync(srcDir) } catch {}
    }
    // Archive custom_limits.json too (tail root, so moveJsonFiles misses it) —
    // otherwise a stale file would shadow the fresh registry custom limits in
    // getEffectiveLimits when the re-added tail switches to custom mode.
    const customLimitsPath = path.join(tailDir, 'custom_limits.json')
    if (fs.existsSync(customLimitsPath)) {
      fs.mkdirSync(archiveDir, { recursive: true })
      moveFile(customLimitsPath, path.join(archiveDir, 'custom_limits.json'))
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Per-tail custom limits ────────────────────────────────────────────────────

ipcMain.handle('custom-limits:load', (_e, tail) => {
  if (!isValidTail(tail)) return null
  const file = path.join(DATA_ROOT, tail, 'custom_limits.json')
  return fs.existsSync(file) ? readJson(file, null) : null
})

ipcMain.handle('custom-limits:save', (_e, tail, limits) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  try {
    writeJson(path.join(DATA_ROOT, tail, 'custom_limits.json'), limits)
    return { ok: true }
  } catch (e) {
    // Every other write handler resolves { ok:false, error } — a thrown write
    // here instead REJECTED the invoke, so handleSaveLimit's result.ok path
    // never surfaced the reason and TailModal's .catch swallowed it silently.
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('custom-limits:delete', (_e, tail) => {
  if (!isValidTail(tail)) return { ok: false, error: 'Invalid tail identifier' }
  const file = path.join(DATA_ROOT, tail, 'custom_limits.json')
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Import PDF ────────────────────────────────────────────────────────────────
// Resolves tail from fleet registry, spawns the VXP Python parser,
// saves one JSON file per session-date, and auto-creates a report per date.

// Packaged: Python scripts ship in resources\source (not next to data\, so an
// update can replace them wholesale). Dev: the repo's app\source.
const SOURCE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'source')
  : path.join(__dirname, '..', '..', 'source')

// Packaged builds ship their own Python (resources\python — embeddable runtime
// with pdfplumber/openpyxl baked in by build-package.ps1), so user PCs need no
// Python install. Falls back to the system launcher when the bundle is absent
// (dev mode, or a pre-bundle install that was updated in place).
function pythonCommand() {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'python', 'python.exe')
    if (fs.existsSync(bundled)) return bundled
  }
  return process.platform === 'win32' ? 'py' : 'python3'
}

ipcMain.handle('import:pdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select VXP Report PDF(s)',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (canceled || !filePaths.length) return { ok: false, cancelled: true }

  const scriptPath = path.join(SOURCE_DIR, 'import_vxp.py')
  const limitsJson = JSON.stringify(readJson(path.join(AC_DIR, 'comp_limits_vxp.json'), {}))
  const fileCount  = filePaths.length

  // Process one PDF end-to-end. Returns an outcome object — it never throws or
  // aborts the batch; a bad file yields { ok:false, reason } (or skipped:true
  // for duplicates / full-overlap) so the loop can continue to the next file.
  function importOnePdf(pdfPath, fileIndex) {
    const pdfName = path.basename(pdfPath)
    let pdfHash
    try {
      pdfHash = crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex')
    } catch (e) {
      return Promise.resolve({ ok: false, reason: `Could not read file: ${e.message}` })
    }

    // Overall batch pct: files before this one are done; within this file the
    // page fraction spans up to ~95% (100% is emitted once the whole batch ends).
    const emitProgress = (pageFraction, page, total) => {
      const pct = Math.round(((fileIndex + Math.min(pageFraction, 0.95)) / fileCount) * 100)
      event.sender.send('import:progress', { pct, page, total, fileIndex, fileCount })
    }
    emitProgress(0, 0, 0)

    return new Promise((resolve) => {
      const proc = spawn(pythonCommand(), [scriptPath, pdfPath, '--limits', limitsJson])
      let stdout = ''

      proc.stderr.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          const m = line.match(/^PROGRESS (\d+)\/(\d+)/)
          if (m) {
            const page = parseInt(m[1]), total = parseInt(m[2])
            emitProgress(total ? page / total : 0, page, total)
          }
        }
      })

      proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ ok: false, reason: `Python exited with code ${code}` })
          return
        }
        let importObjects
        try { importObjects = JSON.parse(stdout) } catch (e) {
          resolve({ ok: false, reason: `Failed to parse Python output: ${e.message}` })
          return
        }
        if (!Array.isArray(importObjects) || !importObjects.length) {
          resolve({ ok: false, reason: 'No sessions found in PDF' })
          return
        }

        // Resolve full tail from fleet registry using the suffix extracted by Python.
        // Exact match wins; suffix match used as fallback but must be unambiguous.
        const tailSuffix = (importObjects[0]?.tail_suffix || '').toUpperCase()
        // An empty suffix would suffix-match every tail (endsWith('') is always
        // true) and silently import into a single-tail fleet — reject instead.
        if (!tailSuffix) {
          resolve({ ok: false, reason: 'Could not detect the aircraft tail from the PDF header (A/C # …_TAIL).' })
          return
        }
        const fleetData  = readJson(path.join(GLOBAL_DIR, 'tail_number_tags_vxp_hums_index.json'), { tails: [] })
        const exactMatch  = (fleetData.tails ?? []).find(t => t.tail.toUpperCase() === tailSuffix)
        const suffixMatches = exactMatch ? [] : (fleetData.tails ?? []).filter(t =>
          t.tail.toUpperCase().endsWith(tailSuffix)
        )
        if (!exactMatch && suffixMatches.length === 0) {
          resolve({ ok: false, reason: `Aircraft "${tailSuffix}" not found in fleet. Please add it first.` })
          return
        }
        if (!exactMatch && suffixMatches.length > 1) {
          const names = suffixMatches.map(m => m.tail).join(', ')
          resolve({ ok: false, reason: `Ambiguous tail "${tailSuffix}" — matches multiple aircraft (${names}). Check fleet registry.` })
          return
        }
        const fleetItem = exactMatch ?? suffixMatches[0]
        const tail      = fleetItem.tail
        const importDir = path.join(DATA_ROOT, tail, 'imports')

        // ── Duplicate PDF guard ───────────────────────────────────────────────
        // Reject by filename OR content hash so renamed re-imports are also blocked.
        if (fs.existsSync(importDir)) {
          const existingImports = fs.readdirSync(importDir)
            .filter(f => f.endsWith('.json'))
            .map(f => readJson(path.join(importDir, f), null))
            .filter(Boolean)
          const alreadyImported = existingImports.some(d =>
            d.source_file === pdfName || d.source_hash === pdfHash ||
            (Array.isArray(d.source_hashes) && d.source_hashes.includes(pdfHash))
          )
          if (alreadyImported) {
            // The PDF's hash also lives on its OTHER date files, so after one of
            // its dates was deleted (imports:delete) a blanket block would make
            // that date unrecoverable — re-importing the PDF is the only way to
            // get it back. Only block when every session the PDF carries is
            // still on disk (session ids are deterministic, so a re-parse of the
            // same PDF reproduces them); otherwise fall through to the
            // session-level dedup, which merges just the missing sessions.
            const onDisk = new Set(
              existingImports.flatMap(d => (d.sessions ?? []).map(s => s.session_id))
            )
            const hasMissing = importObjects.some(imp =>
              (imp.sessions ?? []).some(s => !onDisk.has(s.session_id))
            )
            if (!hasMissing) {
              resolve({ ok: false, skipped: true, tail, reason: `Already imported for ${tail} (duplicate filename or content).` })
              return
            }
          }
        }

        // ── Save import files (session-level dedup) ───────────────────────────
        const savedFiles = []
        try {
          for (const imp of importObjects) {
            const filename = `date_import_${imp.date}.json`
            const filePath = path.join(importDir, filename)
            const existing = readJson(filePath, null)
            const { tail_suffix: _sf, ...impToSave } = { ...imp, tail, source_hash: pdfHash }
            if (existing?.sessions && impToSave.sessions) {
              const existingIds = new Set(existing.sessions.map(s => s.session_id))
              const newSessions = impToSave.sessions.filter(s => !existingIds.has(s.session_id))
              if (newSessions.length) {
                // Store merged sessions chronologically so consumers can trust
                // array order (pre-v0.8.5 merges prepended newest-first).
                const sessions = [...newSessions, ...existing.sessions].sort(bySessionStart)
                // The merge overwrites source_file/source_hash with the newest
                // PDF's identity — keep every contributing PDF's hash so the
                // duplicate guard still recognizes a re-import of the ORIGINAL.
                const source_hashes = [...new Set(
                  [...(existing.source_hashes ?? []), existing.source_hash, pdfHash].filter(Boolean)
                )]
                writeJson(filePath, { ...impToSave, sessions, source_hashes })
                savedFiles.push({ filename, sessions_added: newSessions.length })
              }
            } else {
              writeJson(filePath, impToSave)
              savedFiles.push({ filename, sessions_added: (impToSave.sessions ?? []).length })
            }
          }
        } catch (e) {
          resolve({ ok: false, tail, reason: `Failed to save import: ${e.message}` })
          return
        }

        // A PDF whose every session was already on disk writes no new files —
        // report it as skipped (nothing new) rather than a silent success.
        if (!savedFiles.length) {
          resolve({ ok: false, skipped: true, tail, reason: `No new sessions for ${tail} (already imported).` })
          return
        }

        // ── Scan for incidents (caution/critical/sustained up-trend) ──────────
        // Appends one entry per (date, component) — latest session of the date —
        // to each affected component's tracker JSON. Trend maps are computed
        // AFTER the new files are saved (so they include this PDF) and AS OF
        // each import's own date, so older dates in a multi-date PDF get the
        // trend the fleet would have seen on that date. A trend-only incident
        // additionally needs the up call to have held TREND_STREAK_DATES
        // import dates in a row (computeSustainedUp).
        let incidentsCreated = 0
        try {
          const limits = getEffectiveLimits(tail, fleetItem)
          const allImports = loadImportFiles(importDir)   // read the dir once, reuse per date
          const mapCache = {}
          const mapFor = d => (mapCache[d] ??= computeTrendMap(allImports, d))
          for (const imp of importObjects) {
            const asOf = toSortableDate(imp.date)
            const sustainedUp = computeSustainedUp(allImports, asOf, mapFor)
            // Scan the SAVED import for this date (merged with any pre-existing
            // sessions), not the raw PDF object — "the date's latest session"
            // must be judged over the whole merged day, or a backfill PDF that
            // adds an EARLIER session would overwrite entries with older data.
            const saved = allImports.find(i => i.date === imp.date) ?? imp
            incidentsCreated += scanImportForIncidents(tail, saved, limits, mapFor(asOf), sustainedUp)
          }
        } catch (e) {
          console.warn('Incident scan failed:', e.message)
        }

        resolve({
          ok: true, tail,
          files:     savedFiles,
          dates:     importObjects.map(i => i.date),
          incidents: incidentsCreated,
        })
      })

      proc.on('error', (e) => {
        resolve({ ok: false, reason: `Failed to start Python: ${e.message}` })
      })
    })
  }

  // Process selected PDFs sequentially: two files may target the same tail/date,
  // and in-order processing lets each one see the previous one's saved files, so
  // the duplicate guard + session-level dedup stay correct with no extra state.
  const results = []
  for (let i = 0; i < filePaths.length; i++) {
    const r = await importOnePdf(filePaths[i], i)
    results.push({ file: path.basename(filePaths[i]), ...r })
  }

  event.sender.send('import:progress', { pct: 100, fileIndex: fileCount, fileCount })

  return {
    ok: true,
    results,
    tails:          [...new Set(results.filter(r => r.ok).map(r => r.tail))],
    imported:       results.filter(r => r.ok && r.files?.length).length,
    skipped:        results.filter(r => !r.ok && r.skipped).length,
    failed:         results.filter(r => !r.ok && !r.skipped).length,
    totalDates:     results.reduce((n, r) => n + (r.files?.length ?? 0), 0),
    totalIncidents: results.reduce((n, r) => n + (r.incidents ?? 0), 0),
  }
})

// ── Fleet ─────────────────────────────────────────────────────────────────────

const FLEET_FILE = path.join(GLOBAL_DIR, 'tail_number_tags_vxp_hums_index.json')

ipcMain.handle('fleet:load', () => {
  // null (not an empty registry) when the file is missing — a file that exists
  // with tails: [] is a deliberately emptied fleet and must be honoured, not
  // silently replaced by the renderer's default/cached fleet.
  return readJson(FLEET_FILE, null)
})

ipcMain.handle('fleet:save', (_e, data) => {
  try {
    writeJson(FLEET_FILE, data)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Export ────────────────────────────────────────────────────────────────────
// PDF: the renderer builds a self-contained HTML document (letterhead reports
// or SVG chart pages); it is rendered in a hidden window and printed to A4 via
// printToPDF — page size/margins come from the document's @page CSS, so long
// content flows onto as many pages as needed.

ipcMain.handle('export:pdf', async (event, html, defaultFilename) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export PDF',
    defaultPath: defaultFilename,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { ok: false, cancelled: true }

  const tmpHtml = path.join(app.getPath('temp'), `vxp_export_${Date.now()}.html`)
  let pdfWin = null
  try {
    fs.writeFileSync(tmpHtml, html, 'utf-8')
    pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    await pdfWin.loadFile(tmpHtml)
    const buf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,   // honour the document's @page { size: A4 }
    })
    fs.writeFileSync(filePath, buf)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    pdfWin?.destroy()
    try { fs.unlinkSync(tmpHtml) } catch {}
  }
})

// Excel: the renderer flattens the selected date range's sessions into a
// payload; source/export_excel.py (openpyxl) writes the styled workbook —
// same spawn pattern as import:pdf.
ipcMain.handle('export:excel', async (event, payload, defaultFilename) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Excel',
    defaultPath: defaultFilename,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  })
  if (canceled || !filePath) return { ok: false, cancelled: true }

  const tmpPayload = path.join(app.getPath('temp'), `vxp_export_${Date.now()}.json`)
  try {
    fs.writeFileSync(tmpPayload, JSON.stringify(payload), 'utf-8')
  } catch (e) {
    return { ok: false, error: e.message }
  }

  const scriptPath = path.join(SOURCE_DIR, 'export_excel.py')
  return new Promise((resolve) => {
    const proc = spawn(pythonCommand(), [scriptPath, tmpPayload, filePath])
    let stdout = ''; let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('close', (code) => {
      try { fs.unlinkSync(tmpPayload) } catch {}
      let result = null
      try { result = JSON.parse(stdout.trim().split('\n').pop()) } catch {}
      if (result?.ok) {
        resolve({ ok: true, path: filePath, sessions: result.sessions, rows: result.rows })
      } else {
        resolve({ ok: false, error: result?.error ?? (stderr.trim() || `Python exited with code ${code}`) })
      }
    })
    proc.on('error', (e) => {
      try { fs.unlinkSync(tmpPayload) } catch {}
      resolve({ ok: false, error: `Failed to start Python: ${e.message}` })
    })
  })
})

// ── App version ───────────────────────────────────────────────────────────────
// Single source of truth is package.json's "version" (what the updater compares
// against release tags) — the BottomBar label reads it from here instead of
// hardcoding it, so a release bump can't leave a stale version on screen.

ipcMain.handle('app:version', () => app.getVersion())

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  Menu.setApplicationMenu(null)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#1e2228',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.maximize()

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ── First-run data seeding ────────────────────────────────────────────────────
// A fresh (or partially populated) data\ folder gets the baseline files that
// imports depend on — without the fleet registry every PDF import fails with
// "Aircraft not found in fleet". Strictly additive: each file is created only
// when missing; existing files are never modified, so deliberate user state
// (an emptied fleet, custom limits, …) survives restarts and app updates.
// report_actions_vxp.json is deliberately NOT seeded — a missing file means
// "use built-in defaults" while an existing [] means "user emptied the list"
// (see actions:load).
const SEED_FLEET = {
  schema_version: '2.1',
  tails: [
    { tail: '4X-BHT', system: 'vxp', aircraft_type: 'S-76C++', limits_mode: 'global', custom_limits: {} },
  ],
}

function ensureDataSeed() {
  try {
    const fleetFile = path.join(GLOBAL_DIR, 'tail_number_tags_vxp_hums_index.json')
    if (!fs.existsSync(fleetFile)) writeJson(fleetFile, SEED_FLEET)

    const signersFile = path.join(GLOBAL_DIR, 'report_signer.json')
    if (!fs.existsSync(signersFile)) writeJson(signersFile, [])

    const limitsFile = path.join(AC_DIR, 'comp_limits_vxp.json')
    if (!fs.existsSync(limitsFile)) writeJson(limitsFile, {})

    // Scaffold imports/ + reports/ for every registered tail — same shape
    // tail:create makes, idempotent. Driven by the registry (after the seed
    // above), so tails the user removed from the fleet are not resurrected.
    const fleet = readJson(fleetFile, { tails: [] })
    for (const t of fleet.tails ?? []) {
      if (!t?.tail || !isValidTail(t.tail)) continue
      fs.mkdirSync(path.join(DATA_ROOT, t.tail, 'imports'), { recursive: true })
      fs.mkdirSync(path.join(DATA_ROOT, t.tail, 'reports'), { recursive: true })
    }
  } catch (e) {
    // Seeding must never block startup; a real disk problem will surface with
    // a clear error on the first import/save anyway.
    console.error('Data seeding failed:', e)
  }
}

app.whenReady().then(() => {
  ensureDataSeed()       // fresh install: create baseline data files (additive only)
  migrateAllTrackers()   // collapse legacy per-session tracker entries (≤ v0.8.4)
  createWindow()
  initUpdater()          // startup GitHub-release check → auto-download → restart prompt
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
