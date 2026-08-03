import React, { useState } from 'react'

export default function PurgeModal({ compKey, tail, onConfirm, onClose }) {
  const [typing,  setTyping]  = useState('')
  const [comment, setComment] = useState('')
  const expected = 'PURGE'
  const ready = typing.trim().toUpperCase() === expected

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{ color: 'var(--red)' }}>Purge Component Data</div>

        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 14 }}>
          This will <strong style={{ color: 'var(--red)' }}>permanently remove</strong> all measurements
          for <strong>{compKey}</strong> from every import file in <strong>{tail}</strong>.
        </div>

        <div style={{ fontSize: 12, color: 'var(--subtext)', marginBottom: 6 }}>
          A backup will be saved to <code style={{ color: 'var(--accent)' }}>data/backups/{tail}/</code>
        </div>

        <div style={{
          padding: '10px 12px', borderRadius: 6, marginBottom: 14,
          background: 'rgba(224,82,82,0.1)', border: '1px solid rgba(224,82,82,0.3)',
          fontSize: 12, color: 'var(--red)',
        }}>
          This action cannot be undone from within the app.
        </div>

        <label style={{ fontSize: 12, color: 'var(--subtext)', display: 'block', marginBottom: 4 }}>
          Backup comment (used to identify this backup when restoring):
        </label>
        <input
          type="text"
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="e.g. Before recalibration 06/2026"
          style={{ marginBottom: 14 }}
        />

        <label style={{ fontSize: 12, color: 'var(--subtext)', display: 'block', marginBottom: 6 }}>
          Type <strong>PURGE</strong> to confirm:
        </label>
        <input
          type="text"
          value={typing}
          onChange={e => setTyping(e.target.value)}
          placeholder="PURGE"
          style={{ letterSpacing: '0.1em', fontWeight: 700 }}
          autoFocus
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn danger"
            onClick={() => { if (ready) onConfirm(comment.trim()) }}
            disabled={!ready}
            style={{ opacity: ready ? 1 : 0.4 }}
          >
            Purge Data
          </button>
        </div>
      </div>
    </div>
  )
}
