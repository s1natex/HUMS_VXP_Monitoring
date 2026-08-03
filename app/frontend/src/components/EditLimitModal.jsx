import React, { useState } from 'react'

// direct=true  → no global-change warning (custom limits or single-tail context)
// systemType   → 'vxp' | null (used in the warning message)
// limitsMode   → 'global' | 'custom' | 'empty'
export default function EditLimitModal({
  compKey, currentLimits, onSave, onClose,
  direct = false, systemType = null, limitsMode = 'global',
}) {
  const [lower,    setLower]    = useState(currentLimits?.[0] ?? '')
  const [caution,  setCaution]  = useState(currentLimits?.[1] ?? '')
  const [critical, setCritical] = useState(currentLimits?.[2] ?? '')
  const [confirm,  setConfirm]  = useState(false)

  const parsedValues = [
    lower    !== '' ? parseFloat(lower)    : null,
    caution  !== '' ? parseFloat(caution)  : null,
    critical !== '' ? parseFloat(critical) : null,
  ]

  const numeric = parsedValues.every(v => v === null || !isNaN(v))
  // Thresholds must be non-negative and ascending (lower ≤ caution ≤ critical)
  // among the values that are set — out-of-order limits produce nonsense statuses.
  const present  = parsedValues.filter(v => v !== null && !isNaN(v))
  const ordered  = present.every((v, i) => i === 0 || v >= present[i - 1])
  const nonNeg   = present.every(v => v >= 0)
  const rangeError = numeric && !nonNeg ? 'Limits must be zero or positive'
    : numeric && !ordered ? 'Limits must be ascending: Normal ≤ Caution ≤ Critical'
    : null
  const valid = numeric && !rangeError

  function handleSave() {
    if (!direct && limitsMode !== 'custom' && !confirm) { setConfirm(true); return }
    onSave(compKey, parsedValues)
    onClose()
  }

  function confirmMessage() {
    if (limitsMode === 'custom') {
      return <>This updates the <strong>custom limit</strong> for this tail only. Confirm?</>
    }
    const sys = systemType ? systemType.toUpperCase() : 'all'
    return <>This updates the <strong>global {sys} limits</strong> — change will apply to all {sys} tails. Confirm?</>
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Edit Limits — {compKey}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Normal (lower)',  value: lower,    set: setLower,    color: 'var(--green)' },
            { label: 'Caution',         value: caution,  set: setCaution,  color: 'var(--amber)' },
            { label: 'Critical',        value: critical, set: setCritical, color: 'var(--red)'   },
          ].map(({ label, value, set, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <label style={{ color: 'var(--subtext)', fontSize: 12, width: 130, flexShrink: 0 }}>{label}</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={value}
                onChange={e => { set(e.target.value); setConfirm(false) }}
                placeholder="leave blank to clear"
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </div>

        {rangeError && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>
            {rangeError}
          </div>
        )}

        {confirm && (
          <div style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 6,
            background: limitsMode === 'custom'
              ? 'rgba(74,158,255,0.1)' : 'rgba(224,82,82,0.12)',
            border: limitsMode === 'custom'
              ? '1px solid rgba(74,158,255,0.3)' : '1px solid rgba(224,82,82,0.3)',
            color: limitsMode === 'custom' ? 'var(--accent)' : 'var(--red)',
            fontSize: 12,
          }}>
            {confirmMessage()}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${confirm ? (limitsMode === 'custom' ? 'primary' : 'danger') : 'primary'}`}
            onClick={handleSave}
            disabled={!valid}
          >
            {confirm ? 'Confirm Save' : 'Save Limits'}
          </button>
        </div>
      </div>
    </div>
  )
}
