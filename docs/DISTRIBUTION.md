# EZOffice Distribution & Packaging (Phase 6)

## Status

✅ **Configuration:** electron-builder is configured for Windows NSIS installer + portable build  
⚠️ **Build Issue:** Windows symlink permission error during download phase (environment-specific, not code issue)  
✅ **Workaround:** Available below

## Build Instructions

### Prerequisites
- Node.js 18+ installed
- npm dependencies: `npm install`
- Build artifacts: `npm run build` (creates `dist/` and `dist-electron/` directories)

### Option 1: Use Workaround (Admin PowerShell)

Run in **Administrator** PowerShell to allow symlink creation:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run build:installer
# or for portable version only:
npm run build:portable
```

This generates:
- `dist/EZOffice-0.1.0.exe` — NSIS installer (recommended for end-users)
- `dist/EZOffice-0.1.0.exe` — Portable version (no installation, runs from USB/network)

### Option 2: Skip electron-builder, Use Pre-built Artifacts

For development/testing, skip the installer and distribute as a zip:

```bash
npm run build
# Then manually zip the following for end-users:
#   dist/
#   dist-electron/
#   node_modules/
#   data/ (empty directory for SQLite DB)
```

Users extract the zip and run `dist-electron/main.js` via Electron.

### Option 3: Future — CI/CD (GitHub Actions)

When ready for automated builds, use GitHub Actions on Linux (no symlink issues):

```yaml
name: Build
on: [push]
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install && npm run build:installer
      - uses: actions/upload-artifact@v3
        with:
          name: installers
          path: dist/
```

---

## Installation Flow (End-User)

### First-Time Setup (IT/Admin)

1. **Download:** Get `EZOffice-0.1.0.exe` from release
2. **Install:** Run the installer, choose installation directory
   - Default: `C:\Program Files\EZOffice\`
   - Desktop shortcut created automatically
   - Start menu entry created
3. **First Launch:**
   - App opens, initializes SQLite database at `%APPDATA%\EZOffice\data\ezoffice.db`
   - Master Data page loads (empty)
   - Proceed to setup employees, customers, products

### Data Persistence

- **Database location:** `C:\Users\[USERNAME]\AppData\Roaming\EZOffice\data\`
- **Portable version:** Database stored relative to exe location
- **Backup:** Copy the entire `AppData\Roaming\EZOffice\` folder to USB/cloud

### Uninstall

- Control Panel → Programs → Uninstall `EZOffice`
- Or: Windows Settings → Apps → Apps & features → EZOffice → Uninstall
- **Note:** Uninstall does NOT delete the database (data in `%APPDATA%\EZOffice\` persists)

---

## Version Management

Current version: **0.1.0** (in `package.json`)

To update version for a new release:

```json
{
  "version": "0.1.1"  // or "0.2.0", "1.0.0", etc.
}
```

Then rebuild: `npm run build:installer`

This updates the installer filename and Windows "Add/Remove Programs" version string.

---

## Current Configuration

### electron-builder (package.json)

```json
{
  "build": {
    "appId": "com.ezoffice.app",
    "productName": "EZOffice",
    "win": {
      "target": ["nsis", "portable"],
      "certificateFile": null
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
}
```

**Key decisions locked (CLAUDE.md Phase 6):**
- ✅ Windows-only (not Mac/Linux)
- ✅ NSIS installer (standard Windows .exe with wizard)
- ✅ Portable EXE (optional, for USB/network deployments)
- ✅ No code signing (add later if legal/security requires)
- ✅ Database in `%APPDATA%` (survives uninstall, per SME requirement)
- ✅ App data at: `C:\Users\[USERNAME]\AppData\Roaming\EZOffice\`

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "EZOffice has stopped working" on launch | Missing `better-sqlite3` native bindings | Reinstall: `npm install --no-save better-sqlite3@latest` |
| Database not persisting after close | App crashed; permissions issue | Check `%APPDATA%\EZOffice\data\` folder exists + writable |
| Installer won't run | Code signing certificate invalid | Not signed; expected for dev builds. Use portable version instead |
| Port 4370 already in use (device sync fails) | Another ZKTeco device app running | Close other apps, or change V1000 port in Device Settings |

---

## Next Steps (Future Phases)

- **Auto-update:** Add update server (Phase 6 enhancement)
- **Code signing:** Obtain Windows certificate ($100/year from DigiCert/Sectigo)
- **macOS/Linux builds:** Build on mac-latest, linux-latest runners
- **Crash reporting:** Integrate Sentry or Rollbar
- **Telemetry:** Add opt-in analytics (anonymized, SME-focused)

---

## For IT Deployment (Multi-User)

**Domain / Group Policy deployment:**
1. Store `EZOffice-0.1.0.exe` on company file share
2. Deploy via SCCM or Intune: `msiexec /i \\share\EZOffice.exe /passive`
3. Each user gets own database in their `%APPDATA%`

**Or:** Silent install script:
```batch
EZOffice-0.1.0.exe /S /D=C:\Program Files\EZOffice
```

---

**Last updated:** 2026-06-29  
**Phase:** 6 (Packaging)
