export const Status = Object.freeze({
  OK:       'ok',
  CAUTION:  'caution',
  ALERT:    'alert',
  NOMINAL:  'nominal',
  NORMAL:   'normal',
  CRITICAL: 'critical',
  WHITE:    'white',
})

export const Trend = Object.freeze({
  STABLE: 'stable',
  UP:     'up',
  DOWN:   'down',
})

// Maps status string → CSS colour token
export const STATUS_COLOR = {
  ok:       'var(--green)',
  normal:   'var(--green)',
  nominal:  'var(--green)',
  caution:  'var(--amber)',
  alert:    'var(--red)',
  critical: 'var(--red)',
  white:    'var(--white-na)',
}

// Maps status → dot CSS class
export const STATUS_DOT_CLASS = {
  ok:       'green',
  normal:   'green',
  nominal:  'green',
  caution:  'yellow',
  alert:    'red',
  critical: 'red',
  white:    'white',
  null:     'white',
}

export function dotClass(status) {
  return STATUS_DOT_CLASS[status] ?? 'white'
}

export function trendArrow(trend) {
  if (trend === 'up')   return '↑'
  if (trend === 'down') return '↓'
  return '→'
}

export function trendClass(trend) {
  if (trend === 'up')   return 'trend-up'
  if (trend === 'down') return 'trend-down'
  return 'trend-flat'
}

export function statusLabel(status) {
  if (status === 'alert' || status === 'critical') return 'Critical'
  if (status === 'caution') return 'Caution'
  return 'Normal'
}

export function trendLabel(trend) {
  if (trend === 'up')   return 'Deteriorating'
  if (trend === 'down') return 'Recovering'
  return 'Stable'
}
