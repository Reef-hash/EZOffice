# EZOffice — Proses Release & CI/CD

Panduan cara release `.exe` EZOffice — automatik melalui GitHub Actions.

---

## 1. Gambaran Keseluruhan

Setiap kali Git tag baru yang berformat versi (cth: `v1.2.3`) di-push ke GitHub, ia akan men-trigger GitHub Actions yang:
1. Melakukan pemeriksaan kod (Typecheck TypeScript)
2. Membina fail pendua (Vite build & Electron main compilation)
3. Membungkus fail `.exe` (NSIS installer + portable) menggunakan `electron-builder`
4. Memuat naik fail `.exe` DAN fail metadata auto-update (`latest.yml`) ke GitHub Releases secara automatik

---

## 2. Cara Membuat Release (Versioned Release)

Langkah-langkah untuk membuat pelepasan versi baharu aplikasi untuk production:

### 2.1 Lakukan Version Bump
Gunakan arahan npm standard untuk menaikkan versi. Arahan ini akan secara automatik mengemas kini `package.json`, mencipta git commit bagi perubahan versi, dan mencipta tag git (cth: `v0.1.1`):

```bash
# Untuk tampalan pepijat (bug fixes) - cth. 0.1.0 -> 0.1.1
npm version patch

# Untuk penambahan ciri baharu (features) - cth. 0.1.1 -> 0.2.0
npm version minor

# Untuk perubahan besar/memecahkan keserasian (breaking changes) - cth. 0.2.0 -> 1.0.0
npm version major
```

### 2.2 Tolak (Push) ke GitHub berserta Tag
Tolak (push) commit dan tag baharu tersebut ke pelayan:

```bash
git push origin main --follow-tags
```

> 💡 Flag `--follow-tags` sangat penting untuk memastikan tag yang baru dicipta turut dihantar ke GitHub bagi memicu CI/CD.

### 2.3 Sahkan Hasil Release
1. Pergi ke tab **Actions** di repo GitHub anda untuk memantau proses build.
2. Setelah selesai, semak tab **Releases**. Release baharu mengikut nama tag akan dicipta secara automatik berserta fail-fail berikut:
   - `EZOffice Setup X.Y.Z.exe` (Installer)
   - `EZOffice X.Y.Z.exe` (Portable)
   - `latest.yml` (Fail metadata untuk Auto-Update)

---

## 3. Struktur Fail Release

Setiap release di tab Releases mengandungi:

| Fail | Kegunaan |
|---|---|
| `EZOffice Setup X.Y.Z.exe` | **Installer (NSIS)** — wizard install, pilih folder, auto desktop + Start Menu shortcut |
| `EZOffice X.Y.Z.exe` | **Portable** — standalone, tak perlu install, run terus |
| `latest.yml` | **Metadata Versi** — dibaca oleh auto-updater aplikasi pelanggan untuk semakan kemas kini |

---

## 4. Alur Kerja Perincian CI/CD (Workflow)

### Trigger

| Event | `github.ref` | Tindakan |
|---|---|---|
| Push tag `v*` | `refs/tags/v*` | Memulakan build & release automatik menggunakan `electron-builder` |

### Langkah-langkah Pipeline

```
1. Checkout code (actions/checkout@v4)
2. Setup Node.js 22 (actions/setup-node@v4)
3. npm ci            ← Memasang dependensi & kompilasi better-sqlite3 native binding
4. npm run typecheck ← Memastikan tiada error TypeScript (tsc -b --noEmit)
5. npx electron-builder --win --publish always ← Membina fail .exe & muat naik ke GitHub
```

### Keperluan Runner (Runner Environment)

- **OS:** `windows-latest`
- **Tools:** Python + VS Build Tools (untuk `node-gyp` / `better-sqlite3`), telah tersedia secara lalai (pre-installed).

---

## 5. Troubleshooting

### Pipeline gagal pada `npm run typecheck`
Sila betulkan semua ralat TypeScript dalam kod anda sebelum menolak tag. Pembungkusan aplikasi tidak akan dijalankan sekiranya terdapat ralat typecheck bagi mengelakkan pengedaran aplikasi yang rosak.

### Ralat Keizinan (Permission Denied) pada GitHub Actions
Pastikan `GITHUB_TOKEN` mempunyai keizinan menulis (`contents: write`) dalam repository settings atau diisytiharkan dalam fail `.github/workflows/release.yml`.

---

## 6. Pemasangan untuk Pengguna Akhir

Arahkan pengguna akhir (admin PKS) ke:

> Pergi ke https://github.com/ferlin070/EZOffice/releases  
> Muat turun `EZOffice Setup X.Y.Z.exe` (yang terbaharu)  
> Jalankan fail pemasang (installer) tersebut.  
> 💡 **Nota Penting:** Fail pangkalan data disimpan secara selamat di folder `%APPDATA%\EZOffice\data\` dan tidak akan dipadam/hilang walaupun aplikasi dinyahpasang (uninstall) atau dikemas kini.
