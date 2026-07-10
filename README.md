# EZOffice

Desktop application for SME attendance, payroll, and inventory management, built with Electron, React, TypeScript, and SQLite.

## Alur Pembangunan & Release (CI/CD)

Projek ini dikonfigurasikan dengan alur kerja versioning dan pembungkusan automatik menggunakan GitHub Actions dan `electron-builder`.

### 1. Kitaran Versi (Versioning Cycle)

Versi aplikasi diuruskan secara manual menggunakan standard **Semantic Versioning (SemVer)** pada fail `package.json`. Gunakan arahan npm untuk menaikkan versi:

```bash
# Untuk tampalan pepijat (bug fixes) - cth. 0.1.0 -> 0.1.1
npm version patch

# Untuk penambahan ciri baharu (features) - cth. 0.1.1 -> 0.2.0
npm version minor

# Untuk perubahan besar/memecahkan keserasian (breaking changes) - cth. 0.2.0 -> 1.0.0
npm version major
```

Arahan di atas akan secara automatik:
1. Mengemas kini nilai `"version"` di dalam `package.json`.
2. Membuat satu Git commit untuk perubahan tersebut.
3. Mencipta satu Git tag berformat `vX.Y.Z` (contoh: `v0.1.1`).

### 2. Memicu Release Automatik (Trigger Release)

Untuk memicu CI/CD dan membina aplikasi untuk sistem pelanggan:
1. Pastikan semua fail kerja telah di-commit.
2. Lakukan version bump (menggunakan salah satu arahan `npm version` di atas).
3. Tolak (push) commit dan tag baharu tersebut ke pelayan GitHub:
   ```bash
   git push origin main --follow-tags
   ```

Tindakan ini akan memicu GitHub Actions untuk membina fail `.exe` pemasang (installer) dan fail metadata `latest.yml` untuk tujuan auto-update secara automatik.

Sila rujuk panduan terperinci di [Proses Release & CI/CD](docs/RELEASE.md).
