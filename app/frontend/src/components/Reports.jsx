import React, { useState, useRef, useEffect, useMemo } from 'react'
import SignerDropdown from './SignerDropdown'
import ActionDropdown from './ActionDropdown'
import { saveComponentReport, syncGeneratedReports, generateReport, allEntriesActioned } from '../utils/reportStore'
import { dotClass, statusLabel } from '../constants/status'
import { reportToHtml, imageToDataUrl, safeFilename } from '../utils/exportUtils'
import brookLogo from '../assets/brook_aviation_logo_header.png'

// ── Component detail ───────────────────────────────────────────────────────────
// Entry-level sign model: applying an action to an entry (date) signs that
// date — the entry moves from the Pending view to the Signed view immediately,
// and a fully-actioned component counts as Signed (no separate Sign Off click).
// entryFilter mirrors the list's All / Pending / Signed tab: Pending shows only
// unactioned entries, Signed shows only actioned ones.
// highlightEntryId: entry deep-linked from the chart's sign-action modal
// ("Go to Reports") — that row gets an accent ring + "from chart" tag and is
// scrolled into view so the redirected action is obvious in the list.
function ComponentDetail({ tracker, tail, entryFilter, onUpdate, onSeeChart, highlightEntryId }) {
  const [entries,    setEntries]    = useState(tracker.entries ?? [])
  const highlightRef = useRef(null)

  // The tracker can change under an open detail (a new import scanned while
  // Reports is mounted refreshes the trackers; the key only remounts on comp
  // switch) — re-sync the local copy so fresh entries appear. After our own
  // persist() this sets the same saved entries back, which is a no-op.
  useEffect(() => {
    setEntries(tracker.entries ?? [])
  }, [tracker])

  // entryFilter dep: a redirected signed entry is hidden until the parent
  // switches the tab, so the ref is only attached on the re-render after the
  // filter change — re-fire the scroll then.
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'center' })
  }, [highlightEntryId, entryFilter])
  const [staged,     setStaged]     = useState({})              // entry_id → chosen-but-unapplied action
  const [selectMode, setSelectMode] = useState(false)           // multi-select toggled by the Select button
  const [selected,   setSelected]   = useState(() => new Set()) // entry_ids for bulk apply
  const [bulkAction, setBulkAction] = useState(null)
  const [quickAction, setQuickAction] = useState(null)          // "set all unactioned" choice
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState(null)

  // Signed = every entry has an applied action (derived, not a button press).
  const allActioned = allEntriesActioned(entries)
  const unactionedCount = entries.filter(e => !e.action).length
  const stagedCount = entries.filter(e => staged[e.entry_id] != null && staged[e.entry_id] !== e.action).length

  // Entries shown under the active tab. Selection/bulk ops act on this subset.
  // Sorted newest-first by DATE — tracker order is scan insertion order, which
  // a backfilled older-dated PDF import breaks (its date lands at the top).
  const shownEntries = entries
    .filter(e =>
      entryFilter === 'pending' ? !e.action :
      entryFilter === 'signed'  ? !!e.action : true
    )
    .sort((a, b) => ddmmyyyyToIso(b.date).localeCompare(ddmmyyyyToIso(a.date)))
  const cutoffIso = recentCutoffIso()

  // Tab switches re-render (not remount) this component, so staged actions
  // survive — but the selection could reference entries hidden by the new tab.
  useEffect(() => {
    setSelectMode(false)
    setSelected(new Set())
    setBulkAction(null)
  }, [entryFilter])
  const allSelected = shownEntries.length > 0 && shownEntries.every(e => selected.has(e.entry_id))
  // Revert mode: in the Signed tab select applied entries to send back to pending.
  const revertMode = entryFilter === 'signed'

  async function persist(updated) {
    const prevEntries = entries
    setSaving(true)
    setSaveError(null)
    try {
      setEntries(updated)
      // Status is derived from the entries: all actioned → signed.
      const allDone = allEntriesActioned(updated)
      const t = await saveComponentReport(tail, {
        ...tracker,
        entries: updated,
        status: allDone ? 'signed' : 'pending',
        signed_at: allDone ? (tracker.signed_at ?? new Date().toISOString()) : null,
      })
      onUpdate(t)
      return true
    } catch (e) {
      setEntries(prevEntries)   // disk write failed — roll the UI back
      setSaveError(`Save failed: ${e.message}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  function stageAction(entryId, action) {
    setStaged(prev => ({ ...prev, [entryId]: action }))
  }

  async function applyOne(entryId) {
    const action = staged[entryId]
    if (!action) return
    const ok = await persist(entries.map(e => e.entry_id === entryId ? { ...e, action } : e))
    if (ok) setStaged(prev => { const next = { ...prev }; delete next[entryId]; return next })
  }

  function toggleSelected(entryId) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(entryId) ? next.delete(entryId) : next.add(entryId)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(shownEntries.map(e => e.entry_id)))
  }

  function toggleSelectMode() {
    setSelectMode(m => !m)
    setSelected(new Set())
    setBulkAction(null)
  }

  async function applyBulk() {
    if (!bulkAction || !selected.size) return
    const ok = await persist(entries.map(e => selected.has(e.entry_id) ? { ...e, action: bulkAction } : e))
    if (!ok) return
    setStaged(prev => {
      const next = { ...prev }
      for (const id of selected) delete next[id]
      return next
    })
    setSelectMode(false)
    setSelected(new Set())
    setBulkAction(null)
  }

  // One-click path for the common case: give every entry that still lacks an
  // action the same action — no select mode, no per-entry Apply clicks.
  async function applyToUnactioned() {
    if (!quickAction || !unactionedCount) return
    const ok = await persist(entries.map(e => e.action ? e : { ...e, action: quickAction }))
    if (!ok) return
    setStaged(prev => {
      const next = { ...prev }
      for (const e of entries) if (!e.action) delete next[e.entry_id]
      return next
    })
    setQuickAction(null)
  }

  // Apply every staged (chosen-but-unapplied) action in one save.
  async function applyAllStaged() {
    if (!stagedCount) return
    const ok = await persist(entries.map(e =>
      staged[e.entry_id] != null ? { ...e, action: staged[e.entry_id] } : e
    ))
    if (ok) setStaged({})
  }

  // Revert selected entries back to pending: clears their action — the entry
  // returns to the Pending view and the tracker's derived status follows.
  async function revertSelected() {
    if (!selected.size) return
    const ok = await persist(entries.map(e => selected.has(e.entry_id) ? { ...e, action: null } : e))
    if (ok) {
      setSelectMode(false)
      setSelected(new Set())
    }
  }

  const [name, location] = tracker.comp_key.split(' | ')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{name}</span>
          <span style={{ fontSize: 12, color: 'var(--subtext)' }}>{location}</span>
          {/* No pending/signed flag — the entry's state is the tab it lives under.
              Pending info is never shown inside the Signed view. */}
          {entryFilter !== 'signed' && unactionedCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--subtext)' }}>
              {unactionedCount} action{unactionedCount !== 1 ? 's' : ''} pending
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {shownEntries.length > 0 && (
              <button
                className="btn"
                style={{
                  fontSize: 11,
                  color: selectMode ? (revertMode ? 'var(--red)' : 'var(--accent)') : undefined,
                  borderColor: selectMode ? (revertMode ? 'rgba(224,82,82,0.5)' : 'rgba(74,158,255,0.5)') : undefined,
                }}
                onClick={toggleSelectMode}
              >
                {selectMode ? 'Cancel' : revertMode ? 'Revert Action' : 'Select'}
              </button>
            )}
          </div>
        </div>
        {allActioned && tracker.signed_at && (
          <div style={{ fontSize: 12, color: 'var(--subtext)' }}>
            Signed · all actions applied · {new Date(tracker.signed_at).toLocaleString()}
          </div>
        )}
        {saveError && (
          <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{saveError}</div>
        )}
      </div>

      {/* Quick-apply bar — the fast path: set all unactioned entries with one
          action, or commit every staged choice at once. No select mode needed. */}
      {!revertMode && !selectMode && (unactionedCount > 0 || stagedCount > 1) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          padding: '8px 12px', background: 'var(--panel2)',
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          {unactionedCount > 0 && (
            <>
              <span style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0 }}>
                {unactionedCount} unactioned
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ActionDropdown value={quickAction} onChange={setQuickAction} tail={tail} />
              </div>
              <button
                className="btn primary"
                style={{ fontSize: 11, flexShrink: 0, opacity: quickAction ? 1 : 0.45 }}
                disabled={!quickAction || saving}
                onClick={applyToUnactioned}
              >
                Set all unactioned
              </button>
            </>
          )}
          {stagedCount > 1 && (
            <button
              className="btn"
              style={{ fontSize: 11, flexShrink: 0, color: 'var(--accent)', borderColor: 'rgba(74,158,255,0.5)', marginLeft: unactionedCount > 0 ? 0 : 'auto' }}
              disabled={saving}
              onClick={applyAllStaged}
            >
              Apply staged ({stagedCount})
            </button>
          )}
        </div>
      )}

      {/* Bulk bar — apply (pending) or revert (signed), visible only in select mode */}
      {selectMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          padding: '8px 12px', background: 'var(--panel2)',
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            title="Select all entries"
            style={{ flexShrink: 0, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0, minWidth: 70 }}>
            {selected.size} selected
          </span>
          {revertMode ? (
            <>
              <div style={{ flex: 1 }} />
              <button
                className="btn danger"
                style={{ fontSize: 11, flexShrink: 0, opacity: selected.size ? 1 : 0.45 }}
                disabled={!selected.size || saving}
                onClick={revertSelected}
              >
                Revert to pending
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ActionDropdown value={bulkAction} onChange={setBulkAction} tail={tail} />
              </div>
              <button
                className="btn primary"
                style={{ fontSize: 11, flexShrink: 0, opacity: bulkAction && selected.size ? 1 : 0.45 }}
                disabled={!bulkAction || !selected.size || saving}
                onClick={applyBulk}
              >
                Apply to selected
              </button>
            </>
          )}
        </div>
      )}

      {/* Entries — one row each (filtered by the active All / Pending / Signed tab) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {shownEntries.length === 0 && (
          <div style={{ padding: 16, color: 'var(--subtext)', fontSize: 12, fontStyle: 'italic' }}>
            {entryFilter === 'pending' ? 'No pending actions — every entry has an applied action'
              : entryFilter === 'signed' ? 'No signed entries yet — apply an action to sign a date'
              : 'No entries'}
          </div>
        )}
        {shownEntries.map((e, idx) => {
          const shown = staged[e.entry_id] ?? e.action
          const dirty = staged[e.entry_id] != null && staged[e.entry_id] !== e.action
          const rowSelectable = selectMode
          const isRedirected = highlightEntryId === e.entry_id
          const oldStart = ddmmyyyyToIso(e.date) < cutoffIso &&
            (idx === 0 || ddmmyyyyToIso(shownEntries[idx - 1].date) >= cutoffIso)
          return (
            <React.Fragment key={e.entry_id}>
            {oldStart && <OlderDivider />}
            <div
              ref={isRedirected ? highlightRef : undefined}
              className="card"
              // In select mode the whole row toggles selection; the action
              // dropdown and Apply button stop propagation so they still work.
              onClick={rowSelectable ? () => toggleSelected(e.entry_id) : undefined}
              style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                cursor: rowSelectable ? 'pointer' : 'default',
                background: rowSelectable && selected.has(e.entry_id) ? 'rgba(74,158,255,0.07)' : undefined,
                borderColor: isRedirected ? 'rgba(74,158,255,0.65)' : undefined,
                boxShadow: isRedirected ? '0 0 0 1px rgba(74,158,255,0.35)' : undefined,
                transition: 'background 0.1s',
              }}
            >
              {rowSelectable && (
                <input
                  type="checkbox"
                  checked={selected.has(e.entry_id)}
                  onChange={() => toggleSelected(e.entry_id)}
                  onClick={ev => ev.stopPropagation()}
                  style={{ flexShrink: 0, cursor: 'pointer' }}
                />
              )}
              <span className={`status-dot ${dotClass(e.limit_status)}`} style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: 12, flexShrink: 0, minWidth: 74 }}>{e.date}</span>
              {isRedirected && (
                <span className="pill blue" style={{ fontSize: 9, flexShrink: 0 }} title="Redirected from the chart">
                  ↩ FROM CHART
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0 }}>avg {e.avg_meas}</span>
              {e.trend === 'up' && (
                <span className="pill red" style={{ fontSize: 9, flexShrink: 0 }}>↑ DETERIORATING</span>
              )}
              {/* Trend-only entries (opened by rising trend while still inside
                  limits) get a neutral pill — an amber NORMAL would mislead. */}
              {e.limit_status === 'alert' || e.limit_status === 'caution' ? (
                <span className={`pill ${e.limit_status === 'alert' ? 'red' : 'amber'}`} style={{ fontSize: 9, flexShrink: 0 }}>
                  {statusLabel(e.limit_status).toUpperCase()}
                </span>
              ) : (
                <span className="pill grey" style={{ fontSize: 9, flexShrink: 0 }}>IN LIMITS</span>
              )}
              {revertMode ? (
                <div style={{
                  flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text)',
                  background: 'var(--panel2)', padding: '5px 10px', borderRadius: 5,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {e.action ?? '—'}
                </div>
              ) : (
                <div style={{ flex: 1, minWidth: 0 }} onClick={ev => ev.stopPropagation()}>
                  <ActionDropdown value={shown} onChange={action => stageAction(e.entry_id, action)} tail={tail} />
                </div>
              )}
              <button
                className="btn"
                title="Show this data point on the chart"
                style={{ fontSize: 11, flexShrink: 0 }}
                onClick={ev => { ev.stopPropagation(); onSeeChart?.(e) }}
              >
                See Chart
              </button>
              {!revertMode && (
                <button
                  className="btn primary"
                  style={{ fontSize: 11, flexShrink: 0, opacity: dirty ? 1 : 0.4 }}
                  disabled={!dirty || saving}
                  onClick={ev => { ev.stopPropagation(); applyOne(e.entry_id) }}
                >
                  Apply
                </button>
              )}
            </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Entry-level sign model: applying an action to a date signs it — a fully
          actioned component is Signed automatically; no separate sign-off step. */}
      {!allActioned && entries.length > 0 && entryFilter !== 'signed' && (
        <div style={{ fontSize: 11, color: 'var(--subtext)', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          Applying an action signs that date — once every entry is actioned the component moves to Signed
          and becomes available for report generation
        </div>
      )}
    </div>
  )
}

// ── Component list ───────────────────────────────────────────────────────────
// Entry-level filters: Pending = has at least one unactioned entry; Signed =
// has at least one actioned entry. A partially-actioned component appears in
// BOTH lists (its pending dates on one side, its signed dates on the other).
function ComponentList({ trackers, selectedKey, onSelect, onViewReportsClick, onGenerateClick, filter, onFilterChange, pendingActionsTotal }) {
  const [filterHover, setFilterHover] = useState(null)
  const filtered = sortTrackersByLatest((trackers ?? []).filter(t => {
    const es = t.entries ?? []
    if (filter === 'pending') return es.some(e => !e.action)
    if (filter === 'signed')  return es.some(e => !!e.action)
    return true
  }), filter)
  const cutoff = recentCutoffIso()
  const firstOld = filtered.findIndex(x => x.latest < cutoff)

  return (
    <div style={{
      width: 'var(--reportlist-w)', flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--border)',
      background: 'var(--panel)',
    }}>
      {/* Filter tabs — the Actions Pending tab carries the tail-wide count.
          flex:1 + same row padding/gap as the Generate/View row below, so the
          tabs match those buttons' widths exactly. */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center' }}>
        {[
          // Pending = amber, Signed = green (matches the app's status colours)
          { key: 'pending', label: 'Actions Pending', count: pendingActionsTotal,
            bg: 'rgba(240,165,0,0.18)', bd: 'rgba(240,165,0,0.55)', fg: 'var(--amber)' },
          { key: 'signed',  label: 'Signed Actions',  count: null,
            bg: 'rgba(46,204,113,0.15)', bd: 'rgba(46,204,113,0.5)', fg: 'var(--green)' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            onMouseEnter={() => setFilterHover(f.key)}
            onMouseLeave={() => setFilterHover(null)}
            title={f.key === 'pending' ? 'Unactioned entries across all components of this tail' : undefined}
            style={{
              flex: 1, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: filter === f.key ? f.bg : filterHover === f.key ? 'rgba(255,255,255,0.06)' : 'var(--panel2)',
              border: `1px solid ${filter === f.key ? f.bd : filterHover === f.key ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`,
              color: filter === f.key ? f.fg : filterHover === f.key ? 'var(--text)' : 'var(--subtext)',
              cursor: 'pointer', transition: 'background 0.1s, border-color 0.1s, color 0.1s',
            }}
          >
            {f.label}
            {f.count > 0 && (
              <span style={{
                minWidth: 16, padding: '0 4px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                background: 'rgba(240,165,0,0.28)', color: 'var(--amber)', lineHeight: '15px',
              }}>
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--subtext)', fontSize: 12, fontStyle: 'italic' }}>
            No components
          </div>
        )}
        {filtered.map(({ t }, idx) => {
          const [name, location] = t.comp_key.split(' | ')
          const es = t.entries ?? []
          const pendingCount = es.filter(e => !e.action).length
          return (
            <React.Fragment key={t.comp_key}>
            {idx === firstOld && <OlderDivider />}
            <div
              onClick={() => onSelect(t.comp_key)}
              style={{
                padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: selectedKey === t.comp_key ? 'rgba(74,158,255,0.08)' : 'transparent',
                borderLeft: selectedKey === t.comp_key ? '2px solid var(--accent)' : '2px solid transparent',
              }}
              onMouseEnter={e => { if (selectedKey !== t.comp_key) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
              onMouseLeave={e => { if (selectedKey !== t.comp_key) e.currentTarget.style.background = 'transparent' }}
            >
              {/* No pending/signed flag on rows — the tab defines the state; the
                  Signed view never shows pending info. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--subtext)' }}>
                {location} · {es.length} entr{es.length !== 1 ? 'ies' : 'y'}
                {filter !== 'signed' && pendingCount > 0 && (
                  <span style={{ color: 'var(--amber)' }}> · {pendingCount} pending</span>
                )}
              </div>
            </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Generate a report / view generated reports — pinned at the bottom of
          the list. Same .btn style for both, with the tabs' shape (radius/
          padding) so tabs and buttons read as one aligned control block. */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          className="btn"
          style={{ flex: 1, fontSize: 11, fontWeight: 600, justifyContent: 'center', padding: '3px 10px', borderRadius: 5 }}
          onClick={onGenerateClick}
        >
          Generate Report
        </button>
        <button
          className="btn"
          title="View all generated reports for this tail"
          style={{ flex: 1, fontSize: 11, fontWeight: 600, justifyContent: 'center', padding: '3px 10px', borderRadius: 5 }}
          onClick={onViewReportsClick}
        >
          View Reports
        </button>
      </div>
    </div>
  )
}

// DD-MM-YYYY → YYYY-MM-DD (native <input type="date"> format)
function ddmmyyyyToIso(d) {
  const p = d.split('-')
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : ''
}
function isoToDdmmyyyy(iso) {
  return iso.split('-').reverse().join('-')
}

// Newest alerts first; anything older than RECENT_DAYS sits below a divider.
const RECENT_DAYS = 30
function recentCutoffIso() {
  const d = new Date()
  d.setDate(d.getDate() - RECENT_DAYS)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Newest entry date (ISO) of a tracker among the entries the tab shows.
function trackerLatestIso(t, filter) {
  return (t.entries ?? [])
    .filter(e => filter === 'pending' ? !e.action : filter === 'signed' ? !!e.action : true)
    .map(e => ddmmyyyyToIso(e.date))
    .reduce((a, b) => (b > a ? b : a), '')
}

function sortTrackersByLatest(trackers, filter) {
  return [...trackers]
    .map(t => ({ t, latest: trackerLatestIso(t, filter) }))
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.t.comp_key.localeCompare(b.t.comp_key))
}

function OlderDivider() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
      fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
      color: 'var(--subtext)',
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      Older than {RECENT_DAYS} days
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

// Full [earliest, latest] entry date span across a set of trackers, as ISO strings.
function fullDateRange(trackers) {
  const isoDates = trackers.flatMap(t => (t.entries ?? []).map(e => ddmmyyyyToIso(e.date))).filter(Boolean).sort()
  return { from: isoDates[0] ?? '', to: isoDates[isoDates.length - 1] ?? '' }
}

// ── Generate report modal ────────────────────────────────────────────────────
// Lists EVERY component with at least one actioned entry — the same set the
// Signed Actions tab shows, so the counts always reconcile. All of them are
// selectable: only SIGNED entries are compiled into the report, so pending
// entries simply do not exist for generation until they are actioned (a
// partially-actioned row shows an informational pending count). The signer is
// chosen here and recorded ONLY on the generated document — trackers never
// carry signer identity (see generateReport in reportStore.js).
function GenerateReportModal({ trackers, onGenerate, onClose }) {
  // Date span across the SIGNED entries only — pending ones are not includable.
  const fullRange = fullDateRange(trackers.map(t => ({
    ...t, entries: (t.entries ?? []).filter(e => !!e.action),
  })))
  const [selectedKeys, setSelectedKeys] = useState(trackers.map(t => t.comp_key))
  const [search,   setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState(fullRange.from)
  const [dateTo,   setDateTo]   = useState(fullRange.to)
  const [signer,    setSigner]    = useState(null)
  const [reportName, setReportName] = useState('')   // optional user-given name
  const [error,     setError]     = useState(null)
  const [generating, setGenerating] = useState(false)

  // Search filters the visible rows only — the selection is untouched.
  const shownTrackers = trackers.filter(t =>
    !search || t.comp_key.toLowerCase().includes(search.toLowerCase())
  )

  function toggle(key) {
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function selectAll() {
    setSelectedKeys(trackers.map(t => t.comp_key))
    setDateFrom(fullRange.from)
    setDateTo(fullRange.to)
  }

  async function handleGenerate() {
    if (!selectedKeys.length || !dateFrom || !dateTo) {
      setError('Select at least one component and a date range')
      return
    }
    if (!signer) {
      setError('Select a signer (AME) to sign the report')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      await onGenerate({
        compKeys: selectedKeys,
        dateFrom: isoToDdmmyyyy(dateFrom),
        dateTo: isoToDdmmyyyy(dateTo),
        signer,
        name: reportName.trim() || null,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    // Closing is blocked while a report is being generated — dismissing the
    // modal mid-save would orphan the in-flight generateReport() call and drop
    // a failed save's inline error (same guard as ExportModal / TailModal /
    // the chart's Sign Action modal).
    <div className="modal-backdrop" onClick={generating ? undefined : onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
        <div className="modal-title" style={{ marginBottom: 4 }}>Generate Incident Report</div>
        {!trackers.length ? (
          <div style={{ fontSize: 12, color: 'var(--subtext)', marginTop: 14, marginBottom: 4, lineHeight: 1.6 }}>
            No components have signed entries yet. Apply an action to a tracked entry to make
            its component available for report generation.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--subtext)', marginBottom: 18, lineHeight: 1.5 }}>
              Compiles signed component entries into a formal document, signed by the selected AME.
              Pending entries are not included until they are actioned.
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
              Report name <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
            </div>
            <input
              type="text"
              value={reportName}
              onChange={e => setReportName(e.target.value)}
              placeholder="e.g. March 2026 vibration review"
              maxLength={80}
              style={{ width: '100%', fontSize: 12, marginBottom: 18 }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Components ({selectedKeys.length}/{trackers.length} selected)
              </span>
              <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={selectAll}>All</button>
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search components…"
              style={{ width: '100%', fontSize: 12, marginBottom: 6 }}
            />
            {/* maxHeight fits 4 rows — the list scrolls beyond that */}
            <div style={{
              maxHeight: 132, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
              marginBottom: 18, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel2)', padding: 4,
            }}>
              {shownTrackers.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--subtext)', fontStyle: 'italic' }}>
                  No components match the search
                </div>
              )}
              {shownTrackers.map(t => {
                const checked = selectedKeys.includes(t.comp_key)
                const signedCount  = (t.entries ?? []).filter(e => !!e.action).length
                const pendingCount = (t.entries ?? []).filter(e => !e.action).length
                const [name, location] = t.comp_key.split(' | ')
                return (
                  <label
                    key={t.comp_key}
                    title={pendingCount > 0
                      ? `Only the ${signedCount} signed entr${signedCount !== 1 ? 'ies' : 'y'} will be included — ${pendingCount} pending entr${pendingCount !== 1 ? 'ies' : 'y'} do not exist for generation until signed`
                      : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, cursor: 'pointer',
                      padding: '6px 8px', borderRadius: 4,
                      background: checked ? 'rgba(74,158,255,0.1)' : 'transparent',
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(t.comp_key)} />
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span style={{ color: 'var(--subtext)', fontSize: 11 }}>{location}</span>
                    {pendingCount > 0 && (
                      <span style={{ marginLeft: 'auto', color: 'var(--amber)', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {pendingCount} pending
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
              Date range
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 20 }}>
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

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
              Signer (AME)
            </div>
            <div style={{ display: 'flex', marginBottom: 20 }}>
              <SignerDropdown value={signer} onChange={setSigner} />
            </div>
          </>
        )}
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button className="btn" onClick={onClose} disabled={generating}>Cancel</button>
          <button
            className="btn primary"
            disabled={!trackers.length || generating}
            onClick={handleGenerate}
          >
            {generating ? 'Generating…' : 'Generate & Sign'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generated report document (letterhead) ───────────────────────────────────
function GeneratedReportDoc({ report, onBack }) {
  const [exporting, setExporting]  = useState(false)
  const [exportMsg, setExportMsg]  = useState(null)   // { ok, text }

  // Same document → A4 PDF via the export pipeline (multi-page when long).
  async function handleExport() {
    if (exporting) return
    if (!window.electronAPI?.exportPdf) {
      setExportMsg({ ok: false, text: 'Export requires the desktop app' })
      return
    }
    setExporting(true)
    setExportMsg(null)
    try {
      const logo = await imageToDataUrl(brookLogo)
      const result = await window.electronAPI.exportPdf(
        reportToHtml(report, logo),
        `${safeFilename(report.tail)}_incident_report_${safeFilename(report.name ?? `${report.date_from}_${report.date_to}`)}.pdf`
      )
      if (result?.ok) setExportMsg({ ok: true, text: `Saved to ${result.path}` })
      else if (!result?.cancelled) setExportMsg({ ok: false, text: result?.error ?? 'Export failed' })
    } catch (e) {
      setExportMsg({ ok: false, text: e.message })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: 'var(--panel2)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn" onClick={onBack}>← Back</button>
        <button className="btn" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
        {exportMsg && (
          <span style={{
            fontSize: 11, alignSelf: 'center',
            color: exportMsg.ok ? 'var(--green)' : 'var(--red)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {exportMsg.text}
          </span>
        )}
      </div>
      <div style={{ background: '#fff', color: '#111', borderRadius: 6, padding: '32px 36px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src={brookLogo} alt="Brook Aviation" style={{ height: 46, marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>BROOK AVIATION</div>
          <div style={{ fontSize: 11, color: '#555' }}>HUMS/VXP Monitoring</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 10 }}>Incident Report</div>
          {report.name && (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginTop: 2 }}>{report.name}</div>
          )}
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
            {report.tail} · {report.date_from} – {report.date_to}
          </div>
        </div>

        {report.components.map(c => (
          <div key={c.comp_key} style={{ marginBottom: 22, borderTop: '1px solid #ddd', paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{c.comp_key}</div>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th style={{ padding: '4px 6px' }}>Date</th>
                  <th style={{ padding: '4px 6px' }}>Meas.</th>
                  <th style={{ padding: '4px 6px' }}>Status</th>
                  <th style={{ padding: '4px 6px' }}>Trend</th>
                  <th style={{ padding: '4px 6px' }}>Action Taken</th>
                </tr>
              </thead>
              <tbody>
                {c.entries.map(e => (
                  <tr key={e.entry_id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '4px 6px' }}>{e.date}</td>
                    <td style={{ padding: '4px 6px' }}>{e.avg_meas}</td>
                    <td style={{ padding: '4px 6px' }}>{statusLabel(e.limit_status)}</td>
                    <td style={{ padding: '4px 6px' }}>{e.trend === 'up' ? '↑ Up' : '→ Stable'}</td>
                    <td style={{ padding: '4px 6px' }}>{e.action ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>
              Latest action: <strong>{c.latest_action ?? '—'}</strong> · {c.stats.count} event(s)
              {' '}({c.stats.caution_count} caution, {c.stats.critical_count} critical, {c.stats.uptrend_count} up-trend)
            </div>
            <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>
              Signer: <strong>{c.signer_name ?? '—'}</strong>
              {c.signed_at ? ` · ${new Date(c.signed_at).toLocaleDateString()}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Generated reports panel (all generated reports for the tail) ─────────────
function GeneratedReportsPanel({ reports, onBack }) {
  const [openReport, setOpenReport] = useState(null)

  if (openReport) {
    return <GeneratedReportDoc report={openReport} onBack={() => setOpenReport(null)} />
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 20 }}>
      <button className="btn" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: 14 }}>← Back</button>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
        Generated Reports
      </div>
      {!reports.length ? (
        <div style={{ color: 'var(--subtext)', fontSize: 12, fontStyle: 'italic' }}>
          No reports generated yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reports.map(r => (
            <div
              key={r.report_id}
              className="card"
              style={{ padding: 12, cursor: 'pointer' }}
              onClick={() => setOpenReport(r)}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {r.name ? <>{r.name} <span style={{ fontWeight: 400, color: 'var(--subtext)' }}>· {r.date_from} → {r.date_to}</span></> : <>{r.date_from} → {r.date_to}</>}
              </div>
              {/* Component names included in this report */}
              <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 3 }}>
                {r.components.map(c => c.comp_key.split(' | ')[0]).join(' · ')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--subtext)', marginTop: 2 }}>
                {r.components.length} component{r.components.length !== 1 ? 's' : ''} · generated {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Reports view ──────────────────────────────────────────────────────────────
export default function Reports({ activeTail, componentReports, onComponentReportsChange, initialSelectedComp, initialEntryId, onInitialCompConsumed, onSeeChartEntry }) {
  const [selectedKey, setSelectedKey] = useState(initialSelectedComp ?? componentReports?.[0]?.comp_key ?? null)
  const [generatedReports, setGeneratedReports] = useState([])
  const [viewingReports, setViewingReports] = useState(false)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  // Actions Pending / Signed Actions — shared by the component list AND the
  // detail's entry rows (entry-level sign model: the tab filters entries, not
  // just comps). Opens on the pending work.
  const [filter, setFilter] = useState('pending')
  // Entry redirected from the chart's sign-action modal — kept locally after
  // the deep-link props are consumed; cleared on any manual navigation.
  const [highlightEntryId, setHighlightEntryId] = useState(initialEntryId ?? null)

  useEffect(() => {
    // Guarded so a slow response can't set state after unmount (the view is
    // keyed per tail, so a tail switch unmounts this instance mid-flight).
    let alive = true
    syncGeneratedReports(activeTail).then(list => { if (alive) setGeneratedReports(list) })
    return () => { alive = false }
  }, [activeTail])

  // Deep-link support: re-select when the caller (e.g. Dashboard's Actions widget)
  // requests a different component while this page is already mounted. Consumed
  // once then cleared via onInitialCompConsumed — otherwise a repeat click on the
  // same pending-action row (with a manual selection in between) would pass the
  // same value twice and this effect wouldn't re-fire, and a stale value would
  // leak into a freshly-mounted Reports for a different tail.
  useEffect(() => {
    if (initialSelectedComp) {
      setViewingReports(false)
      setSelectedKey(initialSelectedComp)
      if (initialEntryId) {
        setHighlightEntryId(initialEntryId)
        // Open the tab the redirected entry actually lives under — it may have
        // just been signed from the chart modal, so 'pending' would hide it.
        const t = (componentReports ?? []).find(t => t.comp_key === initialSelectedComp)
        const entry = (t?.entries ?? []).find(e => e.entry_id === initialEntryId)
        if (entry) setFilter(entry.action ? 'signed' : 'pending')
      }
      onInitialCompConsumed?.()
    }
  }, [initialSelectedComp, initialEntryId])

  // Fall back to the first tracker matching the active tab when nothing is
  // selected — trackers load asynchronously, so selectedKey can be null at
  // mount. The detail pane never shows a component that isn't in the visible
  // (filtered) list; when NO component matches the tab, selected stays null
  // and the default empty-state message renders instead.
  const matchesFilter = t =>
    filter === 'pending' ? (t.entries ?? []).some(e => !e.action) :
    filter === 'signed'  ? (t.entries ?? []).some(e => !!e.action) : true
  const visibleTrackers = sortTrackersByLatest((componentReports ?? []).filter(matchesFilter), filter).map(x => x.t)
  const selected = visibleTrackers.find(t => t.comp_key === selectedKey)
    ?? visibleTrackers[0]
    ?? null

  function handleUpdate(updated) {
    const next = (componentReports ?? []).map(t => t.comp_key === updated.comp_key ? updated : t)
    onComponentReportsChange?.(next)
  }

  function handleSelect(compKey) {
    setViewingReports(false)
    setSelectedKey(compKey)
    setHighlightEntryId(null)
  }

  function handleFilterChange(f) {
    setFilter(f)
    setHighlightEntryId(null)
  }

  async function handleGenerate({ compKeys, dateFrom, dateTo, signer, name }) {
    const report = await generateReport(activeTail, { compKeys, dateFrom, dateTo, signer, name })
    setGeneratedReports(prev => [{ ...report, _filename: `${report.report_id}.json` }, ...prev])
    setShowGenerateModal(false)
  }

  // Every comp with ≥ 1 actioned entry — mirrors the Signed Actions tab, so
  // the Generate modal shows the same count; the modal itself marks which of
  // these are selectable (fully actioned) vs disabled (still has pending).
  const signedTrackers = useMemo(
    () => (componentReports ?? []).filter(t => (t.entries ?? []).some(e => !!e.action)),
    [componentReports]
  )

  // Fleet-wide count of unactioned entries — the tag next to the Signed tab.
  const pendingActionsTotal = useMemo(
    () => (componentReports ?? []).reduce(
      (sum, t) => sum + (t.entries ?? []).filter(e => !e.action).length, 0
    ),
    [componentReports]
  )

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
      <ComponentList
        trackers={componentReports}
        selectedKey={selected?.comp_key ?? null}
        onSelect={handleSelect}
        onViewReportsClick={() => setViewingReports(true)}
        onGenerateClick={() => setShowGenerateModal(true)}
        filter={filter}
        onFilterChange={handleFilterChange}
        pendingActionsTotal={pendingActionsTotal}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {viewingReports ? (
          <GeneratedReportsPanel
            reports={generatedReports}
            onBack={() => setViewingReports(false)}
          />
        ) : selected ? (
          <ComponentDetail
            key={selected.comp_key}
            tracker={selected}
            tail={activeTail}
            entryFilter={filter}
            onUpdate={handleUpdate}
            onSeeChart={entry => onSeeChartEntry?.(selected.comp_key, entry)}
            highlightEntryId={highlightEntryId}
          />
        ) : (
          // Default message: nothing to select — either no trackers exist yet
          // or no component matches the active tab.
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--subtext)', fontSize: 14, flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>📋</div>
            <div>
              {!(componentReports ?? []).length
                ? 'No tracked incidents yet — import data to start tracking components'
                : filter === 'pending'
                  ? 'No components with pending actions'
                  : 'No components with signed actions yet'}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {!(componentReports ?? []).length
                ? 'Entries open automatically when an import breaches a limit or sustains an up-trend'
                : filter === 'pending'
                  ? 'All entries are actioned — see Signed Actions or generate a report'
                  : 'Apply an action to a pending entry to sign that date'}
            </div>
          </div>
        )}
      </div>

      {showGenerateModal && (
        <GenerateReportModal
          trackers={signedTrackers}
          onGenerate={handleGenerate}
          onClose={() => setShowGenerateModal(false)}
        />
      )}
    </div>
  )
}
