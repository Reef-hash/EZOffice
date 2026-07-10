# Front-End Improvement Plan â€” EZOffice

Dokumen ini adalah pelan kerja serahan kepada **front-end developer**. Ia mengandungi semua
penambahbaikan UI/UX yang dikenal pasti selepas audit menyeluruh terhadap front-end codebase,
disusun mengikut fasa dengan kebergantungan, fail terlibat, dan kriteria penerimaan.

> **Baca bahagian "Sempadan Kerja" (Section 2) dahulu sebelum mula.** Ia menentukan apa yang
> anda boleh ubah dan apa yang **dilarang sama sekali** disentuh. Sebarang pelanggaran sempadan
> akan menjejaskan business logic yang dimiliki oleh pasukan back-end.

---

## 1. Konteks & Prasyarat

**Stack:** Electron 42 + React 19 + TypeScript (strict) + Vite 8 + Tailwind v4 (CSS-first
`@theme` config di `src/index.css`, **tiada** `tailwind.config.ts`) + `@tanstack/react-query`.

**Design system:** Sumber kebenaran ialah `docs/DESIGN_SYSTEM.md`. Token implementasi di
`src/index.css` (`@theme` block). **Jangan tulis hex value mentah dalam komponen** â€” gunakan
utility class yang dijana dari token (cth. `bg-primary-600`, bukan `bg-[#6d5df6]`).

**Cara jalankan dev:**
```bash
npm install
npm run electron:dev   # launcher Electron + Vite dev server
```
> Nota persekitaran: jika `ELECTRON_RUN_AS_NODE` diset, unset untuk satu proses launch tersebut
> (ia akan block Electron GUI). Tanya pasukan back-end sebelum ubah.

**Typecheck sebelum commit:**
```bash
npx tsc -p tsconfig.app.json --noEmit   # renderer
npx tsc -p tsconfig.node.json --noEmit  # electron (jangan ubah fail electron/, tapi pastikan
                                        # perubahan renderer tak break typecheck node)
```
Kedua-dua mesti lulus dengan **0 error**. Strict mode aktif â€” tiada `any` baru dibenarkan.

**Konvensyen commit:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `style:`).
Satu perubahan logik per commit. Contoh: `feat(frontend): add ConfirmDialog component`.

---

## 2. Sempadan Kerja â€” WAJIB BACA

### Dibenarkan (front-end dev milik sepenuhnya)

| Path | Kebenaran |
|------|-----------|
| `src/shared/components/**` | Cipta, ubah, tambah komponen baru. Ini domain anda. |
| `src/index.css` | Edit `@theme` block, tambah dark mode tokens, base styles. |
| `src/App.tsx` | Boleh ubah **wrapper/routing/layout** sahaja (ErrorBoundary, dark class, providers). **Jangan ubah** auth state logic, IPC calls, atau business handlers. |
| `src/shared/hooks/**` | Boleh tambah hook UI-only (cth. `useFocusTrap`, `useKeyboardShortcut`). **Jangan ubah** `useIpcQuery.ts` contract. |
| `src/modules/**/*.tsx` | Boleh ubah **JSX, styling, className, presentation logic** (modal open/close state, tab state, confirm dialog trigger, toast trigger). |
| `src/modules/**/constants.ts` | Boleh ubah peta tone/label untuk display. |
| `docs/DESIGN_SYSTEM.md` | Boleh kemas kini jika token baru ditambah (jaga supaya selari dengan `src/index.css`). |

### Dilarang sama sekali (business logic â€” milik pasukan back-end)

| Path / Konsep | Sebab |
|---------------|-------|
| `electron/**` (semua) | Main process, IPC handlers, services, DB, migrations. Domain back-end. |
| `src/shared/types/**` | Kontrak antara preload <-> renderer. Jangan ubah interface/Zod schema. Jika perlu type baru untuk UI sahaja, cipta di dalam komponen/hook anda. |
| Badan fungsi mutation/handler | Anda boleh ubah **bagaimana handler dicetuskan** (cth. ganti `confirm()` dengan dialog) dan **feedback selepas** (toast), tetapi **JANGAN ubah**: argumen yang dihantar ke `window.api.*`, mutation yang dipanggil, susunan state reset yang bermakna business, atau logic validasi. |
| Validation logic (Zod) | Skema input di `src/shared/types/inputs.ts` â€” jangan sentuh. |
| Calculation logic | Payroll engine, attendance summary aggregation, statutory rates â€” jangan sentuh. |
| `electron-builder.yml`, `vite.config.ts`, `package.json` (deps/build) | Tanya pasukan back-end sebelum tambah dependency baru. |
| `CLAUDE.md`, `ARCHITECTURE.md` | Dokumen seni bina â€” jangan ubah. |

### Kawasan Kelabu â€” Dapatkan Kelulusan Dahulu

- **Menambah dependency npm baru** â€” wajib tanya back-end. CLAUDE.md Section 6 melarang
  dependency untuk fungsi 10-baris. Jika library diperlukan (cth. `focus-trap-react`),
  bincang dahulu.
- **Mengubah `preload.ts` API surface** â€” jangan. Jika perlu channel IPC baru untuk UI, minta
  back-end tambah.
- **Mengubah skema warna utama** (Indigo -> lain) â€” dilarang. Design direction locked
  (lihat `docs/DESIGN_SYSTEM.md` + Decision Log CLAUDE.md 2026-06-25).

---

## 3. Pengenalan Fasa

| Fasa | Tajuk | Kebergantungan | Effort | Impact |
|------|-------|----------------|--------|--------|
| FE-1 | Foundation & Cleanup | Tiada | Rendah | Tinggi |
| FE-2 | Shared Component Hardening | Tiada | Sederhana | Tinggi |
| FE-3 | UX Feedback & States | FE-1.1, FE-2.1 | Sederhana | Tinggi |
| FE-4 | Dark Mode | FE-1.3 (ringan) | Tinggi | Tinggi |
| FE-5 | Motion & Polish | Tiada (boleh parallel) | Rendah | Sederhana |
| FE-6 | Advanced UX (optional) | FE-4 | Sederhana | Rendah |

