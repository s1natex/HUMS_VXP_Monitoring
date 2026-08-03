import React, { useState, useEffect, useMemo } from 'react'
import { syncGeneratedReports } from '../utils/reportStore'
import { extractCompSeries, toSortableDate } from '../utils/importLoader'
import {
  reportToHtml, chartsToHtml, buildChartSegments, buildExcelPayload,
  imageToDataUrl, isoToDdmmyyyy, safeFilename, MAX_POINTS_PER_CHART,
} from '../utils/exportUtils'
import brookLogo from '../assets/brook_aviation_logo_header.png'

const TYPES = [
  { key: 'report', label: 'Report (PDF)',  hint: 'A generated Incident Report as a paged A4 document' },
  { key: 'charts', label: 'Charts (PDF)',  hint: 'Vibration charts for selected components over a date range' },
  { key: 'excel',  label: 'Data (Excel)',  hint: 'All session measurements in a date range as a styled workbook' },
]

// Union of comp keys present in the given imports, insertion-ordered.
function compsWithData(imports) {
  const keys = []
  const seen = new Set()
  for (const imp of imports) {
    for (const s of imp.sessions ?? []) {
      for (const key of Object.keys(s.comps ?? {})) {
        if (!seen.has(key)) { seen.add(key); keys.push(key) }
      }
    }
  }
  return keys
}

