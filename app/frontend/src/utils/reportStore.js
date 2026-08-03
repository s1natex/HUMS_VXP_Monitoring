// Report persistence layer
// Primary: Electron IPC → data/{tail}/reports/, data/global/
// Fallback: localStorage (browser dev mode)

import { tailType } from '../data/tailIndex'

const LS_SIGNERS  = 'vxp_signers_v2'
const LS_ACTIONS  = 'vxp_actions_v2'
const LS_COMP_REPORTS = 'vxp_comp_reports_v1'
const LS_GEN_REPORTS  = 'vxp_gen_reports_v1'

// ── Signers ──────────────────────────────────────────────────────────────────

export function getSigners() {
  try { return JSON.parse(localStorage.getItem(LS_SIGNERS) || '[]') } catch { return [] }
}

export async function syncSigners() {
  const api = window.electronAPI
  if (!api) return
  try {
    const data = await api.loadSigners()
    if (Array.isArray(data)) localStorage.setItem(LS_SIGNERS, JSON.stringify(data))
  } catch (e) {
    console.warn('syncSigners failed:', e)
  }
}

export async function addSigner(signer) {
  const signers = getSigners()
  if (signers.find(s => s.id === signer.id)) return
  signers.push(signer)
  localStorage.setItem(LS_SIGNERS, JSON.stringify(signers))
  window.electronAPI?.saveSigners(signers).catch(() => {})
}

export async function removeSigner(id) {
  const signers = getSigners().filter(s => s.id !== id)
  localStorage.setItem(LS_SIGNERS, JSON.stringify(signers))
  window.electronAPI?.saveSigners(signers).catch(() => {})
}

// ── Actions ──────────────────────────────────────────────────────────────────

const DEFAULT_VXP_ACTIONS = [
  'No action required',
  'Monitor — re-check on next flight',
  'Track trends for 3 flights',
  // Trend-triggered entries (rising vibration while still inside limits —
  // the early-warning path) get dedicated planning actions:
  'Trend watch — increased monitoring interval',
  'Plan maintenance before limit exceedance',
  'Rotor track & balance',
  'Schedule maintenance inspection',
  'Perform ground run check',
  'Replace component',
  'Consult engineering',
  'Ground aircraft — await clearance',
]

export function getActions(tail) {
  const key = `${LS_ACTIONS}_${tailType(tail)}`
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null')
    return raw ?? DEFAULT_VXP_ACTIONS
  } catch { return DEFAULT_VXP_ACTIONS }
}

export async function syncActions(tail) {
  const api = window.electronAPI
  if (!api) return
  const tt = tailType(tail)
  try {
    // null = no saved list on disk yet → keep the built-in defaults. An empty
    // ARRAY is a real state (the user deleted every action) and must be cached
    // too — the old `data.length` guard resurrected the deleted list on the
    // next launch whenever the user had emptied it completely.
    const data = await api.loadActions(tt)
    if (Array.isArray(data)) {
      localStorage.setItem(`${LS_ACTIONS}_${tt}`, JSON.stringify(data))
    }
  } catch (e) {
    console.warn('syncActions failed:', e)
  }
}

export async function addAction(tail, action) {
  const tt = tailType(tail)
  const key = `${LS_ACTIONS}_${tt}`
  const actions = getActions(tail)
  if (actions.includes(action)) return
  actions.push(action)
  localStorage.setItem(key, JSON.stringify(actions))
  window.electronAPI?.saveActions(tt, actions).catch(() => {})
}

// Removes an action from the pick list only — entries that already carry the
// action text keep it (the tracker snapshot is historical record).
export async function removeAction(tail, action) {
  const tt = tailType(tail)
  const actions = getActions(tail).filter(a => a !== action)
  localStorage.setItem(`${LS_ACTIONS}_${tt}`, JSON.stringify(actions))
  window.electronAPI?.saveActions(tt, actions).catch(() => {})
}

// Entry-level sign model: an entry is signed when it carries an applied action;
// a component counts as fully Signed when EVERY entry does (tracker status).
// Report generation is per-entry: only signed entries are compiled — a comp
// qualifies with ≥ 1 signed entry (see generateReport).
export function allEntriesActioned(entries) {
  return (entries?.length ?? 0) > 0 && entries.every(e => !!e.action)
}

// ── Component incident trackers (in-memory cache) ─────────────────────────────
// One tracker per component per tail: { comp_key, tail, status, signer_id,
// signer_name, signed_at, entries: [...] }. `status` is 'pending' or 'signed' —
// trackers are signed in bulk at report-generation time (see generateReport).

export function getLocalComponentReports(tail) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_COMP_REPORTS) || '{}')
    return all[tail] ?? []
  } catch { return [] }
}

export function setLocalComponentReports(tail, trackers) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_COMP_REPORTS) || '{}')
    all[tail] = trackers
    localStorage.setItem(LS_COMP_REPORTS, JSON.stringify(all))
  } catch {}
}

export async function syncComponentReports(tail) {
  const api = window.electronAPI
  if (!api) return getLocalComponentReports(tail)
  try {
    const trackers = await api.listComponentReports(tail)
    setLocalComponentReports(tail, trackers)
    return trackers
  } catch {
    return getLocalComponentReports(tail)
  }
}

