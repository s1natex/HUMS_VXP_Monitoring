import React, { useState } from 'react'
import { ALL_COMP_KEYS, LIMITS } from '../data/limits'
import EditLimitModal from './EditLimitModal'

// ── Custom limits configurator ─────────────────────────────────────────────
function LimitsPanel({ customLimits, onChange, onBack }) {
  const [editingComp, setEditingComp] = useState(null)

  function handleSaveComp(key, vals) {
    onChange({ ...customLimits, [key]: vals })
    setEditingComp(null)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button className="btn" onClick={onBack} style={{ padding: '4px 10px', fontSize: 11 }}>
          ← Back
        </button>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Custom Limits</div>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--subtext)' }}>
          {Object.keys(customLimits).filter(k => customLimits[k] !== null).length} / {ALL_COMP_KEYS.length} set
        </span>
      </div>

      <div style={{
        maxHeight: 380, overflowY: 'auto',
        border: '1px solid var(--border)', borderRadius: 4,
      }}>
        {ALL_COMP_KEYS.map((key, i) => {
          const vals = customLimits[key] ?? LIMITS[key]
          const isCustom = key in customLimits
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px',
                borderBottom: i < ALL_COMP_KEYS.length - 1 ? '1px solid var(--border)' : 'none',
                background: isCustom ? 'rgba(74,158,255,0.05)' : 'transparent',
              }}
            >
              <span style={{ flex: 1, fontSize: 10, color: isCustom ? 'var(--text)' : 'var(--subtext)' }}>
                {key}
              </span>
              <span style={{ fontSize: 10, color: 'var(--subtext)', width: 110, textAlign: 'right', flexShrink: 0 }}>
                {vals ? vals.map(v => v ?? '—').join(' / ') : '—'}
              </span>
              <button
                className="btn"
                style={{ padding: '2px 8px', fontSize: 10, flexShrink: 0 }}
                onClick={() => setEditingComp(key)}
              >
                Edit
              </button>
            </div>
          )
        })}
      </div>

      {editingComp && (
        <EditLimitModal
          compKey={editingComp}
          currentLimits={customLimits[editingComp] ?? LIMITS[editingComp]}
          onSave={handleSaveComp}
          onClose={() => setEditingComp(null)}
          direct
        />
      )}
    </>
  )
}

// ── Restore prompt — shown when existing data package is found on re-add ───
function RestoreStep({ tail, data, onRestore, onFresh, onCancel, saving }) {
  const { importCount, reportCount, firstDate, lastDate } = data
  const range = firstDate && lastDate
    ? firstDate === lastDate ? firstDate : `${firstDate} → ${lastDate}`
    : 'unknown'

  return (
    <>
      <div className="modal-title" style={{ color: 'var(--amber)' }}>
        Existing Data Package Found
      </div>

      <div style={{
        background: 'rgba(255,190,50,0.07)', border: '1px solid rgba(255,190,50,0.25)',
        borderRadius: 5, padding: '12px 14px', marginBottom: 16,
      }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
          {tail}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { label: 'Import dates',    value: importCount },
            { label: 'Reports',         value: reportCount },
            { label: 'Date range',      value: range },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--subtext)', minWidth: 110 }}>{label}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--subtext)', lineHeight: 1.6, marginBottom: 18 }}>
        {data.fromBackup
          ? <>This tail has data in the <strong style={{ color: 'var(--amber)' }}>backup directory</strong> from a previous removal. Choosing <strong style={{ color: 'var(--green)' }}>Restore</strong> will move the backed-up data back. Choosing <strong style={{ color: 'var(--red)' }}>Start Fresh</strong> will leave the backup in place and begin with an empty slate.</>
          : <>This tail has previously stored data on disk. Choosing <strong style={{ color: 'var(--green)' }}>Restore</strong> will load all existing imports and reports. Choosing <strong style={{ color: 'var(--red)' }}>Start Fresh</strong> will archive the old data to <code style={{ fontSize: 11 }}>backups/{tail}/</code> and begin with an empty slate.</>
        }
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn danger" onClick={onFresh} disabled={saving}>
          {saving ? '…' : 'Start Fresh'}
        </button>
        <button className="btn primary" onClick={onRestore} disabled={saving}>
          {saving ? '…' : 'Yes, Restore Data'}
        </button>
      </div>
    </>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────