**Susunan disyorkan:** FE-1 -> FE-2 -> FE-3 -> FE-4 -> FE-5 -> FE-6. FE-5 boleh dijalankan
selari dengan FE-3/FE-4 kerana ia tidak bergantung pada mereka.

---

## 4. Phase FE-1 â€” Foundation & Cleanup

### FE-1.1 â€” Satukan Sistem Toast (Buang Duplikasi)

**Masalah:** Ada dua fail Toast yang bercanggah:
- `src/shared/components/Toast/Toast.tsx` â€” **aktif** (dipakai app via `index.ts`), gunakan
  kelas `animate-in fade-in slide-in-from-right` dari plugin `tailwindcss-animate` yang **tidak
  dipasang** -> animasi broken.
- `src/shared/components/Toast/ToastProvider.tsx` â€” **dead code**, versi lebih baik
  (`rounded-xl`, `border-l-4`, `pointer-events-none` container) tetapi tidak dipanggil.

`Toast/index.ts` mengeksport dari `./Toast` (versi lama). `AppShell.tsx` import `'./Toast'`
(folder) -> `index.ts` -> `Toast.tsx` lama.

**Tugas:**
1. Pilih versi `ToastProvider.tsx` sebagai asas (lebih baik struktur & styling).
2. Buang `Toast.tsx` (versi lama).
3. Namakan semula `ToastProvider.tsx` -> `Toast.tsx`.
4. Kemas kini `Toast/index.ts` untuk mengeksport dari `./Toast` (kini fail baru).
5. Tambah jenis `warning` kepada versi baru (versi lama ada `warning`, versi baru hanya
   `success`/`error`/`info`).
6. Pastikan signature `useToast()` kekal: `addToast(message: string, tone?: ToastType)`.
   **Jangan ubah API** â€” 6 fail import `useToast` dari `'@/shared/components/Toast'`.

**Fail terlibat:**
- `src/shared/components/Toast/Toast.tsx` (ganti kandungan)
- `src/shared/components/Toast/ToastProvider.tsx` (buang)
- `src/shared/components/Toast/index.ts` (kemas kini export + type)

**Kriteria penerimaan:**
- [ ] Satu fail Toast sahaja kekal
- [ ] `useToast()` API tidak berubah
- [ ] Jenis `success`/`error`/`info`/`warning` semua berfungsi
- [ ] Toast muncul di top-right, auto-dismiss 4.5s, boleh dismiss manual
- [ ] Container `pointer-events-none`, toast individu `pointer-events-auto`
- [ ] Typecheck lulus
- [ ] App boot tanpa error, toast muncul bila `SettingsPage` save

### FE-1.2 â€” Tambah Global Error Boundary

**Masalah:** Tiada React Error Boundary di root. Jika komponen throw, seluruh app white-screen
tanpa maklumat berguna.

**Tugas:**
1. Cipta `src/shared/components/ErrorBoundary/ErrorBoundary.tsx` â€” class component
   (Error Boundary mesti class, React limitation) dengan fallback UI:
  - Icon error (SVG inline, jangan tambah dependency icon library)
  - Mesej "Something went wrong"
  - Butang "Reload" (`window.location.reload()`)
  - Butang "Copy error" (copy `error.message` + `componentStack` ke clipboard)
2. Eksport dari `src/shared/components/ErrorBoundary/index.ts` dan
   `src/shared/components/index.ts`.
3. Bungkus root tree di `src/App.tsx` dengan `<ErrorBoundary>` â€” **di luar** semua provider
   (QueryClientProvider, HashRouter). Letakkan di paling luar.
4. Fallback mesti guna design system tokens (`bg-background`, `text-neutral-900`, `Button`).

**Fail terlibat:**
- `src/shared/components/ErrorBoundary/ErrorBoundary.tsx` (baru)
- `src/shared/components/ErrorBoundary/index.ts` (baru)
- `src/shared/components/index.ts` (tambah export)
- `src/App.tsx` (tambah wrapper sahaja â€” jangan ubah auth/routing logic)

**Kriteria penerimaan:**
- [ ] Throw di mana-mana komponen -> fallback UI muncul, bukan blank screen
- [ ] Butang "Reload" berfungsi
- [ ] Butang "Copy error" menyalin stack ke clipboard
- [ ] Fallback guna design tokens, bukan hex mentah
- [ ] Typecheck lulus

### FE-1.3 â€” Betulkan Inconsistent Radius

**Masalah:** Design system: `radius-sm=8px`, `radius-md=12px`, `radius-lg=16px`,
`radius-xl=20px`. Terdapat ketidakkonsistenan:

| Lokasi | Sekarang | Patutnya | Sebab |
|--------|----------|----------|-------|
| `src/modules/auth/LoginPage.tsx:97` card | `rounded-lg` (16px) | `rounded-xl` (20px) | Semua card utama guna xl |
| `src/shared/components/SettingsPage.tsx:173` raw input | `rounded-lg` (16px) | `rounded-md` (12px) | Match `Input` component (`rounded-md`) |

**Tugas:** Tukar dua lokasi di atas. Jangan ubah yang lain â€” error message `rounded-sm` (8px)
adalah sengaja (lebih kecil dari card), itu betul.

**Fail terlibat:** `LoginPage.tsx`, `SettingsPage.tsx`

**Kriteria penerimaan:**
- [ ] Login card guna `rounded-xl`
- [ ] SettingsPage raw input guna `rounded-md`
- [ ] Tiada perubahan visual yang mengejutkan pada komponen lain

---

