; HUMS VXP Monitoring — installer / updater
;
; Installs (or updates) the app into a folder the user picks on the directory
; page (default: their Desktop):
;
;   <chosen folder>\HUMS VXP Monitoring\
;   ├── HUMS VXP Monitoring.exe      (+ Electron runtime files)
;   ├── resources\                   (app code + Python scripts — replaced on update)
;   ├── locales\                     (Electron runtime — replaced on update)
;   ├── data\                        (ALL user data — NEVER touched by this installer)
;   ├── version.txt                  (installed version marker, for the future updater)
;   └── Uninstall.exe                (removes the app; asks before touching data)
;
; $DESKTOP is resolved through the Windows shell, so OneDrive-redirected
; Desktops (e.g. C:\Users\x\OneDrive\Desktop) are handled automatically.
;
; DATA INTEGRITY RULE: nothing in this script may ever delete, overwrite or
; enumerate anything under $INSTDIR\data. Updates wipe only the app-owned
; paths listed explicitly in the Install section.
;
; Silent usage (future auto-update / CI):  "HUMS VXP Monitoring Install.exe" /S
; Optional target override (silent only):  /S /D=C:\some\dir   (no quotes, must be last)
;
; Compiled by build-package.ps1, which generates build\version.nsh first.

Unicode true
ManifestDPIAware true
!include "MUI2.nsh"
!include "build\version.nsh"        ; defines APP_VERSION and STAGING_DIR

Name "HUMS VXP Monitoring"
OutFile "HUMS VXP Monitoring Install.exe"
RequestExecutionLevel user          ; user-writable locations — no admin, no UAC
InstallDir "$DESKTOP\HUMS VXP Monitoring"   ; default only — changeable on the directory page
BrandingText "HUMS VXP Monitoring ${APP_VERSION}"
SetCompressor /SOLID lzma
SetFont "Segoe UI" 9

; ── Modern UI pages ───────────────────────────────────────────────────────────
; Sidebar bitmap is generated per-build by build-package.ps1 (app-themed gradient).
!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBAR_BMP}"
!define MUI_WELCOMEPAGE_TITLE "HUMS VXP Monitoring ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This wizard installs (or updates) HUMS VXP Monitoring on your computer.$\r$\n$\r$\nUpdating an existing installation replaces only the application files — your data folder is never touched.$\r$\n$\r$\nClick Next to continue."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where to install HUMS VXP Monitoring. The default is a folder on your Desktop, but you can pick any location.$\r$\n$\r$\nThe app and its data folder will live inside the chosen folder. To update an existing installation, select the same folder as before."
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Installation complete"
!define MUI_FINISHPAGE_TEXT "HUMS VXP Monitoring ${APP_VERSION} has been installed to:$\r$\n$INSTDIR"
!define MUI_FINISHPAGE_RUN "$INSTDIR\HUMS VXP Monitoring.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch HUMS VXP Monitoring"
; Second finish-page checkbox (the SHOWREADME slot repurposed, standard NSIS
; pattern): creates a desktop shortcut only when ticked.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\HUMS VXP Monitoring.lnk" "$INSTDIR\HUMS VXP Monitoring.exe"
FunctionEnd

Section "Install"
  SetDetailsPrint both

  ; ── Guard: app must not be running (its files would be locked) ──────────────
  ; Deleting the exe is the lock probe; it is rewritten below either way.
  retry_lock:
  ClearErrors
  IfFileExists "$INSTDIR\HUMS VXP Monitoring.exe" 0 not_locked
  Delete "$INSTDIR\HUMS VXP Monitoring.exe"
  IfErrors 0 not_locked
    IfSilent 0 +3
      SetErrorLevel 5               ; silent update: report locked and bail out
      Abort
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "HUMS VXP Monitoring appears to be running.$\r$\nPlease close it, then press Retry." \
      IDRETRY retry_lock
    Abort
  not_locked:

  ; ── Remove previous app files (data\ is deliberately not listed) ────────────
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE*"
  Delete "$INSTDIR\version.txt"
  Delete "$INSTDIR\vk_swiftshader_icd.json"

  ; ── Install new app files ───────────────────────────────────────────────────
  SetOutPath "$INSTDIR"
  File /r "${STAGING_DIR}\*"

  ; ── Data folder: create if missing, never modify if present ─────────────────
  CreateDirectory "$INSTDIR\data"

  ; ── Version marker for the future startup update-check ──────────────────────
  FileOpen $0 "$INSTDIR\version.txt" w
  FileWrite $0 "${APP_VERSION}"
  FileClose $0

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  DetailPrint "Installed HUMS VXP Monitoring ${APP_VERSION} to $INSTDIR"
SectionEnd

; ── Uninstall ─────────────────────────────────────────────────────────────────
; Removes the app files and desktop shortcut. The data folder is ALWAYS kept —
; same data-integrity rule as install/update: nothing here may touch data\.
Section "Uninstall"
  ; ── Guard: app must not be running (locked files would survive the deletes,
  ; leaving a half-removed folder that looks undeletable) ─────────────────────
  un_retry_lock:
  ClearErrors
  IfFileExists "$INSTDIR\HUMS VXP Monitoring.exe" 0 un_not_locked
  Delete "$INSTDIR\HUMS VXP Monitoring.exe"
  IfErrors 0 un_not_locked
    IfSilent 0 +3
      SetErrorLevel 5               ; silent: report locked and bail out
      Abort
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "HUMS VXP Monitoring appears to be running.$\r$\nPlease close it, then press Retry." \
      IDRETRY un_retry_lock
    Abort
  un_not_locked:

  Delete "$DESKTOP\HUMS VXP Monitoring.lnk"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE*"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\version.txt"
  Delete "$INSTDIR\HUMS VXP Monitoring.exe"
  Delete "$INSTDIR\Uninstall.exe"

  RMDir "$INSTDIR"    ; non-recursive: root stays because data\ is always kept

  ; ── Outcome report (interactive only) ───────────────────────────────────────
  IfSilent un_done
  MessageBox MB_ICONINFORMATION \
    "HUMS VXP Monitoring was removed.$\r$\n$\r$\nYour data was kept at:$\r$\n$INSTDIR\data"
  un_done:
SectionEnd
