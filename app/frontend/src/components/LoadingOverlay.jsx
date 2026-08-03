import React from 'react'

const W       = 260
const H       = 260
const CX      = W / 2
const CY      = H / 2
const DISPLAY = 215   // rendered pixel size (coordinate space stays at 260×260)

// ── S-76D swept-tip blade planform (top-down rotor view) ───────────────────
//
// Blade points straight up (–Y) at 0°; assembly rotates CW.
// Leading edge = right (+X);  Trailing edge = left (–X).
//
// Reference: S-76D_mainRotorTip.jpg
//
// Trailing edge (–X): straight r=35→90, then gentle cubic sweep to tip at r=122.
// Leading edge (+X): straight r=35→88, then DRAMATIC cubic sweep — crosses the
//   blade centreline and arrives at the same tip, shifted 2 px toward the trailing
//   edge. The asymmetric sweep (6 px vs 2 px lateral travel) replicates the
//   scimitar planform in the reference photo.
// The slight 2 px difference in sweep-start radius (88 vs 90) gives the leading
//   edge a subtly earlier onset, matching the diagonal seam visible on the real blade.
// One solid filled path — no hollow cap, no seam element.

const BLADE = `
  M ${CX - 4},${CY - 35}
  L ${CX - 4},${CY - 90}
  C ${CX - 4},${CY - 104} ${CX - 3},${CY - 114} ${CX - 2},${CY - 122}
  C ${CX + 1},${CY - 112} ${CX + 4.5},${CY - 99} ${CX + 4},${CY - 88}
  L ${CX + 4},${CY - 35}
  Z
`.trim()

// Hub bolt positions precomputed (r=5.5 from centre)
const HUB_BOLTS = [0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
  const rad = (deg - 90) * Math.PI / 180
  return { key: deg, cx: CX + Math.cos(rad) * 5.5, cy: CY + Math.sin(rad) * 5.5 }
})

// ── Arm assembly ───────────────────────────────────────────────────────────
function Arm({ deg }) {
  return (
    <g transform={`rotate(${deg}, ${CX}, ${CY})`}>

      {/* Trunnion — hub face (r=8) to flap hinge (r=17) */}
      <path
        d={`M ${CX-3.5},${CY-8} L ${CX-2.5},${CY-17} L ${CX+2.5},${CY-17} L ${CX+3.5},${CY-8} Z`}
        fill="#0c1b30" stroke="var(--accent)" strokeWidth="0.8"
      />

      {/* Flap hinge at r=20 */}
      <circle cx={CX} cy={CY-20} r="3.5"
        fill="#091422" stroke="var(--accent)" strokeWidth="1.2" />
      <circle cx={CX} cy={CY-20} r="1.5"
        fill="var(--accent)" opacity="0.7" />

      {/* Lead-lag damper body r=20–27 */}
      <rect x={CX-2.5} y={CY-27} width="5" height="7" rx="1.2"
        fill="#0d1b2e" stroke="var(--accent)" strokeWidth="0.7" />
      <rect x={CX-2.5} y={CY-27} width="5" height="2" rx="0.8"
        fill="var(--accent)" opacity="0.4" />
      <rect x={CX-2.5} y={CY-22} width="5" height="2" rx="0.8"
        fill="var(--accent)" opacity="0.4" />

      {/* Lead-lag hinge pin at r=28 */}
      <circle cx={CX} cy={CY-28} r="2.5"
        fill="#091422" stroke="var(--accent)" strokeWidth="0.9" />
      <circle cx={CX} cy={CY-28} r="1.1"
        fill="#6ab4ff" />

      {/* Blade grip housing r=28–35 */}
      <rect x={CX-3.5} y={CY-35} width="7" height="7" rx="1.2"
        fill="#0e1f36" stroke="var(--accent)" strokeWidth="1" />
      <circle cx={CX} cy={CY-32} r="1.2" fill="var(--accent)" opacity="0.65" />
      <circle cx={CX} cy={CY-29} r="1.2" fill="var(--accent)" opacity="0.65" />

      {/* Pitch horn */}
      <line
        x1={CX + 3.5} y1={CY - 33}
        x2={CX + 11}   y2={CY - 31}
        stroke="#6ab4ff" strokeWidth="1.8" strokeLinecap="round"
      />
      <circle cx={CX+11} cy={CY-31} r="1.8" fill="#6ab4ff" />

      {/* Pitch link */}
      <line
        x1={CX+11} y1={CY-31}
        x2={CX+9}  y2={CY-20}
        stroke="#6ab4ff" strokeWidth="1" strokeLinecap="round" opacity="0.55"
      />
      <circle cx={CX+9} cy={CY-20} r="1.3" fill="#6ab4ff" opacity="0.45" />

      {/* Swept-tip blade — solid single path */}
      <path d={BLADE} fill="var(--accent)" opacity="0.88" />

    </g>
  )
}

