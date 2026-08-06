// updater.cjs — startup auto-update via GitHub Releases.
//
// Flow (initUpdater, runs a few seconds after launch):
//   1. connectivity gate  — net.isOnline(); offline machines skip silently
//   2. release check      — GET api.github.com/repos/<UPDATE_REPO>/releases/latest,
//                           compare tag (vX.Y.Z) against app.getVersion()
//   3. download           — newer version's installer asset (.exe) is streamed to
//                           the OS temp folder with progress events
//   4. apply              — on user confirmation ("Restart & Update"): a detached
//                           cmd script waits for the app to exit, runs the
//                           installer silently (/S /D=<install dir> — exit code 5
//                           = still locked → retry), relaunches the app, and
//                           cleans up after itself. data\ is untouched by design
//                           (see Package\installer.nsi).
//
// UPDATE_REPO comes from package.json "updateRepo" ("owner/repo"). Empty string
// disables the whole feature (status 'disabled'). The repo must be PUBLIC —
// checks are unauthenticated; only the release assets matter, the repo can be
// an empty shell that exists purely to host releases.
//
// Renderer contract (see preload.cjs / UpdateBanner.jsx): every state change is
// broadcast as an 'update:event' payload { status, ... }:
//   checking | none | available | downloading | downloaded | offline |
//   disabled | error({ phase: 'check'|'download' })
// Payloads carry manual:true when the check came from the version-label click,
// so the renderer only toasts negative outcomes the user explicitly asked for.

const { app, net, ipcMain, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const UPDATE_REPO = (require('../package.json').updateRepo ?? '').trim()
const CHECK_TIMEOUT_MS = 15000
const PROGRESS_INTERVAL_MS = 250

let lastEvent = { status: 'idle' }
let available = null        // { version, notes, url, size, assetName }
let downloadedPath = null   // set once the installer is fully on disk
let downloading = false

function broadcast(payload) {
  lastEvent = payload
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('update:event', payload)
  }
}

// 'v1.2.3' / '1.2.3' → [1,2,3]; null when unparseable.
function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((s ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isNewer(remote, local) {
  for (let i = 0; i < 3; i++) {
    if (remote[i] !== local[i]) return remote[i] > local[i]
  }
  return false
}

async function fetchLatestRelease() {
  const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'HUMS-VXP-Monitoring-Updater',
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  })
  // 404 = repo missing/private or no release published yet — treat as "no update".
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
  return res.json()
}

async function checkForUpdates({ manual = false, autoDownload = false } = {}) {
  if (!UPDATE_REPO) { broadcast({ status: 'disabled', manual }); return }
  if (downloading) return
  // A check can take up to CHECK_TIMEOUT_MS on a slow network — repeated
  // version-label clicks must not stack concurrent checks.
  if (lastEvent.status === 'checking') return
  // Already downloaded this session — re-prompt instead of re-checking, but
  // only while the installer is actually still on disk (Windows temp cleanup
  // can remove it mid-session; a stale path would dead-end the install).
  if (downloadedPath && available) {
    if (fs.existsSync(downloadedPath)) {
      broadcast({ status: 'downloaded', manual, version: available.version })
      return
    }
    downloadedPath = null
    available = null
  }
  if (!net.isOnline()) { broadcast({ status: 'offline', manual }); return }

  broadcast({ status: 'checking', manual })
  let release
  try {
    release = await fetchLatestRelease()
  } catch (e) {
    broadcast({ status: 'error', phase: 'check', manual, message: e.message })
    return
  }

  const remote = parseVersion(release?.tag_name)
  const local  = parseVersion(app.getVersion())
  const asset  = (release?.assets ?? []).find(a => /\.exe$/i.test(a.name))
  if (!release || !remote || !local || !asset || !isNewer(remote, local)) {
    broadcast({ status: 'none', manual, version: app.getVersion() })
    return
  }

  available = {
    version:   remote.join('.'),
    notes:     release.body ?? '',
    url:       asset.browser_download_url,
    size:      asset.size ?? 0,
    assetName: asset.name,
  }
  broadcast({ status: 'available', manual, version: available.version, size: available.size })
  if (autoDownload) await downloadUpdate({ manual })
}

