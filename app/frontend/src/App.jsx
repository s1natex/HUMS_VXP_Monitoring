import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import TopBar            from './components/TopBar'
import BottomBar         from './components/BottomBar'
import LoadingOverlay    from './components/LoadingOverlay'
import DefaultPage       from './components/DefaultPage'
import Dashboard         from './components/Dashboard'
import Charts            from './components/Charts'
import Reports           from './components/Reports'
import RecentImportsPage from './components/RecentImportsPage'
import ExportModal       from './components/ExportModal'
import ImportResultsModal from './components/ImportResultsModal'
import UpdateBanner      from './components/UpdateBanner'
import { LIMITS }                   from './data/limits'
import { MOCK_SIGNERS }             from './data/mockData'
import { aggregateCompStatus, computeImportSummary, toSortableDate } from './utils/importLoader'
import { computeTrendMapsByDate }   from './utils/trendDetection'
import { initReportStore }          from './utils/reportStore'
import { loadFleet, loadFleetFromIPC, saveFleet } from './utils/fleetStore'

// ── Seed localStorage with mock signers on first run (browser dev mode only —
// in Electron the real list is synced from data/global/report_signer.json) ────
const LS_SIGNERS = 'vxp_signers_v2'
if (!window.electronAPI && !localStorage.getItem(LS_SIGNERS)) {
  localStorage.setItem(LS_SIGNERS, JSON.stringify(MOCK_SIGNERS))
}