// Persists an edited tracker (action changes on entries). Does not itself sign.
// Awaits the IPC write so a follow-up syncComponentReports sees the fresh data.
// Throws when the disk write fails — callers surface the error to the user.
// The localStorage cache is only updated AFTER a successful disk write, so a
// failed save can't leave a phantom tracker in the cache.
export async function saveComponentReport(tail, tracker) {
  if (window.electronAPI?.saveComponentReport) {
    const result = await window.electronAPI.saveComponentReport(tail, tracker.comp_key, tracker)
    if (result && !result.ok) throw new Error(result.error ?? 'disk write failed')
  }
  const trackers = getLocalComponentReports(tail)
  const idx = trackers.findIndex(t => t.comp_key === tracker.comp_key)
  if (idx >= 0) trackers[idx] = tracker
  else trackers.unshift(tracker)
  setLocalComponentReports(tail, trackers)
  return tracker
}

// ── Generated (compiled) Incident Report documents ────────────────────────────

export function getLocalGeneratedReports(tail) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_GEN_REPORTS) || '{}')
    return all[tail] ?? []
  } catch { return [] }
}

export function setLocalGeneratedReports(tail, reports) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_GEN_REPORTS) || '{}')
    all[tail] = reports
    localStorage.setItem(LS_GEN_REPORTS, JSON.stringify(all))
  } catch {}
}

export async function syncGeneratedReports(tail) {
  const api = window.electronAPI
  if (!api) return getLocalGeneratedReports(tail)
  try {
    // Disk order is directory (≈ oldest-first) while in-session generation
    // prepends — normalize to newest-first so the reports list and the Export
    // modal's default pick are consistent across restarts.
    const reports = [...await api.listGeneratedReports(tail)]
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    setLocalGeneratedReports(tail, reports)
    return reports
  } catch {
    return getLocalGeneratedReports(tail)
  }
}

// Compiles a formal Incident Report from component trackers over a date range.
// Only SIGNED (actioned) entries are compiled — a partially-actioned component
// may be included, its unactioned entries are simply left out (they stay
// pending and can go into a later report once actioned). Gate: every requested
// comp_key must carry at least one applied action.
// The signer (AME) is chosen in the Generate Report modal and recorded ONLY on
// the generated document — trackers never carry signer identity.
// Only entries whose date falls within [dateFrom, dateTo] (inclusive, DD-MM-YYYY) are included.
export async function generateReport(tail, { compKeys, dateFrom, dateTo, signer, name }) {
  if (!signer) throw new Error('A signer (AME) is required to generate a report')
  // Must go through IPC (not getLocalComponentReports) — the localStorage cache
  // only holds trackers touched this session; disk is the source of truth.
  const trackers = await syncComponentReports(tail)
  const toSortable = d => { const p = d.split('-'); return `${p[2]}-${p[1]}-${p[0]}` }
  const from = toSortable(dateFrom)
  const to   = toSortable(dateTo)

  const signedAt   = new Date().toISOString()
  const signerName = signer.first ? `${signer.first[0]}. ${signer.last}` : (signer.name ?? signer.last ?? '—')

  const components = []
  for (const compKey of compKeys) {
    const tracker = trackers.find(t => t.comp_key === compKey)
    const actioned = (tracker?.entries ?? []).filter(e => !!e.action)
    if (!actioned.length) {
      throw new Error(`${compKey} has no signed entries — apply an action to at least one entry before including it in a report`)
    }
    // tracker.entries follows scan insertion order — not date order when a
    // backfilled older-dated PDF was imported after a newer one. A formal
    // document must list its dates chronologically, so sort explicitly.
    const entries = actioned
      .filter(e => {
        const d = toSortable(e.date)
        return d >= from && d <= to
      })
      .sort((a, b) => toSortable(a.date).localeCompare(toSortable(b.date)))
    if (!entries.length) continue
    const latestEntry = entries[entries.length - 1]
    components.push({
      comp_key: compKey,
      entries,
      latest_action: latestEntry?.action ?? null,
      stats: {
        count:          entries.length,
        caution_count:  entries.filter(e => e.limit_status === 'caution').length,
        critical_count: entries.filter(e => e.limit_status === 'alert').length,
        uptrend_count:  entries.filter(e => e.trend === 'up').length,
      },
      signer_id:   signer.id,
      signer_name: signerName,
      signed_at:   signedAt,
    })
  }
  if (!components.length) throw new Error('No entries found in the selected date range')

  const timestamp = Date.now().toString(36)
  const report = {
    report_id:  `genreport_${tail}_${timestamp}`,
    name:       name?.trim() || null,   // optional user-given report name
    tail,
    created_at: new Date().toISOString(),
    date_from:  dateFrom,
    date_to:    dateTo,
    components,
  }
  const filename = `${report.report_id}.json`
  // Disk write first — a signed maintenance document must not silently live
  // only in the localStorage cache. On failure nothing is cached and the
  // Generate modal surfaces the error.
  if (window.electronAPI?.saveGeneratedReport) {
    const result = await window.electronAPI.saveGeneratedReport(tail, filename, report)
    if (result && !result.ok) {
      throw new Error(`Report could not be saved to disk: ${result.error}`)
    }
  }
  const reports = getLocalGeneratedReports(tail)
  reports.unshift({ ...report, _filename: filename })
  setLocalGeneratedReports(tail, reports)
  return report
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

export async function initReportStore(tail) {
  await Promise.all([
    syncSigners(),
    syncActions(tail),
  ])
}
