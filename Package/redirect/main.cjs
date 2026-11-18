// Redirect launcher — installed by installer.nsi into a STRAY app folder.
//
// Background: the ≤ v1.0.3 updater applied updates through a cmd script that
// garbled non-ASCII install paths, so the installer created a second copy of
// the app in a new folder (empty data\) and launched that instead of the real
// install. When the new installer detects this, it installs into the real
// folder and replaces this stray copy's resources\app with this launcher, so
// whatever still starts the stray exe (the old apply script's relaunch line)
// opens the real install instead. The stray's data\ is never touched.
//
// redirect.txt (written by the installer, UTF-16LE with BOM) holds the full
// path of the real "HUMS VXP Monitoring.exe".

const { app, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function readTarget() {
  const raw = fs.readFileSync(path.join(__dirname, 'redirect.txt'))
  return raw.toString('utf16le').replace(/^﻿/, '').replace(/\0/g, '').trim()
}

app.whenReady().then(() => {
  try {
    const target = readTarget()
    if (!target || !fs.existsSync(target)) throw new Error(`App not found at:\n${target}`)
    spawn(target, [], { cwd: path.dirname(target), detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    dialog.showErrorBox('HUMS VXP Monitoring',
      `This is an outdated copy of HUMS VXP Monitoring and the main installation could not be started.\n\n${e.message}`)
  }
  app.exit(0)
})
