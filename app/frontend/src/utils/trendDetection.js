// Trend detection — JS mirror of app/source/trend_detection.py (the reference
// implementation; algorithm details documented there). main.cjs carries the
// same logic for incident scanning. Keep constants and classification in sync.
//
// "up" = DETERIORATING · "down" = RECOVERING · "stable" = flat / not enough data
//
// Pipeline: median per date → Theil-Sen slope over CALENDAR DAYS (last
// TREND_WINDOW dates, min TREND_MIN_DATES) → relative + absolute gates →
// residual-noise gate (signal must exceed the scatter around the fit) →
// Mann-Kendall consistency gate → sharp-reversal veto (the last date landing
// far off the fitted line against the trend cancels the call and is
// reported via `reversal`).

export const TREND_WINDOW        = 5     // analyse the last N import dates
export const TREND_MIN_DATES     = 4     // fewer dates → 'stable' (insufficient data)
export const TREND_REL_THRESHOLD = 0.15  // |projected change| ≥ 15% of window mean
export const TREND_ABS_MIN_DELTA = 0.02  // …and ≥ 0.02 ips absolute
export const TREND_MIN_TAU       = 0.5   // Mann-Kendall: |tau| ≥ 0.5 for a trend call
export const TREND_REVERSAL_VETO = 0.35  // last date ≥ 35% of |delta| below the fit cancels
export const TREND_NOISE_GATE    = 2.0   // …and |delta| ≥ 2× the residual MAD (fit noise)

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Median absolute deviation — robust scatter estimate of the fit residuals.
function medianAbsDev(values) {
  const m = median(values)
  return median(values.map(v => Math.abs(v - m)))
}

// 'YYYY-MM-DD' → whole days since epoch, or null if unparseable.
function dayNumber(dateStr) {
  const t = Date.parse(`${dateStr}T00:00:00Z`)
  return Number.isNaN(t) ? null : Math.round(t / 86400000)
}

// Theil-Sen fit of values over positions xs → { slope, intercept }.
// slope = median of all pairwise slopes (robust to one outlier date), in
// value units per day when xs are calendar days; intercept = median residual
// at x = 0 (the first window date).
function theilSen(xs, values) {
  const n = values.length
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 }
  const slopes = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (xs[j] !== xs[i]) slopes.push((values[j] - values[i]) / (xs[j] - xs[i]))
    }
  }
  if (!slopes.length) return { slope: 0, intercept: median(values) }
  const slope = median(slopes)
  const intercept = median(values.map((v, i) => v - slope * xs[i]))
  return { slope, intercept }
}

// Mann-Kendall consistency: (concordant − discordant) / all pairs ∈ [−1, 1].
// Ties count in the denominator only, so flat-ish series score low.
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

