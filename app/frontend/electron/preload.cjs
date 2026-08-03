const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Limits (system-wide: 'vxp')
  loadLimits:   (tailType)             => ipcRenderer.invoke('limits:load', tailType),
  saveLimits:   (tailType, limits)     => ipcRenderer.invoke('limits:save', tailType, limits),

  // Imports (writes happen only via import:pdf in the main process)
  listImports:  (tail)                 => ipcRenderer.invoke('imports:list', tail),
  loadImport:   (tail, filename)       => ipcRenderer.invoke('imports:load', tail, filename),
  deleteImport: (tail, filename)       => ipcRenderer.invoke('imports:delete', tail, filename),

  // Reports — per-component incident trackers (data/{tail}/reports/{compKey}.json)
  listComponentReports: (tail)                  => ipcRenderer.invoke('reports:list-components', tail),
  loadComponentReport:  (tail, compKey)         => ipcRenderer.invoke('reports:load-component', tail, compKey),
  saveComponentReport:  (tail, compKey, data)   => ipcRenderer.invoke('reports:save-component', tail, compKey, data),

  // Reports — compiled/generated Incident Report documents (…/reports/generated_reports/)
  listGeneratedReports: (tail)                  => ipcRenderer.invoke('reports:list-generated', tail),
  loadGeneratedReport:  (tail, filename)        => ipcRenderer.invoke('reports:load-generated', tail, filename),
  saveGeneratedReport:  (tail, filename, data)  => ipcRenderer.invoke('reports:save-generated', tail, filename, data),

  // Signers
  loadSigners:  ()                     => ipcRenderer.invoke('signers:load'),
  saveSigners:  (signers)              => ipcRenderer.invoke('signers:save', signers),

  // Actions
  loadActions:  (tailType)             => ipcRenderer.invoke('actions:load', tailType),
  saveActions:  (tailType, actions)    => ipcRenderer.invoke('actions:save', tailType, actions),

  // Fleet registry
  loadFleet:    ()                     => ipcRenderer.invoke('fleet:load'),
  saveFleet:    (data)                 => ipcRenderer.invoke('fleet:save', data),

  // Tail data-package management
  createTail:       (tail)             => ipcRenderer.invoke('tail:create', tail),
  checkTailData:    (tail)             => ipcRenderer.invoke('tail:check', tail),
  removeTailBackup: (tail)             => ipcRenderer.invoke('tail:remove-backup', tail),
  archiveTailData:  (tail)             => ipcRenderer.invoke('tail:archive-data', tail),
  restoreTail:      (tail)             => ipcRenderer.invoke('tail:restore', tail),

  // Per-tail custom limits (stored in <tail>/custom_limits.json)
  loadCustomLimits:   (tail)           => ipcRenderer.invoke('custom-limits:load', tail),
  saveCustomLimits:   (tail, limits)   => ipcRenderer.invoke('custom-limits:save', tail, limits),
  deleteCustomLimits: (tail)           => ipcRenderer.invoke('custom-limits:delete', tail),

  // Purge — comment is stored in the backup for identification
  purgeComp:        (tail, compKey, comment) => ipcRenderer.invoke('purge:comp', tail, compKey, comment),

  // Backup: list / restore purged component data
  checkCompBackup:   (tail, compKey)                  => ipcRenderer.invoke('backup:check-comp', tail, compKey),
  listCompBackups:   (tail, compKey)                  => ipcRenderer.invoke('backup:list-comp', tail, compKey),
  restoreCompBackup: (tail, compKey, backupFilename)  => ipcRenderer.invoke('backup:restore-comp', tail, compKey, backupFilename),

  // Export — PDF (reports/charts HTML → A4 via printToPDF) and Excel
  // (payload → source/export_excel.py). Both open a save dialog.
  // Return { ok, path } or { ok: false, error } or { ok: false, cancelled: true }
  exportPdf:   (html, defaultFilename)    => ipcRenderer.invoke('export:pdf', html, defaultFilename),
  exportExcel: (payload, defaultFilename) => ipcRenderer.invoke('export:excel', payload, defaultFilename),

  // Import PDF(s) — multi-select; each file's tail is auto-detected from its header.
  // Returns { ok:true, results, tails, imported, skipped, failed, totalDates, totalIncidents }
  //   where results[] = { file, ok, tail?, files?, dates?, incidents?, skipped?, reason? }
  //   (skipped = duplicate / already-imported; !ok && !skipped = hard failure).
  // Or { ok: false, cancelled: true } when the dialog is dismissed.
  importPdf: () => ipcRenderer.invoke('import:pdf'),

  // Progress stream from the active import — returns unsubscribe fn
  onImportProgress: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('import:progress', handler)
    return () => ipcRenderer.removeListener('import:progress', handler)
  },

  // Running app version (package.json "version") — shown in the BottomBar.
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // ── Auto-update (GitHub Releases — see electron/updater.cjs) ────────────────
  // checkForUpdates: manual re-check (version label click); auto-downloads too.
  // installUpdate:   quits, silently installs the downloaded update, relaunches.
  // getUpdateState:  last emitted update event (for late-mounting subscribers).
  // onUpdateEvent:   { status: checking|none|available|downloading|downloaded|
  //                    offline|disabled|error, ... } — returns unsubscribe fn.
  checkForUpdates: ()  => ipcRenderer.invoke('update:check'),
  downloadUpdate:  ()  => ipcRenderer.invoke('update:download'),
  installUpdate:   ()  => ipcRenderer.invoke('update:install'),
  getUpdateState:  ()  => ipcRenderer.invoke('update:get-state'),
  onUpdateEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('update:event', handler)
    return () => ipcRenderer.removeListener('update:event', handler)
  },
})
