import React, { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { ALL_COMP_KEYS } from '../data/limits'
import { dotClass } from '../constants/status'

function WidgetHeader({ title, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', letterSpacing: '0.03em' }}>
        {title}
      </span>
      {action}
    </div>
  )
}

// ── Widget 1: Recent Imports ──────────────────────────────────────────────────
function RecentImportsWidget({ imports, onViewAll }) {
  const recent = (imports ?? []).slice(0, 5)
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <WidgetHeader
        title="Recent Imports"
        action={
          <button className="btn" onClick={onViewAll} style={{ fontSize: 11, padding: '3px 10px' }}>
            View all
          </button>
        }
      />
      {recent.length === 0 ? (
        <div style={{ color: 'var(--subtext)', fontSize: 12, fontStyle: 'italic' }}>No imports yet</div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map(imp => {
            const s = imp.summary ?? {}
            return (
              <div key={imp.import_id ?? imp.date} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 6, background: 'var(--panel2)',
              }}>
                <div style={{ fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{imp.date}</div>
                <div style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0 }}>
                  {(imp.sessions ?? []).length} Sessions
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: 'var(--subtext)', fontWeight: 700 }}>Total: {s.total ?? 0}</span>
                  <span style={{ fontSize: 10, color: 'var(--border2)', margin: '0 3px' }}>|</span>
                  <span style={{ fontSize: 10, color: 'var(--green)',   fontWeight: 700 }}>{s.green  ?? 0}N</span>
                  <span style={{ fontSize: 10, color: 'var(--amber)',   fontWeight: 700 }}>{s.yellow ?? 0}C</span>
                  <span style={{ fontSize: 10, color: 'var(--red)',     fontWeight: 700 }}>{s.red    ?? 0}Cr</span>
                  <span style={{ fontSize: 10, color: 'var(--border2)', margin: '0 3px' }}>|</span>
                  <span style={{ fontSize: 10, color: 'var(--subtext)', fontWeight: 700 }}>{s.flat   ?? 0}→</span>
                  <span style={{ fontSize: 10, color: 'var(--red)',     fontWeight: 700 }}>{s.up     ?? 0}↑</span>
                  <span style={{ fontSize: 10, color: 'var(--amber)',   fontWeight: 700 }}>{s.down   ?? 0}↓</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Widget 2: Actions ─────────────────────────────────────────────────────────
// componentReports: per-component incident trackers for the active tail.
// "Pending actions" = individual entries that still need an action assigned
// (can be multiple per component) across all trackers for this tail.
// Counts what triggered a set of entries (an entry can count in both a limit
// bucket and the trend bucket, e.g. reason 'limit+trend').
function pendingBreakdown(entries) {
  return {
    caution:  entries.filter(e => e.limit_status === 'caution').length,
    critical: entries.filter(e => e.limit_status === 'alert' || e.limit_status === 'critical').length,
    up:       entries.filter(e => e.trend === 'up').length,
  }
}

function ActionsWidget({ componentReports, onViewReports, onSelectComponent }) {
  const [hoverRow, setHoverRow] = useState(null)
  const pendingEntries = (componentReports ?? []).flatMap(t =>
    (t.entries ?? []).filter(e => !e.action).map(e => ({ ...e, comp_key: t.comp_key }))
  )

  // One row per COMPONENT with pending actions (not per entry) — fixed at the
  // 3 most recently touched comps so the widget never scrolls. Each row carries
  // that comp's own caution/critical/up-trend pending breakdown.
  const byComp = new Map()
  for (const e of pendingEntries) {
    if (!byComp.has(e.comp_key)) byComp.set(e.comp_key, [])
    byComp.get(e.comp_key).push(e)
  }
  const latest3Comps = [...byComp.entries()]
    .map(([compKey, entries]) => {
      const latest = entries.reduce((a, b) => ((b.created_at ?? '') > (a.created_at ?? '') ? b : a))
      return { compKey, latest, ...pendingBreakdown(entries) }
    })
    .sort((a, b) => (b.latest.created_at ?? '').localeCompare(a.latest.created_at ?? ''))
    .slice(0, 3)

  const { caution: cautionCount, critical: criticalCount, up: upTrendCount } = pendingBreakdown(pendingEntries)

  function handleRowClick(compKey) {
    onSelectComponent ? onSelectComponent(compKey) : onViewReports()
  }

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <WidgetHeader
        title="Actions"
        action={
          <button className="btn" onClick={onViewReports} style={{ fontSize: 11, padding: '3px 10px' }}>
            View all
          </button>
        }
      />
      <div style={{ marginBottom: 14, flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
            {pendingEntries.length}
          </div>
          <div style={{ fontSize: 10, color: 'var(--subtext)' }}>Pending actions</div>
        </div>
        {[
          { label: 'Caution',  value: cautionCount,  color: 'var(--amber)' },
          { label: 'Critical', value: criticalCount, color: 'var(--red)'   },
          { label: '↑ Deteriorating', value: upTrendCount, color: 'var(--red)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, color }}>
              {value}
            </div>
            <div style={{ fontSize: 9, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {label}
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {latest3Comps.map(({ compKey, latest, caution, critical, up }) => (
          <div
            key={compKey}
            onClick={() => handleRowClick(compKey)}
            onMouseEnter={() => setHoverRow(compKey)}
            onMouseLeave={() => setHoverRow(null)}
            title="Open in Reports"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              padding: '8px 12px', borderRadius: 5,
              background: hoverRow === compKey ? 'rgba(255,255,255,0.06)' : 'var(--panel2)',
              border: `1px solid ${hoverRow === compKey ? 'rgba(74,158,255,0.45)' : 'transparent'}`,
              transition: 'background 0.1s, border-color 0.1s',
            }}
          >
            <span className={`status-dot ${dotClass(latest.limit_status)}`} />
            <span style={{ fontWeight: 600, fontSize: 12, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '38%' }}>
              {compKey.split(' | ')[0]}
            </span>
            <span style={{ flex: 1, fontSize: 10, color: 'var(--subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {compKey.split(' | ')[1] ?? ''}
            </span>
            {/* Pending breakdown for this comp — same notation as Recent Imports */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--amber)',   fontWeight: 700 }}>{caution}C</span>
              <span style={{ fontSize: 10, color: 'var(--border2)' }}>|</span>
              <span style={{ fontSize: 10, color: 'var(--red)',     fontWeight: 700 }}>{critical}Cr</span>
              <span style={{ fontSize: 10, color: 'var(--border2)' }}>|</span>
              <span style={{ fontSize: 10, color: 'var(--red)',     fontWeight: 700 }}>{up}↑</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0 }}>{latest.date}</span>
          </div>
        ))}
        {!pendingEntries.length && (
          <div style={{ fontSize: 12, color: 'var(--subtext)', fontStyle: 'italic' }}>No pending actions</div>
        )}
      </div>
    </div>
  )
}

// ── Widget 3: Limits Status ───────────────────────────────────────────────────
function LimitsWidget({ compStatus, editableLimits, onSelect }) {
  const hasLimit   = k => Array.isArray(editableLimits?.[k])
  // A comp only has a real measurement if aggregateCompStatus put an entry in compStatus
  const hasMeasure = k => !!compStatus?.[k]

  // N/A: no limit defined, OR limit defined but no measurement recorded yet
  const naEntries = ALL_COMP_KEYS
    .filter(k => !hasLimit(k) || !hasMeasure(k) || compStatus[k].status === 'white')
    .map(k => [k, compStatus?.[k] ?? { status: 'white' }])

  const alertEntries = ALL_COMP_KEYS
    .filter(k => hasLimit(k) && hasMeasure(k) && (compStatus[k].status === 'alert' || compStatus[k].status === 'critical'))
    .map(k => [k, compStatus[k]])

  const cautionEntries = ALL_COMP_KEYS
    .filter(k => hasLimit(k) && hasMeasure(k) && compStatus[k].status === 'caution')
    .map(k => [k, compStatus[k]])

  const normalEntries = ALL_COMP_KEYS
    .filter(k => hasLimit(k) && hasMeasure(k) && compStatus[k].status === 'ok')
    .map(k => [k, compStatus[k]])

  // Colour rides on each datum — indexing a colour array positionally would
  // misalign once a zero-value category is filtered out of the pie.
  const pieData = [
    { name: 'N/A',      value: naEntries.length,      color: 'var(--white-na)' },
    { name: 'Normal',   value: normalEntries.length,  color: 'var(--green)'    },
    { name: 'Caution',  value: cautionEntries.length, color: 'var(--amber)'    },
    { name: 'Critical', value: alertEntries.length,   color: 'var(--red)'      },
  ].filter(d => d.value > 0)

  const columns = [
    { label: 'N/A',      color: 'var(--white-na)', list: naEntries,      count: naEntries.length      },
    { label: 'Normal',   color: 'var(--green)',   list: normalEntries,  count: normalEntries.length  },
    { label: 'Caution',  color: 'var(--amber)',   list: cautionEntries, count: cautionEntries.length },
    { label: 'Critical', color: 'var(--red)',     list: alertEntries,   count: alertEntries.length   },
  ]

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <WidgetHeader title="Limits Status" />
      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
        {/* Pie chart */}
        <div style={{ width: 110, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <ResponsiveContainer width={110} height={110}>
            <PieChart>
              <Pie data={pieData} innerRadius={28} outerRadius={48} paddingAngle={pieData.length > 1 ? 2 : 0} dataKey="value">
                {pieData.map(d => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'var(--panel2)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                }}
                itemStyle={{ color: 'var(--text)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 4-column status lists: N/A | Normal | Caution | Critical */}
        <div style={{ flex: 1, display: 'flex', gap: 5, minHeight: 0, minWidth: 0 }}>
          {columns.map(({ label, color, list, count }) => (
            <div key={label} style={{
              flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
              background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 5,
              overflow: 'hidden',
            }}>
              <div style={{ padding: '6px 8px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 9, color: 'var(--subtext)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {label}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {list.length === 0 ? (
                  <div style={{ padding: '6px 8px', fontSize: 10, color: 'var(--subtext)', opacity: 0.6 }}>None</div>
                ) : list.map(([key]) => (
                  <div
                    key={key}
                    onClick={() => onSelect?.(key)}
                    style={{
                      padding: '3px 7px', cursor: onSelect ? 'pointer' : 'default', fontSize: 10,
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                    onMouseEnter={e => { if (onSelect) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {key.split(' | ')[0]}
                    </div>
                    <div style={{ color: 'var(--subtext)', fontSize: 9 }}>
                      {key.split(' | ')[1] ?? ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Widget 4: Trends (3-column list, all 96 comps) ────────────────────────────
function TrendsWidget({ compStatus, onSelect }) {
  const allComps = ALL_COMP_KEYS
    .map(key => [key, compStatus?.[key] ?? { status: 'white', trend: 'stable' }])
  const upComps     = allComps.filter(([,v]) => v.trend === 'up')
  const stableComps = allComps.filter(([,v]) => v.trend !== 'up' && v.trend !== 'down')
  const downComps   = allComps.filter(([,v]) => v.trend === 'down')

  const columns = [
    { icon: '↓', label: 'Recovering',     color: 'var(--amber)',   list: downComps   },
    { icon: '→', label: 'Stable',         color: 'var(--subtext)', list: stableComps },
    { icon: '↑', label: 'Deteriorating',  color: 'var(--red)',     list: upComps     },
  ]

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <WidgetHeader title="Trends" />
      <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
        {columns.map(({ icon, label, color, list }) => (
          <div key={label} style={{
            flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
            background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 5,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 10px 6px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{icon} {list.length}</div>
              <div style={{ fontSize: 9, color: 'var(--subtext)', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {label}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {list.map(([key]) => (
                <div
                  key={key}
                  onClick={() => onSelect?.(key)}
                  style={{
                    padding: '4px 8px', cursor: onSelect ? 'pointer' : 'default', fontSize: 10,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                  onMouseEnter={e => { if (onSelect) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {key.split(' | ')[0]}
                  </div>
                  <div style={{ color: 'var(--subtext)', fontSize: 9 }}>
                    {key.split(' | ')[1] ?? ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Dashboard (2×2 grid) — order: Imports | Actions / Limits | Trends ─────────
export default function Dashboard({
  imports, componentReports, compStatus, editableLimits,
  onViewImports, onViewReports, onViewComponent, onViewReportComponent,
}) {
  return (
    <div style={{
      flex: 1, overflow: 'hidden', padding: 20,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: 16,
    }}>
      <RecentImportsWidget imports={imports} onViewAll={onViewImports} />
      <ActionsWidget componentReports={componentReports} onViewReports={onViewReports} onSelectComponent={onViewReportComponent} />
      <LimitsWidget compStatus={compStatus} editableLimits={editableLimits} onSelect={onViewComponent} />
      <TrendsWidget compStatus={compStatus} onSelect={onViewComponent} />
    </div>
  )
}
