// Export builders — the renderer side of the Export feature.
// PDF exports are self-contained HTML documents (inline CSS + data-URI logo +
// inline SVG charts) handed to main.cjs `export:pdf`, which prints them to A4;
// @page CSS drives the page size and long content flows over multiple pages.
// Excel exports are flattened session payloads for source/export_excel.py.

import { getLimitStatus } from './limitStatus'
import { statusLabel } from '../constants/status'

// ── Small helpers ─────────────────────────────────────────────────────────────

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 'DD-MM-YYYY' → 'YYYY-MM-DD' (sortable); returns input when not a 3-part date
function toSortable(d) {
  const p = (d ?? '').split('-')
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (d ?? '')
}

// 'YYYY-MM-DD' → 'DD-MM-YYYY'
export function isoToDdmmyyyy(iso) {
  return (iso ?? '').split('-').reverse().join('-')
}

function ddmmToSlash(iso) {   // 'YYYY-MM-DD' → 'DD/MM/YY' (chart tick labels)
  const p = (iso ?? '').split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : (iso ?? '')
}

// Filesystem-safe default filename fragment
export function safeFilename(s) {
  return String(s ?? '').replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_')
}

// Bundled asset URL (Vite) → data URI, so the temp HTML file rendered by the
// hidden export window can show the logo without access to the dev server.
export async function imageToDataUrl(src) {
  try {
    const blob = await (await fetch(src)).blob()
    return await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  } catch {
    return null   // letterhead renders without the logo image
  }
}

// ── Shared document scaffold ──────────────────────────────────────────────────

const PAGE_CSS = `
  @page { size: A4; margin: 15mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #111;
    font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .letterhead { text-align: center; margin-bottom: 20px; }
  .letterhead img { height: 46px; margin-bottom: 6px; }
  .letterhead .org { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
  .letterhead .sub { font-size: 10px; color: #555; }
  .letterhead .doc-title { font-size: 17px; font-weight: 800; margin-top: 9px; }
  .letterhead .doc-name  { font-size: 13px; font-weight: 600; color: #333; margin-top: 2px; }
  .letterhead .doc-meta  { font-size: 10px; color: #555; margin-top: 4px; }
  .footer-note { margin-top: 22px; font-size: 9px; color: #888; text-align: center; }
`

function letterheadHtml({ logoDataUrl, title, name, meta }) {
  return `
  <div class="letterhead">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Brook Aviation" />` : ''}
    <div class="org">BROOK AVIATION</div>
    <div class="sub">HUMS/VXP Monitoring</div>
    <div class="doc-title">${esc(title)}</div>
    ${name ? `<div class="doc-name">${esc(name)}</div>` : ''}
    ${meta ? `<div class="doc-meta">${esc(meta)}</div>` : ''}
  </div>`
}

function footerNote() {
  return `<div class="footer-note">Generated ${new Date().toLocaleString()} · Brook Aviation HUMS/VXP Monitoring</div>`
}

// ── Report → PDF HTML ─────────────────────────────────────────────────────────
// Mirrors the on-screen GeneratedReportDoc letterhead. Long reports flow over
// multiple A4 pages: table headers repeat per page, rows and per-component
// summary blocks never split mid-element.

export function reportToHtml(report, logoDataUrl) {
  const compSections = (report.components ?? []).map(c => `
    <div class="comp">
      <div class="comp-name">${esc(c.comp_key)}</div>
      <table>
        <thead>
          <tr><th>Date</th><th>Meas.</th><th>Status</th><th>Trend</th><th>Action Taken</th></tr>
        </thead>
        <tbody>
          ${(c.entries ?? []).map(e => `
          <tr>
            <td>${esc(e.date)}</td>
            <td>${esc(e.avg_meas)}</td>
            <td>${esc(statusLabel(e.limit_status))}</td>
            <td>${e.trend === 'up' ? '&uarr; Up' : '&rarr; Stable'}</td>
            <td class="action">${esc(e.action ?? '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="comp-summary">
        <div>Latest action: <strong>${esc(c.latest_action ?? '—')}</strong> · ${c.stats?.count ?? 0} event(s)
          (${c.stats?.caution_count ?? 0} caution, ${c.stats?.critical_count ?? 0} critical, ${c.stats?.uptrend_count ?? 0} up-trend)</div>
        <div>Signer: <strong>${esc(c.signer_name ?? '—')}</strong>${c.signed_at ? ` · ${new Date(c.signed_at).toLocaleDateString()}` : ''}</div>
      </div>
    </div>`).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(report.name ?? 'Incident Report')}</title>