export default function TailModal({ mode, initial, existingTails = [], onSave, onClose }) {
  const [tail,         setTail]         = useState(initial?.tail ?? '')
  const [acType,       setAcType]       = useState(initial?.acType ?? '')
  const systemType = 'vxp'
  // Normalize legacy 'empty' → 'global' since the empty mode is no longer supported
  const [limitsMode,   setLimitsMode]   = useState(
    (initial?.limitsMode === 'empty' || !initial?.limitsMode) ? 'global' : initial.limitsMode
  )
  const [customLimits, setCustomLimits] = useState(initial?.customLimits ?? {})
  // 'form' | 'limits' | 'restore'
  const [step,         setStep]         = useState('form')
  const [restoreData,  setRestoreData]  = useState(null)
  const [saving,       setSaving]       = useState(false)

  const tailTrimmed = tail.trim().toUpperCase()
  const tailExists  = mode === 'add' && existingTails.includes(tailTrimmed)
  const valid       = tailTrimmed !== '' && acType.trim() !== '' && !tailExists

  function buildItem(customLimitsOverride = customLimits) {
    return {
      tail:         tailTrimmed,
      acType:       acType.trim(),
      systemType,
      limitsMode,
      customLimits: limitsMode === 'custom' ? customLimitsOverride : {},
    }
  }

  async function handleSave() {
    if (mode === 'add' && window.electronAPI?.checkTailData) {
      // Check whether a data package already exists on disk for this tail.
      // If yes, show the restore prompt before proceeding.
      const data = await window.electronAPI.checkTailData(tailTrimmed).catch(() => null)
      if (data) {
        setRestoreData(data)
        setStep('restore')
        return
      }
    }
    await finalize(false)
  }

  async function finalize(isRestore) {
    setSaving(true)
    try {
      if (mode === 'add') {
        if (isRestore) {
          // Move data from backup back into the live tail directory.
          await window.electronAPI?.restoreTail?.(tailTrimmed)?.catch(() => {})
        } else {
          // Archive any stale live data (start-fresh path) — no-op if directory is empty.
          await window.electronAPI?.archiveTailData?.(tailTrimmed)?.catch(() => {})
        }
        // Scaffold imports/ and reports/ directories (idempotent — safe after restore).
        await window.electronAPI?.createTail?.(tailTrimmed)?.catch(() => {})
      }
      // Write custom limits to the tail's data folder (both add and edit paths).
      // This file overrides the global system limits when limitsMode === 'custom'.
      let effectiveCustomLimits = customLimits
      if (limitsMode === 'custom') {
        // Restore path with nothing configured in the modal: restoreTail just
        // moved the tail's old custom_limits.json back — adopt those limits
        // instead of overwriting the restored file with an empty {} (which
        // silently destroyed the only copy of the tail's custom limits).
        if (isRestore && !Object.keys(customLimits).length) {
          effectiveCustomLimits =
            (await window.electronAPI?.loadCustomLimits?.(tailTrimmed)?.catch(() => null)) ?? {}
        }
        await window.electronAPI?.saveCustomLimits?.(tailTrimmed, effectiveCustomLimits)?.catch(() => {})
      } else if (mode === 'edit' && initial?.limitsMode === 'custom') {
        // Switched away from custom → delete the override JSON so global limits take effect
        await window.electronAPI?.deleteCustomLimits?.(tailTrimmed)?.catch(() => {})
      }
      onSave(buildItem(effectiveCustomLimits))
      // onClose is intentionally absent here — onSave triggers the parent's
      // setShowAdd(false) / setEditTarget(null) which unmounts this component,
      // avoiding a double setState call on the already-unmounted instance.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: step === 'limits' ? 540 : step === 'restore' ? 480 : 420 }}
        onClick={e => e.stopPropagation()}
      >
        {step === 'limits' && (
          <LimitsPanel
            customLimits={customLimits}
            onChange={setCustomLimits}
            onBack={() => setStep('form')}
          />
        )}

        {step === 'restore' && restoreData && (
          <RestoreStep
            tail={tailTrimmed}
            data={restoreData}
            saving={saving}
            onRestore={() => finalize(true)}
            onFresh={() => finalize(false)}
            onCancel={() => { setStep('form'); setRestoreData(null) }}
          />
        )}

        {step === 'form' && (
          <>
            <div className="modal-title">
              {mode === 'add' ? 'Add New Tail' : `Edit Tail — ${initial.tail}`}
            </div>

            {/* Tail Number */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--subtext)', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Tail Number
              </label>
              <input
                type="text"
                value={tail}
                onChange={e => setTail(e.target.value)}
                disabled={mode === 'edit'}
                placeholder="e.g. 4X-ABC"
                style={{ textTransform: 'uppercase' }}
              />
              {tailExists && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                  Tail already exists in fleet
                </div>
              )}
            </div>

            {/* AC Type */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--subtext)', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Aircraft Type
              </label>
              <input
                type="text"
                value={acType}
                onChange={e => setAcType(e.target.value)}
                placeholder="e.g. S76C++"
              />
            </div>

            {/* Limits Mode */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--subtext)', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Limits
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['global', 'custom'].map(m => (
                  <button
                    key={m}
                    onClick={() => setLimitsMode(m)}
                    className={`btn ${limitsMode === m ? 'primary' : ''}`}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    {m === 'global' ? 'Global (VXP)' : 'Custom Override'}
                  </button>
                ))}
              </div>
              {limitsMode === 'custom' && (
                <button
                  className="btn"
                  onClick={() => setStep('limits')}
                  style={{ marginTop: 8, width: '100%', justifyContent: 'center', color: 'var(--accent)' }}
                >
                  Configure Limits
                  {Object.keys(customLimits).filter(k => customLimits[k] !== null).length > 0 && (
                    <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--subtext)' }}>
                      ({Object.keys(customLimits).filter(k => customLimits[k] !== null).length} set)
                    </span>
                  )}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={handleSave} disabled={!valid || saving}>
                {saving ? '…' : mode === 'add' ? 'Add Tail' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