// Loads a tail's import files + component trackers over IPC. The per-date
// import files are fetched in PARALLEL — the previous per-file `await` loop
// made bootstrap and tail select scale linearly with the import history (one
// IPC round-trip per date file). Promise.all preserves listImports order
// (newest first), so consumers see the same array order as before.
async function fetchTailData(api, tail) {
  const [importFiles, trackers] = await Promise.all([
    api.listImports(tail),
    api.listComponentReports(tail),
  ])
  const imports = (await Promise.all(
    importFiles.map(fn => api.loadImport(tail, fn).then(d => (d ? { ...d, _filename: fn } : null)))
  )).filter(Boolean)
  return { imports, trackers }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Navigation state ─────────────────────────────────────────────────────
  // page: 'default' | 'recent-imports' | 'tail' (when activeTail set)
  // tailView: 'dashboard' | 'reports' | 'charts'
  const [page,      setPage]      = useState('default')
  const [activeTail, setActiveTail] = useState(null)
  const [tailView,  setTailView]  = useState('dashboard')
  const [loading,   setLoading]   = useState(false)
  const [chartInitComp, setChartInitComp] = useState(null)
  // "See Chart" deep-link target from Reports: { date: 'DD-MM-YYYY', session_id? }
  // — the matching data point gets a ring marker and is scrolled into view.
  const [chartInitTarget, setChartInitTarget] = useState(null)
  const [reportsInitComp, setReportsInitComp] = useState(null)
  // "Go to Reports" from the chart's sign-action modal: the entry_id to mark
  // as redirected-from (accent ring + tag) in the Reports entry list.
  const [reportsInitEntry, setReportsInitEntry] = useState(null)
  // Bumped when the user re-clicks the already-active nav button: remounts the
  // view (via its key) so it resets to its default state, without a loading screen.
  const [viewNonce, setViewNonce] = useState(0)
  const tailSelectTimer = useRef(null)
  // Tracks whether the user mutated fleet state after mount but before IPC hydration
  // completed. When true, the init() effect skips overwriting with the IPC value.
  const fleetDirty = useRef(false)

  // ── Data state ────────────────────────────────────────────────────────────
  // importsByTail: { [tail]: importArray }
  // componentReportsByTail: { [tail]: componentTrackerArray }
  const [importsByTail, setImportsByTail] = useState({})
  const [componentReportsByTail, setComponentReportsByTail] = useState({})
  const [vxpLimits,     setVxpLimits]     = useState(null)
  const [fleet,         setFleet]         = useState(() => loadFleet())
  const [customLimitsByTail, setCustomLimitsByTail] = useState({})
  const [reloadTrigger,      setReloadTrigger]      = useState(0)
  // importProgress / exportProgress: null | { pct: 0-100, message: string, error?: string, done?: boolean }
  const [importProgress, setImportProgress] = useState(null)
  const [exportProgress, setExportProgress] = useState(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [importResults,   setImportResults]   = useState(null)
  // Global app-level toast: null | { text: string, ok: boolean }
  const [appToast,       setAppToast]       = useState(null)
  const appToastTimer = useRef(null)
  // Auto-update (electron/updater.cjs events): last event + user dismissal.
  // Dismissing hides the banner for this session; a manual re-check re-shows it.
  const [updateEvt,       setUpdateEvt]       = useState(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  // Running version from package.json via IPC ('1.0.0' fallback = browser dev).
  const [appVersion,      setAppVersion]      = useState('1.0.0')

  // ── Computed: limits for active tail ─────────────────────────────────────
  // Always apply global VXP overrides so all views see consistent limits.
  const baseLimits = useMemo(
    () => (vxpLimits ? { ...LIMITS, ...vxpLimits } : LIMITS),
    [vxpLimits]
  )

  // Effective limits for any tail - layers that tail's custom overrides (when
  // limitsMode === 'custom') on top of the global base. Computed per tail so
  // one tail's custom limits never colour another tail's status.
  const limitsForTail = useCallback((tail) => {
    const fi = fleet.find(f => f.tail === tail)
    if (fi?.limitsMode === 'custom') {
      const custom = customLimitsByTail[tail] ?? fi.customLimits ?? {}
      return { ...baseLimits, ...custom }
    }
    return baseLimits
  }, [fleet, baseLimits, customLimitsByTail])

  const editableLimits = useMemo(
    () => (activeTail ? limitsForTail(activeTail) : baseLimits),
    [activeTail, limitsForTail, baseLimits]
  )

  // ── Computed: per-tail trend maps (single source for every consumer) ───────
  // Per import date, the trend map AS OF that date — the Recent Imports rows
  // use their own date's map so each row shows that day's trends.
  const trendMapsByDateByTail = useMemo(() => {
    const result = {}
    for (const [tail, imps] of Object.entries(importsByTail)) {
      result[tail] = computeTrendMapsByDate(imps)
    }
    return result
  }, [importsByTail])

  // Current trends per tail = the newest date's map (covers the full history);
  // shared by compStatus and the TopBar dots instead of each recomputing it.
  const trendMapByTail = useMemo(() => {
    const result = {}
    for (const [tail, maps] of Object.entries(trendMapsByDateByTail)) {
      const dates = Object.keys(maps).sort()
      result[tail] = dates.length ? maps[dates[dates.length - 1]] : {}
    }
    return result
  }, [trendMapsByDateByTail])

  // ── Computed: comp status map for active tail ─────────────────────────────
  const compStatus = useMemo(() => {
    if (!activeTail) return {}
    return aggregateCompStatus(importsByTail[activeTail] ?? [], editableLimits, trendMapByTail[activeTail])
  }, [activeTail, importsByTail, editableLimits, trendMapByTail])

  // ── Computed: comp status map for every fleet tail (TopBar dots + fleet cards)
  const compStatusByTail = useMemo(() => {
    const result = {}
    for (const fi of fleet) {
      result[fi.tail] = aggregateCompStatus(importsByTail[fi.tail] ?? [], limitsForTail(fi.tail), trendMapByTail[fi.tail])
    }
    return result
  }, [fleet, importsByTail, limitsForTail, trendMapByTail])

  // ── Computed: imports with display summaries ───────────────────────────────
  // Summaries are derived at render time from the CURRENT effective limits (not
  // whatever was active at load), so limit edits, purges and new imports
  // immediately re-colour the Recent Imports counts everywhere. Trends come from
  // each import's OWN date (as-of map), so rows differ date to date.
  const summarizedImportsByTail = useMemo(() => {
    const result = {}
    for (const [tail, imps] of Object.entries(importsByTail)) {
      const limits = limitsForTail(tail)
      const maps   = trendMapsByDateByTail[tail] ?? {}
      result[tail] = imps.map(imp => ({
        ...imp,
        summary: computeImportSummary(imp, limits, maps[toSortableDate(imp.date)]),
      }))
    }
    return result
  }, [importsByTail, limitsForTail, trendMapsByDateByTail])

  // ── Bootstrap: load limits + fleet from IPC, then preload all tail data ──────
  useEffect(() => {
    async function init() {
      const api = window.electronAPI
      if (!api) return

      const [vxp, fleetData] = await Promise.allSettled([
        api.loadLimits('vxp'),
        loadFleetFromIPC(),
      ])
      if (vxp.status === 'fulfilled' && vxp.value) setVxpLimits(vxp.value)

      // Skip IPC hydration if the user already mutated the fleet during startup —
      // their change would otherwise be silently overwritten by the stale IPC value.
      let currentFleet = fleet
      if (fleetData.status === 'fulfilled' && Array.isArray(fleetData.value) && !fleetDirty.current) {
        setFleet(fleetData.value)
        saveFleet(fleetData.value)
        currentFleet = fleetData.value
      }

      // Preload all tails so DefaultPage and TopBar show real data immediately.
      const allImports = {}
      const allComponentReports = {}
      await Promise.all(currentFleet.map(async fi => {
        try {
          const { imports, trackers } = await fetchTailData(api, fi.tail)
          allImports[fi.tail] = imports
          allComponentReports[fi.tail] = trackers
        } catch {
          allImports[fi.tail] = []
          allComponentReports[fi.tail] = []
        }
      }))
      // Merge under anything loaded since this fetch started (tail select /
      // import completing mid-bootstrap is fresher than the preload snapshot).
      setImportsByTail(prev => ({ ...allImports, ...prev }))
      setComponentReportsByTail(prev => ({ ...allComponentReports, ...prev }))
    }
    init()
  }, [])

  // Re-fetch a tail's imports + component trackers from disk into the caches.
  // Shared by import completion and tail add (restore), so fleet cards and the
  // TopBar dots reflect on-disk data without requiring a tail select first.
  const refreshTailData = useCallback(async (tail) => {
    const api = window.electronAPI
    if (!api || !tail) return
    try {
      const { imports, trackers } = await fetchTailData(api, tail)
      setImportsByTail(prev => ({ ...prev, [tail]: imports }))
      setComponentReportsByTail(prev => ({ ...prev, [tail]: trackers }))
    } catch (e) {
      // Best-effort refresh: keep the existing cache — a failed per-file load
      // previously rejected out of this fn, and handleAddTail doesn't await it
      // (unhandled rejection). The next tail select reloads from disk anyway.
      console.warn('Tail data refresh failed:', e)
    }
  }, [])

  // ── Load tail data from IPC when tail changes ─────────────────────────────
  useEffect(() => {
    if (!activeTail) return

    if (!window.electronAPI) {
      setLoading(false)  // dev/mock mode — no IPC, clear the nav spinner
      return
    }

    const api = window.electronAPI

    async function loadTailData() {
      setLoading(true)
      try {
        const { imports, trackers } = await fetchTailData(api, activeTail)

        setImportsByTail(prev => ({ ...prev, [activeTail]: imports }))
        setComponentReportsByTail(prev => ({ ...prev, [activeTail]: trackers }))

        const cl = await api.loadCustomLimits?.(activeTail)?.catch(() => null)
        setCustomLimitsByTail(prev => {
          if (cl) return { ...prev, [activeTail]: cl }
          // No custom-limits file on disk - drop any stale cache entry so the
          // fleet-registry copy (or global limits) takes effect.
          if (!(activeTail in prev)) return prev
          const next = { ...prev }
          delete next[activeTail]
          return next
        })
      } catch (e) {
        console.warn('IPC load failed:', e)
      } finally {
        setLoading(false)
      }
    }

    loadTailData()
    initReportStore(activeTail)
  }, [activeTail, reloadTrigger])

  // ── Global toast ─────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (appToastTimer.current) clearTimeout(appToastTimer.current)
    if (tailSelectTimer.current) clearTimeout(tailSelectTimer.current)
  }, [])

  function showAppToast(text, ok = false) {
    if (appToastTimer.current) clearTimeout(appToastTimer.current)
    setAppToast({ text, ok })
    appToastTimer.current = setTimeout(() => setAppToast(null), 4000)
  }

  // ── Auto-update events ────────────────────────────────────────────────────
  // The main process runs the startup check + auto-download on its own; the
  // renderer just mirrors its events. Manual checks (version label click) get
  // their negative outcomes as toasts; states needing action show the banner.
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateEvent) return
    api.getAppVersion?.().then(v => { if (v) setAppVersion(v) })
    // Pick up any state emitted before this subscriber mounted.
    api.getUpdateState?.().then(s => { if (s && s.status !== 'idle') setUpdateEvt(s) })
    return api.onUpdateEvent((evt) => {
      setUpdateEvt(evt)
      if (['available', 'downloading', 'downloaded'].includes(evt.status)) {
        setUpdateDismissed(false)
      }
      if (evt.manual) {
        if (evt.status === 'none')          showAppToast(`You're up to date (v${evt.version})`, true)
        else if (evt.status === 'offline')  showAppToast('No internet connection — cannot check for updates')
        else if (evt.status === 'disabled') showAppToast('Updates are not configured for this build')
        else if (evt.status === 'error' && evt.phase === 'check')
          showAppToast(`Update check failed: ${evt.message}`)
      }
    })
  }, [])

  const handleCheckUpdates = useCallback(() => {
    window.electronAPI?.checkForUpdates?.()
  }, [])

  const handleInstallUpdate = useCallback(async () => {
    const res = await window.electronAPI?.installUpdate?.()
    if (res && !res.ok) showAppToast(`Update failed: ${res.error}`)
  }, [])

  // ── Navigation handlers ───────────────────────────────────────────────────

  // A tail select is applied on a 500ms delay (spinner beat) — any navigation
  // clicked inside that window must win, or the pending select fires after it
  // and yanks the user to the tail dashboard they already navigated away from.
  // Also clears the `loading` the pending select set, so an early-return
  // navigation path (which shows no spinner of its own) can't strand it on.
  const cancelPendingTailSelect = useCallback(() => {
    if (tailSelectTimer.current) {
      clearTimeout(tailSelectTimer.current)
      tailSelectTimer.current = null
      setLoading(false)
    }
  }, [])

  const handleTailSelect = useCallback((tail) => {
    if (page === 'tail' && activeTail === tail && tailView === 'dashboard') return
    if (tailSelectTimer.current) clearTimeout(tailSelectTimer.current)
    setLoading(true)
    tailSelectTimer.current = setTimeout(() => {
      // Re-selecting the already-active tail (from Recent Imports or a non-
      // dashboard view) doesn't change activeTail, so the [activeTail] effect
      // that clears `loading` wouldn't re-run — bump reloadTrigger to force it.
      if (tail === activeTail) setReloadTrigger(t => t + 1)
      setActiveTail(tail)
      setTailView('dashboard')
      setPage('tail')
      // loading cleared by [activeTail, reloadTrigger] useEffect, not here
    }, 500)
  }, [page, activeTail, tailView])

  const handleTailViewChange = useCallback((view) => {
    cancelPendingTailSelect()
    setChartInitComp(null)
    setChartInitTarget(null)
    if (page === 'tail' && tailView === view) {
      // Re-clicked the active view: reset it to its default state, no spinner.
      setViewNonce(n => n + 1)
      return
    }
    setLoading(true)
    setTimeout(() => {
      setTailView(view)
      setPage('tail')
      setLoading(false)
    }, 200)
  }, [page, tailView, cancelPendingTailSelect])

  const handleViewComponent = useCallback((compKey) => {
    cancelPendingTailSelect()
    if (page === 'tail' && tailView === 'charts' && chartInitComp === compKey) return
    setChartInitComp(compKey)
    setChartInitTarget(null)
    setLoading(true)
    setTimeout(() => {
      setTailView('charts')
      setPage('tail')
      setLoading(false)
    }, 200)
  }, [page, tailView, chartInitComp, cancelPendingTailSelect])

  // "See Chart" on a report entry: open Charts on that component with the
  // entry's data point highlighted and scrolled into view. No viewNonce bump —
  // switching reports → charts already remounts Charts (different view type),
  // and bumping it would remount the still-visible Reports mid-transition.
  const handleSeeChartEntry = useCallback((compKey, entry) => {
    cancelPendingTailSelect()
    setChartInitComp(compKey)
    setChartInitTarget(entry ? { date: entry.date, session_id: entry.session_id ?? null } : null)
    setLoading(true)
    setTimeout(() => {
      setTailView('charts')
      setPage('tail')
      setLoading(false)
    }, 200)
  }, [cancelPendingTailSelect])

  const handleRecentImports = useCallback(() => {
    cancelPendingTailSelect()
    if (page === 'recent-imports') {
      setViewNonce(n => n + 1)
      return
    }
    setLoading(true)
    setTimeout(() => {
      setPage('recent-imports')
      setLoading(false)
    }, 200)
  }, [page, cancelPendingTailSelect])

  const handleDefaultPage = useCallback(() => {
    cancelPendingTailSelect()
    if (page === 'default') return
    setLoading(true)
    setTimeout(() => {
      setActiveTail(null)
      setPage('default')
      setLoading(false)
    }, 200)
  }, [page, cancelPendingTailSelect])

  // ── Fleet CRUD ────────────────────────────────────────────────────────────

  // Add: TailModal handles the data-package restore/archive decision before calling
  // this handler. Here we only need to update the fleet registry — the directory
  // scaffold (imports/ reports/) was already created or restored inside TailModal.
  function handleAddTail(tailItem) {
    fleetDirty.current = true
    const updated = [...fleet, tailItem]
    setFleet(updated)
    saveFleet(updated)
    // A restored data package already has imports/trackers on disk — load them
    // now so the fleet card doesn't read "No Imports Yet" until a tail select.
    refreshTailData(tailItem.tail)
  }

  // Edit: updates only the fleet-registry entry (ac type, system, limits mode).
  // Disk data (imports/ reports/) is not touched — only the JSON metadata changes.
  function handleEditTail(tailItem) {
    fleetDirty.current = true
    const updated = fleet.map(f => f.tail === tailItem.tail ? tailItem : f)
    setFleet(updated)
    saveFleet(updated)
    // Drop the cached custom limits for this tail - TailModal may have changed
    // them, and the registry copy (tailItem.customLimits) is now the fresh source.
    setCustomLimitsByTail(prev => {
      if (!(tailItem.tail in prev)) return prev
      const next = { ...prev }
      delete next[tailItem.tail]
      return next
    })
  }

  // Remove: writes a backup-metadata record to backups/[tail]/ before removing from
  // the registry. The actual data package (imports/ reports/) is kept on disk so it
  // can be restored by re-adding the tail.
  async function handleRemoveTails(tails) {
    fleetDirty.current = true
    const results = await Promise.all(
      tails.map(tail =>
        window.electronAPI?.removeTailBackup?.(tail)
          ?.catch(e => ({ ok: false, error: e.message }))
          ?? Promise.resolve({ ok: true })
      )
    )
    const failed = results.filter(r => r && !r.ok)
    if (failed.length) {
      showAppToast(`Warning: backup failed for ${failed.length} tail(s) — data may not be recoverable`)
    }
    const removing = new Set(tails)
    const updated  = fleet.filter(f => !removing.has(f.tail))
    setFleet(updated)
    saveFleet(updated)
    // Drop cached data for the removed tails — otherwise a later re-add with
    // "Start Fresh" would render the archived (now stale) stats from memory.
    const dropKeys = prev => {
      if (!tails.some(t => t in prev)) return prev
      const next = { ...prev }
      for (const t of tails) delete next[t]
      return next
    }
    setImportsByTail(dropKeys)
    setComponentReportsByTail(dropKeys)
    setCustomLimitsByTail(dropKeys)
    if (removing.has(activeTail)) {
      setActiveTail(null)
      setPage('default')
    }
  }

  // ── Limits save ───────────────────────────────────────────────────────────
  async function handleSaveLimit(compKey, values) {
    const fi = fleet.find(f => f.tail === activeTail)

    try {
      if (fi?.limitsMode === 'custom') {
        const updated = { ...(customLimitsByTail[activeTail] ?? fi.customLimits ?? {}), [compKey]: values }
        setCustomLimitsByTail(prev => ({ ...prev, [activeTail]: updated }))
        // Keep the fleet-registry copy in sync too: limitsForTail falls back to
        // fi.customLimits for tails whose custom_limits.json hasn't been loaded
        // yet (fresh app start before this tail is opened), so a stale registry
        // copy would colour the fleet card / TopBar dot with outdated limits.
        fleetDirty.current = true
        const updatedFleet = fleet.map(f => f.tail === activeTail ? { ...f, customLimits: updated } : f)
        setFleet(updatedFleet)
        saveFleet(updatedFleet)
        const result = await window.electronAPI?.saveCustomLimits(activeTail, updated)
        if (result && !result.ok) showAppToast(`Limits not saved to disk: ${result.error}`)
      } else {
        const updated = { ...(vxpLimits ?? {}), [compKey]: values }
        setVxpLimits(updated)
        const result = await window.electronAPI?.saveLimits('vxp', updated)
        if (result && !result.ok) showAppToast(`Limits not saved to disk: ${result.error}`)
      }
    } catch (e) {
      showAppToast(`Failed to save limits: ${e.message}`)
    }
  }

  // ── Purge handler ─────────────────────────────────────────────────────────
  function handlePurgeComp(compKey) {
    setImportsByTail(prev => {
      const tailImports = (prev[activeTail] ?? []).map(imp => ({
        ...imp,
        sessions: (imp.sessions ?? []).map(s => {
          const { [compKey]: _, ...rest } = s.comps ?? {}
          return { ...s, comps: rest }
        }),
      }))
      return { ...prev, [activeTail]: tailImports }
    })
    // main.cjs also stripped this comp's tracker entries on disk (every entry
    // references a purged session, so the tracker file is deleted) — mirror
    // that here or Reports/Dashboard keep showing the purged comp's actions.
    setComponentReportsByTail(prev => ({
      ...prev,
      [activeTail]: (prev[activeTail] ?? []).filter(t => t.comp_key !== compKey),
    }))
  }

  // ── Import delete ─────────────────────────────────────────────────────────
  async function handleDeleteImport(imp) {
    if (imp._filename && window.electronAPI) {
      const result = await window.electronAPI.deleteImport(imp.tail, imp._filename)
        .catch(e => ({ ok: false, error: e.message }))
      if (!result?.ok) {
        showAppToast(`Failed to delete import: ${result?.error ?? 'Unknown error'}`)
        return
      }
      // main.cjs already stripped matching entries from component trackers on disk — resync.
      const trackers = await window.electronAPI.listComponentReports(imp.tail).catch(() => [])
      setComponentReportsByTail(prev => ({ ...prev, [imp.tail]: trackers }))
    }
    setImportsByTail(prev => ({
      ...prev,
      [imp.tail]: (prev[imp.tail] ?? []).filter(i => i._filename !== imp._filename),
    }))
  }

  function handleComponentReportsChange(newTrackers) {
    setComponentReportsByTail(prev => ({ ...prev, [activeTail]: newTrackers }))
  }

  function handleViewReportComponent(compKey) {
    setReportsInitComp(compKey)
    setReportsInitEntry(null)
    handleTailViewChange('reports')
  }

  // Chart sign-action modal → Reports, with the entry marked redirected-from.
  const handleGoToReportsEntry = useCallback((compKey, entryId) => {
    setReportsInitComp(compKey)
    setReportsInitEntry(entryId ?? null)
    handleTailViewChange('reports')
  }, [handleTailViewChange])

  // ── Export ────────────────────────────────────────────────────────────────
  // Opens the export picker (report PDF / charts PDF / Excel data). Progress
  // is streamed into the BottomBar bar by the modal via setExportProgress.
  function handleExport() {
    if (exportProgress || importProgress) return
    setExportModalOpen(true)
  }

  // Only closes the picker — the progress bar's lifecycle is owned by the
  // modal's export flow (cleared on cancel/error, after a beat on success).
  function handleExportModalClose() {
    setExportModalOpen(false)
  }

  // ── Import PDF ────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!window.electronAPI?.importPdf) return

    setImportProgress({ pct: 0, message: 'Opening file...' })

    const unsub = window.electronAPI.onImportProgress?.((data) => {
      const filePrefix = data.fileCount > 1 ? `File ${(data.fileIndex ?? 0) + 1}/${data.fileCount} — ` : ''
      setImportProgress(prev => ({
        ...prev,
        pct: data.pct ?? prev?.pct ?? 0,
        message: data.total > 0
          ? `${filePrefix}Importing... (page ${data.page} / ${data.total})`
          : `${filePrefix}Importing...`,
      }))
    })

    try {
      const result = await window.electronAPI.importPdf()
      unsub?.()

      if (result?.cancelled) {
        setImportProgress(null)
      } else if (result?.ok) {
        const { results = [], tails = [], imported = 0, skipped = 0, failed = 0, totalDates = 0 } = result

        // Success toast. Keep the friendly single-file wording when exactly one
        // file was selected; otherwise summarise the batch.
        let message
        if (results.length === 1) {
          const r = results[0]
          message = r.ok
            ? `Done - ${r.files?.length ?? 0} date(s) saved for ${r.tail}`
            : r.reason || 'Import failed'
        } else {
          const parts = [`${imported} file(s)`, `${totalDates} date(s)`, `across ${tails.length} tail(s)`]
          if (skipped) parts.push(`${skipped} skipped`)
          if (failed)  parts.push(`${failed} failed`)
          message = `Done - ${parts.join(', ')}`
        }
        setImportProgress({ pct: 100, message, error: failed > 0 && imported === 0, done: true })

        // Reload imports and component trackers for EVERY affected tail. A
        // refresh failure must not be reported as an IMPORT failure (the files
        // are already saved — retrying would just hit the duplicate guard); the
        // caches reload on the next tail select anyway.
        for (const t of tails) await refreshTailData(t).catch(() => {})

        // Pop up the per-file breakdown when a multi-file batch had any
        // skips/failures. A single-file result already shows its reason in the
        // toast above (matching the original single-import behaviour).
        if (results.length > 1 && (skipped || failed)) {
          setImportResults(results.filter(r => !r.ok))
        }
        setTimeout(() => setImportProgress(null), 2200)
      } else {
        const msg = result?.error || 'Import failed'
        setImportProgress({ pct: 0, message: msg, error: true, done: true })
        setTimeout(() => setImportProgress(null), 3500)
      }
    } catch (e) {
      unsub?.()
      setImportProgress({ pct: 0, message: e.message, error: true, done: true })
      setTimeout(() => setImportProgress(null), 3500)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderContent() {
    if (page === 'recent-imports') {
      return (
        <RecentImportsPage
          key={`recent-imports:${viewNonce}`}
          activeTail={activeTail}
          importsByTail={summarizedImportsByTail}
          onDelete={handleDeleteImport}
        />
      )
    }

    if (page === 'default' || !activeTail) {
      return (
        <DefaultPage
          importsByTail={importsByTail}
          componentReportsByTail={componentReportsByTail}
          compStatusByTail={compStatusByTail}
          onTailSelect={handleTailSelect}
          fleet={fleet}
          onAdd={handleAddTail}
          onEdit={handleEditTail}
          onRemove={handleRemoveTails}
          limitsForTail={limitsForTail}
        />
      )
    }

    // Tail views
    if (tailView === 'dashboard') {
      return (
        <Dashboard
          imports={summarizedImportsByTail[activeTail] ?? []}
          componentReports={componentReportsByTail[activeTail] ?? []}
          compStatus={compStatus}
          editableLimits={editableLimits}
          onViewImports={handleRecentImports}
          onViewReports={() => handleTailViewChange('reports')}
          onViewComponent={handleViewComponent}
          onViewReportComponent={handleViewReportComponent}
        />
      )
    }

    if (tailView === 'charts') {
      return (
        <Charts
          key={`${activeTail}:${viewNonce}`}
          activeTail={activeTail}
          imports={importsByTail[activeTail] ?? []}
          compStatus={compStatus}
          editableLimits={editableLimits}
          fleetItem={fleet.find(f => f.tail === activeTail)}
          onSaveLimit={handleSaveLimit}
          onPurgeComp={handlePurgeComp}
          onRestoreComp={() => setReloadTrigger(t => t + 1)}
          initialComp={chartInitComp}
          initialTarget={chartInitTarget}
          componentReports={componentReportsByTail[activeTail] ?? []}
          onComponentReportsChange={handleComponentReportsChange}
          onGoToReportsEntry={handleGoToReportsEntry}
        />
      )
    }

    if (tailView === 'reports') {
      return (
        <Reports
          key={`${activeTail}:${viewNonce}`}
          activeTail={activeTail}
          componentReports={componentReportsByTail[activeTail] ?? []}
          onComponentReportsChange={handleComponentReportsChange}
          initialSelectedComp={reportsInitComp}
          initialEntryId={reportsInitEntry}
          onInitialCompConsumed={() => { setReportsInitComp(null); setReportsInitEntry(null) }}
          onSeeChartEntry={handleSeeChartEntry}
        />
      )
    }

    return null
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', width: '100vw', overflow: 'hidden',
      position: 'relative',
    }}>
      <TopBar
        activeTail={activeTail}
        tailView={tailView}
        page={page}
        fleet={fleet}
        compStatusByTail={compStatusByTail}
        onTailSelect={handleTailSelect}
        onTailViewChange={handleTailViewChange}
        onRecentImports={handleRecentImports}
        onDefaultPage={handleDefaultPage}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {renderContent()}
      </div>
      <LoadingOverlay visible={loading} />

      <BottomBar
        importProgress={importProgress}
        exportProgress={exportProgress}
        onImport={handleImport}
        onExport={handleExport}
        onCheckUpdates={window.electronAPI ? handleCheckUpdates : undefined}
        appVersion={appVersion}
      />

      {!updateDismissed && (
        <UpdateBanner
          evt={updateEvt}
          onInstall={handleInstallUpdate}
          onRetry={() => window.electronAPI?.downloadUpdate?.()}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}

      {appToast && (
        <div
          style={{
            position: 'fixed', bottom: 56, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9000, padding: '8px 18px', borderRadius: 6,
            background: appToast.ok ? 'rgba(46,204,113,0.18)' : 'rgba(224,82,82,0.18)',
            border: `1px solid ${appToast.ok ? 'rgba(46,204,113,0.5)' : 'rgba(224,82,82,0.5)'}`,
            color: appToast.ok ? 'var(--green)' : 'var(--red)',
            fontSize: 12, fontWeight: 600,
            pointerEvents: 'none',
            maxWidth: 'min(420px, 80vw)', textAlign: 'center',
            whiteSpace: 'pre-wrap',
          }}
        >
          {appToast.text}
        </div>
      )}

      {exportModalOpen && (
        <ExportModal
          fleet={fleet}
          activeTail={activeTail}
          importsByTail={importsByTail}
          limitsForTail={limitsForTail}
          onProgress={setExportProgress}
          onToast={showAppToast}
          onClose={handleExportModalClose}
        />
      )}

      {importResults && (
        <ImportResultsModal rows={importResults} onClose={() => setImportResults(null)} />
      )}
    </div>
  )
}
