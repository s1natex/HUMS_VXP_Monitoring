import React, { useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import { LIMITS } from '../data/limits'
import { detectTrend } from '../utils/trendDetection'
import { statusLabel, trendLabel, trendArrow, STATUS_COLOR } from '../constants/status'
import { toSortableDate } from '../utils/importLoader'

const PX_PER_GROUP   = 64   // minimum pixel width per date column
const PX_PER_SESSION = 36   // minimum pixel width per HH:MM session tick — a dense
                            // day widens its column so time labels never mash together
const AXIS_W         = 56   // pinned y-axis gutter — stays visible while the chart scrolls
const DENSE_CUTOFF   = 300  // above this many points, hide static dots for render perf

function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
  })
}

// Colour for an incident marker/tooltip: the limit status wins; a trend-only
// incident (no breach) uses the app-wide Deteriorating red.
function incidentColor(inc) {
  const s = inc?.limit_status
  return s === 'caution' || s === 'alert' || s === 'critical'
    ? STATUS_COLOR[s]
    : 'var(--red)'
}

// A tracker entry pins to the session it was judged on (session_id match),
// falling back to the date's latest session. Shared by the incident-marker
// matching and the "See Chart" highlight resolution.
function pointForEntry(dayPts, sessionId) {
  return (sessionId && dayPts.find(pt => pt.session_id === sessionId))
    || dayPts[dayPts.length - 1]
    || null
}

