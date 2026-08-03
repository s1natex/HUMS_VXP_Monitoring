import React from 'react'

// Floating card above the bottom bar for the auto-update flow (see
// electron/updater.cjs). Renders only for the states that need user attention:
//   downloading → progress bar (startup checks auto-download, so this is
//                 usually the first thing the user sees)
//   available   → Download button (only reached when an auto-download failed
//                 and the user re-checks) — handled as part of 'error' retry
//   downloaded  → "Restart & Update" prompt
//   error       → download-phase failure with a Retry button
// Check-phase outcomes (none / offline / error on a manual check) are toasts,
// not banners — they're transient answers, not pending actions.

function BannerBtn({ onClick, primary, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px', borderRadius: 3, fontSize: 12, fontWeight: 700,
        letterSpacing: '0.02em', cursor: 'pointer',
        border: primary ? 'none' : '1px solid var(--border)',
        background: primary ? 'var(--accent)' : 'transparent',
        color: primary ? 'white' : 'var(--subtext)',
      }}
    >
      {children}
    </button>
  )
}

export default function UpdateBanner({ evt, onInstall, onRetry, onDismiss }) {
  if (!evt) return null
  const { status, version, pct, received, total, message } = evt
  const show = status === 'downloading' || status === 'downloaded' ||
               (status === 'error' && evt.phase === 'download') ||
               status === 'available'
  if (!show) return null

  const mb = b => (b / 1048576).toFixed(1)

  return (
    <div style={{
      position: 'fixed',
      right: 14,
      bottom: 'calc(var(--bottombar-h) + 14px)',
      zIndex: 900,
      width: 320,
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
      padding: '12px 14px',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          {status === 'downloaded' ? `Update v${version} ready to install`
            : status === 'downloading' ? `Downloading update v${version}…`
            : status === 'error' ? 'Update download failed'
            : `Update v${version} available`}
        </span>
        {status !== 'downloading' && (
          <span
            onClick={onDismiss}
            title="Dismiss"
            style={{ cursor: 'pointer', color: 'var(--subtext)', fontSize: 14, lineHeight: 1, padding: 2 }}
          >
            ✕
          </span>
        )}
      </div>

      {status === 'downloading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, background: 'rgba(74,158,255,0.12)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: 'var(--accent)',
              width: `${Math.max(2, Math.min(100, pct ?? 0))}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--subtext)', whiteSpace: 'nowrap' }}>
            {total ? `${mb(received ?? 0)} / ${mb(total)} MB` : `${pct ?? 0}%`}
          </span>
        </div>
      )}

      {status === 'downloaded' && (
        <>
          <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 10 }}>
            The app will close, install the update and reopen. Your data folder is not affected.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <BannerBtn onClick={onDismiss}>Later</BannerBtn>
            <BannerBtn primary onClick={onInstall}>Restart &amp; Update</BannerBtn>
          </div>
        </>
      )}

      {(status === 'error' || status === 'available') && (
        <>
          {status === 'error' && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10, wordBreak: 'break-word' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <BannerBtn onClick={onDismiss}>Later</BannerBtn>
            <BannerBtn primary onClick={onRetry}>{status === 'error' ? 'Retry' : 'Download'}</BannerBtn>
          </div>
        </>
      )}
    </div>
  )
}