// points: [{ date: 'YYYY-MM-DD', value }] session-level (multiple per date OK).
// Returns { trend, slope, intercept, delta, relChange, tau, spanDays, noise,
// reversal, dates } — `slope` is per day, `intercept` the fitted value at
// dates[0], `noise` the residual MAD of the fit, `reversal` is null or
// 'fall'/'rise' when a sharp last-date move against an otherwise-qualified
// trend cancelled the call.
export function detectTrend(points) {
  const byDate = {}
  for (const p of (points ?? [])) {
    if (typeof p.value !== 'number') continue
    ;(byDate[p.date] ?? (byDate[p.date] = [])).push(p.value)
  }
  const allDates = Object.keys(byDate).sort()
  const empty = { trend: 'stable', slope: 0, intercept: 0, delta: 0, relChange: 0,
                  tau: 0, spanDays: 0, noise: 0, reversal: null, dates: allDates }
  if (allDates.length < TREND_MIN_DATES) return empty

  const dates  = allDates.slice(-TREND_WINDOW)
  const values = dates.map(d => median(byDate[d]))

  // Calendar-day x positions; fall back to index spacing if a date is odd.
  const days = dates.map(dayNumber)
  const xs = days.every(d => d !== null)
    ? days.map(d => d - days[0])
    : values.map((_, i) => i)

  const { slope, intercept } = theilSen(xs, values)
  const spanDays = xs[xs.length - 1] - xs[0]
  const delta = slope * spanDays
  const ref   = Math.max(values.reduce((a, b) => a + b, 0) / values.length, 1e-9)
  const rel   = delta / ref
  const tau   = kendallTau(values)

  // Noise gate: the projected change must clear the scatter around the fit
  // (residual MAD), so a "trend" that is smaller than the series' own noise
  // never classifies — kills false calls on jittery-but-flat components.
  const noise = medianAbsDev(values.map((v, i) => v - (intercept + slope * xs[i])))
  const clearsNoise = Math.abs(delta) >= TREND_NOISE_GATE * noise

  // Sharp-reversal veto: the last date landing well off the FITTED LINE
  // against the trend breaks it RIGHT NOW — report stable, flag the reversal.
  // Judged on the last date's residual (not the step from the previous date),
  // so an outlier spike one date earlier can't fake a reversal while the last
  // value still sits on the trend.
  const lastResid = values[values.length - 1] - (intercept + slope * xs[xs.length - 1])
  const vetoSize = Math.max(TREND_ABS_MIN_DELTA, TREND_REVERSAL_VETO * Math.abs(delta))

  let trend = 'stable'
  let reversal = null
  if (delta >= TREND_ABS_MIN_DELTA && rel >= TREND_REL_THRESHOLD && tau >= TREND_MIN_TAU && clearsNoise) {
    if (lastResid <= -vetoSize) reversal = 'fall'
    else trend = 'up'
  } else if (delta <= -TREND_ABS_MIN_DELTA && rel <= -TREND_REL_THRESHOLD && tau <= -TREND_MIN_TAU && clearsNoise) {
    if (lastResid >= vetoSize) reversal = 'rise'
    else trend = 'down'
  }

  return { trend, slope, intercept, delta, relChange: rel, tau, spanDays, noise, reversal, dates }
}

// compKey → [{ date: 'YYYY-MM-DD', value }] across every session of every import.
function collectCompPoints(imports) {
  const byComp = {}
  for (const imp of (imports ?? [])) {
    const p = (imp.date ?? '').split('-')             // DD-MM-YYYY
    if (p.length !== 3) continue
    const date = `${p[2]}-${p[1]}-${p[0]}`
    for (const session of (imp.sessions ?? [])) {
      for (const [key, meas] of Object.entries(session.comps ?? {})) {
        if (typeof meas?.avg_meas !== 'number') continue
        ;(byComp[key] ?? (byComp[key] = [])).push({ date, value: meas.avg_meas })
      }
    }
  }
  return byComp
}

// Builds { compKey: 'up' | 'down' | 'stable' } from a tail's loaded imports —
// the live counterpart of main.cjs computeTrendMap (which reads from disk).
export function computeTrendMap(imports) {
  const map = {}
  for (const [key, points] of Object.entries(collectCompPoints(imports))) {
    map[key] = detectTrend(points).trend
  }
  return map
}

// Per-date trend maps: { 'YYYY-MM-DD': { compKey: trend } }, each computed from
// the history up to and including that date — the trend the fleet would have
// seen ON that date. Feeds the Recent Imports ↑/→/↓ counts so every import row
// shows its own date's trends instead of today's. The newest date's map equals
// computeTrendMap over the full history.
export function computeTrendMapsByDate(imports) {
  const byComp = collectCompPoints(imports)
  // Every import date gets a map — including dates with no numeric
  // measurements, whose trends carry over from the history before them.
  const dateSet = new Set()
  for (const imp of (imports ?? [])) {
    const p = (imp.date ?? '').split('-')               // DD-MM-YYYY
    if (p.length === 3) dateSet.add(`${p[2]}-${p[1]}-${p[0]}`)
  }
  const maps = {}
  for (const date of [...dateSet].sort()) {
    const map = {}
    for (const [key, points] of Object.entries(byComp)) {
      const upTo = points.filter(p => p.date <= date)
      if (upTo.length) map[key] = detectTrend(upTo).trend
    }
    maps[date] = map
  }
  return maps
}
