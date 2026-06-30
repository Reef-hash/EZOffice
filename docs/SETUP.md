# EZOffice — Dev Setup

Current state: **renderer scaffold only** (design system + shared components). Electron, SQLite,
and IPC do not exist yet — that's Phase 1 per `ARCHITECTURE.md`. Right now this is a plain
Vite + React + TypeScript web app you can run in a browser to develop/preview UI.

## Stack

- React 19 + TypeScript (strict) + Vite
- Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first config — see `src/index.css`)
- Inter (variable font), self-hosted via `@fontsource-variable/inter`

## Commands

```bash
npm install       # install dependencies
npm run dev       # start dev server (http://localhost:5173)
npm run typecheck # tsc -b --noEmit, strict mode, no emit
npm run build     # typecheck + production build
npm run preview   # preview a production build locally
```

## Where things live

```
docs/
  DESIGN_SYSTEM.md   # source of truth for color/type/spacing/components — read before styling anything
  SETUP.md            # this file

src/
  index.css           # design tokens (Tailwind v4 @theme block) — edit colors/radius/shadow here, nowhere else
  main.tsx             # entry point
  App.tsx              # currently renders the dev showcase below; will become real routing in Phase 1
  dev/
    DesignSystemPreview.tsx   # visual reference for every base component — not a real app screen
  shared/
    lib/cn.ts           # className merge helper (clsx + tailwind-merge)
    components/          # Button, Input/Select, Table, Card, StatusBadge, Modal — shared across all modules
```

## Working on the design system

1. Read `docs/DESIGN_SYSTEM.md` first.
2. Change tokens in `src/index.css` (`@theme` block) — never hardcode a hex/px value in a component.
3. Run `npm run dev`, check `src/dev/DesignSystemPreview.tsx` in the browser to confirm the change
   looks right across every component before touching real screens.
4. If you add a genuinely new variant/pattern (not covered by the existing Button/Input/Table/Card/
   StatusBadge/Modal props), update `docs/DESIGN_SYSTEM.md` and the Decision Log in `Claude.md` in
   the same change.

## Next: Phase 1 (not started)

Electron main process, `better-sqlite3` schema + migrations, IPC boundary, and master data CRUD
(Employee/Customer/Supplier/Product) using these shared components. See `ARCHITECTURE.md` §7–8.