## 5. Phase FE-2 â€” Shared Component Hardening

### FE-2.1 â€” Bina Komponen `ConfirmDialog` (Reusable)

**Masalah:** 8 lokasi guna `confirm()` native (lihat FE-3.2 untuk senarai penuh). Native dialog
Electron nampak janggal dan tak konsisten dengan design system.

**Tugas:**
1. Cipta `src/shared/components/ConfirmDialog/ConfirmDialog.tsx` â€” bina atas `Modal` sedia ada.
   Props:
   ```ts
   interface ConfirmDialogProps {
     isOpen: boolean
     title: string
     message: ReactNode
     confirmLabel?: string      // default "Confirm"
     cancelLabel?: string       // default "Cancel"
     tone?: 'danger' | 'primary' // danger -> butang confirm guna variant danger
     onConfirm: () => void
     onCancel: () => void
   }
   ```
2. Guna `Modal` dengan `size="sm"`, `footer` berisi butang Cancel (secondary) + Confirm
   (danger/primary ikut `tone`).
3. Eksport dari `index.ts` masing-masing dan `src/shared/components/index.ts`.
4. **Jangan wire ke mana-mana page lagi** â€” itu kerja FE-3.2.

**Fail terlibat:**
- `src/shared/components/ConfirmDialog/ConfirmDialog.tsx` (baru)
- `src/shared/components/ConfirmDialog/index.ts` (baru)
- `src/shared/components/index.ts` (tambah export)

**Kriteria penerimaan:**
- [ ] Komponen render dengan Modal sedia ada (Esc + backdrop close berfungsi)
- [ ] `tone="danger"` -> butang confirm guna `variant="danger"`
- [ ] `tone="primary"` -> butang confirm guna `variant="primary"`
- [ ] Label boleh di-override
- [ ] Typecheck lulus

### FE-2.2 â€” Modal: Focus Trap + Focus Restoration

**Masalah:** `src/shared/components/Modal/Modal.tsx` ada `aria-modal`, `aria-labelledby`, Esc
close, backdrop close â€” tetapi:
- **Tiada focus trap** â€” Tab boleh lompat ke elemen di belakang modal.
- **Tiada focus restoration** â€” bila modal tutup, focus tak kembali ke elemen pencetus.
- Tiada fokus auto ke modal body semasa buka.

**Tugas:**
1. Bila modal buka: simpan `document.activeElement` (elemen pencetus), fokus ke modal container
   atau elemen boleh-fokus pertama di dalam modal.
2. Trap Tab/Shift+Tab dalam modal â€” bila Tab di hujung, pusing ke mula; bila Shift+Tab di mula,
   pusing ke hujung.
3. Bila modal tutup: restore fokus ke elemen pencetus yang disimpan tadi.
4. Implementasi manual dibenarkan (QuerySelector `button, [href], input, select, textarea,
   [tabindex]:not([tabindex="-1"])`). **Jangan tambah dependency** tanpa kelulusan â€” jika
   `focus-trap-react` diperlukan, bincang dengan back-end dahulu (lihat Section 2 kawasan
   kelabu).
5. Boleh ekstrak logic ke hook `src/shared/hooks/useFocusTrap.ts` untuk reusability.

**Fail terlibat:**
- `src/shared/components/Modal/Modal.tsx` (ubah)
- `src/shared/hooks/useFocusTrap.ts` (baru, jika ekstrak ke hook)

**Kriteria penerimaan:**
- [ ] Buka modal -> fokus auto ke dalam modal
- [ ] Tab/Shift+Tab kekal dalam modal (tak lompat ke background)
- [ ] Tutup modal (Esc/backdrop/button) -> fokus kembali ke elemen pencetus
- [ ] Test dengan EmployeeForm, AttendanceLogForm â€” semua berfungsi
- [ ] Typecheck lulus

### FE-2.3 â€” Table: Tambah `aria-sort`

**Masalah:** `src/shared/components/Table/Table.tsx` ada sortable columns tetapi `<th>` tiada
atribut `aria-sort`. Screen reader tak tahu column mana sedang di-sort.

**Tugas:**
1. Pada setiap `<th>` yang sortable, tambah `aria-sort`:
  - `'none'` jika bukan column aktif
  - `'ascending'` jika `sortKey === column.key && sortDirection === 'asc'`
  - `'descending'` jika `sortKey === column.key && sortDirection === 'desc'`
2. Column tidak sortable -> `aria-sort` tidak perlu (atau omit sepenuhnya).
3. Tambah `role="button"` dan `tabIndex={0}` pada button sort sedia ada jika belum ada
   (button sudah ada, semak sahaja).

**Fail terlibat:** `src/shared/components/Table/Table.tsx`

**Kriteria penerimaan:**
- [ ] Inspect `<th>` sortable -> ada `aria-sort` dengan nilai betul
- [ ] Klik sort -> `aria-sort` berubah (asc/desc/none)
- [ ] Typecheck lulus

### FE-2.4 â€” Ganti Komponen Mentah dengan Shared Components

**Masalah:** Dua lokasi bypass shared components:

1. `src/modules/audit/AuditLogPage.tsx:42` â€” bina badge manual dengan template literal colors
   (`${...}`). Patut guna `StatusBadge`.
2. `src/shared/components/SettingsPage.tsx:173` â€” raw `<input>` dengan styling hardcoded,
   bypass `Input` component. File upload juga raw.

**Tugas:**
1. **AuditLogPage:** Tentukan mapping action -> `BadgeTone` (cth. `create`/`update`/`delete` ->
   `info`/`warning`/`error`, `login`/`logout` -> `neutral`). Ganti badge manual dengan
   `<StatusBadge tone={...}>{label}</StatusBadge>`. Boleh tambah peta di
   `src/modules/audit/constants.ts` (baru) mengikut pola `src/modules/attendance/constants.ts`.