// Ghost blade for motion-blur layers
function BladeGhost({ deg, opacity }) {
  return (
    <path
      transform={`rotate(${deg}, ${CX}, ${CY})`}
      d={BLADE}
      fill="var(--accent)"
      opacity={opacity}
    />
  )
}

export default function LoadingOverlay({ visible, message = 'Loading…', sub = '', progress = null }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0d1117',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'all' : 'none',
      transition: 'opacity 0.2s',
    }}>
      <svg width={DISPLAY} height={DISPLAY} viewBox={`0 0 ${W} ${H}`}>

        {/* Outer disc ring */}
        <circle cx={CX} cy={CY} r={120}
          fill="none" stroke="rgba(74,158,255,0.05)" strokeWidth="20" />
        <circle cx={CX} cy={CY} r={120}
          fill="none" stroke="rgba(74,158,255,0.13)" strokeWidth="1.2" />

        {/* ── Spinning assembly ── */}
        <g style={{ transformOrigin: `${CX}px ${CY}px`, animation: 'vxp-spin 1.4s linear infinite' }}>

          {/* Motion-blur ghost blades */}
          {[0,90,180,270].map(d => <BladeGhost key={`g2_${d}`} deg={d-18} opacity={0.06} />)}
          {[0,90,180,270].map(d => <BladeGhost key={`g1_${d}`} deg={d-9}  opacity={0.16} />)}

          {/* Swashplate ring */}
          <circle cx={CX} cy={CY} r={14}
            fill="none" stroke="rgba(74,158,255,0.22)" strokeWidth="1.6" />
          <circle cx={CX} cy={CY} r={12}
            fill="none" stroke="rgba(74,158,255,0.10)" strokeWidth="0.7" />

          {/* Four arm + blade assemblies */}
          {[0,90,180,270].map(d => <Arm key={d} deg={d} />)}

        </g>

        {/* ── Static hub cap ── */}

        <circle cx={CX} cy={CY} r={8}
          fill="#07111e" stroke="var(--accent)" strokeWidth="1.4" />

        {HUB_BOLTS.map(({ key, cx, cy }) => (
          <circle key={key} cx={cx} cy={cy} r="1.1" fill="var(--accent)" opacity="0.6" />
        ))}

        <circle cx={CX} cy={CY} r={4.5}
          fill="#0c1e32" stroke="var(--accent)" strokeWidth="0.8" opacity="0.85" />

        <circle cx={CX} cy={CY} r={2.8} fill="var(--accent)" opacity="0.88" />
        <circle cx={CX} cy={CY} r={1.7} fill="#0e2040" />
        <circle cx={CX} cy={CY} r={1.0} fill="white" opacity="0.95" />
        <circle cx={CX} cy={CY} r={0.4} fill="#0d1117" />

      </svg>

      <div style={{
        marginTop: 20, fontSize: 12, fontWeight: 700,
        color: 'var(--text)', letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        {message}
      </div>
      {sub && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--subtext)', letterSpacing: '0.06em' }}>
          {sub}
        </div>
      )}
      {progress !== null && (
        <div style={{ marginTop: 18, width: 220, background: 'rgba(74,158,255,0.12)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: 'var(--accent)',
            width: `${Math.max(0, Math.min(100, progress))}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}
    </div>
  )
}
