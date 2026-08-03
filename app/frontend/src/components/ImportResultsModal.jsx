import React from 'react'

// Shown after a multi-file import when one or more PDFs were skipped or failed.
// `rows` are the non-ok per-file results from import:pdf:
//   { file, skipped?, tail?, reason }
// skipped = duplicate / already-imported (nothing wrong); otherwise a failure.
export default function ImportResultsModal({ rows = [], onClose }) {
  const skipped = rows.filter(r => r.skipped)
  const failed  = rows.filter(r => !r.skipped)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Import Results</div>

        <div style={{ fontSize: 13, color: 'var(--subtext)', marginBottom: 14 }}>
          {failed.length > 0 && `${failed.length} file(s) failed`}
          {failed.length > 0 && skipped.length > 0 && ' · '}
          {skipped.length > 0 && `${skipped.length} file(s) skipped`}
          . The valid files were imported.
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r, i) => {
            const isSkip = !!r.skipped
            const color  = isSkip ? 'var(--amber)' : 'var(--red)'
            return (
              <div
                key={i}
                style={{
                  padding: '10px 12px', borderRadius: 6,
                  background: isSkip ? 'rgba(217,164,65,0.08)' : 'rgba(224,82,82,0.08)',
                  border: `1px solid ${isSkip ? 'rgba(217,164,65,0.3)' : 'rgba(224,82,82,0.3)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase', color, flexShrink: 0,
                    padding: '1px 6px', borderRadius: 3, border: `1px solid ${color}`,
                  }}>
                    {isSkip ? 'Skipped' : 'Failed'}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }} title={r.file}>
                    {r.file}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--subtext)', lineHeight: 1.5, paddingLeft: 2 }}>
                  {r.reason || 'Unknown reason'}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