2. **SettingsPage:** Ganti raw `<input>` text/email/phone dengan `<Input>` component. Untuk
   file upload (logo), bina `src/shared/components/Input/FileInput.tsx` baru (atau tambah
   variant ke `Input` â€” pilih yang lebih bersih). File input native styling tricky â€” guna
   `file:` modifier Tailwind yang sedia ada sebagai asas, bungkus dalam `Field`.

**Fail terlibat:**
- `src/modules/audit/AuditLogPage.tsx`
- `src/modules/audit/constants.ts` (baru)
- `src/shared/components/SettingsPage.tsx`
- `src/shared/components/Input/FileInput.tsx` (baru, jika pilih komponen berasingan)
- `src/shared/components/Input/index.ts` (tambah export jika perlu)

**Kriteria penerimaan:**
- [ ] AuditLogPage badge guna `StatusBadge`, tiada template literal color
- [ ] SettingsPage text inputs guna `Input` component
- [ ] File upload berfungsi (upload, preview, validate 2MB)
- [ ] Tiada regression visual
- [ ] Typecheck lulus

---

## 6. Phase FE-3 â€” UX Feedback & States

> **Bergantung pada:** FE-1.1 (Toast disatukan), FE-2.1 (ConfirmDialog wujud).

### FE-3.1 â€” Wire Success Toast pada Semua CRUD

**Masalah:** `useIpcMutation` di `src/shared/hooks/useIpcQuery.ts` ada option
`onSuccessMessage` tetapi majoriti page tidak gunakannya. Create/update/delete untuk
employee/customer/supplier/product â€” **tiada success toast**. User tiada feedback visual bila
operasi berjaya.

**Tugas:**
1. Pada setiap `useIpcMutation` call di page-page CRUD, tambah option:
   ```ts
   {
     onSuccessMessage: 'Employee created successfully', // atau sesuai
   }
   ```
2. **Penting:** `useIpcMutation` perlu diubah untuk **membaca** `onSuccessMessage` dan trigger
   toast. Semak implementasi semasa â€” jika ia hanya terima option tetapi tak gunakan, tambah
   logic di hook tersebut untuk panggil `useToast().addToast(message, 'success')` dalam
   `onSuccess`. Ini adalah **presentation concern** (feedback selepas operasi), bukan business
   logic â€” dibenarkan.
3. Mesej harus spesifik: "Employee created", "Customer updated", "Product deleted" â€” bukan
   generik "Success".

**Fail terlibat (senarai CRUD pages):**
- `src/modules/master-data/employees/EmployeeListPage.tsx`
- `src/modules/master-data/customers/CustomerListPage.tsx`
- `src/modules/master-data/suppliers/SupplierListPage.tsx`
- `src/modules/master-data/products/ProductListPage.tsx`
- `src/modules/attendance/AttendanceListPage.tsx` (+ sub-panels: ShiftManagementPanel,
  LeaveApprovalPanel)
- `src/modules/payroll/salaryStructures/SalaryStructureListPage.tsx`
- `src/modules/payroll/salaryAdvances/SalaryAdvanceListPage.tsx`
- `src/modules/payroll/rateTables/*` (jika ada mutation)
- `src/shared/hooks/useIpcQuery.ts` (tambah toast trigger â€” presentation sahaja)

**Kriteria penerimaan:**
- [ ] Setiap create/update/delete berjaya -> toast success muncul
- [ ] Mesej spesifik per entiti
- [ ] Toast hilang auto selepas 4.5s
- [ ] **Business logic mutation tak berubah** (argumen, endpoint, state reset kekal sama)

### FE-3.2 â€” Ganti Semua `confirm()` dengan `ConfirmDialog`

**Masalah:** 8 lokasi guna `confirm()` native. Senarai penuh:

| Fail | Baris | Mesej |
|------|-------|-------|
| `EmployeeListPage.tsx` | 96 | `Delete employee "${name}"?` |
| `CustomerListPage.tsx` | 57 | `Delete customer "${name}"?` |
| `SupplierListPage.tsx` | 71 | `Delete supplier "${name}"?` |
| `ProductListPage.tsx` | 64 | `Delete product "${name}"?` |
| `AttendanceListPage.tsx` | 222 | `Delete this attendance log?` |
| `ShiftManagementPanel.tsx` | 72 | `Delete shift "${name}"?` |
| `SalaryAdvanceListPage.tsx` | 91 | `Delete this salary advance?` |
| `SalaryStructureListPage.tsx` | 95 | `Delete this salary structure?` |

**Tugas:**
1. Tambah state `confirmDialog` di setiap page: `{ isOpen, message, onConfirm }`.
2. Ganti `if (!confirm(...)) return` dengan buka dialog. Bila user confirm -> panggil handler
   sebenar (mutation). Bila cancel -> tutup dialog, **jangan** panggil mutation.
3. **CRITICAL:** Yang berubah hanyalah **mekanisme pengesahan** (native dialog -> custom
   dialog). Yang **tidak berubah**: argumen mutation, mutation yang dipanggil, susunan
   `setIsFormOpen`/`setEditingX` selepas delete. Lihat contoh pola di bawah.

