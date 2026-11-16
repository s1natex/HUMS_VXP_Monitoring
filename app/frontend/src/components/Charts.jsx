import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import ComponentChart from './ComponentChart'
import EditLimitModal from './EditLimitModal'
import PurgeModal from './PurgeModal'
import ActionDropdown from './ActionDropdown'
import { ALL_COMP_KEYS, LIMITS } from '../data/limits'
import { dotClass, trendArrow, trendClass, statusLabel, trendLabel } from '../constants/status'
import { extractCompSeries } from '../utils/importLoader'
import { saveComponentReport, allEntriesActioned } from '../utils/reportStore'

// status key → color bucket used in filters
const STATUS_TO_BUCKET = {
  white:   'na',
  ok:      'green', normal: 'green',
  caution: 'yellow',
  alert:   'red', critical: 'red',
}

const STATUS_FILTERS = [
  { key: 'green',  label: '✓', title: 'Normal',       color: 'var(--green)' },
  { key: 'yellow', label: '!', title: 'Caution',       color: 'var(--amber)' },
  { key: 'red',    label: '✕', title: 'Critical',      color: 'var(--red)'   },
]
const TREND_FILTERS = [
  { key: 'stable', label: '→', title: 'Stable',        color: 'var(--subtext)' },
  { key: 'up',     label: '↑', title: 'Deteriorating', color: 'var(--red)'     },
  { key: 'down',   label: '↓', title: 'Recovering',    color: 'var(--amber)'   },
]

function FilterBtn({ active, color, onClick, children, title }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 34, height: 32,
        background: active ? color : hover ? 'rgba(255,255,255,0.07)' : 'var(--panel)',
        color: active ? '#1e2228' : hover ? 'var(--text)' : color,
        border: `1px solid ${active ? color : hover ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`,
        borderRadius: 3, fontSize: 14, fontWeight: 700,
        cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s, border-color 0.1s',
      }}
    >
      {children}
    </button>
  )
}

function AllBtn({ active, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 32, padding: '0 12px',
        background: active ? 'var(--accent)' : hover ? 'rgba(255,255,255,0.07)' : 'var(--panel)',
        color: active ? '#fff' : hover ? 'var(--text)' : 'var(--subtext)',
        border: `1px solid ${active ? 'var(--accent)' : hover ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`,
        borderRadius: 3, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s, border-color 0.1s',
      }}
    >All</button>
  )
}

function ManageModal({ compKey, onClose, onEdit, onPurge, onRestore, restoring, loadingBackups }) {
  const name = compKey.split(' | ')[0]
  const loc  = compKey.split(' | ')[1]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
        <div className="modal-title">{name}</div>
        {loc && <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 16 }}>{loc}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="btn primary"
            style={{ justifyContent: 'center' }}
            onClick={() => { onClose(); onEdit(compKey) }}
          >
            Edit Limits
          </button>
          <button
            className="btn danger"
            style={{ justifyContent: 'center' }}
            onClick={() => { onClose(); onPurge(compKey) }}
          >
            Purge &amp; Backup Data
          </button>
          <button
            className="btn"
            style={{ justifyContent: 'center', color: 'var(--green)', borderColor: 'rgba(46,204,113,0.4)' }}
            onClick={() => onRestore(compKey)}
            disabled={restoring === compKey || loadingBackups}
          >
            {loadingBackups ? 'Loading backups…' : restoring === compKey ? '…' : '↩ Restore from Backup'}
          </button>
        </div>
        <button className="btn" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function CompRow({ compKey, meas, selected, onSelect, onManage }) {
  const [hover,    setHover]    = useState(false)
  const [btnHover, setBtnHover] = useState(false)
  const parts  = compKey.split(' | ')
  const name   = parts[0]
  const loc    = parts[1] ?? ''
  const status = meas?.status ?? 'white'
  const trend  = meas?.trend  ?? 'stable'

  const dotMap = { white: 'white', ok: 'green', normal: 'green', caution: 'yellow', alert: 'red', critical: 'red' }

  return (
    <div
      onClick={() => onSelect(compKey)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', cursor: 'pointer',
        background: selected ? 'rgba(74,158,255,0.1)' : hover ? 'rgba(255,255,255,0.03)' : 'transparent',
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background 0.1s',
      }}
    >
      <span className={`status-dot ${dotMap[status] ?? 'white'}`} style={{ flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: selected ? 700 : 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--subtext)' }}>{loc}</div>
      </div>

      {hover && (
        <button
          onClick={e => { e.stopPropagation(); onManage(compKey) }}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          title="Manage component"
          style={{
            padding: '2px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
            background: btnHover ? 'rgba(74,158,255,0.32)' : 'rgba(74,158,255,0.15)',
            border: `1px solid ${btnHover ? 'rgba(74,158,255,0.8)' : 'rgba(74,158,255,0.4)'}`,
            color: btnHover ? '#fff' : 'var(--accent)',
            cursor: 'pointer', flexShrink: 0,
            transform: btnHover ? 'scale(1.05)' : 'scale(1)',
            transition: 'background 0.1s, border-color 0.1s, color 0.1s, transform 0.1s',
          }}
        >
          Manage
        </button>
      )}

      <span className={trendClass(trend)} style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
        {trendArrow(trend)}
      </span>
    </div>
  )
}