function downloadUpdate({ manual = false } = {}) {
  if (!available || downloading) return Promise.resolve()
  if (downloadedPath && fs.existsSync(downloadedPath)) {
    broadcast({ status: 'downloaded', manual, version: available.version })
    return Promise.resolve()
  }
  downloading = true
  const version = available.version
  const target = path.join(app.getPath('temp'), `HUMS_VXP_Update_${version}.exe`)

  return new Promise((resolve) => {
    // fail/finish are made idempotent: a stream error can surface from both
    // the response and the file (destroying one triggers the other), and only
    // the first outcome may settle the promise / broadcast a state.
    let file = null
    let settled = false
    const fail = (message) => {
      if (settled) return
      settled = true
      downloading = false
      try { file?.destroy() } catch {}
      try { fs.unlinkSync(target) } catch {}
      broadcast({ status: 'error', phase: 'download', manual, version, message })
      resolve()
    }

    let request
    try {
      request = net.request({ url: available.url, redirect: 'follow' })
    } catch (e) { fail(e.message); return }

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        fail(`Download responded ${response.statusCode}`)
        response.resume?.()
        return
      }
      const total = parseInt(response.headers['content-length'], 10) || available.size || 0
      file = fs.createWriteStream(target)
      let received = 0
      let lastEmit = 0

      broadcast({ status: 'downloading', version, pct: 0, received: 0, total })

      file.on('error', (e) => fail(e.message))

      response.on('data', (chunk) => {
        if (settled) return
        received += chunk.length
        // Respect write backpressure so a slow disk doesn't buffer the whole
        // installer in memory.
        if (!file.write(chunk)) {
          response.pause()
          file.once('drain', () => response.resume())
        }
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now
          broadcast({
            status: 'downloading', version, received, total,
            pct: total ? Math.round((received / total) * 100) : 0,
          })
        }
      })

      response.on('end', () => {
        if (settled) return
        file.end(() => {
          if (settled) return
          // A truncated download must never be handed to the installer.
          if (total && received < total) { fail('Download incomplete'); return }
          settled = true
          downloading = false
          downloadedPath = target
          broadcast({ status: 'downloaded', manual, version })
          resolve()
        })
      })

      response.on('error', (e) => fail(e.message ?? 'Connection lost'))
    })

    request.on('error', (e) => fail(e.message))
    request.end()
  })
}

// Writes and launches the detached apply script, then quits the app. The
// installer's silent mode exits with code 5 while the app's exe is still
// locked, so the script retries once per second (up to a minute) — that covers
// both the app still shutting down and transient locks (antivirus, OneDrive).
function installUpdate() {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updates can only be installed in the packaged app (dev mode).' }
  }
  if (!downloadedPath || !fs.existsSync(downloadedPath)) {
    return { ok: false, error: 'No downloaded update found.' }
  }
  const installDir = path.dirname(process.execPath)
  const batPath = path.join(app.getPath('temp'), 'HUMS_VXP_ApplyUpdate.cmd')
  // /D= must be unquoted and last — NSIS takes everything after it, spaces included.
  const bat = [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    'set RETRIES=60',
    ':try',
    'ping -n 2 127.0.0.1 >nul',
    `"${downloadedPath}" /S /D=${installDir}`,
    'if !errorlevel! equ 5 (',
    '  set /a RETRIES-=1',
    '  if !RETRIES! gtr 0 goto try',
    ')',
    `start "" "${process.execPath}"`,
    `del "${downloadedPath}"`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n')

  try {
    fs.writeFileSync(batPath, bat)
    spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch (e) {
    return { ok: false, error: e.message }
  }
  // Let the invoke response reach the renderer before tearing everything down.
  setTimeout(() => app.quit(), 200)
  return { ok: true }
}

function initUpdater() {
  ipcMain.handle('update:check',     () => checkForUpdates({ manual: true, autoDownload: true }))
  ipcMain.handle('update:download',  () => downloadUpdate({ manual: true }))
  ipcMain.handle('update:install',   () => installUpdate())
  ipcMain.handle('update:get-state', () => lastEvent)

  // Startup check: delayed so it never competes with window creation / data
  // seeding, and auto-downloads so the user is only prompted once the update
  // is actually ready to apply ("Restart & Update").
  if (UPDATE_REPO) {
    setTimeout(() => { checkForUpdates({ autoDownload: true }) }, 3000)
  }
}

module.exports = { initUpdater }
