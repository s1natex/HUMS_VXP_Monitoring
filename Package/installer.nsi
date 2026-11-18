; HUMS VXP Monitoring — installer / updater
;
; Installs (or updates) the app into a folder the user picks on the directory
; page (default: their Desktop, or the existing install's folder):
;
;   <chosen folder>\HUMS VXP Monitoring\
;   ├── HUMS VXP Monitoring.exe      (+ Electron runtime files)
;   ├── resources\                   (app code + Python scripts — replaced on update)
;   ├── locales\                     (Electron runtime — replaced on update)
;   ├── data\                        (ALL user data — NEVER touched by this installer)
;   ├── version.txt                  (installed version marker)
;   └── Uninstall.exe                (removes the app; asks before touching data)
;
; The install folder is recorded in HKCU\Software\HUMS VXP Monitoring
; (InstallDir) so later installs/updates can find it.
;
; $DESKTOP is resolved through the Windows shell, so OneDrive-redirected
; Desktops (e.g. C:\Users\x\OneDrive\Desktop) are handled automatically.
;
; DATA INTEGRITY RULE: nothing in this script may ever delete, overwrite or
; enumerate-and-modify anything under any data\ folder. Updates wipe only the
; app-owned paths listed explicitly in the Install section.
;
; Command line:
;   /S                 silent (used by the in-app updater)
;   /RELAUNCH          silent update started by the v1.0.4+ updater: start the
;                      app again once installed
;   /D=C:\some\dir     target folder (no quotes, must be LAST)
;
; Silent mode waits up to 60 s for the running app to exit (its exe is locked
; until then); if it never unlocks the installer exits with code 5.
;
; LEGACY UPDATE REDIRECT: the ≤ v1.0.3 updater ran the installer from a cmd
; script, which garbled non-ASCII install paths — the installer then created a
; second copy of the app at the garbled path (empty data\) and that copy was
; launched. When started that way (silent, no /RELAUNCH), the target folder has
; no imported data, and the real install is known (registry, or the default
; Desktop folder), the update is redirected into the real install. If a stray
; copy exists at the old target, its resources\app is replaced by a tiny
; launcher (Package\redirect) that opens the real install, so the old script's
; relaunch line lands in the right app. The stray's data\ is left untouched.
;
; Compiled by build-package.ps1, which generates build\version.nsh first.

Unicode true
ManifestDPIAware true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "build\version.nsh"        ; defines APP_VERSION, STAGING_DIR, SIDEBAR_BMP, APP_ICON

!define APP_EXE "HUMS VXP Monitoring.exe"
!define REG_KEY "Software\HUMS VXP Monitoring"

Name "HUMS VXP Monitoring"
OutFile "HUMS VXP Monitoring Install.exe"
RequestExecutionLevel user          ; user-writable locations — no admin, no UAC
InstallDir "$DESKTOP\HUMS VXP Monitoring"   ; default only — changeable on the directory page
InstallDirRegKey HKCU "${REG_KEY}" "InstallDir"   ; existing install wins over the default
BrandingText "HUMS VXP Monitoring ${APP_VERSION}"
SetCompressor /SOLID lzma
SetFont "Segoe UI" 9

Var Relaunch     ; "1" when started by the v1.0.4+ updater (/RELAUNCH)
Var StrayDir     ; legacy redirect: the folder the old updater pointed at

; ── Modern UI pages ───────────────────────────────────────────────────────────
; Sidebar bitmap is generated per-build by build-package.ps1 (app-themed gradient).
!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBAR_BMP}"
; Installer + uninstaller icon: the same Brook Aviation mark as the app .exe.
!define MUI_ICON   "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_WELCOMEPAGE_TITLE "HUMS VXP Monitoring ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This wizard installs (or updates) HUMS VXP Monitoring on your computer.$\r$\n$\r$\nUpdating an existing installation replaces only the application files — your data folder is never touched.$\r$\n$\r$\nClick Next to continue."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where to install HUMS VXP Monitoring. The default is a folder on your Desktop, but you can pick any location.$\r$\n$\r$\nThe app and its data folder will live inside the chosen folder. To update an existing installation, select the same folder as before."
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Installation complete"
!define MUI_FINISHPAGE_TEXT "HUMS VXP Monitoring ${APP_VERSION} has been installed to:$\r$\n$INSTDIR"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
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
  CreateShortcut "$DESKTOP\HUMS VXP Monitoring.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
FunctionEnd

; In: $R0 = install folder. Out: $R1 = "1" when any data\<tail>\imports\*.json
; exists (read-only check — nothing under data\ is modified).
Function HasImports
  StrCpy $R1 ""
  ClearErrors
  FindFirst $R2 $R3 "$R0\data\*.*"
  ${DoUntil} ${Errors}
    ${If} $R3 != "."
    ${AndIf} $R3 != ".."
    ${AndIf} ${FileExists} "$R0\data\$R3\imports\*.json"
      StrCpy $R1 "1"
      ${Break}
    ${EndIf}
    FindNext $R2 $R3
  ${Loop}
  FindClose $R2
FunctionEnd