**Pola yang dibenarkan (presentation wrapper sahaja):**
```tsx
// SEBELUM (business logic + native confirm bercampur)
const handleDelete = useCallback(async () => {
  if (!editingEmployee) return
  if (!confirm(`Delete employee "${editingEmployee.name}"?`)) return  // <- ganti ini
  await deleteMutation.mutateAsync(editingEmployee.id)                // <- kekal sama
  setIsFormOpen(false)                                                // <- kekal sama
  setEditingEmployee(null)                                            // <- kekal sama
}, [editingEmployee, deleteMutation])

// SELEPAS (confirm dipisah ke dialog, business logic kekal exact)
const [confirmState, setConfirmState] = useState<{
  open: boolean
  message: string
  onConfirm: () => void
} | null>(null)

const handleDelete = useCallback(() => {
  if (!editingEmployee) return
  setConfirmState({
    open: true,
    message: `Delete employee "${editingEmployee.name}"? This cannot be undone.`,
    onConfirm: async () => {
      await deleteMutation.mutateAsync(editingEmployee.id)  // <- KEKAL SAMA
      setIsFormOpen(false)                                  // <- KEKAL SAMA
      setEditingEmployee(null)                              // <- KEKAL SAMA
      setConfirmState(null)
    },
  })
}, [editingEmployee, deleteMutation])

// Di JSX:
<ConfirmDialog
  isOpen={confirmState?.open ?? false}
  title="Confirm Delete"
  message={confirmState?.message ?? ''}
  tone="danger"
  confirmLabel="Delete"
  onConfirm={confirmState?.onConfirm ?? (() => {})}
  onCancel={() => setConfirmState(null)}
/>
```

**Fail terlibat:** 8 fail di atas + `ConfirmDialog` dari FE-2.1.

**Kriteria penerimaan:**
- [ ] Tiada `confirm(` kekal dalam codebase renderer (semak dengan grep)
- [ ] Dialog muncul dengan mesej betul, tone `danger`
- [ ] Confirm -> delete berlaku (mutation dipanggil dengan argumen sama)
- [ ] Cancel -> tiada delete, dialog tutup
- [ ] **Mutation calls, argumen, state reset selepas delete â€” KEKAL EXACT SAMA** (diff review
      akan fokus pada ini)

### FE-3.3 â€” Ganti `alert()` dengan Toast

**Masalah:** 2 lokasi guna `alert()`:
- `EmployeeListPage.tsx:89` â€” `alert(`Export failed: ${err}`)`
- `AttendanceListPage.tsx:234` â€” `alert(`Export failed: ${err}`)`

**Tugas:** Ganti dengan `addToast(`Export failed: ${String(err)}`, 'error')`. Pastikan page
import `useToast`. Ini adalah feedback error presentation â€” dibenarkan.

**Fail terlibat:** 2 fail di atas.

**Kriteria penerimaan:**
- [ ] Tiada `alert(` kekal dalam renderer
- [ ] Export gagal -> toast error muncul

### FE-3.4 â€” Enhanced Empty States (Illustration)

**Masalah:** `Table` empty state hanya text (title + description). Nampak kosong dan kurang
polished.

**Tugas:**
1. Tambah prop `emptyState.icon?` (ReactNode) ke `Table` â€” SVG inline ringkas (folder kosong,
   dokumen, dll). Jangan tambah icon library â€” cipta 2-3 SVG inline reusable di
   `src/shared/components/icons/` (cth. `EmptyBoxIcon`, `NoResultsIcon`).
2. Layout: icon (neutral-300, `size-12`) di atas, title (`text-neutral-700 font-medium`),
   description (`text-neutral-500`), action (jika ada).
3. Setiap page CRUD pass icon yang sesuai + action butang "Add X" bila senarai kosong.

**Fail terlibat:**
- `src/shared/components/Table/Table.tsx`
- `src/shared/components/icons/` (baru, folder)
- Semua page CRUD (pass icon + action ke `emptyState`)

**Kriteria penerimaan:**
- [ ] Table kosong -> icon + text + (jika ada) action butang
- [ ] Icon neutral, tak menarik perhatian berlebihan
- [ ] Typecheck lulus

### FE-3.5 â€” Konsistensi Loading States

**Masalah:** `SettingsPage` guna loading text "Loading settings..." berasingan. Page lain
gantung pada `Table` `isLoading` skeleton. Tidak konsisten.

**Tugas:**
1. Cipta `src/shared/components/Skeleton/Skeleton.tsx` â€” komponen placeholder berpulse (varian:
   `text`, `card`, `line`). Guna `animate-pulse` + `bg-neutral-200`.
2. `SettingsPage` ganti "Loading settings..." dengan skeleton layout (form fields skeleton).
3. `AuditLogPage` â€” semak ada loading state atau tidak, tambah jika tiada.
4. Jangan ubah `Table` skeleton (sudah ada, itu betul) â€” hanya tambah untuk page yang tiada.

**Fail terlibat:**
- `src/shared/components/Skeleton/Skeleton.tsx` (baru)
- `src/shared/components/SettingsPage.tsx`
- `src/modules/audit/AuditLogPage.tsx` (semak)

**Kriteria penerimaan:**
- [ ] SettingsPage loading -> skeleton form, bukan text
- [ ] AuditLogPage ada loading state
- [ ] Skeleton guna `animate-pulse`, warna `neutral-200`

---

## 7. Phase FE-4 â€” Dark Mode

> **Nota:** Ini fasa terbesar dari segi effort. Lihat Decision Log CLAUDE.md 2026-06-25 â€”
> design direction Indigo/Ink locked. Dark mode adalah tambahan, bukan ganti arah design.

### FE-4.1 â€” Definisi Dark Mode Tokens di `index.css`

**Masalah:** `src/index.css` ada `@theme` block dengan token light sahaja. **Tiada** `dark:`
variant atau override `.dark`. Tailwind v4 CSS-first perlukan definisi eksplisit.

**Tugas:**
1. Tambah block override di `src/index.css` (di luar `@theme`, guna selector `.dark`):
   ```css
   .dark {
     --color-background: #0f0f12;       /* near-black, cool */
     --color-surface: #18181b;          /* ink-900, card bg */
     --color-border: #27272a;           /* ink-800 */
     /* Override neutral scale untuk text/border di dark */
     --color-neutral-200: #27272a;
     --color-neutral-300: #3f3f46;
     --color-neutral-400: #71717a;
     --color-neutral-500: #a1a1aa;
     --color-neutral-700: #d4d4d8;
     --color-neutral-900: #f4f4f5;      /* primary text jadi terang */
   }
   ```
   **Penting:** Ini override CSS custom properties sahaja. Kerana komponen guna utility class
   yang rujuk token (cth. `bg-surface`, `text-neutral-900`), override ini akan cascade
   automatik. **Jangan** tambah `dark:` class pada setiap komponen â€” itu approach lama dan
   melanggar prinsip token.