function StatStrip({ points }) {
  if (!points?.length) return null
  const latest = points[points.length - 1]?.value ?? 0
  const prev   = points.length > 1 ? points[points.length - 2]?.value : null
  const change = prev != null ? latest - prev : null
  const dates    = [...new Set(points.map(p => p.date))].length
  const sessions = points.length
  const lastDate = points[points.length - 1]?.date ?? '—'

  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {[
        { label: 'Latest (ips)', value: latest.toFixed(4) },
        { label: 'Change', value: change != null ? (change >= 0 ? '+' : '') + change.toFixed(4) : '—',
          color: change == null ? undefined : change > 0 ? 'var(--red)' : change < 0 ? 'var(--amber)' : 'var(--subtext)' },
        { label: 'Dates',        value: dates },
        { label: 'Sessions',     value: sessions },
        { label: 'Last import',  value: lastDate.split('-').reverse().join('/') },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ flex: 1, padding: '8px 12px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</div>
          <div style={{ fontSize: 10, color: 'var(--subtext)', marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Restore backup selection modal ────────────────────────────────────────────
function RestoreSelectModal({ compKey, backups, onSelect, onClose }) {
  const name = compKey.split(' | ')[0]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-title">Restore Backup — {name}</div>
        <div style={{ fontSize: 12, color: 'var(--subtext)', marginBottom: 12 }}>
          Select a backup to restore (newest first):
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 320, overflowY: 'auto', marginBottom: 14 }}>
          {backups.map(b => (
            <div
              key={b.filename}
              onClick={() => onSelect(b.filename)}
              style={{
                padding: '10px 14px', borderRadius: 5, cursor: 'pointer',
                background: 'var(--panel2)', border: '1px solid var(--border)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(74,158,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--panel2)'}
            >
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', marginBottom: 3 }}>
                {b.comment || <span style={{ fontStyle: 'italic', color: 'var(--subtext)' }}>(no comment)</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--subtext)' }}>
                {b.purged_at ? new Date(b.purged_at).toLocaleString() : '—'} &nbsp;·&nbsp; {b.entries_count} entries
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Sign-action modal ─────────────────────────────────────────────────────────
// Opened by clicking a chart data point that carries a pending (unactioned)
// tracker entry. Applying an action here signs that date — same entry-level
// sign model as the Reports page, persisted through the same store, so the
// Reports view reflects it immediately. "Go to Reports" deep-links to the
// entry and marks it as redirected-from in the list.
function SignActionModal({ compKey, entry, tail, saving, error, onApply, onGoToReports, onClose }) {
  const [action, setAction] = useState(entry.action ?? null)
  const [name, location] = compKey.split(' | ')

  return (
    // Closing is blocked while the save runs — dismissing the modal mid-save
    // would drop a failed save's inline error, leaving the user believing the
    // date was signed (same guard as ExportModal / TailModal).
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="modal-title" style={{ marginBottom: 2 }}>Sign Action — {name}</div>
        {location && <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 14 }}>{location}</div>}

        {/* The entry being signed — same row anatomy as the Reports list */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
          padding: '8px 12px', background: 'var(--panel2)',
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          <span className={`status-dot ${dotClass(entry.limit_status)}`} style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{entry.date}</span>
          <span style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0 }}>avg {entry.avg_meas}</span>
          <div style={{ flex: 1 }} />
          {entry.trend === 'up' && (
            <span className="pill red" style={{ fontSize: 9, flexShrink: 0 }}>↑ DETERIORATING</span>
          )}
          {entry.limit_status === 'alert' || entry.limit_status === 'caution' ? (
            <span className={`pill ${entry.limit_status === 'alert' ? 'red' : 'amber'}`} style={{ fontSize: 9, flexShrink: 0 }}>
              {statusLabel(entry.limit_status).toUpperCase()}
            </span>
          ) : (
            <span className="pill grey" style={{ fontSize: 9, flexShrink: 0 }}>IN LIMITS</span>
          )}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Action
        </div>
        <ActionDropdown value={action} onChange={setAction} tail={tail} />
        <div style={{ fontSize: 11, color: 'var(--subtext)', marginTop: 10, lineHeight: 1.5 }}>
          Applying an action signs this date — the entry moves to Signed Actions on the Reports page.
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
          <button className="btn" style={{ fontSize: 11 }} onClick={onGoToReports} disabled={saving} title="Open this entry on the Reports page">
            Go to Reports
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn primary"
            style={{ opacity: action ? 1 : 0.45 }}
            disabled={!action || saving}
            onClick={() => onApply(action)}
          >
            {saving ? 'Saving…' : 'Apply & Sign'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Charts({
  activeTail, imports, compStatus, editableLimits, fleetItem,
  onSaveLimit, onPurgeComp, onRestoreComp, initialComp, initialTarget, componentReports,
  onComponentReportsChange, onGoToReportsEntry,
}) {
  const [selectedComp,  setSelectedComp]  = useState(initialComp ?? null)
  const [manageTarget,  setManageTarget]  = useState(null)
  const [editTarget,    setEditTarget]    = useState(null)
  const [purgeTarget,   setPurgeTarget]   = useState(null)
  const [restoringComp,  setRestoringComp]  = useState(null)
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [restoreTarget,  setRestoreTarget]  = useState(null)   // compKey waiting for backup selection
  const [backupList,     setBackupList]     = useState([])     // backups for restoreTarget
  const [restoreMsg,     setRestoreMsg]     = useState(null)
  const [search,         setSearch]         = useState('')
  // Pending tracker entry clicked on the chart → sign-action modal
  const [signTarget, setSignTarget] = useState(null)
  const [signSaving, setSignSaving] = useState(false)
  const [signError,  setSignError]  = useState(null)
  const restoreMsgTimer = useRef(null)

  // Clear the restore-message timer on unmount to avoid state update on unmounted component.
  useEffect(() => () => { if (restoreMsgTimer.current) clearTimeout(restoreMsgTimer.current) }, [])

  // Multi-select filter Sets — empty = "all"
  const [statusFilters, setStatusFilters] = useState(new Set())
  const [trendFilters,  setTrendFilters]  = useState(new Set())

  const allActive = statusFilters.size === 0 && trendFilters.size === 0

  function toggleStatus(key) {
    setStatusFilters(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleTrend(key) {
    setTrendFilters(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function clearAll() {
    setStatusFilters(new Set())
    setTrendFilters(new Set())
  }

  const chartPoints = useMemo(() => {
    if (!selectedComp) return []
    return extractCompSeries(imports ?? [], selectedComp)
  }, [selectedComp, imports])

  // Chart date-range filter (reported by ComponentChart). The trend pill is
  // the CURRENT trend, so it is hidden while the range is purely historical.
  const [chartRange, setChartRange] = useState(null)
  const latestDate = chartPoints.length ? chartPoints[chartPoints.length - 1].date : null
  const rangeIsHistorical = !!(chartRange && latestDate && chartRange.to < latestDate)

  // Incident-tracker entries for the selected component — the chart tints
  // incident data points and shows the applied action in the tooltip.
  const trackerEntries = useMemo(() => {
    if (!selectedComp) return []
    return (componentReports ?? []).find(t => t.comp_key === selectedComp)?.entries ?? []
  }, [componentReports, selectedComp])

  // "See Chart" highlight only applies to the deep-linked component — any
  // manual pick from the list (even re-selecting the same comp) dismisses it.
  const [deepTarget, setDeepTarget] = useState(initialTarget ?? null)
  const highlight = selectedComp === initialComp ? deepTarget : null

  function handleSelectComp(compKey) {
    setDeepTarget(null)
    setSelectedComp(compKey)
  }

  // Stable ref for the memoized ComponentChart — a fresh callback every render
  // would defeat its React.memo.
  const handleIncidentClick = useCallback(entry => {
    setSignError(null)
    setSignTarget(entry)
  }, [])

  // Apply & Sign from the chart modal: persists through the same store as the
  // Reports page and pushes the updated tracker list up to App, so Reports
  // (and this chart's incident tints) reflect the signed entry immediately.
  async function handleSignApply(action) {
    const entry = signTarget
    const tracker = (componentReports ?? []).find(t => t.comp_key === selectedComp)
    if (!entry || !action || !tracker) return
    setSignSaving(true)
    setSignError(null)
    try {
      const entries = (tracker.entries ?? []).map(e => e.entry_id === entry.entry_id ? { ...e, action } : e)
      const allDone = allEntriesActioned(entries)
      const updated = await saveComponentReport(activeTail, {
        ...tracker,
        entries,
        status: allDone ? 'signed' : 'pending',
        signed_at: allDone ? (tracker.signed_at ?? new Date().toISOString()) : null,
      })
      onComponentReportsChange?.((componentReports ?? []).map(t => t.comp_key === updated.comp_key ? updated : t))
      setSignTarget(null)
      showRestoreMsg({ ok: true, text: `Action signed for ${selectedComp.split(' | ')[0]} · ${entry.date}` })
    } catch (e) {
      setSignError(`Save failed: ${e.message}`)
    } finally {
      setSignSaving(false)
    }
  }

  function handleSignGoToReports() {
    const entry = signTarget
    setSignTarget(null)
    onGoToReportsEntry?.(selectedComp, entry.entry_id)
  }

  const filteredKeys = useMemo(() => {
    return ALL_COMP_KEYS.filter(key => {
      const meas   = compStatus?.[key]
      const status = meas?.status ?? 'white'
      const trend  = meas?.trend  ?? 'stable'

      if (statusFilters.size > 0) {
        // No measurement data → always N/A regardless of whether a limit is defined
        const bucket = meas
          ? (STATUS_TO_BUCKET[status] ?? (Array.isArray(editableLimits?.[key]) ? 'green' : 'na'))
          : 'na'
        if (!statusFilters.has(bucket)) return false
      }
      if (trendFilters.size > 0 && !trendFilters.has(trend)) return false
      if (search) {
        if (!key.toLowerCase().includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [compStatus, statusFilters, trendFilters, search, editableLimits])

  async function handlePurge(comment) {
    if (!purgeTarget) return
    const compKey = purgeTarget
    setPurgeTarget(null)
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.purgeComp(activeTail, compKey, comment)
        if (!result?.ok) {
          showRestoreMsg({ ok: false, text: `Purge failed: ${result?.error ?? 'Unknown error'}` })
          return
        }
      }
      onPurgeComp?.(compKey)
      if (selectedComp === compKey) setSelectedComp(null)
      showRestoreMsg({ ok: true, text: `Data purged and backed up for ${compKey.split(' | ')[0]}` })
    } catch (e) {
      showRestoreMsg({ ok: false, text: `Purge failed: ${e.message}` })
    }
  }

  function showRestoreMsg(msg) {
    if (restoreMsgTimer.current) clearTimeout(restoreMsgTimer.current)
    setRestoreMsg(msg)
    restoreMsgTimer.current = setTimeout(() => setRestoreMsg(null), 3500)
  }

  // Open backup-selection modal: list available backups first.
  // ManageModal stays open (loadingBackups=true) while the IPC call runs.
  async function handleRestoreOpen(compKey) {
    if (restoringComp || loadingBackups) return
    setLoadingBackups(true)
    try {
      let backups
      try {
        backups = window.electronAPI
          ? await window.electronAPI.listCompBackups(activeTail, compKey)
          : []
      } catch (e) {
        setManageTarget(null)
        showRestoreMsg({ ok: false, text: `Failed to list backups: ${e.message}` })
        return
      }
      if (!backups?.length) {
        setManageTarget(null)
        showRestoreMsg({ ok: false, text: 'No purge backup found for this component' })
        return
      }
      setManageTarget(null)
      setBackupList(backups)
      setRestoreTarget(compKey)
    } finally {
      setLoadingBackups(false)
    }
  }

  async function handleRestoreSelect(backupFilename) {
    const compKey = restoreTarget
    setRestoreTarget(null)
    setBackupList([])
    if (!compKey) return
    setRestoringComp(compKey)
    try {
      const result = window.electronAPI
        ? await window.electronAPI.restoreCompBackup(activeTail, compKey, backupFilename)
        : { ok: false, error: 'No IPC' }
      if (result?.ok && result.restored > 0) {
        onRestoreComp?.()
        showRestoreMsg({ ok: true, text: `Restored ${result.restored} entr${result.restored !== 1 ? 'ies' : 'y'} for ${compKey.split(' | ')[0]}` })
      } else if (result?.ok && !result.restored) {
        showRestoreMsg({ ok: false, text: 'Backup found but no matching sessions — import files may have been replaced' })
      } else {
        showRestoreMsg({ ok: false, text: result?.error ?? 'Restore failed' })
      }
    } catch (e) {
      showRestoreMsg({ ok: false, text: e.message })
    } finally {
      setRestoringComp(null)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Component list panel ─────────────────────────────────────────────── */}
      <div style={{
        width: 'var(--complist-w)', flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        background: 'var(--panel)',
      }}>
        {/* Search + single-row filter bar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            placeholder="Search components…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12 }}
          />
          {/* Single row: All | ✓ ! ✕ | divider | → ↑ ↓ */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <AllBtn active={allActive} onClick={clearAll} />
            {STATUS_FILTERS.map(f => (
              <FilterBtn
                key={f.key}
                active={statusFilters.has(f.key)}
                color={f.color}
                title={f.title}
                onClick={() => toggleStatus(f.key)}
              >
                {f.label}
              </FilterBtn>
            ))}
            <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }} />
            {TREND_FILTERS.map(f => (
              <FilterBtn
                key={f.key}
                active={trendFilters.has(f.key)}
                color={f.color}
                title={f.title}
                onClick={() => toggleTrend(f.key)}
              >
                {f.label}
              </FilterBtn>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--subtext)' }}>
            {filteredKeys.length} / {ALL_COMP_KEYS.length} components
          </div>
        </div>

        {/* Component list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredKeys.map(key => (
            <CompRow
              key={key}
              compKey={key}
              meas={compStatus?.[key]}
              selected={selectedComp === key}
              onSelect={handleSelectComp}
              onManage={setManageTarget}
            />
          ))}
        </div>
      </div>

      {/* ── Chart panel ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {selectedComp ? (
          <>
            <div style={{
              padding: '10px 18px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedComp.split(' | ')[0]}</div>
                <div style={{ fontSize: 11, color: 'var(--subtext)' }}>{selectedComp.split(' | ')[1]}</div>
              </div>
              {compStatus?.[selectedComp] && compStatus[selectedComp].status !== 'white' && (
                <span className={`pill ${
                  compStatus[selectedComp].status === 'alert'   || compStatus[selectedComp].status === 'critical' ? 'red'   :
                  compStatus[selectedComp].status === 'caution' ? 'amber' : 'green'
                }`}>
                  {statusLabel(compStatus[selectedComp].status).toUpperCase()}
                </span>
              )}
              {compStatus?.[selectedComp] && !rangeIsHistorical && (() => {
                const trend = compStatus[selectedComp].trend ?? 'stable'
                return (
                  <span className={`pill ${trend === 'up' ? 'red' : trend === 'down' ? 'amber' : 'grey'}`}>
                    {trendArrow(trend)} {trendLabel(trend).toUpperCase()}
                  </span>
                )
              })()}
            </div>

            <StatStrip points={chartPoints} />

            {chartPoints.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 8,
                color: 'var(--subtext)',
              }}>
                <div style={{ fontSize: 28, opacity: 0.3 }}>📭</div>
                <div style={{ fontSize: 13 }}>No import data for this component</div>
              </div>
            ) : (
              <div style={{ flex: 1, padding: '12px 8px 8px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <ComponentChart
                  compKey={selectedComp}
                  points={chartPoints}
                  editableLimits={editableLimits}
                  trackerEntries={trackerEntries}
                  highlight={highlight}
                  onIncidentClick={handleIncidentClick}
                  onRangeChange={setChartRange}
                />
              </div>
            )}
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
            color: 'var(--subtext)',
          }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>📈</div>
            <div style={{ fontSize: 14 }}>Select a component to view chart</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Use filters to narrow the list</div>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {manageTarget && (
        <ManageModal
          compKey={manageTarget}
          onClose={() => setManageTarget(null)}
          onEdit={setEditTarget}
          onPurge={setPurgeTarget}
          onRestore={handleRestoreOpen}
          restoring={restoringComp}
          loadingBackups={loadingBackups}
        />
      )}
      {restoreTarget && (
        <RestoreSelectModal
          compKey={restoreTarget}
          backups={backupList}
          onSelect={handleRestoreSelect}
          onClose={() => { setRestoreTarget(null); setBackupList([]) }}
        />
      )}
      {editTarget && (
        <EditLimitModal
          compKey={editTarget}
          currentLimits={editableLimits?.[editTarget] ?? LIMITS[editTarget]}
          onSave={onSaveLimit}
          onClose={() => setEditTarget(null)}
          systemType={fleetItem?.systemType}
          limitsMode={fleetItem?.limitsMode ?? 'global'}
        />
      )}
      {purgeTarget && (
        <PurgeModal
          compKey={purgeTarget}
          tail={activeTail}
          onConfirm={handlePurge}
          onClose={() => setPurgeTarget(null)}
        />
      )}
      {signTarget && selectedComp && (
        <SignActionModal
          compKey={selectedComp}
          entry={signTarget}
          tail={activeTail}
          saving={signSaving}
          error={signError}
          onApply={handleSignApply}
          onGoToReports={handleSignGoToReports}
          onClose={() => { setSignTarget(null); setSignError(null) }}
        />
      )}

      {restoreMsg && (
        <div style={{
          position: 'fixed', bottom: 52, left: '50%', transform: 'translateX(-50%)',
          zIndex: 500, padding: '8px 18px', borderRadius: 6,
          background: restoreMsg.ok ? 'rgba(46,204,113,0.18)' : 'rgba(224,82,82,0.18)',
          border: `1px solid ${restoreMsg.ok ? 'rgba(46,204,113,0.5)' : 'rgba(224,82,82,0.5)'}`,
          color: restoreMsg.ok ? 'var(--green)' : 'var(--red)',
          fontSize: 12, fontWeight: 600,
          pointerEvents: 'none',
        }}>
          {restoreMsg.text}
        </div>
      )}
    </div>
  )
}
