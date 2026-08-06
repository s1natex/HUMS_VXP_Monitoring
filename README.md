# HUMS/VXP Monitoring

Desktop app for helicopter maintenance vibration monitoring (Brook Aviation, S-76C++ fleet).
Maintenance engineers import VXP report PDFs, review per-component vibration measurements
against engineering limits, sign off incidents, and track trends over time.

**Stack:** React 18 · Vite 5 · Electron 29 · Recharts · Python 3 (pdfplumber, openpyxl)

## Quick use

### Deployment of new updates
- Make Changes in ./app/
- Bump version + update CHANGELOG.md + update project_spec.md
- Commit -> Push to Github Repository
- Github Actions workflow handles compile release using version bump and CHANGELOG.md
  (the new version's CHANGELOG section becomes the GitHub release notes)
- User side app startup checks for updates and applies new release when available

### Run the app in development

```powershell
cd app\frontend
npm install        # first time only
npm run start      # Vite dev server + Electron
```

Data lives in `app\data\` in dev mode. PDF import and Excel export spawn Python —
install the dependencies once: `py -m pip install pdfplumber openpyxl`.

### Build the Windows installer

```powershell
powershell -ExecutionPolicy Bypass -File .\Package\build-package.ps1
```

Produces `Package\HUMS VXP Monitoring Install.exe` — the single deliverable for both fresh
installs and updates. The installer lets the user pick a location (default: Desktop folder),
creates the app + `data\` folder + `Uninstall.exe`, and never touches `data\` on update.
See [Package/Instructions.md](Package/Instructions.md) for the full release/install/update flow.

### Python backend (spawned by the app, also usable standalone)

```powershell
py app\source\import_vxp.py <report.pdf> --limits {}   # PDF → session JSON on stdout
py app\source\export_excel.py <payload.json> <out.xlsx>
```

`app\source\trend_detection.py` is the reference trend algorithm, mirrored in the Electron
main process and the renderer.

## Repository layout

| Path | What it is |
| --- | --- |
| `app/frontend/` | React renderer + Electron main process (`electron/main.cjs`) |
| `app/source/` | Python: VXP PDF parser, Excel export, trend detection |
| `app/data/` | Dev-mode data store (per-tail imports/reports + global registry) |
| `Package/` | Installer build pipeline and the produced installer exe |
| `Resources/` | Historical specs, design docs, assets, test data |

## Documentation

- [app/project_spec.md](app/project_spec.md) — living spec: architecture, data model, IPC surface, trend detection, packaging
- [app/CHANGELOG.md](app/CHANGELOG.md) — versioned change history
- [Package/Instructions.md](Package/Instructions.md) — installer build, install/update/uninstall, silent mode, auto-update plan
- [Resources/docs/Project_1_0_specs.md](Resources/docs/Project_1_0_specs.md) — full historical project spec
- [Resources/docs/pdf_to_excel_design.md](Resources/docs/pdf_to_excel_design.md) · [pdf_to_excel_specs.md](Resources/docs/pdf_to_excel_specs.md) · [pdf_to_excel_usage_workflow.md](Resources/docs/pdf_to_excel_usage_workflow.md) — PDF→Excel pipeline design docs
- [Resources/docs/fleet_comp_vib_concept.md](Resources/docs/fleet_comp_vib_concept.md) — fleet component-vibration concept
- [Resources/docs/Brook HUMS Manual - Rev 0 (April 2024).pdf](<Resources/docs/Brook HUMS Manual - Rev 0 (April 2024).pdf>) — HUMS manual
