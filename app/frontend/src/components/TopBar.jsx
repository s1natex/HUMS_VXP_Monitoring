import React, { useState, useRef, useEffect, useMemo } from 'react'
import logo from '../assets/brook_aviation_logo_header.png'
import { isWip } from '../data/tailIndex'

// ── TopBar nav button with hover lighting ─────────────────────────────────────
function NavBtn({ isActive, onClick, children, style = {} }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      className="vxp-nav-btn"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: isActive ? 'white' : hover ? 'rgba(255,255,255,0.18)' : 'transparent',
        color: isActive ? 'var(--accent)' : hover ? 'white' : 'rgba(255,255,255,0.88)',
        border: `1px solid ${isActive ? 'white' : hover ? 'rgba(255,255,255,0.55)' : '#7ab8ff'}`,
        borderRadius: 3, fontSize: 13, fontWeight: 700,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ── Derive worst incident indicator from a compStatus map ─────────────────────
// Returns { color: 'red'|'yellow'|'green'|null, trendUp: boolean }
function deriveIncident(compStatus) {
  if (!compStatus || Object.keys(compStatus).length === 0) return { color: null, trendUp: false }

  let worstLevel = 0   // 0=none, 1=green/ok, 2=yellow/caution, 3=red/alert
  let trendUp    = false

  for (const entry of Object.values(compStatus)) {
    const s = entry?.status
    if (s === 'alert' || s === 'critical') worstLevel = Math.max(worstLevel, 3)
    else if (s === 'caution' || s === 'warning') worstLevel = Math.max(worstLevel, 2)
    else if (s === 'ok' || s === 'normal') worstLevel = Math.max(worstLevel, 1)

    if (entry?.trend === 'up') trendUp = true
  }

  const color = worstLevel === 3 ? 'red' : worstLevel === 2 ? 'yellow' : worstLevel === 1 ? 'green' : null
  return { color, trendUp }
}

// ── Pulsing incident dot ───────────────────────────────────────────────────────
const DOT_COLORS = {
  red:    { bg: '#e74c3c', ring: 'rgba(231,76,60,0.45)',  cls: 'vxp-pulse-ring-red'   },
  yellow: { bg: '#f0a500', ring: 'rgba(240,165,0,0.45)',  cls: 'vxp-pulse-ring-amber' },
  green:  { bg: '#2ecc71', ring: 'rgba(46,204,113,0.45)', cls: 'vxp-pulse-ring-green' },
}

function IncidentIndicator({ color, trendUp, size = 8 }) {
  if (!color && !trendUp) return null
  const dc = DOT_COLORS[color]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 3 }}>
      {color && (
        <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
          <span
            className={dc.cls}
            style={{
              position: 'absolute', inset: -3,
              borderRadius: '50%',
              border: `2px solid ${dc.bg}`,
              opacity: 0.7,
            }}
          />
          <span style={{
            width: size, height: size, borderRadius: '50%',
            background: dc.bg,
            display: 'inline-block',
            flexShrink: 0,
          }} />
        </span>
      )}
      {trendUp && (
        <span style={{
          color: '#e74c3c', fontSize: 8, fontWeight: 900, lineHeight: 1,
        }} title="Trend up detected">▲</span>
      )}
    </span>
  )
}

// ── Tail Dropdown ─────────────────────────────────────────────────────────────
function TailDropdown({ activeTail, onSelect, fleet, compStatusByTail }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const activeIncident = useMemo(
    () => activeTail ? deriveIncident(compStatusByTail?.[activeTail]) : { color: null, trendUp: false },
    [activeTail, compStatusByTail],
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <NavBtn
        isActive={!!activeTail}
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 14px', minWidth: 130, justifyContent: 'space-between' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {activeTail ?? 'Select Tail'}
          {activeTail && <IncidentIndicator {...activeIncident} />}
        </span>
        <span style={{ fontSize: 9, opacity: 0.8 }}>{open ? '▲' : '▼'}</span>
      </NavBtn>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 4, minWidth: 'max-content', zIndex: 300,
          overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        }}>
          {(fleet ?? []).map((fi, i) => {
            const { tail } = fi
            const wip      = isWip(tail)
            const incident = deriveIncident(compStatusByTail?.[tail])
            return (
              <div
                key={tail}
                onClick={() => { onSelect(tail); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontSize: 13, fontWeight: 700,
                  color: tail === activeTail ? 'var(--accent)' : wip ? 'var(--subtext)' : 'var(--text)',
                  background: tail === activeTail ? 'var(--sel-bg)' : 'transparent',
                  borderBottom: i < (fleet ?? []).length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (tail !== activeTail) e.currentTarget.style.background = '#232d3f' }}
                onMouseLeave={e => { if (tail !== activeTail) e.currentTarget.style.background = 'transparent' }}
              >
                <span>{tail}</span>
                <span
                  className="vxp-badge-pulse"
                  style={{
                    fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 2,
                    background: 'rgba(74,158,255,0.18)',
                    color: '#7bc3ff',
                    display: 'inline-block',
                  }}
                >
                  VXP
                </span>
                <IncidentIndicator {...incident} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── TopBar ────────────────────────────────────────────────────────────────────
export default function TopBar({
  activeTail, tailView, page, fleet, compStatusByTail,
  onTailSelect, onTailViewChange, onRecentImports, onDefaultPage,
}) {
  const NAV_ITEMS = [
    { key: 'dashboard',       label: 'Dashboard',       isActive: page === 'tail' && tailView === 'dashboard', onClick: () => onTailViewChange('dashboard') },
    { key: 'reports',         label: 'Reports',         isActive: page === 'tail' && tailView === 'reports',   onClick: () => onTailViewChange('reports')   },
    { key: 'charts',          label: 'Charts',          isActive: page === 'tail' && tailView === 'charts',    onClick: () => onTailViewChange('charts')    },
    { key: 'recent-imports',  label: 'Recent Imports',  isActive: page === 'recent-imports',                  onClick: onRecentImports                     },
  ]

  return (
    <div style={{
      height: 62,
      background: 'var(--accent)',
      display: 'flex', alignItems: 'center',
      padding: '0 14px', gap: 10, flexShrink: 0,
      userSelect: 'none',
    }}>
      <img
        src={logo}
        alt="Brook Aviation"
        style={{ height: 38, objectFit: 'contain' }}
        onError={e => { e.target.style.display = 'none' }}
      />

      <NavBtn isActive={page === 'default'} onClick={onDefaultPage} style={{ padding: '5px 14px' }}>
        Default Page
      </NavBtn>

      <TailDropdown
        activeTail={activeTail}
        onSelect={onTailSelect}
        fleet={fleet}
        compStatusByTail={compStatusByTail}
      />

      <div style={{ flex: 1 }} />

      {activeTail && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 1, height: 34, background: '#3a82e0', margin: '0 4px' }} />
          {NAV_ITEMS.map(item => (
            <NavBtn key={item.key} isActive={item.isActive} onClick={item.onClick} style={{ padding: '5px 16px' }}>
              {item.label}
            </NavBtn>
          ))}
        </div>
      )}
    </div>
  )
}
