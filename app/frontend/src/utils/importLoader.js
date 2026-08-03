import { LIMITS } from '../data/limits'
import { getLimitStatus } from './limitStatus'
import { computeTrendMap } from './trendDetection'

// Converts DD-MM-YYYY → YYYY-MM-DD so localeCompare gives correct chronological order
export function toSortableDate(ddmmyyyy) {
  const p = ddmmyyyy?.split('-')
  return p?.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (ddmmyyyy ?? '')
}

// True if the comp key has a real limit array defined (not null, not absent)
function hasDefinedLimit(key, limitsMap) {
  return Array.isArray(limitsMap[key])
}

// trendMap: { compKey: 'up'|'down'|'stable' } AS OF this import's date
// (computeTrendMapsByDate), so each row's ↑/→/↓ counts reflect the trends the
// fleet would have seen on that date — not today's.
export function computeImportSummary(imp, limitsOverride, trendMap) {
  const limitsMap = limitsOverride ?? LIMITS
  // Per comp key, keep the measurement from the date's chronologically LATEST
  // session. Merged import files store sessions newest-first, so sort by
  // started_at before letting the last write win.
  const ordered = [...(imp.sessions ?? [])]
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
  const latest = {}
  for (const s of ordered) {
    for (const [key, m] of Object.entries(s.comps ?? {})) {
      latest[key] = m
    }
  }
  // `total` = distinct comps measured on this date (drives the "Total: N"
  // shown next to the limit indicators in Recent Imports).
  const counts = { total: Object.keys(latest).length, white: 0, green: 0, yellow: 0, red: 0, up: 0, flat: 0, down: 0 }
  for (const [key, m] of Object.entries(latest)) {
    const st = hasDefinedLimit(key, limitsMap) ? getLimitStatus(key, m.avg_meas ?? 0, limitsMap) : null
    if (!st || st === 'white')  counts.white++
    else if (st === 'ok')       counts.green++
    else if (st === 'caution')  counts.yellow++
    else if (st === 'alert')    counts.red++
    const tr = trendMap?.[key] ?? 'stable'
    if (tr === 'up')        counts.up++
    else if (tr === 'down') counts.down++
    else                    counts.flat++
  }
  return counts
}

// Aggregates the latest status/trend for every comp across all loaded imports.
// Processes oldest→newest so the last write wins (newest import, newest session).
// Status is re-computed from avg_meas using current limits (not the stored value)
// so the display is always consistent with the active limit thresholds.
// trendMapOverride: pass a precomputed map (App's trendMapByTail) to avoid
// recomputing it for every caller; computed from `imports` when absent.
export function aggregateCompStatus(imports, limitsOverride, trendMapOverride) {
  const limitsMap = limitsOverride ?? LIMITS
  // Trend per comp over the full import history (Theil-Sen on the last
  // TREND_WINDOW dates) — feeds every trend indicator downstream.
  const trendMap = trendMapOverride ?? computeTrendMap(imports)
  const result = {}
  const sorted = [...imports].sort((a, b) =>
    toSortableDate(a.date).localeCompare(toSortableDate(b.date))
  )
  for (const imp of sorted) {
    for (const session of (imp.sessions || [])) {
      for (const [key, meas] of Object.entries(session.comps || {})) {
        const status = Array.isArray(limitsMap[key])
          ? getLimitStatus(key, meas.avg_meas ?? 0, limitsMap)
          : 'white'
        result[key] = {
          status,
          trend:    trendMap[key] ?? 'stable',
          avg_meas: meas.avg_meas ?? 0,
          date:     imp.date,
        }
      }
    }
  }
  return result
}

// Extracts per-comp chart series from all imports for a given comp key
export function extractCompSeries(imports, compKey) {
  const points = []
  const sorted = [...imports].sort((a, b) =>
    toSortableDate(a.date).localeCompare(toSortableDate(b.date))
  )
  for (const imp of sorted) {
    for (const session of (imp.sessions || [])) {
      const meas = session.comps?.[compKey]
      if (meas?.avg_meas != null) {
        const timeStr = session.started_at
          ? session.started_at.split('T')[1]?.slice(0, 5) ?? '00:00'
          : '00:00'
        const dateStr = imp.date.split('-').reverse().join('-') // DD-MM-YYYY → YYYY-MM-DD
        points.push({ date: dateStr, time: timeStr, value: meas.avg_meas, session_id: session.session_id ?? null })
      }
    }
  }
  return points
}
