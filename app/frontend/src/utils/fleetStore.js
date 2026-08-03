const LS_FLEET  = 'vxp_fleet_v1'
const VXP_ONLY  = new Set(['vxp'])

const DEFAULT_FLEET = [
  { tail: '4X-BHT', acType: 'S76C++', systemType: 'vxp', limitsMode: 'global', customLimits: {} },
]

// Convert JSON file entry → app fleet item
function fromJsonEntry(e) {
  return {
    tail:         e.tail,
    acType:       e.aircraft_type ?? 'Unknown',
    systemType:   e.system        ?? 'vxp',
    limitsMode:   e.limits_mode   ?? 'global',
    customLimits: e.custom_limits ?? {},
  }
}

// Convert app fleet item → JSON file entry
function toJsonEntry(fi) {
  return {
    tail:          fi.tail,
    system:        fi.systemType,
    aircraft_type: fi.acType,
    limits_mode:   fi.limitsMode,
    custom_limits: fi.customLimits,
  }
}

// Sync read from localStorage cache (used for initial useState value)
export function loadFleet() {
  try {
    const raw = localStorage.getItem(LS_FLEET)
    if (!raw) return DEFAULT_FLEET
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_FLEET
    // Normalize: supply defaults for any fields absent in older localStorage entries
    // so consumers never encounter undefined for limitsMode, customLimits, etc.
    return parsed
      .filter(fi => !fi.systemType || VXP_ONLY.has(fi.systemType))
      .map(fi => ({
        tail:         fi.tail         ?? '',
        acType:       fi.acType       ?? 'Unknown',
        systemType:   'vxp',
        limitsMode:   fi.limitsMode   ?? 'global',
        customLimits: fi.customLimits ?? {},
      }))
  } catch {
    return DEFAULT_FLEET
  }
}

// Async read from IPC (JSON file); returns null when IPC unavailable or the
// registry file doesn't exist yet. An existing file with an EMPTY tails[] is a
// deliberately emptied fleet and is returned as [] — the old `!tails.length`
// guard fell back to the default/cached fleet, resurrecting removed tails.
export async function loadFleetFromIPC() {
  if (!window.electronAPI?.loadFleet) return null
  try {
    const data = await window.electronAPI.loadFleet()
    if (!data || !Array.isArray(data.tails)) return null
    return data.tails.map(fromJsonEntry).filter(fi => VXP_ONLY.has(fi.systemType))
  } catch {
    return null
  }
}

// Write to localStorage cache AND persist to JSON file via IPC
export function saveFleet(fleet) {
  localStorage.setItem(LS_FLEET, JSON.stringify(fleet))
  window.electronAPI?.saveFleet?.({
    schema_version: '2.1',
    tails: fleet.map(toJsonEntry),
  })?.catch(() => {})
}