2. Pastikan `body` background/color rujuk `var(--color-background)` /
   `var(--color-neutral-900)` (sudah ada, semak).
3. Tambah `color-scheme: dark` pada `.dark` untuk native form controls (scrollbar, date
   picker).

**Fail terlibat:** `src/index.css`

**Kriteria penerimaan:**
- [ ] Toggle dark mode -> background, card, border, text berubah
- [ ] Light mode kekal tidak berubah
- [ ] `color-scheme` betul (scrollbar gelap di dark mode)

### FE-4.2 â€” Wrap LoginPage dalam Dark Class

**Masalah:** `src/App.tsx` return `LoginPage` **sebelum**
`<div className={isDarkMode ? 'dark' : ''}>` â€” jadi walaupun CSS wujud, login screen tak akan
dark.

**Tugas:**
1. Pindahkan wrapper `<div className={isDarkMode ? 'dark' : ''}>` ke **paling luar** â€” bungkus
   KEDUA-DUA cabang (LoginPage + authenticated) di dalamnya.
2. Struktur betul:
   ```tsx
   return (
     <ErrorBoundary>
       <div className={isDarkMode ? 'dark' : ''}>
         <QueryClientProvider client={queryClient}>
           {!auth.isAuthenticated ? <LoginPage ... /> : <HashRouter>...</HashRouter>}
         </QueryClientProvider>
       </div>
     </ErrorBoundary>
   )
   ```
3. **Jangan ubah** auth state logic, `handleLoginSuccess`, `handleLogout`, `checkFirstLaunch`
   effect â€” itu business logic.

**Fail terlibat:** `src/App.tsx`

**Kriteria penerimaan:**
- [ ] Dark mode ON -> LoginPage juga dark
- [ ] Auth flow (login, signup, first-launch detection) kekal berfungsi
- [ ] Initializing screen juga dark bila dark mode ON

### FE-4.3 â€” Audit & Fix Hardcoded Light Colors

**Masalah:** Walaupun token override (FE-4.1) akan cascade ke majoriti komponen, ada hardcoded
light colors yang tak akan berubah:

| Pattern | Lokasi | Fix |
|---------|--------|-----|
| `bg-white` | Button secondary, Card, Table, Modal, Input, SettingsPage | Ganti `bg-surface` (token yang akan override di dark) |
| `text-neutral-900` (hardcoded sebagai light) | Umum | OK â€” token override akan jadi terang di dark |
| `bg-neutral-100` (App.tsx initializing) | `App.tsx:104` | Ganti `bg-background` |
| `bg-neutral-50` (Table hover) | `Table.tsx:140` | OK â€” token override, atau ganti `bg-white/5` |
| Sidebar `bg-ink-900` | `AppShell.tsx` | OK â€” ink sudah gelap, kekal sama di dark mode |

**Tugas:**
1. Grep `bg-white` dalam `src/` â€” ganti dengan `bg-surface` di mana patut (card, modal, input,
   table, button secondary). **Jangan** ganti di tempat yang memang patut putih (cth. logo
   circle).
2. Grep `bg-neutral-100` di `App.tsx` initializing screen -> `bg-background`.
3. Test setiap screen di dark mode, catat mana yang masih light/broken, fix satu-satu.

**Fail terlibat:** Semua fail `src/shared/components/*` + page yang ada `bg-white` hardcoded.

**Kriteria penerimaan:**
- [ ] `grep "bg-white" src/` -> tinggal hanya yang sengaja putih (logo, dll)
- [ ] Semua 6 tab Attendance, semua 5 tab Payroll, semua 4 Master Data, Audit, Settings â€”
      semua render betul di dark mode
- [ ] Light mode kekal tidak berubah (regression test)
- [ ] Tidak ada `dark:` class ditambah (approach token, bukan per-komponen)

### FE-4.4 â€” Focus Ring Offset untuk Dark Mode

**Masalah:** `Button` guna `focus-visible:ring-offset-2` tanpa `ring-offset-color` â€” default
white. Di dark mode, offset ini tak kelihatan pada background gelap.

**Tugas:**
1. Tambah `focus-visible:ring-offset-background` (atau `ring-offset-surface`) di `Button.tsx`.
2. Jika token `--color-background`/`--color-surface` tidak auto-jana utility `ring-offset-*`,
   tambah class custom atau guna `ring-offset-2 ring-offset-[var(--color-surface)]`.
3. Semak `Input`, `Select` â€” ada focus ring juga, pastikan offset betul.

**Fail terlibat:** `Button.tsx`, `Input.tsx`, `Select.tsx`

**Kriteria penerimaan:**
- [ ] Focus ring visible di light AND dark mode
- [ ] Offset warna match background

---

## 8. Phase FE-5 â€” Motion & Polish

> Boleh dijalankan selari dengan FE-3/FE-4. Tiada kebergantungan ketat.

### FE-5.1 â€” Toast Enter/Exit Animations

**Tugas:** Tambah keyframes di `src/index.css`:
```css
@keyframes toast-in {
  from { opacity: 0; transform: translateX(100%); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(100%); }
}
```
Gunakan pada toast container: `animate-[toast-in_0.2s_ease-out]`. Untuk exit, perlu state
"leaving" â€” tambah flag di Toast state, delay remove sehingga animasi tamat (~200ms).

**Fail terlibat:** `src/index.css`, `src/shared/components/Toast/Toast.tsx`

### FE-5.2 â€” Tab Switch Transitions

