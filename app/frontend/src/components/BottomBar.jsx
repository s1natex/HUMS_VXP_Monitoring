import React, { useState } from 'react'

function PressBtn({ onClick, style, children, title, disabled }) {
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  return (
    <button
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onClick={onClick}
      style={{
        ...style,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        filter: !disabled && hovered && !pressed ? 'brightness(1.18)' : !disabled && pressed ? 'brightness(0.88)' : 'none',
        transform: !disabled && pressed ? 'scale(0.93)' : !disabled && hovered ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 0.1s, filter 0.12s, opacity 0.15s',
      }}
    >
      {children}
    </button>
  )
}

export default function BottomBar({ importProgress, exportProgress, onImport, onExport, onCheckUpdates, appVersion, updateChecking }) {
  const importing = !!importProgress
  const exporting = !!exportProgress
  const busy      = importing || exporting
  const progress  = importProgress ?? exportProgress

  return (
    <div style={{
      height: 'var(--bottombar-h)',
      background: 'var(--panel)',
      borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 10, flexShrink: 0,
      userSelect: 'none',
    }}>
      <PressBtn
        title={importing ? 'Import in progress…' : 'Import VXP PDF'}
        disabled={busy}
        onClick={onImport}
        style={{
          display: 'flex', alignItems: 'center',
          padding: '5px 16px', borderRadius: 3, border: 'none',
          background: 'var(--accent)', color: 'white',
          fontSize: 12, fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        Import
      </PressBtn>

      {/* Centre: version text normally; progress bar + label while busy */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
        {busy ? (
          <>
            <div style={{ flex: 1, maxWidth: 220, background: 'rgba(74,158,255,0.12)', borderRadius: 3, height: 4, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: progress.error ? 'var(--red)' : exporting ? 'var(--green)' : 'var(--accent)',
                width: `${Math.max(2, Math.min(100, progress.pct ?? 0))}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: progress.error ? 'var(--red)' : exporting ? 'var(--green)' : 'var(--accent)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: 260,
            }}>
              {progress.message ?? (exporting ? 'Exporting…' : 'Importing…')}
            </span>
          </>
        ) : updateChecking ? (
          // Update check in flight (startup or version-label click) — shown in
          // the version slot so the check is visibly "doing something".
          <span style={{
            color: 'var(--accent)', fontSize: 11, fontWeight: 600,
            animation: 'vxp-badge-pulse 1.2s ease-in-out infinite',
          }}>
            Checking for updates…
          </span>
        ) : (
          <span
            title="Check for updates"
            onClick={onCheckUpdates}
            style={{ color: 'var(--subtext)', fontSize: 11, opacity: 0.7, cursor: onCheckUpdates ? 'pointer' : 'default' }}
          >
            v{appVersion}
          </span>
        )}
      </div>

      <PressBtn
        title={exporting ? 'Export in progress…' : 'Export report / charts / Excel data'}
        disabled={busy}
        onClick={onExport}
        style={{
          display: 'flex', alignItems: 'center',
          padding: '5px 16px', borderRadius: 3, border: 'none',
          background: 'var(--green)', color: 'white',
          fontSize: 12, fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        Export
      </PressBtn>
    </div>
  )
}