// ── Chart control button (arrows / date range / back) with hover feedback ──
function CtrlBtn({ title, onClick, active, children, style = {} }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 24, borderRadius: 4, padding: 0,
        background: hover ? 'rgba(74,158,255,0.24)' : 'rgba(30,34,40,0.78)',
        border: `1px solid ${hover ? 'rgba(74,158,255,0.65)' : active ? 'rgba(74,158,255,0.5)' : 'var(--border2)'}`,
        color: hover ? '#fff' : active ? 'var(--accent)' : 'var(--text)',
        fontSize: 15, fontWeight: 700, lineHeight: 1,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.1s, border-color 0.1s, color 0.1s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ── Date-range picker modal ────────────────────────────────────────────────
function DateRangeModal({ min, max, initial, onApply, onClose }) {
  const [from, setFrom] = React.useState(initial?.from ?? min)
  const [to,   setTo]   = React.useState(initial?.to   ?? max)
  const valid = from && to && from <= to
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-title">Chart Date Range</div>
        <div style={{ fontSize: 12, color: 'var(--subtext)', marginBottom: 14 }}>
          Show only sessions within this range. Available: {fmtDate(min)} – {fmtDate(max)}
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--subtext)', display: 'block', marginBottom: 4 }}>From</label>
            <input type="date" value={from} min={min} max={to || max} onChange={e => setFrom(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--subtext)', display: 'block', marginBottom: 4 }}>To</label>
            <input type="date" value={to} min={from || min} max={max} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => onApply(null)}>Show All</button>
          <button className="btn primary" disabled={!valid} onClick={() => onApply({ from, to })}>Apply</button>
        </div>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const inc = d.incident
  // Incident label: limit breach (Caution/Critical) and/or sustained up-trend.
  const incParts = []
  if (inc) {
    if (inc.limit_status === 'caution' || inc.limit_status === 'alert' || inc.limit_status === 'critical') {
      incParts.push(statusLabel(inc.limit_status))
    }
    if (inc.trend === 'up' || (inc.reason ?? '').includes('trend')) {
      incParts.push(`${trendArrow('up')} ${trendLabel('up')}`)
    }
  }
  const incColor = inc ? incidentColor(inc) : null
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--border)',
      padding: '6px 12px', borderRadius: 4, fontSize: 11, color: 'var(--text)',
    }}>
      <div style={{ color: 'var(--subtext)' }}>{fmtDate(d.date)} · {d.time}</div>
      <div style={{ fontWeight: 700, marginTop: 2 }}>{d.value?.toFixed(4)} ips</div>
      {inc && (
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid var(--border)', maxWidth: 230 }}>
          <div style={{ fontWeight: 700, color: incColor }}>
            ⚠ {incParts.length ? incParts.join(' · ') : 'Incident'}
          </div>
          {inc.action ? (
            <div style={{ marginTop: 2, whiteSpace: 'normal' }}>
              Action: <strong>{inc.action}</strong>
            </div>
          ) : (
            <div style={{ marginTop: 2, color: incColor, fontWeight: 700 }}>
              ! No action taken yet
              <div style={{ marginTop: 2, color: 'var(--subtext)', fontWeight: 400 }}>
                Click the point to sign this action
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// trackerEntries: incident-tracker entries for this component (one per import
// date) — matched to their data point so the tooltip can show the action taken
// (or an unactioned "!" marker) and the dot is tinted by incident status.
// highlight: { date: 'DD-MM-YYYY', session_id? } — the "See Chart" deep-link
// target from Reports; the matching point gets a ring marker + the chart
// scrolls it into view.
// onIncidentClick(entry): fired when a data point carrying a PENDING (unactioned)
// tracker entry is clicked — Charts opens the sign-action modal on it.
function ComponentChart({ compKey, points, editableLimits, trackerEntries, highlight, onIncidentClick }) {
  const limitsMap = editableLimits || LIMITS
  const limits = limitsMap[compKey]

  // Date-range filter: null = show all. Reset when switching component.
  const [range,     setRange]     = React.useState(null)   // { from, to } (YYYY-MM-DD) | null
  const [rangeOpen, setRangeOpen] = React.useState(false)
  useEffect(() => { setRange(null); setRangeOpen(false) }, [compKey])

  // Full available date span (points are already YYYY-MM-DD).
  const fullSpan = useMemo(() => {
    const ds = (points || []).map(p => p.date).sort()
    return { min: ds[0] ?? '', max: ds[ds.length - 1] ?? '' }
  }, [points])

  const visiblePoints = useMemo(() => {
    if (!range) return points || []
    return (points || []).filter(p => p.date >= range.from && p.date <= range.to)
  }, [points, range])

  // The full data pipeline only depends on the visible points — memoize it so
  // parent re-renders (e.g. every search keystroke in Charts) don't rebuild it.
  const { data, groups, totalUnits, xPosToTime, midToDate, midToCount } = useMemo(() => {
    const rawData = (visiblePoints || []).map(pt => {
      if (Array.isArray(pt)) {
        const d = typeof pt[0] === 'string' ? pt[0] : pt[0].toISOString().slice(0, 10)
        return { date: d, time: '00:00', value: pt[1], session_id: null }
      }
      return { date: pt.date, time: pt.time ?? '00:00', value: pt.value, session_id: pt.session_id ?? null }
    })

    const sorted = [...rawData].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return a.time < b.time ? -1 : 1
    })

    // ── Date groups ──────────────────────────────────────────────────────────
    // Every date is a column at least one unit wide (1 unit = PX_PER_GROUP px);
    // a date with many sessions widens so each session tick keeps at least
    // PX_PER_SESSION px — HH:MM time labels keep strict spacing and never mash,
    // no matter how many sessions a day has. Sessions spread evenly inside
    // their day's column.
    const groups = []
    const data = []
    sorted.forEach((pt, i) => {
      let g = groups[groups.length - 1]
      if (!g || g.date !== pt.date) {
        g = { date: pt.date, groupIdx: groups.length, count: 0, startI: i }
        groups.push(g)
      }
      g.count++
      data.push({ ...pt, xIdx: i, groupIdx: g.groupIdx })
    })
    let cursor = 0
    groups.forEach(g => {
      g.units = Math.max(1, (g.count * PX_PER_SESSION) / PX_PER_GROUP)
      g.start = cursor
      cursor += g.units
    })
    const totalUnits = cursor
    data.forEach(pt => {
      const g = groups[pt.groupIdx]
      const posInGroup = pt.xIdx - g.startI
      pt.xPos = g.start + ((posInGroup + 0.5) / g.count) * g.units
    })

    const xPosToTime = {}
    const midToDate  = {}
    const midToCount = {}
    data.forEach(pt => { xPosToTime[pt.xPos] = pt.time })
    groups.forEach(g => {
      const center = g.start + g.units / 2
      midToDate[center]  = fmtDate(g.date)
      midToCount[center] = g.count
    })

    // ── Incident markers ────────────────────────────────────────────────────
    // One tracker entry per import date, pinned to its data point.
    const entryByDate = {}
    for (const e of trackerEntries ?? []) {
      const iso = toSortableDate(e?.date ?? '')  // DD-MM-YYYY → YYYY-MM-DD
      if (iso) entryByDate[iso] = e
    }
    groups.forEach(g => {
      const e = entryByDate[g.date]
      if (!e) return
      const target = pointForEntry(data.slice(g.startI, g.startI + g.count), e.session_id)
      if (target) target.incident = e
    })

    return { data, groups, totalUnits, xPosToTime, midToDate, midToCount }
  }, [visiblePoints, trackerEntries])

  const n = data.length

  // ── "See Chart" highlight target ───────────────────────────────────────────
  // Resolve the deep-linked entry to its data point: session_id match first,
  // else the date's latest session (the one the tracker entry was judged on).
  const highlightPt = useMemo(() => {
    if (!highlight?.date) return null
    const iso = toSortableDate(highlight.date)  // DD-MM-YYYY → YYYY-MM-DD
    return pointForEntry(data.filter(pt => pt.date === iso), highlight.session_id)
  }, [data, highlight])

  // ── Trend indicator ────────────────────────────────────────────────────────
  // Same algorithm as every other trend indicator (utils/trendDetection.js):
  // Theil-Sen over the last TREND_WINDOW visible dates. Rendered only as a
  // dashed segment across the fitted window — the textual trend tag lives in
  // the Charts header pill, not on the chart itself.
  const trendInfo = useMemo(() => detectTrend(visiblePoints), [visiblePoints])

  const trendSeg = useMemo(() => {
    const t = trendInfo
    if (t.trend === 'stable' || t.dates.length < 2) return null
    const centerByDate = {}
    groups.forEach(g => { centerByDate[g.date] = g.start + g.units / 2 })
    const x0 = centerByDate[t.dates[0]]
    const x1 = centerByDate[t.dates[t.dates.length - 1]]
    if (x0 == null || x1 == null) return null
    // Endpoints from the day-based fit; the segment is drawn straight across
    // the equal-width date columns, so endpoints are exact and the middle is
    // an approximation when calendar gaps are uneven.
    return {
      trend: t.trend,
      x0, x1,
      y0: Math.max(t.intercept, 0),
      y1: Math.max(t.intercept + t.slope * t.spanDays, 0),
    }
  }, [trendInfo, groups])

  // Start scrolled to the right edge so the latest data is visible by default —
  // unless a deep-linked highlight point exists, which is centred instead.
  // Keyed so it fires once per (comp, range, highlight): `data` also rebuilds
  // when trackerEntries change (e.g. signing an incident from the chart), and
  // that must NOT snap the scroll position away from the point just signed.
  const scrollRef = useRef(null)
  const autoScrolledKey = useRef(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const key = `${compKey}|${range?.from ?? ''}:${range?.to ?? ''}|${highlightPt ? `${highlightPt.date}T${highlightPt.time}` : ''}`
    if (autoScrolledKey.current === key) return
    autoScrolledKey.current = key
    if (highlightPt) {
      const px = AXIS_W + highlightPt.xPos * PX_PER_GROUP
      el.scrollLeft = Math.max(0, px - el.clientWidth / 2)
    } else {
      el.scrollLeft = el.scrollWidth
    }
  }, [data, highlightPt, compKey, range])

  // Mouse wheel scrolls the chart horizontally (vertical wheel delta → x-scroll).
  function handleWheel(e) {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  }

  // Arrow buttons / arrow keys scroll ~3 date columns per press.
  function scrollByGroups(dir) {
    scrollRef.current?.scrollBy({ left: dir * PX_PER_GROUP * 3, behavior: 'smooth' })
  }

  // Left/Right arrow keys scroll the chart — unless the user is typing in an
  // input (e.g. the component search box).
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      scrollRef.current?.scrollBy({ left: (e.key === 'ArrowLeft' ? -1 : 1) * PX_PER_GROUP * 3, behavior: 'smooth' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])


  // Custom dot: ring marker for the deep-linked highlight point, status-tinted
  // dot (+ "!" when unactioned) for incident points, default dot otherwise.
  // Above DENSE_CUTOFF ordinary points render nothing (null → no DOM node), so
  // the dense-chart perf behaviour of the old `dot={false}` is preserved while
  // the few special markers still draw.
  function renderDot(props) {
    const { cx, cy, payload, index } = props
    if (cx == null || cy == null) return null
    const isHl = highlightPt && payload.xIdx === highlightPt.xIdx
    const inc  = payload.incident
    if (isHl) {
      return (
        <g key={`dot-${index}`}>
          <circle cx={cx} cy={cy} r={9} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
          <circle cx={cx} cy={cy} r={4} fill="#ffffff" />
        </g>
      )
    }
    if (inc) {
      const color = incidentColor(inc)
      const clickable = !inc.action && !!onIncidentClick
      return (
        <g
          key={`dot-${index}`}
          onClick={clickable ? ev => { ev.stopPropagation(); onIncidentClick(inc) } : undefined}
          style={clickable ? { cursor: 'pointer' } : undefined}
        >
          {/* Invisible widened hit area so a pending incident is easy to click */}
          {clickable && <circle cx={cx} cy={cy} r={11} fill="transparent" />}
          <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="var(--bg)" strokeWidth={1} />
          {!inc.action && (
            <text x={cx} y={cy - 8} textAnchor="middle" fill={color} fontSize={11} fontWeight={800}>!</text>
          )}
        </g>
      )
    }
    if (n > DENSE_CUTOFF) return null
    return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill="var(--accent)" />
  }

  const thresholds = []
  if (limits) {
    const [lower, caution, critical] = limits
    if (lower    != null) thresholds.push({ value: lower,    color: 'var(--green)', label: 'Normal'   })
    if (caution  != null) thresholds.push({ value: caution,  color: 'var(--amber)', label: 'Caution'  })
    if (critical != null) thresholds.push({ value: critical, color: 'var(--red)',   label: 'Critical' })
  }

  const maxLimit = thresholds.length ? Math.max(...thresholds.map(t => t.value)) : null
  const maxData  = data.length ? Math.max(...data.map(d => d.value)) : 0
  const yMax     = maxLimit != null ? Math.max(maxData, maxLimit) * 1.1 : (maxData * 1.1 || 1)
  const yDomain  = [0, parseFloat(yMax.toFixed(4))]
  const xDomain  = [0, totalUnits]

  if (!n) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, color: 'var(--subtext)', fontSize: 13,
      }}>
        {range ? 'No data in the selected date range' : 'No data available'}
        {range && (
          <button className="btn" onClick={() => setRange(null)}>← Show all data</button>
        )}
        {rangeOpen && (
          <DateRangeModal
            min={fullSpan.min} max={fullSpan.max} initial={range}
            onApply={r => { setRange(r); setRangeOpen(false) }}
            onClose={() => setRangeOpen(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, width: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Chart controls — pinned to the top-right of the chart area */}
      <div style={{ position: 'absolute', top: 2, right: 10, zIndex: 5, display: 'flex', gap: 4 }}>
        {range && (
          <CtrlBtn
            title="Back — show all data"
            onClick={() => setRange(null)}
            style={{ width: 'auto', padding: '0 8px', fontSize: 10 }}
          >
            ← All
          </CtrlBtn>
        )}
        <CtrlBtn
          title="Select date range"
          onClick={() => setRangeOpen(true)}
          active={!!range}
          style={{ width: 'auto', padding: '0 8px', fontSize: 10 }}
        >
          {range ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'Date Range'}
        </CtrlBtn>
        <CtrlBtn title="Scroll left"  onClick={() => scrollByGroups(-1)}>‹</CtrlBtn>
        <CtrlBtn title="Scroll right" onClick={() => scrollByGroups(1)}>›</CtrlBtn>
      </div>

      {rangeOpen && (
        <DateRangeModal
          min={fullSpan.min} max={fullSpan.max} initial={range}
          onApply={r => { setRange(r); setRangeOpen(false) }}
          onClose={() => setRangeOpen(false)}
        />
      )}
      {/* Horizontal scroll — every date is a min-width column (widened when it
          has many sessions), so the chart just gets wider than the viewport
          and scrolls, same as the sidebar component list scrolls vertically.
          Scales to thousands of points without any custom zoom/pan math.
          Mouse wheel and the arrow buttons also scroll horizontally. */}
      <div ref={scrollRef} onWheel={handleWheel} style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ height: '100%', width: `max(100%, ${Math.ceil(totalUnits * PX_PER_GROUP) + AXIS_W + 24}px)` }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: AXIS_W }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3040" strokeOpacity={0.6} />

              {groups.map((g, gi) => gi % 2 !== 0 ? null : (
                <ReferenceArea
                  key={`fill-${g.date}`}
                  xAxisId="time"
                  x1={g.start}
                  x2={g.start + g.units}
                  fill="rgba(74,158,255,0.04)"
                  stroke="none"
                />
              ))}

              <XAxis
                xAxisId="time"
                dataKey="xPos"
                type="number"
                domain={xDomain}
                ticks={data.map(pt => pt.xPos)}
                tickFormatter={xPos => xPosToTime[xPos] ?? ''}
                orientation="bottom"
                tick={{ fill: '#6a7b8a', fontSize: 9 }}
                tickLine={{ stroke: '#2a3040' }}
                axisLine={false}
                height={20}
                interval={0}
              />
              <XAxis
                xAxisId="date"
                dataKey="xPos"
                type="number"
                domain={xDomain}
                ticks={groups.map(g => g.start + g.units / 2)}
                tick={({ x, y, payload }) => {
                  const date  = midToDate[payload.value]
                  const count = midToCount[payload.value]
                  if (!date) return null
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text textAnchor="middle" fill="#8a9bb0" fontSize={10} fontWeight={700}>
                        <tspan x={0} dy={10}>{date}</tspan>
                        {count != null && (
                          <tspan x={0} dy={13} fill="#5a6b7a" fontSize={9} fontWeight={400}>
                            {count} session{count !== 1 ? 's' : ''}
                          </tspan>
                        )}
                      </text>
                    </g>
                  )
                }}
                orientation="bottom"
                tickLine={false}
                axisLine={{ stroke: '#3a4456' }}
                height={34}
                interval={0}
              />
              {/* Domain only — the visible y-axis is the pinned overlay below,
                  so it stays on screen at any horizontal scroll position. */}
              <YAxis hide domain={yDomain} />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 2' }}
              />

              {groups.slice(1).map(g => (
                <ReferenceLine
                  key={`div-${g.date}`}
                  xAxisId="time"
                  x={g.start}
                  stroke="rgba(255,255,255,0.22)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              ))}

              {thresholds.map(t => (
                <ReferenceLine
                  key={t.label}
                  xAxisId="time"
                  y={t.value}
                  stroke={t.color}
                  strokeDasharray="5 4"
                  strokeWidth={1}
                  strokeOpacity={0.85}
                  label={{ value: t.label, fill: t.color, fontSize: 9, position: 'insideTopRight' }}
                />
              ))}

              {trendSeg && (
                <ReferenceLine
                  xAxisId="time"
                  segment={[{ x: trendSeg.x0, y: trendSeg.y0 }, { x: trendSeg.x1, y: trendSeg.y1 }]}
                  stroke={trendSeg.trend === 'up' ? 'var(--red)' : 'var(--amber)'}
                  strokeWidth={2}
                  strokeDasharray="8 5"
                  strokeOpacity={0.9}
                />
              )}

              {/* Vertical marker line under the deep-linked highlight point */}
              {highlightPt && (
                <ReferenceLine
                  xAxisId="time"
                  x={highlightPt.xPos}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  strokeOpacity={0.9}
                />
              )}

              <Line
                xAxisId="time"
                type="linear"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={1.8}
                dot={renderDot}
                // pointerEvents none: the hover dot draws OVER the incident
                // dot and would otherwise swallow its click (recharts calls
                // activeDot handlers with the config object, not the point
                // payload, so it can't forward the click itself).
                activeDot={{ fill: '#ffffff', r: 5, pointerEvents: 'none' }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pinned Y axis — rendered OUTSIDE the scroll container so it stays
          visible at any horizontal scroll position. The scrolling chart keeps
          an equal left gutter (margin left = AXIS_W) so at scroll 0 the plot
          starts exactly at the axis edge; scrolled data slides underneath the
          opaque gutter. Same domain + margins as the main chart, so ticks and
          grid lines align exactly. pointerEvents none keeps wheel-scroll live. */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: AXIS_W,
        background: 'var(--bg)', pointerEvents: 'none', zIndex: 3,
      }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* bottom margin = main chart's 8 + time axis 20 + date axis 34,
              so both plots are the same height and ticks line up */}
          <ComposedChart data={data} margin={{ top: 12, right: 0, bottom: 62, left: 0 }}>
            <YAxis
              domain={yDomain}
              width={AXIS_W}
              tick={{ fill: '#8a9bb0', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#3a4456' }}
              label={{
                value: 'AVG MEAS (ips)', angle: -90, position: 'insideLeft',
                fill: '#8a9bb0', fontSize: 10, offset: 4,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Memoized: Charts re-renders on every filter/search state change, but the
// chart itself only depends on these props.
export default React.memo(ComponentChart)