**Tugas:** `AttendanceListPage` (6 tab) dan `PayrollListPage` (5 tab) â€” tambah fade transition
ringan bila switch tab. Boleh guna keyframe `fade-in` atau library `framer-motion` (perlu
kelulusan â€” lihat Section 2). Pendekatan tanpa library: wrapper
`<div key={activeTab} className="animate-[fade-in_0.15s_ease-out]">` di sekeliling content
tab.

**Fail terlibat:** `AttendanceListPage.tsx`, `PayrollListPage.tsx`

### FE-5.3 â€” Page (Route) Transitions

**Tugas:** Tambah fade transition pada `<Outlet>` di `AppShell`. Pendekatan: guna
`useLocation()` key sebagai trigger, wrap outlet dalam div dengan `key={location.pathname}` +
animate fade-in. Tanpa library.

**Fail terlibat:** `src/shared/components/AppShell.tsx`, `src/index.css` (keyframe `fade-in`)

### FE-5.4 â€” Initializing Screen Polish

**Masalah:** `App.tsx` initializing screen hanya text "Initializing..." â€” tiada
spinner/branding.

**Tugas:** Ganti dengan layout branded: logo circle "EZ" (sama sidebar), spinner (guna
`Spinner` dari Button atau extract ke shared), text "EZOffice" + "Loading...". Guna
`bg-background` (bukan `bg-neutral-100`) supaya dark-mode ready.

**Fail terlibat:** `src/App.tsx` (initializing branch sahaja), mungkin extract `Spinner` ke
`src/shared/components/Spinner/`.

---

## 9. Phase FE-6 â€” Advanced UX (Optional, Lower Priority)

### FE-6.1 â€” Collapsible Sidebar

**Masalah:** Sidebar fixed 240px. Pada window kecil, makan terlalu banyak ruang.

**Tugas:**
1. Tambah state `isSidebarCollapsed` di `AppShell` (default false).
2. Bila collapse -> sidebar jadi 64px, icon-only (sembunyi label, tooltip pada hover).
3. Butang toggle (hamburger atau chevron) di header sidebar.
4. Persist state ke `localStorage` (key `sidebarCollapsed`).
5. Nav item perlu refaktor untuk support icon-only mode â€” sembunyi text, tunjuk icon.

**Nota:** Ini memerlukan setiap nav item ada icon. Cipta set SVG icon inline di
`src/shared/components/icons/` (Employees, Customers, Suppliers, Products, Attendance, Payroll,
ERP, Audit, Settings). Jangan tambah icon library tanpa kelulusan.

**Fail terlibat:** `AppShell.tsx`, `src/shared/components/icons/` (baru)

### FE-6.2 â€” Keyboard Shortcuts

**Tugas:**
1. Cipta `src/shared/hooks/useKeyboardShortcut.ts` â€” daftar shortcut global.
2. Shortcuts cadangan (semua dengan `Ctrl`/`Cmd`):
  - `Ctrl+N` â€” trigger "Add" pada page aktif (emit event atau context)
  - `Esc` â€” tutup form/modal aktif (Modal sudah ada, tetapi page-level form perlu tambah)
  - `Ctrl+S` â€” save form aktif
3. Daftar di `AppShell` atau per-page. **Hati-hati:** jangan override shortcut Electron
   built-in (tanya back-end jika ragu).

**Fail terlibat:** `src/shared/hooks/useKeyboardShortcut.ts` (baru), `AppShell.tsx`,
page forms.

### FE-6.3 â€” Responsive Window Sizing

**Masalah:** Desktop app, tetapi user boleh resize window. Layout tak diuji pada width kecil.

**Tugas:**
1. Test setiap page pada width 800px, 1024px, 1280px, 1920px.
2. Table horizontal scroll sudah ada (`overflow-x-auto`) â€” OK.
3. PageHeader `actions` mungkin overflow pada width kecil â€” tambah `flex-wrap` atau collapse
   ke menu.
4. Form grid (jika ada multi-column) â€” pastikan stack pada width kecil.
5. Catat breakpoint dan fix.

**Fail terlibat:** Audit semua page, fix yang break.

---

## 10. Out of Scope (Jangan Sentuh)

Berikut dikenal pasti tetapi **di luar skop front-end dev**:

| Item | Sebab |
|------|-------|
| Audit logging wiring ke mutations | Logic back-end (Phase B, lihat CLAUDE.md) |
| Role-based permissions / multi-user | Back-end (Phase B) |
| Real-time device listener | Back-end (Phase 3 refinement) |
| Lateness payroll deduction | Back-end (Phase D) |
| ERP module (Invoice/PO/DO) | Belum dibina â€” fasa berasingan |
| Auto-update server | Infra (Phase 6 refinement) |
| Performance optimization (memo, virtualization) | Boleh dicadang tetapi perlu kelulusan; jangan refactor preemptive |
| Internationalization (i18n) | Belum dalam roadmap |

---

## 11. Definition of Done (Per Fasa)

Setiap fasa dianggap lengkap apabila:

- [ ] Semua task dalam fasa dilaksanakan mengikut kriteria penerimaan
- [ ] `npx tsc -p tsconfig.app.json --noEmit` lulus dengan 0 error
- [ ] `npx tsc -p tsconfig.node.json --noEmit` lulus dengan 0 error (jika sentuh fail yang
      typecheck node â€” biasanya tak, tetapi pastikan)
- [ ] App boot tanpa error via `npm run electron:dev`
- [ ] Light mode regression test: semua page render betul, tiada visual break
- [ ] (FE-4 onwards) Dark mode test: semua page render betul
- [ ] **Tiada perubahan pada business logic** â€” diff review akan fokus pada:
 - `electron/**` mesti 0 perubahan
 - `src/shared/types/**` mesti 0 perubahan
 - Argumen mutation, endpoint IPC, state reset selepas operasi â€” mesti kekal exact
