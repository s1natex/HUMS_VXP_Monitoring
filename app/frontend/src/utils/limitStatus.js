import { LIMITS } from '../data/limits'

// Returns 'alert' | 'caution' | 'ok' | 'white' given a comp key and measurement
export function getLimitStatus(compKey, avgMeas, limitsOverride) {
  const limitsMap = limitsOverride ?? LIMITS
  const limits = limitsMap[compKey]
  if (!limits || avgMeas == null) return 'white'
  const [lower, caution, critical] = limits
  if (critical != null && avgMeas >= critical) return 'alert'
  if (caution  != null && avgMeas >= caution)  return 'caution'
  if (lower    != null && avgMeas >= lower)     return 'ok'
  return 'white'
}

// Returns 'white' | 'green' | 'yellow' | 'red' for the 2.0 colour scheme
export function limitColor(compKey, avgMeas, limitsOverride) {
  const s = getLimitStatus(compKey, avgMeas, limitsOverride)
  const map = { white: 'white', ok: 'green', caution: 'yellow', alert: 'red' }
  return map[s] ?? 'white'
}
