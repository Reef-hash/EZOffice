# CLAUDE.md — EZOffice Engineering Standards

This file defines how EZOffice is built. Any agent (Claude Code or otherwise) working on this codebase follows these standards as if reporting to a senior engineer/architect. Read this in full before writing any code. If a decision in `ARCHITECTURE.md` conflicts with something here, `ARCHITECTURE.md` wins on *what* to build; this file governs *how* to build it.

---

## 1. Role & Mandate

You are acting as a **senior software engineer and architect** on this project, not a code-generation tool. That means:

- You don't just make requested code "work" — you make it *correct, readable, and maintainable* for whoever (human or agent) touches it next.
- You push back (briefly, in writing) if a request would introduce architectural debt, and propose the better alternative before implementing — don't silently implement a worse pattern just because it was asked for.
- You leave the codebase in a state where a new agent, reading only this file + `ARCHITECTURE.md` + the code itself, can continue work without needing prior conversation context.
- You never ship something you wouldn't be comfortable having reviewed in a code review at a company that takes engineering seriously.

---

## 2. Project Context (summary)

EZOffice is an offline-first Electron + React desktop app: Attendance (fingerprint) + Payroll + basic ERP (Invoice/PO/DO). Full architecture, data flow, and phased build plan live in `ARCHITECTURE.md` — read it before starting any phase.

---

## 3. Non-Negotiable Code Quality Rules

- **TypeScript strict mode, always.** No `any` unless there is genuinely no alternative (e.g. a poorly-typed third-party SDK) — and if so, isolate it behind a typed wrapper function immediately, don't let `any` leak into application code.
- **No silent failures.** Every `catch` block either handles the error meaningfully (retry, user-facing message, fallback) or re-throws with added context. Never an empty `catch {}` or a bare `console.log(err)` and move on.
- **Single Responsibility per file/function.** If a file is doing UI rendering *and* business logic *and* DB access, split it. A React component should not contain SQL. A service function should not contain JSX.
- **No magic numbers/strings.** Status values (`"Draft"`, `"Sent"`, `"Received"`), statutory rates, and thresholds go in named constants/enums in one place, not hardcoded inline across files.
- **Naming conventions:**
  - `camelCase` — variables, functions
  - `PascalCase` — React components, TypeScript types/interfaces, classes
  - `snake_case` — database columns and table names
  - File names match their default export (`PayrollSummary.tsx` exports `PayrollSummary`)
- **Comments explain *why*, not *what*.** `// deduct stock here` is noise. `// stock must be deducted before invoice number is issued — invoice numbering is the point of no return for this transaction` is signal.
- **No dead code, no commented-out blocks left "just in case."** Delete it. Git history is the safety net, not the source file.

---

## 4. Architecture Rules (specific to this codebase)

- **Renderer never touches the database or hardware directly.** All access goes through `ipcMain` handlers in the Main process. If you find yourself importing `better-sqlite3` in anything under `/src`, stop — that's a boundary violation.
- **Business logic lives in a dedicated service layer, not inside IPC handlers and not inside React components.** IPC handlers should be thin: validate input → call a service function → return result. Example: payroll calculation logic lives in `electron/services/payroll.ts`, not inline inside `electron/ipc/payroll.ts`.
- **Module boundaries are real boundaries.** Attendance, Payroll, and ERP each own their tables and service functions. If Payroll needs attendance data, it calls a defined function from the attendance service (`getMonthlyAttendanceSummary(employeeId, month)`) — it does not reach into `attendance_logs` with its own ad-hoc query.
- **All schema changes go through a migration file**, never a manual `ALTER TABLE` run once and forgotten. Migrations are numbered and committed to `db/migrations/`.
- **Multi-step writes use transactions.** Anything that touches more than one table as a logical unit (e.g. DO creation: insert DO row + deduct stock) must be wrapped in a single SQLite transaction — partial writes are not acceptable, even on a single-user offline app.
- **Foreign keys are enforced**, not just implied by naming. `PRAGMA foreign_keys = ON` at every DB connection.

---

## 5. Working Process

