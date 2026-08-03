import React, { useState, useMemo, useRef, useEffect } from 'react'
import { toSortableDate } from '../utils/importLoader'
import { ALL_COMP_KEYS, LIMITS } from '../data/limits'
import TailModal from './TailModal'

// ── Manage dropdown ────────────────────────────────────────────────────────
function ManageDropdown({ onAction, disabled }) {
  const [open, setOpen]       = useState(false)
  const [hovered, setHovered] = useState(false)
  const ref = useRef(null)

  // Close when clicking anywhere outside the dropdown (same pattern as the
  // signer / action dropdowns).
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function pick(action) { setOpen(false); onAction(action) }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 13px', borderRadius: 4, border: '1px solid var(--accent)',
          background: disabled ? 'transparent' : hovered ? 'rgba(74,158,255,0.13)' : 'transparent',
          color: disabled ? 'var(--subtext)' : 'var(--accent)',
          fontSize: 11, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
          letterSpacing: '0.04em',
          animation: disabled ? 'none' : 'vxp-pulse-ring 2s ease-out infinite',
          transform: (!disabled && hovered) ? 'scale(1.04)' : 'scale(1)',
          transition: 'background 0.15s, transform 0.1s, color 0.15s',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        Manage <span style={{ fontSize: 9, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 200,
          background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 5, padding: 5, display: 'flex', flexDirection: 'column', gap: 4,
          minWidth: 130,
          animation: 'vxp-fade-up 0.12s ease-out',
          boxShadow: '0 4px 18px rgba(0,0,0,0.4)',
        }}>
          {[
            { label: '+ Add',    action: 'add',    color: 'var(--green)', anim: 'vxp-pulse-ring-green' },
            { label: '✎ Edit',   action: 'edit',   color: 'var(--amber)', anim: 'vxp-pulse-ring-amber' },
            { label: '✕ Remove', action: 'remove', color: 'var(--red)',   anim: 'vxp-pulse-ring-red'   },
          ].map(({ label, action, color, anim }) => (
            <ActionBtn key={action} color={color} animation={anim} onClick={() => pick(action)}>
              {label}
            </ActionBtn>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionBtn({ color, animation, children, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: '5px 13px', borderRadius: 4, border: `1px solid ${color}`,
        background: hovered ? `${color}22` : 'transparent', color,
        fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
        animation: `${animation} 2s ease-out infinite`,
        transform: hovered ? 'scale(1.04)' : 'scale(1)',
        transition: 'background 0.15s, transform 0.1s',
      }}
    >
      {children}
    </button>
  )
}

// ── Stat / trend bubbles ───────────────────────────────────────────────────
function StatBubble({ value, color, label }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 36 }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        border: `2px solid ${color}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto', fontSize: 13, fontWeight: 700, color,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 8, color: 'var(--subtext)', marginTop: 3,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {label}
      </div>
    </div>
  )
}

function TrendBubble({ arrow, value, color, label }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 44 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color, lineHeight: 1 }}>{arrow}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 8, color: 'var(--subtext)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
    </div>
  )
}

// ── Tail card ──────────────────────────────────────────────────────────────
function TailCard({ fleetItem, stats, componentReports, lastImport, hasData, manageMode, onClick }) {
  const { tail, acType, systemType } = fleetItem
  const [hovered, setHovered] = useState(false)

  const na        = '—'
  const isEdit    = manageMode === 'edit'
  const isRemove  = manageMode === 'remove'
  const pillClass = 'blue'
  const sysLabel  = 'VXP'

  // Pending actions = individual tracked entries still needing an action (can be
  // multiple per component), across every component tracker for this tail.
  const pendingActions = componentReports.reduce(
    (sum, t) => sum + (t.entries ?? []).filter(e => !e.action).length, 0
  )

  // Border highlights: edit → amber on hover, remove → red on hover (same animation pattern)
  let borderColor = 'var(--border)'
  if      (isEdit   && hovered) borderColor = 'var(--amber)'
  else if (isRemove && hovered) borderColor = 'var(--red)'
  else if (!manageMode && hovered) borderColor = 'var(--accent)'

  return (
    <div
      className="card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 0, cursor: 'pointer', overflow: 'hidden',
        borderColor,
        boxShadow: (!manageMode && hovered)
          ? '0 4px 20px rgba(74,158,255,0.18)'
          : (isRemove && hovered)
            ? '0 0 0 2px rgba(231,76,60,0.18)'
            : '0 0 0 rgba(0,0,0,0)',
        transform: (!manageMode && hovered) ? 'translateY(-2px) scale(1.012)' : 'translateY(0) scale(1)',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', marginRight: 6 }}>{tail}</span>
        <span className="pill grey" style={{ marginRight: 5 }}>{acType}</span>
        <span className={`pill ${pillClass}`}>{sysLabel}</span>
        {isEdit && hovered ? (
          <span style={{ flex: 1, textAlign: 'right', fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>✎ Edit</span>
        ) : isRemove && hovered ? (
          <span style={{ flex: 1, textAlign: 'right', fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>✕ Remove</span>
        ) : (
          <span style={{ flex: 1, textAlign: 'right', fontSize: 10, color: 'var(--subtext)', fontWeight: 700 }}>
            {lastImport ?? 'No Imports Yet'}
          </span>
        )}
      </div>

      {/* Middle: Limits | Reports */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: 'var(--subtext)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Limits
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'space-around' }}>
            <StatBubble value={hasData ? stats?.na       : na} color="var(--white-na)" label="N/A"      />
            <StatBubble value={hasData ? stats?.normal   : na} color="var(--green)"    label="Normal"   />
            <StatBubble value={hasData ? stats?.caution  : na} color="var(--amber)"    label="Caution"  />
            <StatBubble value={hasData ? stats?.critical : na} color="var(--red)"      label="Critical" />
          </div>
        </div>

        <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />

        <div style={{ width: 90, flexShrink: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: 'var(--subtext)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Actions
          </div>
          <div style={{
            fontSize: 22, fontWeight: 700, lineHeight: 1,
            color: pendingActions > 0 ? 'var(--amber)' : 'var(--subtext)',
          }}>
            {pendingActions}
          </div>
          <div style={{ fontSize: 9, color: 'var(--subtext)', marginTop: 3 }}>pending</div>
        </div>
      </div>

      {/* Bottom: Trends */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 8, color: 'var(--subtext)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Trends
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'space-around' }}>
          <TrendBubble arrow="↓" value={hasData ? stats?.down : na} color="var(--amber)"   label="Recovering"    />
          <TrendBubble arrow="→" value={hasData ? stats?.flat : na} color="var(--subtext)" label="Stable"        />
          <TrendBubble arrow="↑" value={hasData ? stats?.up   : na} color="var(--red)"     label="Deteriorating" />
        </div>
      </div>
    </div>
  )
}

// ── Default page ───────────────────────────────────────────────────────────
export default function DefaultPage({ importsByTail, componentReportsByTail, compStatusByTail, onTailSelect, fleet, onAdd, onEdit, onRemove, limitsForTail }) {
  const [manageMode,    setManageMode]    = useState(null)   // null | 'edit' | 'remove'
  const [showAdd,       setShowAdd]       = useState(false)
  const [editTarget,    setEditTarget]    = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)   // null | tail string

  // Pre-compute per-tail stats once per fleet/import change.
  // Reuses App's compStatusByTail (already computed for the TopBar dots)
  // instead of re-aggregating per tail. Uses ALL_COMP_KEYS (96) + effective
  // limits for N/A classification so the Limits bubbles match the per-tail
  // Dashboard LimitsWidget exactly. Trend bubbles count only comps WITH
  // measurements (TrendsWidget's Stable column additionally lists no-data
  // comps, so its Stable figure can read higher).
  const perTailData = useMemo(() => {
    const result = {}
    for (const fi of fleet) {
      const limits  = limitsForTail?.(fi.tail) ?? LIMITS
      const imports = importsByTail?.[fi.tail] ?? []
      const status  = compStatusByTail?.[fi.tail] ?? {}
      const lastImport = imports.length
        ? [...imports].sort((a, b) => toSortableDate(b.date).localeCompare(toSortableDate(a.date)))[0].date
        : null

      const hasLim  = k => Array.isArray(limits[k])
      const hasMeas = k => !!status[k]
      const na       = ALL_COMP_KEYS.filter(k => !hasLim(k) || !hasMeas(k) || status[k].status === 'white').length
      const critical = ALL_COMP_KEYS.filter(k => hasLim(k) && hasMeas(k) && (status[k].status === 'alert' || status[k].status === 'critical')).length
      const caution  = ALL_COMP_KEYS.filter(k => hasLim(k) && hasMeas(k) && status[k].status === 'caution').length
      const normal   = ALL_COMP_KEYS.filter(k => hasLim(k) && hasMeas(k) && status[k].status === 'ok').length
      const up       = ALL_COMP_KEYS.filter(k => hasMeas(k) && status[k].trend === 'up').length
      const down     = ALL_COMP_KEYS.filter(k => hasMeas(k) && status[k].trend === 'down').length
      const flat     = ALL_COMP_KEYS.filter(k => hasMeas(k) && status[k].trend !== 'up' && status[k].trend !== 'down').length

      result[fi.tail] = {
        lastImport,
        hasData: imports.length > 0,
        stats: { na, normal, caution, critical, up, down, flat },
      }
    }
    return result
  }, [fleet, importsByTail, limitsForTail, compStatusByTail])

  function handleManageAction(action) {
    if (action === 'add') { setShowAdd(true); return }
    setManageMode(action)
  }

  function exitManage() { setManageMode(null) }

  function handleCardClick(fleetItem) {
    if (manageMode === 'edit')   { setEditTarget(fleetItem.tail); return }
    if (manageMode === 'remove') { setConfirmRemove(fleetItem.tail); return }
    onTailSelect(fleetItem.tail)
  }

  function handleRemoveConfirm() {
    onRemove([confirmRemove])
    setConfirmRemove(null)
    setManageMode(null)
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flex: 1 }}>Fleet Overview</div>

        {manageMode && (
          <button className="btn" onClick={exitManage}>Cancel</button>
        )}

        <ManageDropdown onAction={handleManageAction} disabled={!!manageMode} />
      </div>

      {/* Fleet grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {fleet.map(fi => {
          const { lastImport, hasData, stats } = perTailData[fi.tail] ?? { lastImport: null, hasData: false, stats: {} }
          const componentReports = componentReportsByTail?.[fi.tail] ?? []

          return (
            <TailCard
              key={fi.tail}
              fleetItem={fi}
              stats={stats}
              hasData={hasData}
              componentReports={componentReports}
              lastImport={lastImport}
              manageMode={manageMode}
              onClick={() => handleCardClick(fi)}
            />
          )
        })}
      </div>

      {/* Confirm remove dialog */}
      {confirmRemove !== null && (
        <div className="modal-backdrop" onClick={() => setConfirmRemove(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: 'var(--red)' }}>Remove Tail?</div>
            <div style={{ color: 'var(--subtext)', fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
              Remove <strong style={{ color: 'var(--text)' }}>{confirmRemove}</strong> from the fleet?
              <br />
              The data package (imports and reports) is <strong style={{ color: 'var(--text)' }}>not deleted</strong> —
              a backup record is created in <code style={{ fontSize: 11 }}>backups/{confirmRemove}/</code>.
              You can restore the data by re-adding the tail.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmRemove(null)}>No, Keep</button>
              <button className="btn danger" onClick={handleRemoveConfirm}>Yes, Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <TailModal
          mode="add"
          existingTails={fleet.map(f => f.tail)}
          onSave={item => { onAdd(item); setShowAdd(false) }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <TailModal
          mode="edit"
          initial={fleet.find(f => f.tail === editTarget)}
          onSave={item => { onEdit(item); setEditTarget(null); setManageMode(null) }}
          onClose={() => { setEditTarget(null); setManageMode(null) }}
        />
      )}
    </div>
  )
}
