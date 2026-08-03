// Tail registry — single source of truth for all known aircraft (VXP only for v1.0)
export const TAILS = ['4X-BHT']

export const VXP_TAILS = new Set(['4X-BHT'])

const AIRCRAFT_TYPES = {
  '4X-BHT': 'S76C++',
}

export function tailAircraftType(tail) {
  return AIRCRAFT_TYPES[tail] ?? 'Unknown'
}

// Integration point: when HUMS tails are added back, restore HUMS_TAILS set and
// return 'hums' for HUMS tails here.
export function tailType(_tail) {
  return 'vxp'
}

// Integration point: restore WIP_TAILS set and return true for in-progress tails.
export function isWip(_tail) {
  return false
}

export function systemBadge(_tail) {
  return 'VXP'
}
