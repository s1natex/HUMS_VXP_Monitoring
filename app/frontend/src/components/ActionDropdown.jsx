import React, { useState, useRef, useEffect } from 'react'
import { getActions, addAction, removeAction } from '../utils/reportStore'

// ── Action dropdown ───────────────────────────────────────────────────────────
// Shows the saved actions list for this tail's aircraft type, plus a free-text
// box at the bottom — typing a new value and confirming adds it to the persisted
// list (report_actions_vxp.json) and selects it immediately. Hovering an option
// reveals a ✕ that deletes it from the list (already-applied entries keep their
// action text — the list is only the pick menu).
// Shared by the Reports entry rows and the chart's sign-action modal.
export default function ActionDropdown({ value, onChange, tail }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState(() => getActions(tail))
  const [custom, setCustom] = useState('')
  const [hoverOpt, setHoverOpt] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function handleAddCustom() {
    const text = custom.trim()
    if (!text) return
    await addAction(tail, text)
    setOptions(getActions(tail))
    onChange(text)
    setCustom('')
    setOpen(false)
  }

  async function handleRemove(e, opt) {
    e.stopPropagation()
    await removeAction(tail, opt)
    setOptions(getActions(tail))
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn"
        style={{ width: '100%', fontSize: 11, textAlign: 'left', justifyContent: 'space-between' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ?? 'Select action…'}
        </span>
        <span style={{ color: 'var(--subtext)', fontSize: 10, flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--panel)', border: '1px solid var(--border2)',
          borderRadius: 8, zIndex: 400, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {options.length === 0 && (
              <div style={{ padding: '8px 14px', color: 'var(--subtext)', fontSize: 12, fontStyle: 'italic' }}>
                No actions yet — add one below
              </div>
            )}
            {options.map(opt => (
              <div
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                onMouseEnter={() => setHoverOpt(opt)}
                onMouseLeave={() => setHoverOpt(null)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, width: '100%', padding: '8px 14px',
                  textAlign: 'left', fontSize: 12, color: 'var(--text)',
                  background: opt === value ? 'rgba(74,158,255,0.1)'
                    : hoverOpt === opt ? 'rgba(255,255,255,0.05)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{opt}</span>
                {/* Same ✕ style as the signer dropdown's remove button */}
                {hoverOpt === opt && (
                  <button
                    onClick={e => handleRemove(e, opt)}
                    style={{ color: 'var(--red)', fontWeight: 700, fontSize: 16, padding: '0 4px', flexShrink: 0 }}
                    title="Delete action from list"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddCustom() }}
              placeholder="Add new action…"
              style={{ flex: 1, fontSize: 12 }}
            />
            <button className="btn primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={handleAddCustom}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
