import React, { useState, useRef, useEffect } from 'react'
import { toSortableDate } from '../utils/importLoader'

const BTN_SM = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 3,
  color: 'var(--subtext)', fontSize: 11, padding: '5px 13px',
  cursor: 'pointer', fontFamily: 'inherit',
}

function SmBtn({ onClick, style = {}, children }) {
  const [hover, setHover] = useState(false)
  const base = { ...BTN_SM, transition: 'background 0.1s, border-color 0.1s, color 0.1s', ...style }
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...base,
        background: hover ? 'rgba(255,255,255,0.06)' : base.background ?? 'none',
        borderColor: hover ? 'rgba(255,255,255,0.25)' : base.borderColor ?? 'var(--border)',
        color: hover ? (base.color === 'var(--subtext)' ? 'var(--text)' : base.color) : base.color,
      }}
    >
      {children}
    </button>
  )
}

function formatSessionTimes(sessions) {
  return (sessions ?? [])
    .map(s => {
      const start = s.started_at?.split('T')[1]?.slice(0, 5) ?? ''
      const end   = s.completed_at?.split('T')[1]?.slice(0, 5) ?? ''
      if (!start && !end) return null
      return start && end ? `${start}-${end}` : start || end
    })
    .filter(Boolean)
    .join(', ')
}