<style>
  ${PAGE_CSS}
  .comp { border-top: 1px solid #ddd; padding-top: 12px; margin-bottom: 20px; }
  .comp-name { font-weight: 700; font-size: 13px; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10.5px; }
  thead { display: table-header-group; }
  th { text-align: left; border-bottom: 1px solid #ccc; padding: 4px 6px; font-weight: 700; }
  td { border-bottom: 1px solid #eee; padding: 4px 6px; }
  tr { page-break-inside: avoid; }
  td.action { max-width: 220px; }
  .comp-summary { font-size: 10.5px; color: #333; margin-top: 8px; line-height: 1.6; page-break-inside: avoid; }
</style></head>
<body>
  ${letterheadHtml({
    logoDataUrl,
    title: 'Incident Report',
    name: report.name,
    meta: `${report.tail} · ${report.date_from} – ${report.date_to}`,
  })}
  ${compSections}
  ${footerNote()}
</body></html>`
}

// ── Charts → PDF HTML ─────────────────────────────────────────────────────────

// Above this many data points a chart is considered cramped and the comp's
// date range is split into several charts (whole dates only — a date's
// sessions always stay on one chart).
export const MAX_POINTS_PER_CHART = 30

// points: extractCompSeries output ({ date:'YYYY-MM-DD', time, value }) —
// already chronological. Returns [{ points, from, to }] segments, each within
// MAX_POINTS_PER_CHART unless a single date alone exceeds it.
export function buildChartSegments(points, maxPoints = MAX_POINTS_PER_CHART) {
  const byDate = []
  for (const p of points) {
    const last = byDate[byDate.length - 1]
    if (last && last.date === p.date) last.points.push(p)
    else byDate.push({ date: p.date, points: [p] })
  }
  const segments = []
  let current = []
  for (const d of byDate) {
    if (current.length && current.length + d.points.length > maxPoints) {
      segments.push(current)
      current = []
    }
    current.push(...d.points)
  }
  if (current.length) segments.push(current)
  return segments.map(pts => ({
    points: pts,
    from: pts[0]?.date ?? '',
    to: pts[pts.length - 1]?.date ?? '',
  }))
}

const STATUS_COLOR = { alert: '#d64545', caution: '#e0a400', ok: '#2e9e5b', white: '#9aa4af' }

// "Nice" y-axis tick step ≈ range/4 rounded to 1/2/5×10^k
function niceStep(range) {
  const raw = range / 4 || 0.1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1
  return nice * mag
}

// One static SVG line chart for a comp segment — light theme for print:
// value polyline, per-point status-coloured dots, dashed caution/critical
// limit lines, date ticks (first session of each date, thinned to ≤ 10 labels).
export function renderChartSvg(points, limitArr, { width = 700, height = 280 } = {}) {
  const mL = 48, mR = 14, mT = 14, mB = 38
  const iW = width - mL - mR
  const iH = height - mT - mB
  const [, caution, critical] = Array.isArray(limitArr) ? limitArr : [null, null, null]

  const values = points.map(p => p.value)
  const yMax = Math.max(...values, critical ?? 0, caution ?? 0, 0.05) * 1.12
  const step = niceStep(yMax)
  const x = i => points.length === 1 ? mL + iW / 2 : mL + (i * iW) / (points.length - 1)
  const y = v => mT + iH - (v / yMax) * iH

  const parts = []
  parts.push(`<rect x="${mL}" y="${mT}" width="${iW}" height="${iH}" fill="#fafbfc" stroke="#d8dde3"/>`)

  // y grid + labels
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const yy = y(v)
    parts.push(`<line x1="${mL}" y1="${yy}" x2="${mL + iW}" y2="${yy}" stroke="#e4e8ec" stroke-width="1"/>`)
    parts.push(`<text x="${mL - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#667">${v.toFixed(2)}</text>`)
  }

  // x ticks: first point of each date, thinned to ≤ 10 labels
  const dateFirstIdx = []
  points.forEach((p, i) => {
    if (i === 0 || points[i - 1].date !== p.date) dateFirstIdx.push(i)
  })
  const every = Math.max(1, Math.ceil(dateFirstIdx.length / 10))
  dateFirstIdx.forEach((idx, k) => {
    const xx = x(idx)
    parts.push(`<line x1="${xx}" y1="${mT + iH}" x2="${xx}" y2="${mT + iH + 4}" stroke="#aab2bb"/>`)
    if (k % every === 0) {
      parts.push(`<text x="${xx}" y="${mT + iH + 15}" text-anchor="middle" font-size="8.5" fill="#667">${ddmmToSlash(points[idx].date)}</text>`)
    }
  })

  // limit lines
  const limitLine = (v, color, label) => {
    if (v == null || v > yMax) return
    const yy = y(v)
    parts.push(`<line x1="${mL}" y1="${yy}" x2="${mL + iW}" y2="${yy}" stroke="${color}" stroke-width="1" stroke-dasharray="5 4"/>`)
    parts.push(`<text x="${mL + iW - 3}" y="${yy - 3}" text-anchor="end" font-size="8.5" font-weight="700" fill="${color}">${label} ${v}</text>`)
  }
  limitLine(caution, STATUS_COLOR.caution, 'CAUTION')
  limitLine(critical, STATUS_COLOR.alert, 'CRITICAL')

  // series line + dots
  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    parts.push(`<path d="${d}" fill="none" stroke="#2f6db3" stroke-width="1.6"/>`)
  }
  points.forEach((p, i) => {
    parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${STATUS_COLOR[p.status ?? 'white']}" stroke="#fff" stroke-width="0.8"/>`)
  })

  // y axis unit
  parts.push(`<text x="${mL - 34}" y="${mT + 8}" font-size="8.5" fill="#667">ips</text>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

// sections: [{ compKey, segments: [{ points, from, to }] }] — one chart per
// segment; a comp split for crampedness renders "Part k/N" charts of the same
// comp over consecutive sub-ranges.
export function chartsToHtml({ tail, sections, dateFrom, dateTo, limits, logoDataUrl }) {
  const blocks = sections.map(({ compKey, segments }) => {
    const [name, location] = compKey.split(' | ')
    return segments.map((seg, i) => {
      const withStatus = seg.points.map(p => ({ ...p, status: getLimitStatus(compKey, p.value, limits) }))
      const partLabel = segments.length > 1 ? ` · Part ${i + 1}/${segments.length}` : ''
      return `
      <div class="chart-block">
        <div class="chart-title">${esc(name)} <span class="chart-loc">${esc(location ?? '')}</span></div>
        <div class="chart-sub">${isoToDdmmyyyy(seg.from)} – ${isoToDdmmyyyy(seg.to)}${partLabel} · ${seg.points.length} session${seg.points.length !== 1 ? 's' : ''}</div>
        ${renderChartSvg(withStatus, limits?.[compKey])}
      </div>`
    }).join('')
  }).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Component Charts — ${esc(tail)}</title>
<style>
  ${PAGE_CSS}
  .chart-block { page-break-inside: avoid; margin-bottom: 18px; }
  .chart-title { font-size: 13px; font-weight: 700; page-break-after: avoid; }
  .chart-loc { font-weight: 400; color: #667; font-size: 11px; margin-left: 6px; }
  .chart-sub { font-size: 10px; color: #667; margin: 2px 0 6px; }
</style></head>
<body>
  ${letterheadHtml({
    logoDataUrl,
    title: 'Component Vibration Charts',
    meta: `${tail} · ${isoToDdmmyyyy(dateFrom)} – ${isoToDdmmyyyy(dateTo)}`,
  })}
  ${blocks}
  ${footerNote()}
</body></html>`
}

// ── Excel payload ─────────────────────────────────────────────────────────────
// Flattens every session of the imports whose date falls inside
// [dateFrom, dateTo] (ISO, inclusive) — a date may carry several sessions;
// each becomes its own banner block in the workbook. CHANGE IN AVG is the
// delta vs the same comp's previous session across the whole selected range.

export function buildExcelPayload(imports, dateFrom, dateTo, limits, tail) {
  const inRange = (imports ?? []).filter(imp => {
    const d = toSortable(imp.date)
    return d >= dateFrom && d <= dateTo
  }).sort((a, b) => toSortable(a.date).localeCompare(toSortable(b.date)))

  const lastAvg = {}   // compKey → previous session's avg across the range
  const sessions = []
  for (const imp of inRange) {
    const ordered = [...(imp.sessions ?? [])]
      .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
    ordered.forEach((s, i) => {
      const rows = Object.entries(s.comps ?? {}).map(([key, m]) => {
        const [comp, location] = key.split(' | ')
        const avg = m.avg_meas ?? null
        const change = avg != null && lastAvg[key] != null ? avg - lastAvg[key] : null
        if (avg != null) lastAvg[key] = avg
        return {
          comp, location: location ?? '',
          avg_meas: avg,
          max_meas: m.max_meas ?? '',
          change,
          status: getLimitStatus(key, avg, limits),
        }
      })
      sessions.push({
        date: imp.date,
        session_no: i + 1,
        log_count: s.log_count ?? null,
        started_at: s.started_at ?? '',
        completed_at: s.completed_at ?? '',
        rows,
      })
    })
  }

  return {
    tail,
    date_from: isoToDdmmyyyy(dateFrom),
    date_to: isoToDdmmyyyy(dateTo),
    sessions,
  }
}
