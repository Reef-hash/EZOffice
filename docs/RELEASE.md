# EZOffice — Proses Release & CI/CD

Panduan cara release `.exe` EZOffice — automatik melalui GitHub Actions. Untuk dev yang nak release versi baru atau sekadar nak update Latest Build.

---

## 1. Gambaran Keseluruhan

Setiap push ke `main` automatik trigger GitHub Actions yang:
1. Compile TypeScript + bundle Vite
2. Package `.exe` (NSIS installer + portable) guna `electron-builder`
3. Upload ke GitHub Release

Dua jenis release terhasil:

| Jenis | Tag | Bila | Di tab Releases |
|---|---|---|---|
| **Latest Build** | `latest` | Setiap push ke `main` | Pre-release (🟠) |
| **Versioned Release** | `vX.Y.Z` | Bila push tag version | Release stabil (✅) |

Workflow: `.github/workflows/release.yml` — `Build & Release`.

---

## 2. Cara Release Harian (Latest Build)

**Guna:** Nak bagi orang download `.exe` terkini tanpa version tag.

```bash
git add .
git commit -m "fix: some changes"
git push
```

Tunggu ~10 minit → pergi ke [Releases](https://github.com/Reef-hash/EZOffice/releases) → **"EZOffice — Latest Build"** akan auto-dikemaskini dengan `.exe` terbaru.

> ⚠️ Latest Build adalah **pre-release** — mungkin ada bug, fitur belum stabil. User disarankan guna release bertag untuk production.

---

## 3. Cara Release Versioned (Stabil)

**Guna:** Nak release versi stabil untuk production / edaran rasmi.

### 3.1 Bump version

```bash
# Cara 1: npm version (auto bump + commit + tag)
npm version patch -m "chore: bump version to %s"   # 0.1.0 → 0.1.1
npm version minor -m "chore: bump version to %s"   # 0.1.1 → 0.2.0
npm version major -m "chore: bump version to %s"   # 0.2.0 → 1.0.0

# Cara 2: Manual (edit package.json dulu)
git add package.json
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
```

### 3.2 Push + tag

```bash
git push --follow-tags
```

`--follow-tags` akan push commit + tag sekali gus → trigger versioned release automatik.

### 3.3 Verify

Buka [Releases](https://github.com/Reef-hash/EZOffice/releases) — release baru `v0.2.0` akan muncul dengan 2 fail `.exe`.

---

## 4. Trigger Manual (Workflow Dispatch)

Untuk test build tanpa push:

1. Buka [Actions → Build & Release](https://github.com/Reef-hash/EZOffice/actions/workflows/release.yml)
2. Klik **"Run workflow"**
3. Pilih branch `main`
4. Klik **"Run workflow"** hijau

Hasil: `.exe` di-upload sebagai **Artifacts** (7 hari retention), tiada release dicipta.

---

## 5. Struktur Release

Setiap release di tab Releases mengandungi:

| Fail | Kegunaan |
|---|---|
| `EZOffice Setup X.Y.Z.exe` | **Installer (NSIS)** — wizard install, pilih folder, auto desktop shortcut |
| `EZOffice X.Y.Z.exe` | **Portable** — standalone, tak perlu install, run terus |

Release notes auto-ditulis dalam **Bahasa Melayu**.

---

## 6. Workflow CI/CD Detail

### Trigger

| Event | `github.ref` | Tindakan |
|---|---|---|
| Push ke `main` | `refs/heads/main` | Force-push tag `latest` → update pre-release |
| Push tag `v*` | `refs/tags/vX.Y.Z` | Create versioned release |
| `workflow_dispatch` | — | Upload artifacts sahaja |

### Langkah

```
1. Checkout code (actions/checkout@v4)
2. Setup Node.js 22 (actions/setup-node@v4)
3. npm ci            ← compile better-sqlite3 native binding
4. npm run build     ← tsc -b + vite build
5. npx electron-builder --win --publish never   ← package .exe
6. List artifacts    ← tunjuk saiz fail
7. [main push]       ← git tag -f latest && git push -f origin latest
8. [main push]       ← softprops/action-gh-release@v2 (pre-release)
   [tag push]        ← softprops/action-gh-release@v2 (versioned release)
```

### Required runner

- **OS:** `windows-latest` (Windows Server 2025)
- **Tools:** Python + VS Build Tools (untuk `node-gyp` / `better-sqlite3`), sudah pre-installed

---

## 7. Troubleshooting

### Workflow gagal di `npm ci`

**Simptom:** `node-gyp rebuild` error pada `better-sqlite3`.

**Sebab:** Windows runner tak ada C++ build tools.

**Fix:**
```bash
# Jarang berlaku — windows-latest dah ada build tools.
# Jika berlaku, tambah step sebelum npm ci:
- name: Install build tools
  run: npm install -g node-gyp
```

### Workflow gagal di `electron-builder`

**Simptom:** `electron-builder` timeout atau error signing.

**Sebab:** Tiada (app kita guna `certificateFile: null` — unsigned). Biasanya isu ruang disk atau memory.

**Fix:** Tunggu & re-run. Jika berulang, periksa log di Actions tab.

### Workflow tak trigger lepas push

**Simptom:** Push ke main tapi workflow tak jalan.

**Sebab:**
1. Push bukan ke `main` (branch lain)
2. `.github/workflows/release.yml` tak wujud di branch yang di-push

**Fix:**
```bash
# Pastikan workflow ada di main
git checkout main
git pull
# Semak fail wujud
ls .github/workflows/release.yml
```

### Tag `latest` conflict

**Simptom:** Pre-release tak update, atau tag conflict.

**Sebab:** Git tag `latest` wujud di local tapi tak sama dengan remote.

**Fix:**
```bash
# Delete local tag, pull from remote
git tag -d latest
git fetch --tags
```

> Nota: Workflow guna `GITHUB_TOKEN` untuk force-push tag `latest`. Token ini **tidak** trigger recursive workflow (GitHub Actions security feature).

---

## 8. Checklist Release Versioned

Sebelum release versioned (`vX.Y.Z`):

- [ ] Semua feature/fix dah committed & pushed
- [ ] Semua test passed (`npm run typecheck`)
- [ ] Tiada `any` atau empty catch block (CLAUDE.md §3)
- [ ] Decision Log di `CLAUDE.md` dikemaskini
- [ ] `docs/` dikemaskini jika ada flow baru
- [ ] `git status` clean — tiada uncommitted changes
- [ ] Bump version di `package.json`
- [ ] `git tag vX.Y.Z`
- [ ] `git push --follow-tags`
- [ ] Verify di [Actions tab](https://github.com/Reef-hash/EZOffice/actions)
- [ ] Verify di [Releases tab](https://github.com/Reef-hash/EZOffice/releases) — `.exe` boleh muat turun

---

## 9. Untuk User Yang Nak Install

Arahkan user (admin SME) ke:

> Pegi https://github.com/Reef-hash/EZOffice/releases  
> Muat turun `EZOffice Setup X.Y.Z.exe` (yang paling atas)  
> Run → pilih folder → OK  
> Database disimpan di `%APPDATA%\EZOffice\data\` — tak akan hilang bila uninstall

Untuk arahan lebih detail, rujuk [`docs/DISTRIBUTION.md`](./DISTRIBUTION.md).
