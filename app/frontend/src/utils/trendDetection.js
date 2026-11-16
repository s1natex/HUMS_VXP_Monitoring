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
// reported via `reversal`) → level-shift check (window vs the baseline dates
// right before it: an UP step overrides any slope call, a DOWN step only
// fills in 'stable'; reported via `shift`) → latest-measurement gate (the
// newest session must sit ≥ TREND_ABS_MIN_DELTA beyond where the trend line
// starts, or the call drops to 'stable').

export const TREND_WINDOW        = 5     // analyse the last N import dates
export const TREND_MIN_DATES     = 4     // fewer dates → 'stable' (insufficient data)
export const TREND_REL_THRESHOLD = 0.15  // |projected change| ≥ 15% of window mean
export const TREND_ABS_MIN_DELTA = 0.02  // …and ≥ 0.02 ips absolute
export const TREND_MIN_TAU       = 0.5   // Mann-Kendall: |tau| ≥ 0.5 for a trend call
export const TREND_REVERSAL_VETO = 0.35  // last date ≥ 35% of |delta| below the fit cancels
export const TREND_NOISE_GATE    = 2.0   // …and |delta| ≥ 2× the residual MAD (fit noise)
export const SHIFT_BASELINE      = 10    // baseline = up to N dates right before the window
export const SHIFT_MIN_BASELINE  = 5     // fewer baseline dates → no level-shift check
export const SHIFT_REL           = 0.30  // step ≥ 30% of the baseline level…
export const SHIFT_NOISE_GATE    = 4.0   // …and ≥ 4× the baseline MAD (its own scatter)
export const SHIFT_RECENT        = 3     // 'still shifted now': ≥ 2 of the last 3 dates beyond thr
export const SHIFT_ONSET_HITS    = 0.6   // onset run: ≥ 60% of its dates beyond the threshold

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

// Step change of the window vs the baseline just before it → { shift,
// baseline, level }: shift null | 'up' | 'down'; baseline = median of the last
// SHIFT_BASELINE prior values, level = median of the window. Called when the
// window median sits ≥ thr beyond the baseline (sustained) AND 2 of the last
// SHIFT_RECENT dates do too (still shifted now; one dip is tolerated).
function detectLevelShift(priorValues, windowValues) {
  const base = priorValues.slice(-SHIFT_BASELINE)
  if (base.length < SHIFT_MIN_BASELINE || !windowValues.length) {
    return { shift: null, baseline: null, level: null, thr: null }
  }
  const baseline = median(base)
  const level = median(windowValues)
  const thr = Math.max(TREND_ABS_MIN_DELTA, SHIFT_REL * Math.abs(baseline),
                       SHIFT_NOISE_GATE * medianAbsDev(base))
  const recent = windowValues.slice(-SHIFT_RECENT)
  const need = Math.floor(recent.length / 2) + 1          // majority of the last dates
  const upHits   = recent.filter(v => v - baseline >= thr).length
  const downHits = recent.filter(v => baseline - v >= thr).length
  let shift = null
  if (level - baseline >= thr && upHits >= need) shift = 'up'
  else if (baseline - level >= thr && downHits >= need) shift = 'down'
  return { shift, baseline, level, thr }
}

// Index where a level shift STARTED: the earliest date (within the last
// TREND_WINDOW + SHIFT_BASELINE dates) that is itself beyond the threshold and
// from which ≥ SHIFT_ONSET_HITS of the dates through the latest are too — a
// one-date dip inside the elevated band doesn't cut the run short.
function shiftOnset(values, shift, baseline, thr) {
  const sign = shift === 'up' ? 1 : -1
  const n = values.length
  let onset = n - 1, hits = 0
  for (let i = n - 1; i >= Math.max(0, n - TREND_WINDOW - SHIFT_BASELINE); i--) {
    const beyond = sign * (values[i] - baseline) >= thr
    if (beyond) hits++
    if (beyond && hits / (n - i) >= SHIFT_ONSET_HITS) onset = i
  }
  return onset
}

// Most recent measurement: the last session of the latest date. Points may
// carry `time` (session start, sortable string); the latest time wins, and
// ties / missing times fall back to input order.
function latestMeasurement(points) {
  let best = null
  ;(points ?? []).forEach((p, i) => {
    if (typeof p.value !== 'number') return
    const t = p.time ?? ''
    if (!best || p.date > best.date || (p.date === best.date && t >= best.time)) {
      best = { date: p.date, time: t, i, value: p.value }
    }
  })
  return best ? best.value : null
}

// points: [{ date: 'YYYY-MM-DD', value, time? }] session-level (multiple per date OK).
// Returns { trend, slope, intercept, delta, relChange, tau, spanDays, noise,
// reversal, dates } — `slope` is per day, `intercept` the fitted value at
// dates[0], `noise` the residual MAD of the fit, `reversal` is null or
// 'fall'/'rise' when a sharp last-date move against an otherwise-qualified
// trend cancelled the call; `shift` is null or 'up'/'down' when a level shift
// vs the pre-window baseline drove the call, with `baseline` / `level` the
// baseline and window medians (null when there is too little history);
// `onset` is the date the current trend started (first date of the level
// shift, or the window's first date for a slope call; null when stable) —
// charts draw the trend line from onset to the latest date; `current` is the
// most recent measurement (last session of the latest date).
export function detectTrend(points) {
  const byDate = {}
  for (const p of (points ?? [])) {
    if (typeof p.value !== 'number') continue
    ;(byDate[p.date] ?? (byDate[p.date] = [])).push(p.value)
  }
  const allDates = Object.keys(byDate).sort()
  const empty = { trend: 'stable', slope: 0, intercept: 0, delta: 0, relChange: 0,
                  tau: 0, spanDays: 0, noise: 0, reversal: null,
                  shift: null, baseline: null, level: null, onset: null,
                  current: latestMeasurement(points), dates: allDates }
  if (allDates.length < TREND_MIN_DATES) return empty

  const dates  = allDates.slice(-TREND_WINDOW)
  const values = dates.map(d => median(byDate[d]))
  const prior  = allDates.slice(0, -dates.length).map(d => median(byDate[d]))

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

  // Level shift vs the pre-window baseline: an UP step overrides any slope
  // call (far above baseline = deteriorating, even while easing inside the
  // new band); a DOWN step only fills in a 'stable' slope call, so a
  // component rebounding toward its old level still reads 'up'.
  let { shift, baseline, level, thr } = detectLevelShift(prior, values)
  let onset = trend !== 'stable' ? dates[0] : null
  if (shift === 'up' || (shift === 'down' && trend === 'stable')) {
    trend = shift
    reversal = null
    onset = allDates[shiftOnset([...prior, ...values], shift, baseline, thr)]
  } else {
    shift = null   // report a shift only when it drove the call
  }

  // Latest-measurement gate: the newest session must sit beyond where the
  // trend line starts (fit start for a slope call, baseline for a shift) —
  // the per-date median can hide a low final session.
  const current = latestMeasurement(points)
  if (trend !== 'stable' && current != null) {
    const start = shift ? baseline : intercept
    if ((trend === 'up'   && current - start < TREND_ABS_MIN_DELTA) ||
        (trend === 'down' && start - current < TREND_ABS_MIN_DELTA)) {
      trend = 'stable'
      shift = null
      onset = null
    }
  }

  return { trend, slope, intercept, delta, relChange: rel, tau, spanDays, noise, reversal,
           shift, baseline, level, onset, current, dates }
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
        ;(byComp[key] ?? (byComp[key] = [])).push({ date, time: session.started_at ?? '', value: meas.avg_meas })
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