// [earliest, latest] import date of a tail as ISO strings ('' when no data)
function importDateRange(imports) {
  const dates = (imports ?? []).map(i => toSortableDate(i.date)).sort()
  return { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' }
}

// ── Export modal ──────────────────────────────────────────────────────────────
// Opened by the BottomBar Export button (global — works from any page).
// Pick the export kind, the tail, then either a generated report (PDF), a
// component + date-range selection (charts PDF), or a date range (Excel).
export default function ExportModal({ fleet, activeTail, importsByTail, limitsForTail, onProgress, onToast, onClose }) {
  const tails = (fleet ?? []).map(f => f.tail)
  const [tail, setTail] = useState(activeTail ?? tails[0] ?? null)
  const [type, setType] = useState('report')

  const imports = importsByTail?.[tail] ?? []
  const fullRange = useMemo(() => importDateRange(imports), [imports])

  // Generated reports for the selected tail (report kind)
  const [reports, setReports] = useState([])
  const [reportId, setReportId] = useState(null)
  useEffect(() => {
    if (!tail) return
    // Stale-response guard: the modal stays mounted across tail switches, so a
    // slow response for the PREVIOUS tail resolving after the new one would
    // clobber the list (and the preselected report) with the wrong tail's data.
    let alive = true
    syncGeneratedReports(tail).then(list => {
      if (!alive) return
      setReports(list ?? [])
      setReportId((list ?? [])[0]?.report_id ?? null)
    })
    return () => { alive = false }
  }, [tail])

  // Date range (charts + excel kinds) — reset to the tail's full span on tail change
  const [dateFrom, setDateFrom] = useState(fullRange.from)
  const [dateTo,   setDateTo]   = useState(fullRange.to)
  useEffect(() => {
    setDateFrom(fullRange.from)
    setDateTo(fullRange.to)
    setSelectedComps(new Set())
  }, [tail])   // eslint-disable-line react-hooks/exhaustive-deps

  // The tail's imports can still be loading when the modal opens (app
  // bootstrap): the range initialised to '' and the effect above only re-runs
  // on tail change — fill the range in once the dates arrive, without
  // clobbering anything the user already picked.
  useEffect(() => {
    if (fullRange.from && !dateFrom) setDateFrom(fullRange.from)
    if (fullRange.to && !dateTo) setDateTo(fullRange.to)
  }, [fullRange.from, fullRange.to])   // eslint-disable-line react-hooks/exhaustive-deps

  // Component selection (charts kind)
  const allComps = useMemo(() => compsWithData(imports), [imports])
  const [selectedComps, setSelectedComps] = useState(() => new Set())
  const [compSearch, setCompSearch] = useState('')

  // Sessions/points inside the chosen range — drives per-comp counts, the
  // excel summary line, and the disabled state of empty comps.
  const rangeInfo = useMemo(() => {
    const counts = {}
    let sessionCount = 0
    let dateCount = 0
    for (const imp of imports) {
      const d = toSortableDate(imp.date)
      if (!dateFrom || !dateTo || d < dateFrom || d > dateTo) continue
      dateCount++
      for (const s of imp.sessions ?? []) {
        sessionCount++
        for (const [key, m] of Object.entries(s.comps ?? {})) {
          if (m?.avg_meas != null) counts[key] = (counts[key] ?? 0) + 1
        }
      }
    }
    return { counts, sessionCount, dateCount }
  }, [imports, dateFrom, dateTo])

  const shownComps = allComps.filter(k => !compSearch || k.toLowerCase().includes(compSearch.toLowerCase()))

  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)

  function toggleComp(key) {
    setSelectedComps(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function selectAllComps() {
    setSelectedComps(new Set(allComps.filter(k => (rangeInfo.counts[k] ?? 0) > 0)))
  }

  async function runExport() {
    setError(null)
    const api = window.electronAPI
    if (!api?.exportPdf) {
      setError('Export requires the desktop app (no IPC bridge in browser mode)')
      return
    }
    if (!tail) { setError('Select an aircraft tail'); return }

    setExporting(true)
    onProgress?.({ pct: 15, message: 'Preparing export…' })
    try {
      let result
      if (type === 'report') {
        const report = reports.find(r => r.report_id === reportId)
        if (!report) throw new Error('Select a generated report to export')
        const logo = await imageToDataUrl(brookLogo)
        onProgress?.({ pct: 45, message: 'Rendering PDF…' })
        result = await api.exportPdf(
          reportToHtml(report, logo),
          `${safeFilename(tail)}_incident_report_${safeFilename(report.name ?? `${report.date_from}_${report.date_to}`)}.pdf`
        )
      } else if (type === 'charts') {
        if (!selectedComps.size) throw new Error('Select at least one component')
        if (!dateFrom || !dateTo) throw new Error('Select a date range')
        const sections = []
        for (const compKey of allComps) {
          if (!selectedComps.has(compKey)) continue
          const points = extractCompSeries(imports, compKey)
            .filter(p => p.date >= dateFrom && p.date <= dateTo)
          if (!points.length) continue
          sections.push({ compKey, segments: buildChartSegments(points) })
        }
        if (!sections.length) throw new Error('No data points for the selected components in this date range')
        const logo = await imageToDataUrl(brookLogo)
        onProgress?.({ pct: 45, message: 'Rendering charts…' })
        result = await api.exportPdf(
          chartsToHtml({ tail, sections, dateFrom, dateTo, limits: limitsForTail(tail), logoDataUrl: logo }),
          `${safeFilename(tail)}_charts_${isoToDdmmyyyy(dateFrom)}_${isoToDdmmyyyy(dateTo)}.pdf`
        )
      } else {
        if (!dateFrom || !dateTo) throw new Error('Select a date range')
        const payload = buildExcelPayload(imports, dateFrom, dateTo, limitsForTail(tail), tail)
        if (!payload.sessions.length) throw new Error('No sessions in the selected date range')
        onProgress?.({ pct: 45, message: 'Writing workbook…' })
        result = await api.exportExcel(
          payload,
          `${safeFilename(tail)}_data_${isoToDdmmyyyy(dateFrom)}_${isoToDdmmyyyy(dateTo)}.xlsx`
        )
      }

      if (result?.cancelled) {
        onProgress?.(null)
      } else if (result?.ok) {
        onProgress?.({ pct: 100, message: 'Export complete', done: true })
        onToast?.(`Exported to ${result.path}`, true)
        setTimeout(() => onProgress?.(null), 2200)
        onClose?.()
      } else {
        throw new Error(result?.error ?? 'Export failed')
      }
    } catch (e) {
      setError(e.message)
      onProgress?.(null)
    } finally {
      setExporting(false)
    }
  }

  const sectionLabel = { fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }

  return (
    // Closing is blocked while an export runs — unmounting mid-export would
    // orphan the in-flight IPC call and silently drop its inline error.
    <div className="modal-backdrop" onClick={exporting ? undefined : onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 500, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-title" style={{ marginBottom: 14 }}>Export</div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: 2 }}>
          {/* Kind */}
          <div style={sectionLabel}>What to export</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => { setType(t.key); setError(null) }}
                style={{
                  flex: 1, padding: '6px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: type === t.key ? 'rgba(46,204,113,0.15)' : 'var(--panel2)',
                  border: `1px solid ${type === t.key ? 'rgba(46,204,113,0.5)' : 'var(--border)'}`,
                  color: type === t.key ? 'var(--green)' : 'var(--subtext)',
                  transition: 'background 0.1s, border-color 0.1s, color 0.1s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 16, lineHeight: 1.5 }}>
            {TYPES.find(t => t.key === type)?.hint}
          </div>

          {/* Tail */}
          <div style={sectionLabel}>Aircraft</div>
          <select
            value={tail ?? ''}
            onChange={e => { setTail(e.target.value); setError(null) }}
            style={{ width: '100%', fontSize: 12, marginBottom: 16 }}
          >
            {tails.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Report picker */}
          {type === 'report' && (
            <>
              <div style={sectionLabel}>Generated report</div>
              {!reports.length ? (
                <div style={{ fontSize: 12, color: 'var(--subtext)', fontStyle: 'italic', marginBottom: 16 }}>
                  No generated reports for {tail ?? 'this tail'} — generate one from the Reports page first
                </div>
              ) : (
                <div style={{
                  maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
                  marginBottom: 16, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel2)', padding: 4,
                }}>
                  {reports.map(r => (
                    <label
                      key={r.report_id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, cursor: 'pointer',
                        padding: '7px 8px', borderRadius: 4,
                        background: reportId === r.report_id ? 'rgba(74,158,255,0.1)' : 'transparent',
                      }}
                    >
                      <input type="radio" name="export-report" checked={reportId === r.report_id} onChange={() => setReportId(r.report_id)} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name ? r.name : `${r.date_from} → ${r.date_to}`}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--subtext)' }}>
                          {r.name ? `${r.date_from} → ${r.date_to} · ` : ''}
                          {r.components.length} component{r.components.length !== 1 ? 's' : ''} · generated {new Date(r.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Date range (charts + excel) */}
          {type !== 'report' && (
            <>
              <div style={sectionLabel}>Date range</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--subtext)', display: 'block', marginBottom: 4 }}>From</label>
                  <input type="date" value={dateFrom} min={fullRange.from} max={dateTo || fullRange.to} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--subtext)', display: 'block', marginBottom: 4 }}>To</label>
                  <input type="date" value={dateTo} min={dateFrom || fullRange.from} max={fullRange.to} onChange={e => setDateTo(e.target.value)} />
                </div>
                <button className="btn" style={{ fontSize: 11, flexShrink: 0 }} onClick={() => { setDateFrom(fullRange.from); setDateTo(fullRange.to) }}>
                  Full range
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 16 }}>
                {rangeInfo.sessionCount} session{rangeInfo.sessionCount !== 1 ? 's' : ''} across {rangeInfo.dateCount} date{rangeInfo.dateCount !== 1 ? 's' : ''} in range
              </div>
            </>
          )}

          {/* Component picker (charts) */}
          {type === 'charts' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={sectionLabel}>Components ({selectedComps.size} selected)</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={selectAllComps}>All</button>
                  <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setSelectedComps(new Set())}>None</button>
                </div>
              </div>
              <input
                type="text"
                value={compSearch}
                onChange={e => setCompSearch(e.target.value)}
                placeholder="Search components…"
                style={{ width: '100%', fontSize: 12, marginBottom: 6 }}
              />
              <div style={{
                maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
                marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel2)', padding: 4,
              }}>
                {!shownComps.length && (
                  <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--subtext)', fontStyle: 'italic' }}>
                    {allComps.length ? 'No components match the search' : 'No components with data for this tail'}
                  </div>
                )}
                {shownComps.map(key => {
                  const [name, location] = key.split(' | ')
                  const count = rangeInfo.counts[key] ?? 0
                  const empty = count === 0
                  // A comp selected while in range can drop to 0 points when the
                  // range narrows — it must stay uncheckable-OFF (not trapped
                  // checked+disabled), so disable only unchecked empties.
                  const locked = empty && !selectedComps.has(key)
                  return (
                    <label
                      key={key}
                      title={empty ? 'No data points in the selected date range' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, fontSize: 12,
                        cursor: locked ? 'not-allowed' : 'pointer', opacity: empty ? 0.45 : 1,
                        padding: '5px 8px', borderRadius: 4,
                        background: selectedComps.has(key) ? 'rgba(74,158,255,0.1)' : 'transparent',
                      }}
                    >
                      <input type="checkbox" disabled={locked} checked={selectedComps.has(key)} onChange={() => toggleComp(key)} />
                      <span style={{ fontWeight: 600 }}>{name}</span>
                      <span style={{ color: 'var(--subtext)', fontSize: 11 }}>{location}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--subtext)', fontSize: 10, flexShrink: 0 }}>
                        {count} pt{count !== 1 ? 's' : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 16, lineHeight: 1.5 }}>
                One chart per component; a component with more than {MAX_POINTS_PER_CHART} data points is split
                into several charts over consecutive sub-ranges so points stay readable.
              </div>
            </>
          )}
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12, margin: '10px 0 0' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 14 }}>
          <button className="btn" onClick={onClose} disabled={exporting}>Cancel</button>
          <button
            className="btn primary"
            disabled={exporting}
            onClick={runExport}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
