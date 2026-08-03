import React, { useState, useRef, useEffect } from 'react'
import { getSigners, addSigner, removeSigner } from '../utils/reportStore'

function genId() {
  return 'sig_' + Math.random().toString(36).slice(2, 9)
}

export default function SignerDropdown({ value, onChange }) {
  const [open,    setOpen]    = useState(false)
  const [signers, setSigners] = useState(getSigners)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState({ first: '', last: '', license: '' })
  const [hover,   setHover]   = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const refresh = () => setSigners(getSigners())

  async function handleAdd() {
    if (!form.first || !form.last || !form.license) return
    const s = { id: genId(), first: form.first, last: form.last, license: form.license }
    await addSigner(s)
    refresh()
    setForm({ first: '', last: '', license: '' })
    setAdding(false)
  }

  async function handleRemove(e, id) {
    e.stopPropagation()
    await removeSigner(id)
    refresh()
    if (value?.id === id) onChange(null)
  }

  const selected = signers.find(s => s.id === value?.id)

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <button
        className="btn"
        style={{ width: '100%', justifyContent: 'space-between' }}
        onClick={() => setOpen(o => !o)}
      >
        <span>{selected ? `${selected.first} ${selected.last}` : 'Select signer…'}</span>
        <span style={{ color: 'var(--subtext)', fontSize: 10 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--panel)', border: '1px solid var(--border2)',
          borderRadius: 8, zIndex: 300, overflow: 'hidden',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.45)',
        }}>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {signers.length === 0 && (
              <div style={{ padding: '10px 14px', color: 'var(--subtext)', fontSize: 12 }}>
                No signers yet
              </div>
            )}
            {signers.map(s => (
              <div
                key={s.id}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => { onChange(s); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 14px', cursor: 'pointer',
                  background: s.id === value?.id ? 'rgba(74,158,255,0.12)'
                    : hover === s.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.first} {s.last}</div>
                  <div style={{ color: 'var(--subtext)', fontSize: 11 }}>{s.license}</div>
                </div>
                {hover === s.id && (
                  <button
                    onClick={e => handleRemove(e, s.id)}
                    style={{ color: 'var(--red)', fontWeight: 700, fontSize: 16, padding: '0 4px' }}
                    title="Remove signer"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px' }}>
            {!adding ? (
              <button
                className="btn"
                onClick={() => setAdding(true)}
                style={{ width: '100%', fontSize: 12 }}
              >
                + Add signer
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { key: 'first',   placeholder: 'First name' },
                  { key: 'last',    placeholder: 'Last name' },
                  { key: 'license', placeholder: 'License #' },
                ].map(({ key, placeholder }) => (
                  <input
                    key={key}
                    type="text"
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ fontSize: 12 }}
                  />
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn" onClick={() => setAdding(false)} style={{ flex: 1, fontSize: 12 }}>Cancel</button>
                  <button className="btn primary" onClick={handleAdd} style={{ flex: 1, fontSize: 12 }}>Add</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