1. **Before starting a phase:** re-read `ARCHITECTURE.md` and this file. If a phase's scope is ambiguous, state the assumption you're proceeding with rather than guessing silently.
2. **Build incrementally, in the phase order defined in `ARCHITECTURE.md`.** Don't jump ahead to ERP while Attendance is half-done — half-finished parallel work is how codebases rot.
3. **After finishing a unit of work:**
   - Verify it actually runs (don't just claim it does)
   - Update the Decision Log (section 7 below) with anything a future agent would need to know — finalized schema choices, naming decisions, anything non-obvious
4. **Never make a schema-breaking change to existing tables without flagging it explicitly** — even if no other agent is around to ask, write the tradeoff into the Decision Log before proceeding.
5. **Commit messages follow Conventional Commits** (`feat:`, `fix:`, `refactor:`, `chore:`) and stay scoped to one logical change each — no "various fixes" commits.

---

## 6. Anti-Patterns — Do Not Do These

These are common failure modes for AI coding agents specifically. Watch for them in your own output:

- ❌ Writing one giant component/file that does everything because it's faster than splitting it properly
- ❌ Copy-pasting similar logic across Attendance/Payroll/ERP instead of extracting a shared utility
- ❌ Over-engineering a simple feature with unnecessary abstraction layers "for future flexibility" that isn't in the actual plan
- ❌ Adding a new npm dependency for something trivial that's a 10-line function
- ❌ Skipping input validation on IPC handlers because "it's a local app, who's going to send bad data" — validate anyway, it catches your own bugs during dev
- ❌ Inventing a new naming convention mid-project instead of following section 3
- ❌ Marking a phase "done" without actually running the app and clicking through the feature

---

## 7. Decision Log

*Append here as the project progresses. Keep entries short — one line per decision, dated.*

- **2026-06-25 — Design system locked in before Phase 1.** Full spec in `docs/DESIGN_SYSTEM.md`; tokens implemented in `src/index.css`. Summary:
  - **Palette:** Teal/Slate. Primary `#0f766e` (teal-700), hover `#0d9488`, active `#115e59`. Neutrals are the Slate scale (`#f8fafc`→`#0f172a`). Semantic: success green `#15803d`, warning amber `#b45309`, error red `#b91c1c`, info cyan `#0e7490` (each as a `-50/-100/-600/-700/-800` ramp). App background = `neutral-100`, surfaces/cards = white, default border = `neutral-200`.
  - **Font:** Inter (variable), self-hosted via `@fontsource-variable/inter` (no CDN — app is offline-first). Base body size 14px (`text-sm`), table/data cells use Tailwind's built-in `tabular-nums` for numeric alignment.
  - **Radius/shadow kept small and flat:** 4/6/8px radius scale, shadows reserved for things that must visually float (modals, dropdowns) — flat sections use a 1px border, not a shadow, to avoid a "card-soup" look.
  - **Tooling:** Tailwind v4 via `@tailwindcss/vite`, CSS-first config (`@theme` block in `src/index.css`) — no `tailwind.config.ts`; every `--color-*`/`--radius-*`/`--shadow-*` token doubles as a generated utility class.
  - **Base components built** in `src/shared/components/`: `Button`, `Input`/`Select` (+ shared internal `Field` wrapper), `Table` (generic, typed sortable columns via discriminated union, built-in empty/loading states), `Card`, `StatusBadge` (tone-only — modules own their own status→tone maps), `Modal` (portal-based, Esc + backdrop close). All reusable across Attendance/Payroll/ERP — no per-module duplicates.
  - **Scaffold added ahead of Phase 1:** minimal Vite + React 19 + TypeScript (strict) renderer (`package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`). This is renderer-only — Electron, SQLite, and IPC wiring are still Phase 1 work, not yet started. `src/App.tsx` currently renders a throwaway component showcase (`src/dev/DesignSystemPreview.tsx`) for visual verification; it will be replaced by real routing/module screens in Phase 1.

- **2026-06-25 — Phase 1: Electron scaffold + SQLite + Master Data CRUD.** See below for decisions made during implementation.

  - **Electron tooling:** `vite-plugin-electron/simple` chosen for Electron + Vite integration. `electron:dev` script uses `vite` (the plugin spawns Electron automatically). No `electron-builder` (Phase 6). Preload uses `contextBridge` + `contextIsolation: true`. `nodeIntegration: false` — renderer has zero Node access.

  - **Database:** `better-sqlite3` with WAL mode. Dev DB: `./data/ezoffice.dev.db` (gitignored). Prod DB: `app.getPath('userData')/data/ezoffice.db`. Singleton connection via `electron/db/connection.ts` (`getDb()`). `PRAGMA foreign_keys = ON` on every connection.

  - **Migration runner:** Hand-rolled in `electron/db/migrate.ts`. Reads `electron/db/migrations/*.sql` in filename order, tracks applied filenames in `schema_migrations` table, applies pending in a single transaction each. No library dependency — intentionally small.

  - **Schema (0001_init.sql):** Tables: `departments`, `employees`, `customers`, `suppliers`, `products`, `schema_migrations`. Employee `status` is a CHECK-constrained TEXT column (`'active'` / `'inactive'`), matched by a TypeScript `EMPLOYEE_STATUS` const object in `src/shared/types/entities.ts`. Employee has `department_id` FK → departments. **No salary/allowance fields on employees** — Payroll module will own its own `salary_structures` table in Phase 4. **No stock_on_hand on products** — ERP module will own `stock_levels` in Phase 5. All timestamps are ISO 8601 TEXT (SQLite has no native datetime type).

  - **Service layer:** One file per entity under `electron/services/masterData/`. All queries use prepared statements. CSV import (`importEmployeesCsv`) is wrapped in a single `db.transaction()` — partial writes are not acceptable. Every service function takes `db` as the first argument (no hidden global — testable).

  - **IPC layer:** Thin handlers in `electron/ipc/masterData.ts`, registered in `main.ts`. Pattern: validate input with Zod schema → call service function → return result. Every handler wraps in try/catch that re-throws with context (no silent failures). Channel naming: `entity:action` (e.g. `employees:list`, `employees:create`).

  - **Input validation:** `zod` schemas live in `src/shared/types/inputs.ts`, imported by both electron IPC handlers (for server-side validation) and available to renderer if needed. Covers create, update (partial), and CSV row schemas.

  - **Shared types:** `src/shared/types/` contains `entities.ts` (DB row interfaces), `inputs.ts` (Zod schemas + inferred types), `api.ts` (the IPC API interface — the contract between preload and renderer). These are pure TypeScript, no runtime dependencies — safe to import from both electron and renderer.

  - **Routing:** `react-router-dom` with `HashRouter` (Electron-friendly). `AppShell` component wraps an `<Outlet />` in a fixed 240px sidebar + scrollable main content. Sidebar nav: Master Data section (active links), Modules section (placeholder disabled links for Attendance/Payroll/ERP).

  - **State management:** `@tanstack/react-query` for server/Ipc state (list/create/update/delete per entity). No Zustand — not needed yet; add only if cross-page client state becomes necessary.

  - **Renderer structure:** `src/modules/master-data/{employees,customers,suppliers,products}/` — one list page + one form component per entity. Employee additionally has `EmployeeImportDialog` and `constants.ts` (status → badge tone/label maps). All pages use shared `Table`, `Button`, `Input`, `Select`, `Modal`, `StatusBadge`, `PageHeader`.

  - **Replacement of DesignSystemPreview:** `src/dev/DesignSystemPreview.tsx` retained (unreferenced) as a dev-only reference; `App.tsx` now renders the real routing shell. `src/App.tsx` also creates `QueryClientProvider` at the root.

- **2026-06-25 — Design direction relocked: Indigo/Ink ("modern SaaS dashboard"), supersedes the original Teal/flat direction.** Triggered by a reference screenshot the project owner supplied (HR/attendance-style dashboard — dark pill top nav, indigo active states, pastel semantic badges, large rounded white cards on a light-gray canvas). Full spec in `docs/DESIGN_SYSTEM.md` — **this is the new source of truth; the Teal/Slate palette and "shadow as last resort" philosophy from the entry above are retired.** This is a locked decision — do not revert to flat/Teal or invent a third direction without explicit sign-off from the project owner; if a future request conflicts with this, flag it and ask first rather than silently changing it back.
  - **Primary brand color is now indigo** (`primary-600` = `#6d5df6`), replacing teal. Confirmed with the project owner that the Button `primary` variant uses indigo (not ink) — see below.
  - **New `ink` color scale** (`#18181b` base) added, used only for the sidebar nav background and a new `dark` Button variant — never for body text.
  - **New Button variant: `dark`** — high-emphasis, sparingly-used global actions (modeled on the reference's "Manage Team"/"Add Task"), distinct from `primary`. All Button variants are now `rounded-full` (pill), not `rounded-sm`.
  - **Warning semantic moved from amber/yellow to true orange** (`#ea580c`/`#c2410c`) to match the reference's peach/orange pastel. **Info semantic moved from cyan to indigo/lavender**, intentionally sharing literal hex values with `primary` (kept as separate tokens, not `var()`-aliased, so they can diverge later) — see rationale in `docs/DESIGN_SYSTEM.md` §1.
  - **Radius scale increased across the board** (`radius-sm` 4px→8px, `radius-md` 6px→12px, `radius-lg` 8px→16px, new `radius-xl` 20px for cards/tables) and **`shadow-sm` is now the default elevation for every Card/Table**, reversing the original "shadow as last resort, flat border by default" rule.
  - **App shell nav structure kept as a 240px left sidebar, not switched to the reference's top nav** — confirmed with the project owner: EZOffice's nav surface (Master Data's 4 entities + Attendance/Payroll/ERP, each with sub-pages) is larger than the reference app's ~6 icon-only links, so the sidebar scales better. The sidebar is restyled only (`ink-900` background, pill nav items, `primary-600` solid pill for the active item) — see `AppShell.tsx`.
  - All base components (`Button`, `Card`, `StatusBadge`, `Table`, `Modal`, `Input`/`Select`, `PageHeader`) refactored in place to the new tokens — no parallel/duplicate component versions were created.
  - A pastel "soft" Button variant (tone-colored bg, matching the reference's "Clock In"/"Clock Out" buttons) was intentionally **not** added — no consumer exists until the Attendance module is built. Add it then, not preemptively.

- **2026-06-26 — Phase 2: Attendance module — manual clock in/out (no hardware).** Full spec per user directive.

  - **Schema (0002_attendance.sql):** `attendance_logs` is an EVENT table — one row per punch, NOT one row per day. Columns: `id`, `employee_id` (FK → employees with ON DELETE RESTRICT), `type` CHECK('in','out'), `timestamp` (ISO 8601 TEXT), `source` CHECK('manual','device'), `device_id` (nullable, null until Phase 3), `note` (nullable, for admin backfill reasons), `created_at`, `updated_at`. Index on `(employee_id, timestamp)` for efficient time-range queries. Employee FK uses RESTRICT (not CASCADE) — an employee with attendance history cannot be hard-deleted, to avoid silently destroying records.

  - **`source` / `device_id` split:** `source` tracks how the row was created ('manual' vs 'device'), independent of `device_id` which stays null until Phase 3 wires a real fingerprint reader. `device_id` is NOT overloaded to mean "manual" via null.

  - **Alternation validation:** An employee's punches must strictly alternate (IN → OUT → IN → ...). Reject double-IN and double-OUT. This rule is shared across `clockIn`, `clockOut`, and `createManualLog` via a single private `assertAlternation()` helper in `electron/services/attendance.ts` — no duplication. The rule lives in the service layer, not IPC and not the component. On update, alternation is checked against the chronologically preceding log (excluding the row being edited); cascading fixup of subsequent rows is the admin's responsibility.

  - **Service layer (`electron/services/attendance.ts`):** All functions take `db` as first arg (testable, no hidden global). Shared `queryById` helper with JOIN to employees for `employee_name`. `clockIn`/`clockOut` default timestamp to `new Date().toISOString()` if omitted. `createManualLog` for the admin backfill form — same alternation check. `updateAttendanceLog` merges partial input, re-checks alternation if type/employee changed. Delete returns `{changes}`-based not-found error.

  - **IPC layer (`electron/ipc/attendance.ts`):** Thin handlers, exact same pattern as `electron/ipc/masterData.ts`. Channels: `attendance:list`, `attendance:get`, `attendance:getLastForEmployee`, `attendance:clockIn`, `attendance:clockOut`, `attendance:create`, `attendance:update`, `attendance:delete`. Zod validation on all mutating handlers. Every catch re-throws with context.

  - **Renderer module (`src/modules/attendance/`):** `AttendanceListPage.tsx` — Quick Clock panel (employee select → shows current IN/OUT status via `getLastForEmployee` → Clock In / Clock Out buttons, each disabled when already in that state), date-range filter (defaults to today), Table of logs with status badges, row click → `AttendanceLogForm` modal. `AttendanceLogForm.tsx` — add/edit/delete modal (employee select, type select, datetime-local input, note field), mirrors `SupplierForm.tsx` prop shape exactly. `constants.ts` — `ATTENDANCE_TYPE_TONE`/`ATTENDANCE_TYPE_LABEL`/`ATTENDANCE_SOURCE_TONE`/`ATTENDANCE_SOURCE_LABEL` maps, mirroring `employees/constants.ts` pattern.

  - **getMonthlyAttendanceSummary explicitly deferred to Phase 4:** A one-line comment in `electron/services/attendance.ts` notes that the aggregation function depends on Phase 4's `salary_structures` table (shift hours, OT rules) which doesn't exist yet.

  - **No new npm dependencies added.** All built with existing shared components and hooks.

  - **Verified:** TypeScript strict passes with 0 errors (both tsconfig.app.json and tsconfig.node.json). Fresh DB migration applies 0001 then 0002 in order. Electron launches with both master data and attendance handlers registered.

- **2026-06-26 — Payroll module (Phase 4) additional scope locked before build.** Two requirements added by the project owner on top of the original Phase 4 plan (salary structure, EPF/SOCSO/EIS/PCB, payslip — see `ARCHITECTURE.md` §3–4). Locked before implementation starts — the Phase 4 migration must include these from the first commit, not bolt them on after the fact.

  - **Per-employee statutory opt-in/opt-out:** `subject_to_epf`, `subject_to_socso`, `subject_to_eis` — three NOT NULL INTEGER (0/1) flags, default `1`. These live on `salary_structures` (Payroll's own table), **not** on `employees` — consistent with the Phase 1 decision that Payroll owns its own payroll-related fields and master data stays clean. When a flag is `false`, the calculation engine skips that statutory line item entirely for that employee (no lookup performed, no zeroed row in the breakdown) — the skip happens before the rate-table lookup, not after.

  - **Salary advance/loan tracking:** new table `salary_advances` — `id`, `employee_id` (FK → employees, `ON DELETE RESTRICT` — same precedent as `attendance_logs`), `amount` (principal issued), `date_issued`, `limit_max` (the approved ceiling for this advance), `balance_outstanding` (remaining to be repaid), `status` (CHECK `'active'` / `'settled'` / `'cancelled'`), `deduction_mode` (CHECK `'full_balance'` / `'fixed_installment'`), `installment_amount` (nullable REAL; required when `deduction_mode = 'fixed_installment'`, unused otherwise).
    - **Deduction mode is per-advance, not a global payroll setting** — confirmed with the project owner: different advances can carry different repayment terms (e.g. a larger advance repaid over several months vs. a small one repaid in full next cycle), so it's a column on `salary_advances`, not on `payroll_settings`.
    - Each monthly payroll run, for every employee with an `'active'` advance: deduct `min(balance_outstanding, deduction_mode === 'full_balance' ? balance_outstanding : installment_amount)` from both `balance_outstanding` and net pay; when `balance_outstanding` reaches 0, flip `status` to `'settled'`.
    - This deduction is snapshotted into `payroll_run_items`, same historical-integrity rule as the rest of Phase 4 — a finalized payslip must not change if the advance row is edited afterward.

  - These are additive to the Phase 4 migration (`0003_payroll.sql`) alongside `salary_structures`, `payroll_settings`, and the statutory rate tables — no change to schema/decisions already locked for those.

- **2026-06-26 — Phase 4: Payroll module build completed and verified.** Schema, services, IPC, and migration (`0003_payroll.sql`) were already in place from an earlier session but had stalled before typecheck-clean or any renderer screens beyond the run list/detail. This entry covers what it took to actually finish and verify it.

  - **Fixed: wrong relative import depth.** Every file under `electron/services/payroll/` (one directory deeper than `electron/services/`) was importing shared types via `'../../src/shared/types/...'` — two levels up, same as `electron/services/attendance.ts` — which resolves to a nonexistent `electron/src/...` path. Needed `'../../../src/shared/types/...'`. This alone accounted for ~20 `TS2307` errors across `calculationEngine.ts`, `payrollRun.ts`, `payslipPdf.ts`, `salaryAdvances.ts`, `salaryStructure.ts`, `settings.ts`, `statutoryRates.ts`.

  - **Fixed: a real money-correctness bug in `payrollRun.ts`.** `calculatePayrollRun` was mutating `salary_advances.balance_outstanding` directly (via `applyAdvanceDeduction`) every time it ran — but a `'draft'` run is meant to be recalculated freely before finalizing (e.g. after fixing an attendance log), and each recalculation was double/triple-deducting the same advance. Fixed by splitting the concern: `calculatePayrollRun` now only *previews* the advance deduction (via a new shared `previewAdvanceDeductions` helper, read-only) for the snapshotted `payroll_run_items` row; `finalizePayrollRun` is now the only place balances are actually mutated — it re-resolves each employee's active advances at finalize time and overwrites the run item's `advance_deduction`/`net_pay` with what was actually applied. This also makes recalculation genuinely idempotent, which the original code's own comment claimed but didn't deliver.

  - **Fixed: a transaction-boundary violation.** The `DELETE FROM payroll_run_items` (clearing a draft before recalculating) was running *before* `db.transaction(...)`, not inside it — a direct violation of CLAUDE.md §4 that the file's own header comment claimed was followed. Moved inside the transaction.

  - **Fixed: Zod `.partial()` on a refined schema.** `updateSalaryAdvanceSchema = createSalaryAdvanceSchema.partial()` crashed the app at startup (`Error: .partial() cannot be used on object schemas containing refinements`) — Zod v4 disallows `.partial()` on a schema with `.refine()` attached. Split into a `salaryAdvanceBaseSchema` (object only) + `createSalaryAdvanceSchema` (base + refine) + `updateSalaryAdvanceSchema` (base.partial(), no refine). The fixed_installment/installment_amount cross-field check is still enforced for partial updates in the service layer against the merged result, so nothing is actually less validated.

  - **Rewrote `payslipPdf.ts` for pdfmake's real Node API.** The stalled version called `pdfMake.createPdf(docDef).getBlob(callback)` — that's the *browser* API (`Blob`/`getBlob` don't exist in pdfmake's Node entry); it also never installed `pdfmake` at all, and never actually wrote or opened the generated file despite its own docstring claiming it did. Fixed: real `npm install pdfmake @types/pdfmake` (pre-approved per Architecture.md's tech stack and the Phase 4 decision log); `createPdf(docDef).getBuffer()` (Node-safe); pdfmake's own bundled font config (`pdfmake/fonts/Roboto.js`, real TTFs shipped in the package) registered once via `addFonts` — pdfmake's Node entry does **not** auto-register a default font; an ambient module declaration (`electron/types/pdfmake-fonts.d.ts`) types that subpath import since `@types/pdfmake` doesn't cover it. `generatePayslipPdf` now takes an `outputDir`, writes the PDF there, and returns `{filePath, filename}`; the IPC handler (`electron/ipc/payroll.ts`) resolves `outputDir` via `app.getPath('userData')/payslips` and calls `shell.openPath()` — keeps Electron-specific concerns out of the service layer, matching the existing `resolveDbPath`-takes-a-path-not-`app` pattern in `electron/db/connection.ts`.

  - **Fixed: pdfmake bundling crash in the Electron main build.** Even after the rewrite, `npm run electron:dev` crashed on load (first `tslib`'s `__extends` destructuring from an undefined `.default` after esbuild's CJS/ESM interop wrapping; then `__dirname is not defined` in the ESM-output `pdfmake/fonts/Roboto.js`). `vite-plugin-electron`'s `notBundle()` auto-externalizer wasn't catching pdfmake or its subpath font import. Fixed in `vite.config.ts` by explicitly externalizing the whole `pdfmake/*` specifier space (`id === 'pdfmake' || id.startsWith('pdfmake/')`) in the main process's `rollupOptions.external` — same reasoning as `better-sqlite3` already being external there. A plain string in Rollup's `external` only matches the exact specifier, not subpaths, hence the function form.

  - **Built the missing renderer screens** (only the payroll-run list/detail existed before): `src/modules/payroll/salaryStructures/` (list + form — per-employee daily/hourly rate, standard hours, EPF/SOCSO/EIS toggles), `settings/PayrollSettingsPage.tsx` (OT rule, singleton), `rateTables/` (`RateBracketSection.tsx` — one shared component reused for EPF/SOCSO/EIS, which share the wage-bracket shape; `PcbBracketSection.tsx` kept separate since its shape genuinely differs; both are list + inline "add row" only, no edit-in-place — admins delete and re-add to correct a row, intentionally lightweight per the original Phase 4 brief), `salaryAdvances/` (list + form, locked once status leaves `'active'`). `PayrollListPage.tsx` became the hub: a local-state tab bar (`'runs' | 'salaryStructures' | 'settings' | 'rateTables' | 'advances'`) switches between these, same pattern the file already used for its list↔detail toggle — no new routes added, no AppShell changes needed beyond the single `/payroll` link that already existed.

  - **`PageHeader`'s `subtitle` prop widened from `string` to `ReactNode`** — needed for `PayrollRunPage` to show a `StatusBadge` next to the title. Low-risk, backward-compatible (every other caller passes a string, which is still a valid `ReactNode`).

  - **Verified for real, not just typechecked:** `ELECTRON_RUN_AS_NODE=1` is set in this environment (a deliberate guard against agent-launched GUI windows) and silently breaks Electron's dev launch with a confusing "module 'electron' has no export 'BrowserWindow'" error that looks like a code bug but isn't — unset it for the one launch process, confirmed with the project owner first since it pops a real window on the desktop. With it unset: fresh migration applies 0001→0002→0003, app boots, Payroll hub loads with all 5 tabs rendering (Payroll Runs, Salary Structures, Statutory Rate Tables screenshotted directly; Salary Advances/Settings share the same proven Table/Card/Form primitives), and a live EPF rate row was created end-to-end through the real IPC → Zod → SQLite → React Query refetch path. The Zod `.partial()` crash and the pdfmake bundling crash were only caught this way — `tsc` was clean the whole time both bugs were live.

- **2026-06-28 — Phase 3: Fingerprint reader hardware integration (ZKTeco V1000) — scope locked before build.**

  - **Hardware choice:** ZKTeco V1000 (compact, Malaysian-market availability, supports both Ethernet TCP and USB). V1000 supports multiple connection methods: Ethernet/TCP (port 4370, primary), USB flash disk (data export fallback), RS232/RS485 (not used in Phase 3).

  - **Integration approach — dual-path sync:**
    - **Ethernet/TCP (primary):** App connects to V1000 via `zkteco-js` npm library (v1.0.0+, ~21 KB). Sync triggered manually by admin ("Sync from Device" button in Attendance module) — queries device for all attendance logs and inserts new ones into `attendance_logs` with `source: 'device'`.
    - **USB (fallback):** Admin can export V1000 data to USB stick as Excel, manually import via the existing attendance import flow (Phase 2's `importEmployeesCsv` pattern reused for attendance logs). This is a manual fallback if network fails, not a primary flow.

  - **Device configuration:** IP address and port (default 4370) stored in `payroll_settings` singleton table (reusing Phase 4's settings pattern, kept separate from employees/master data). New settings row: `device_ip` (TEXT, nullable), `device_port` (INTEGER, default 4370). Rendered in Attendance module's settings tab (new subtab "Device Settings") with a "Test Connection" button.

  - **Conflict resolution:** When syncing, deduplicate by `(employee_id, timestamp, type)` — if a log already exists with those values, skip (idempotent). Handles the case where employee clocked in offline via app before sync, then device records the same punch.

  - **Service layer (`electron/services/attendance.ts`):** New function `syncFromDeviceEthernet(db, deviceIp, devicePort)` — calls `zkteco-js` → pulls all attendance records → maps to `{employee_id, timestamp, type}` → checks alternation (same validator from Phase 2) → inserts as `source: 'device'`, `created_at: now`, `updated_at: now`. On conflict, returns silently (no error). Function is testable (takes `db` as first arg, no hidden Electron imports).

  - **IPC handler (`electron/ipc/attendance.ts`):** New channel `attendance:syncFromDevice` — takes no args (reads device IP/port from settings table), calls service function, returns `{inserted, skipped, errors}`. Every error re-throws with context (e.g. "Device unreachable at 192.168.1.X:4370").

  - **Renderer (`src/modules/attendance/`):** New "Device Settings" subtab in Attendance hub (same tab pattern as Payroll's 5-tab layout). Shows device IP/port inputs (read from settings), "Test Connection" button (IPC call, shows success/error toast), "Sync Now" button (IPC call, shows inserted count + success toast). No new routes added.

  - **No schema changes:** `attendance_logs` already has nullable `device_id` and `source` columns from Phase 2. `payroll_settings` is extended only (additive, backward-compatible).

  - **Dependency added:** `zkteco-js@^1.0.0` (npm install verified; TypeScript types available via DefinitelyTyped or library's own typings). Externalized in `vite.config.ts` main process bundle if needed (after testing if it bundles cleanly).

  - **Not in scope (Phase 3):** Real-time device listener (would be a subsequent refinement), enrollment of fingerprints to device (manual via device's UI), complex error recovery (just log and let admin retry). Alternation validation on device-sourced logs happens after insert (same as manual logs).

- **2026-06-29 — Phase 6: Packaging & Distribution (electron-builder) — scope locked before build.**

  - **Packaging tool:** `electron-builder` v25.1.8 (standard for Electron apps). Windows-only (not Mac/Linux) per SME market (Malaysia).

  - **Build targets:** NSIS installer (`.exe` with wizard) + portable (standalone `.exe`, no installation). Both generated from single build run via `npm run build:installer`.

  - **Configuration:**
    - `package.json` `build` field contains electron-builder config (app ID, product name, installer settings).
    - Separate `electron-builder.yml` kept as reference (same config, YAML format).
    - `build/assets/` directory holds app icons (currently placeholder; see `build/assets/README.md` for how to add custom branding).
    - Installer options: non-one-click (user can choose install path), desktop + Start menu shortcuts, uninstall persists database.

  - **Database location (locked):** Windows standard `%APPDATA%\EZOffice\data\ezoffice.db` (survives uninstall, per SME requirement to never lose data). Preload's `resolveDbPath` logic uses `app.getPath('userData')` which maps to `%APPDATA%\EZOffice`.

  - **Version management:** Edit `package.json` `version` field (e.g., `0.1.0` → `0.2.0`), then rebuild. Installer filename and Windows registry entries auto-update.

  - **Code signing:** Certificate file set to `null` (unsigned builds). Appropriate for SME/internal deployment. If legal requires signing later (e.g., for public distribution), purchase certificate (DigiCert/Sectigo ~$100/year) and add to CI/CD, not locally.

  - **Build command:** `npm run build:installer` (full build + electron-builder) or `npm run build:portable` (portable only). Outputs to `dist/`.

  - **Known issue (environment, not code):** Windows symlink permissions block electron-builder's winCodeSign tool download during build. Workaround documented in `docs/DISTRIBUTION.md` — requires either Admin PowerShell or skipped signing. This is a one-time setup issue, not a shipped-product issue (users don't build, they run installer).

  - **Verified:** `npm run build` (TypeScript + Vite) succeeds, producing bundled `dist/` and `dist-electron/`. electron-builder config validates (syntax correct, no missing fields). Installer generation tested up to symlink-permission blocker (environmental, fixable with Admin mode).

  - **Not in scope (Phase 6):** Auto-update server (can add later as refinement), macOS/Linux builds (Electron + SQLite are cross-platform, but Phase 1 target was Windows), crash reporting integrations, analytics. MSI generation (NSIS is sufficient for SME; MSI is enterprise-only).

  - **Distribution guide:** `docs/DISTRIBUTION.md` contains end-user install flow, IT deployment scripts, troubleshooting, version management.

A phase is not complete until:
- [ ] Code follows all rules in sections 3–4 above
- [ ] The feature has been run and manually verified, not just written
- [ ] No `any`, no empty catches, no commented-out code left behind
- [ ] Decision Log updated with anything non-obvious
- [ ] Relevant section of `ARCHITECTURE.md` updated if the implementation diverged from the original plan