- [ ] Commit mengikut Conventional Commits, satu perubahan logik per commit
- [ ] Jika menambah dependency â€” kelulusan back-end diperoleh dan dicatat di commit message

---

## 12. Quick Reference â€” Fail Index

### Fail yang akan diubah / dicipta (front-end dev milik)

```
src/
|-- App.tsx                                    [FE-1.2, FE-4.2, FE-5.4]
|-- index.css                                  [FE-4.1, FE-5.1, FE-5.3]
|-- shared/
|   |-- components/
|   |   |-- ErrorBoundary/                     [FE-1.2 BARU]
|   |   |-- ConfirmDialog/                     [FE-2.1 BARU]
|   |   |-- Skeleton/                          [FE-3.5 BARU]
|   |   |-- icons/                             [FE-3.4, FE-6.1 BARU]
|   |   |-- Spinner/                           [FE-5.4 BARU, jika extract]
|   |   |-- Button/Button.tsx                  [FE-4.4]
|   |   |-- Card/Card.tsx                      [FE-4.3]
|   |   |-- Input/{Input,Select,FileInput}.tsx [FE-2.4, FE-4.4]
|   |   |-- Modal/Modal.tsx                    [FE-2.2]
|   |   |-- Table/Table.tsx                    [FE-2.3, FE-3.4, FE-4.3]
|   |   |-- Toast/                             [FE-1.1 satukan, FE-5.1]
|   |   |-- StatusBadge/StatusBadge.tsx        [FE-4.3 audit]
|   |   |-- PageHeader.tsx                     [FE-6.3 audit]
|   |   |-- AppShell.tsx                       [FE-5.3, FE-6.1]
|   |   |-- SettingsPage.tsx                   [FE-1.3, FE-2.4, FE-3.5]
|   |   `-- index.ts                           [tambah exports]
|   `-- hooks/
|       |-- useIpcQuery.ts                     [FE-3.1 presentation sahaja]
|       |-- useFocusTrap.ts                    [FE-2.2 BARU]
|       `-- useKeyboardShortcut.ts             [FE-6.2 BARU]
`-- modules/
    |-- master-data/
    |   |-- employees/{EmployeeListPage,EmployeeForm,EmployeeImportDialog}.tsx
    |   |-- customers/{CustomerListPage,CustomerForm}.tsx
    |   |-- suppliers/{SupplierListPage,SupplierForm}.tsx
    |   `-- products/{ProductListPage,ProductForm}.tsx
    |-- attendance/
    |   |-- AttendanceListPage.tsx             [FE-3.1, FE-3.2, FE-3.3, FE-5.2]
    |   |-- AttendanceLogForm.tsx
    |   |-- DeviceSettingsPage.tsx
    |   `-- constants.ts
    |-- payroll/
    |   |-- PayrollListPage.tsx                [FE-3.1, FE-3.2, FE-5.2]
    |   |-- PayrollRunPage.tsx                 [FE-3.1]
    |   |-- salaryStructures/SalaryStructureListPage.tsx  [FE-3.1, FE-3.2]
    |   |-- salaryAdvances/SalaryAdvanceListPage.tsx      [FE-3.1, FE-3.2]
    |   `-- rateTables/*
    `-- audit/
        |-- AuditLogPage.tsx                   [FE-2.4, FE-3.5]
        `-- constants.ts                       [FE-2.4 BARU]
```

### Fail yang LARANG disentuh (business logic)

```
electron/**                     -- semua, tanpa pengecualian
src/shared/types/**             -- kontrak API, jangan ubah interface/Zod
src/shared/hooks/useIpcQuery.ts -- boleh ubah presentation layer (toast trigger)
                                  tetapi JANGAN ubah query/mutation contract
CLAUDE.md, ARCHITECTURE.md      -- dokumen seni bina
electron-builder.yml            -- config packaging
vite.config.ts                  -- config build
package.json                    -- deps/build scripts (tanya back-end untuk deps baru)
```

---

## 13. Cadangan Urutan Kerja

1. **FE-1 (Foundation & Cleanup)** â€” mula di sini. Bersihkan Toast duplikasi dulu (FE-1.1),
   tambah ErrorBoundary (FE-1.2), betulkan radius (FE-1.3). Fasa ringan, impact tinggi.
2. **FE-2 (Component Hardening)** â€” ConfirmDialog (FE-2.1) dan Modal focus trap (FE-2.2)
   adalah prerequisite untuk FE-3. aria-sort (FE-2.3) dan ganti komponen mentah (FE-2.4)
   boleh lepas.
3. **FE-3 (UX Feedback)** â€” bergantung pada FE-1.1 + FE-2.1. Wire toast (FE-3.1), ganti
   confirm/alert (FE-3.2, FE-3.3), polish empty/loading states (FE-3.4, FE-3.5).
4. **FE-4 (Dark Mode)** â€” fasa paling besar. Token dulu (FE-4.1), kemudian fix LoginPage
   wrapper (FE-4.2), audit hardcoded colors (FE-4.3), focus ring (FE-4.4).
5. **FE-5 (Motion)** â€” boleh selari dengan FE-3/FE-4. Animasi toast (FE-5.1), tab transition
   (FE-5.2), route transition (FE-5.3), initializing polish (FE-5.4).
6. **FE-6 (Advanced, optional)** â€” collapsible sidebar (FE-6.1), keyboard shortcuts (FE-6.2),
   responsive (FE-6.3). Prioriti rendah, hanya selepas FE-1 hingga FE-5 selesai.

---

**Akhir kata:** Jika ragu tentang sempadan, **tanya back-end dahulu** sebelum ubah. Lebih
baik tanya daripada pecah business logic secara tidak sengaja. Diff review akan fokus pada
perubahan business logic â€” pastikan ia 0.