; Out: $R4 = folder of the real existing install (exe + data\), or "".
; Registry first (written by v1.0.4+), then the default Desktop location.
Function FindRealInstall
  StrCpy $R4 ""
  ReadRegStr $R5 HKCU "${REG_KEY}" "InstallDir"
  ${If} $R5 != ""
  ${AndIf} ${FileExists} "$R5\${APP_EXE}"
  ${AndIf} ${FileExists} "$R5\data\*.*"
    StrCpy $R4 $R5
  ${ElseIf} ${FileExists} "$DESKTOP\HUMS VXP Monitoring\${APP_EXE}"
  ${AndIf} ${FileExists} "$DESKTOP\HUMS VXP Monitoring\data\*.*"
    StrCpy $R4 "$DESKTOP\HUMS VXP Monitoring"
  ${EndIf}
FunctionEnd

Section "Install"
  SetDetailsPrint both

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/RELAUNCH" $R1
  ${IfNot} ${Errors}
    StrCpy $Relaunch "1"
  ${EndIf}

  ; ── Legacy update redirect (see header) ─────────────────────────────────────
  StrCpy $StrayDir ""
  ${If} ${Silent}
  ${AndIf} $Relaunch != "1"
    Call FindRealInstall
    ${If} $R4 != ""
    ${AndIf} $R4 != $INSTDIR
      StrCpy $R0 $INSTDIR
      Call HasImports
      ${If} $R1 != "1"
        StrCpy $StrayDir $INSTDIR
        StrCpy $INSTDIR $R4
        DetailPrint "Legacy update target $StrayDir redirected to $INSTDIR"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; ── Guard: app must not be running (its files would be locked) ──────────────
  ; Deleting the exe is the lock probe; it is rewritten below either way.
  ; Silent: the updater has just asked the app to quit — wait up to 60 s.
  StrCpy $R9 0
  retry_lock:
  ClearErrors
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
    Delete "$INSTDIR\${APP_EXE}"
    ${If} ${Errors}
      ${If} ${Silent}
        IntOp $R9 $R9 + 1
        ${If} $R9 < 60
          Sleep 1000
          Goto retry_lock
        ${EndIf}
        SetErrorLevel 5             ; still locked: report and bail out
        Abort
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
        "HUMS VXP Monitoring appears to be running.$\r$\nPlease close it, then press Retry." \
        IDRETRY retry_lock
      Abort
    ${EndIf}
  ${EndIf}

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

  ; ── Version marker ──────────────────────────────────────────────────────────
  FileOpen $0 "$INSTDIR\version.txt" w
  FileWrite $0 "${APP_VERSION}"
  FileClose $0

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${REG_KEY}" "InstallDir" "$INSTDIR"

  ; ── Desktop shortcut + icon refresh ─────────────────────────────────────────
  ; An existing shortcut is rewritten so it points at this install with an
  ; explicit icon, then Explorer is told to drop its cached icons — otherwise
  ; the old logo can linger on the shortcut after an update.
  ${If} ${FileExists} "$DESKTOP\HUMS VXP Monitoring.lnk"
    Call CreateDesktopShortcut
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'   ; SHCNE_ASSOCCHANGED

  ; ── Legacy redirect: neutralise the stray copy ──────────────────────────────
  ${If} $StrayDir != ""
    ${If} ${FileExists} "$StrayDir\${APP_EXE}"
      ; The old apply script will start $StrayDir's exe next — make it a
      ; launcher for this install. Only resources\app is replaced.
      RMDir /r "$StrayDir\resources\app"
      SetOutPath "$StrayDir\resources\app"
      File "redirect\package.json"
      File "redirect\main.cjs"
      FileOpen $0 "$StrayDir\resources\app\redirect.txt" w
      FileWriteUTF16LE /BOM $0 "$INSTDIR\${APP_EXE}"
      FileClose $0
      SetOutPath "$INSTDIR"
      DetailPrint "Stray copy at $StrayDir now opens $INSTDIR"
    ${Else}
      ; Nothing there for the old script to relaunch — start the app ourselves.
      Exec '"$INSTDIR\${APP_EXE}"'
    ${EndIf}
  ${EndIf}

  ; ── Relaunch (v1.0.4+ updater) ──────────────────────────────────────────────
  ${If} $Relaunch == "1"
    Exec '"$INSTDIR\${APP_EXE}"'
  ${EndIf}

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
  IfFileExists "$INSTDIR\${APP_EXE}" 0 un_not_locked
  Delete "$INSTDIR\${APP_EXE}"
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
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\Uninstall.exe"

  ; Forget the install location only if it is this one.
  ReadRegStr $R0 HKCU "${REG_KEY}" "InstallDir"
  ${If} $R0 == $INSTDIR
    DeleteRegKey HKCU "${REG_KEY}"
  ${EndIf}

  RMDir "$INSTDIR"    ; non-recursive: root stays because data\ is always kept

  ; ── Outcome report (interactive only) ───────────────────────────────────────
  IfSilent un_done
  MessageBox MB_ICONINFORMATION \
    "HUMS VXP Monitoring was removed.$\r$\n$\r$\nYour data was kept at:$\r$\n$INSTDIR\data"
  un_done:
SectionEnd