function ViewFileModal({ imp, onClose }) {
  const sessions = imp.sessions ?? []
  const [selectedIdx, setSelectedIdx] = useState(0)

  const content = JSON.stringify(
    sessions.length > 1 ? sessions[selectedIdx] : imp,
    (k, v) => k === '_filename' ? undefined : v,
    2
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 680, width: '92%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', padding: 20 }}
      >
        <div className="modal-title" style={{ marginBottom: 8 }}>
          {imp.date}{imp.source_file ? ` — ${imp.source_file}` : ''}
        </div>

        {sessions.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {sessions.map((s, i) => {
              const start = s.started_at?.split('T')[1]?.slice(0, 5) ?? `Session ${i + 1}`
              const end   = s.completed_at?.split('T')[1]?.slice(0, 5)
              const label = end ? `${start}-${end}` : start
              return (
                <button
                  key={s.session_id ?? i}
                  onClick={() => setSelectedIdx(i)}
                  style={{
                    ...BTN_SM,
                    color: selectedIdx === i ? 'var(--accent)' : 'var(--subtext)',
                    borderColor: selectedIdx === i ? 'rgba(74,158,255,0.5)' : 'var(--border)',
                    fontSize: 10,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        <pre style={{
          flex: 1, overflowY: 'auto', fontSize: 11,
          color: 'var(--text)', background: 'var(--panel2)',
          padding: 12, borderRadius: 4, border: '1px solid var(--border)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace',
        }}>
          {content}
        </pre>

        <button className="btn" style={{ marginTop: 12, alignSelf: 'flex-end' }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function ImportRow({ imp, onDelete, onViewFile, selectMode, selected, onToggle }) {
  const [confirming, setConfirming] = useState(false)
  const confirmRef = useRef(null)
  const s = imp.summary ?? {}
  const times = formatSessionTimes(imp.sessions)

  useEffect(() => {
    if (!confirming) return
    function handleOutside(e) {
      if (confirmRef.current && !confirmRef.current.contains(e.target)) {
        setConfirming(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [confirming])

  return (
    <div
      className="card"
      onClick={selectMode ? onToggle : undefined}
      style={{
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
        cursor: selectMode ? 'pointer' : 'default',
        background: selectMode && selected ? 'rgba(74,158,255,0.07)' : undefined,
        transition: 'background 0.1s',
      }}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          style={{ width: 15, height: 15, flexShrink: 0, accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
      )}

      {/* One-row layout: date · sessions · times · source file, all inline */}
      <div style={{ fontWeight: 700, fontSize: 13, flexShrink: 0, minWidth: 84 }}>{imp.date}</div>
      <div style={{ fontSize: 11, color: 'var(--subtext)', flexShrink: 0 }}>
        {(imp.sessions ?? []).length} session{imp.sessions?.length !== 1 ? 's' : ''}
      </div>
      {times && (
        <div style={{
          fontSize: 10, color: 'var(--subtext)', flexShrink: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {times}
        </div>
      )}
      <div style={{
        flex: 1, minWidth: 0, fontSize: 12, color: 'var(--subtext)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {imp.source_file ?? ''}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--subtext)', fontWeight: 700 }}>Total: {s.total ?? 0}</span>
        <span style={{ fontSize: 11, color: 'var(--border2)', margin: '0 3px' }}>|</span>
        <span style={{ fontSize: 11, color: 'var(--green)',   fontWeight: 700 }}>{s.green  ?? 0}N</span>
        <span style={{ fontSize: 11, color: 'var(--amber)',   fontWeight: 700 }}>{s.yellow ?? 0}C</span>
        <span style={{ fontSize: 11, color: 'var(--red)',     fontWeight: 700 }}>{s.red    ?? 0}Cr</span>
        <span style={{ fontSize: 11, color: 'var(--border2)', margin: '0 3px' }}>|</span>
        <span style={{ fontSize: 11, color: 'var(--subtext)', fontWeight: 700 }}>{s.flat   ?? 0}→</span>
        <span style={{ fontSize: 11, color: 'var(--red)',     fontWeight: 700 }}>{s.up     ?? 0}↑</span>
        <span style={{ fontSize: 11, color: 'var(--amber)',   fontWeight: 700 }}>{s.down   ?? 0}↓</span>
      </div>

      {!selectMode && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            className="btn"
            style={{ fontSize: 11, padding: '3px 10px' }}
            onClick={() => onViewFile(imp)}
          >
            View File
          </button>
          {!confirming ? (
            <button
              className="btn danger"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          ) : (
            <div ref={confirmRef} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--subtext)' }}>Sure?</span>
              <button
                className="btn danger"
                style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => { onDelete(imp); setConfirming(false) }}
              >Yes</button>
              <button
                className="btn"
                style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => setConfirming(false)}
              >No</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RecentImportsPage({ activeTail, importsByTail, onDelete }) {
  const [selectMode,  setSelectMode]  = useState(false)
  const [selected,    setSelected]    = useState(new Set())
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [viewFileImp, setViewFileImp] = useState(null)

  // Dates are DD-MM-YYYY — convert before comparing so the order is chronological.
  const imports = (importsByTail?.[activeTail] ?? [])
    .slice()
    .sort((a, b) => toSortableDate(b.date).localeCompare(toSortableDate(a.date)))

  const totalDates    = imports.length
  const totalSessions = imports.reduce((sum, imp) => sum + (imp.sessions?.length ?? 0), 0)

  const keyOf = imp => imp.import_id ?? imp.date

  const allSelected = imports.length > 0 && imports.every(imp => selected.has(keyOf(imp)))

  function toggle(imp) {
    const k = keyOf(imp)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(imports.map(keyOf)))
  }

  function enterSelect() {
    setSelectMode(true)
    setSelected(new Set())
    setConfirmDel(false)
  }

  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmDel(false)
  }

  async function deleteSelected() {
    const toDelete = imports.filter(imp => selected.has(keyOf(imp)))
    for (const imp of toDelete) {
      await onDelete({ ...imp, tail: imp.tail ?? activeTail })
    }
    exitSelect()
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Imports</span>
        {activeTail && (
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>{activeTail}</span>
        )}
        <span style={{ color: 'var(--subtext)', fontSize: 12 }}>
          {totalDates} Date{totalDates !== 1 ? 's' : ''}
        </span>
        <span style={{ color: 'var(--subtext)', fontSize: 12 }}>
          {totalSessions} Session{totalSessions !== 1 ? 's' : ''}
        </span>

        {/* Right controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectMode ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--subtext)' }}>{selected.size} selected</span>
              <SmBtn onClick={toggleAll} style={{ color: 'var(--accent)', borderColor: 'rgba(74,158,255,0.4)' }}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </SmBtn>
              {selected.size > 0 && !confirmDel && (
                <SmBtn onClick={() => setConfirmDel(true)} style={{ color: 'var(--red)', borderColor: 'rgba(224,82,82,0.5)' }}>
                  Remove ({selected.size})
                </SmBtn>
              )}
              {selected.size > 0 && confirmDel && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--subtext)' }}>Are you sure?</span>
                  <SmBtn onClick={deleteSelected} style={{ color: 'var(--red)', borderColor: 'rgba(224,82,82,0.5)' }}>Yes</SmBtn>
                  <SmBtn onClick={() => setConfirmDel(false)}>No</SmBtn>
                </>
              )}
              <SmBtn onClick={exitSelect}>Cancel</SmBtn>
            </>
          ) : (
            <SmBtn onClick={enterSelect} style={{ color: 'var(--accent)', borderColor: 'rgba(74,158,255,0.4)' }}>
              Select
            </SmBtn>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {imports.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--subtext)', fontSize: 14, fontStyle: 'italic',
          }}>
            No imports for {activeTail ?? 'this tail'}
          </div>
        ) : (
          imports.map(imp => (
            <ImportRow
              key={`${imp.tail ?? activeTail}-${imp.date}`}
              imp={{ ...imp, tail: imp.tail ?? activeTail }}
              onDelete={onDelete}
              onViewFile={setViewFileImp}
              selectMode={selectMode}
              selected={selected.has(keyOf(imp))}
              onToggle={() => toggle(imp)}
            />
          ))
        )}
      </div>

      {viewFileImp && (
        <ViewFileModal imp={viewFileImp} onClose={() => setViewFileImp(null)} />
      )}
    </div>
  )
}
