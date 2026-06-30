# EZOffice — Design System

This document is the source of truth for visual design across EZOffice. It exists so that
Attendance, Payroll, and ERP all look and behave like **one product**, not three apps stitched
together. If you are about to hardcode a color, a spacing value, or invent a new button style —
stop and check here first.

Implementation of these tokens lives in [src/index.css](../src/index.css) (`@theme` block, Tailwind
v4 CSS-first config). Every `--color-*`, `--radius-*`, and `--shadow-*` variable defined there
becomes a Tailwind utility automatically (e.g. `--color-primary-700` → `bg-primary-700`,
`text-primary-700`, `border-primary-700`). **Never write a raw hex value in a component** — use the
generated utility classes so a future palette change is a one-file edit.

Base/shared components built against this system live in `src/shared/components/`.

## Design intent

**Locked 2026-06-25 — official direction, supersedes the original flat/Teal system below.**
Reference: a modern SaaS dashboard screenshot supplied by the project owner (HR/attendance-style
dashboard — dark pill top nav, indigo accents, pastel status badges, large rounded white cards on
a light-gray canvas). Goal: EZOffice should read as a **polished, modern SaaS product**, not a
generic flat business tool and not a "generic AI app" look either. Do not revert to the old flat/
bordered/Teal aesthetic without explicit sign-off from the project owner — if asked to do so by a
future agent or request, flag the conflict with this section first.

Concretely, that means a deliberate reversal of a few of the original system's rules:

- **Soft shadow is now the default elevation for every card/table surface**, not a last resort —
  `shadow-sm` + `rounded-xl`/`rounded-lg` on white surfaces against the `background` canvas, instead
  of a flat 1px border. This *is* the look here, not something to avoid.
- Color carries meaning, but is now also a **first-class decorative layer** for pastel semantic
  badges/icon circles (priority, leave type, stat accents) — more saturated and visible than the
  old subdued `-50`/`-100` tints.
- Shapes are generously rounded (pill buttons/nav, `16–20px` cards) rather than the old `4–8px`
  "kept deliberately small" scale.
- Big, bold black numbers for key stats (e.g. a leave balance "12 Days") are encouraged — the old
  system avoided bold body text; bold is now correct for headline numbers and page headings.
- Still avoid: gradients, glassmorphism, and glowing/colored shadows. Shadows stay neutral
  (`ink`-tinted, not colored) and soft even though they're now ubiquitous.

---

## 1. Color Palette

Direction: **Indigo (primary/brand) / Ink (high-emphasis) / Slate (neutral)**, confirmed
2026-06-25 — replaces the original Teal/Slate direction.

### Primary — Indigo

Vivid indigo-purple. Used for active nav state, links, focus rings, and (per the locked decision
below) the `primary` Button variant. Do not use it for purely decorative elements.

| Token | Hex | Usage |
|---|---|---|
| `primary-50` | `#f4f2fe` | Subtle active-row / selected-tab background |
| `primary-100` | `#e9e5fd` | Hover background for primary-tinted surfaces; doubles as `info` badge bg |
| `primary-600` | `#6d5df6` | **Base primary** — default button bg, active nav pill, links, focus ring |
| `primary-700` | `#5b47e0` | Hover state for primary buttons |
| `primary-800` | `#4935bd` | Active/pressed state for primary buttons; doubles as `info` badge text |

**Decision (confirmed with project owner, 2026-06-25):** the Button `primary` variant uses
**indigo**, not ink. Ink is reserved for a separate, sparingly-used `dark` variant — see §5 Button.

### Ink — near-black

New scale, added for this direction. Used for the sidebar nav background and the `dark` Button
variant (high-emphasis, sparingly-used actions like "Manage Team" / "Add Task") — never for body
text (use `neutral-900` for that).

| Token | Hex | Usage |
|---|---|---|
| `ink-700` | `#3f3f46` | Rarely used standalone |
| `ink-800` | `#27272a` | Hover state (lightens — there's nowhere darker to go) for ink surfaces |
| `ink-900` | `#18181b` | **Base** — sidebar nav background, `dark` button bg |
| `ink-950` | `#09090b` | Active/pressed state for `dark` buttons |

### Neutral — Slate

Used for text, borders, and disabled states. Unchanged from the original direction — still the
workhorse scale for everything that isn't brand/ink/semantic.

| Token | Hex | Usage |
|---|---|---|
| `neutral-50` | `#f8fafc` | Rarely used standalone; lightest tint |
| `neutral-100` | `#f1f5f9` | Rarely used standalone (app background is now its own token, see below) |
| `neutral-200` | `#e2e8f0` | Default border (`--color-border`), table row dividers |
| `neutral-300` | `#cbd5e1` | Stronger border (e.g. input border on hover) |
| `neutral-400` | `#94a3b8` | Placeholder text, disabled text, muted icons |
| `neutral-500` | `#64748b` | Table header text, sidebar inactive-label text |
| `neutral-600` | `#475569` | Secondary text (labels, helper text) |
| `neutral-700` | `#334155` | Rarely used standalone |
| `neutral-800` | `#1e293b` | Rarely used standalone |
| `neutral-900` | `#0f172a` | **Primary text** — headings, body, table data |

Structural roles (semantic aliases — use these for layout-level chrome):

| Token | Maps to | Usage |
|---|---|---|
| `background` | `#f1f2f4` (light cool gray, own literal value — not aliased to `neutral-100`) | App shell / page background |
| `surface` | `#ffffff` | Card, table, modal, input backgrounds |
| `border` | `neutral-200` | Default border color |

### Semantic — Success / Warning / Error / Info

Used for status communication: badges, alerts, validation states, form field errors, **and** pastel
accent treatments (priority badges, stat icon circles, leave-type dots) per the new direction. Each
has a `-50`/`-100` tint (badge/icon-circle backgrounds), a `-600` (icons, links on white), a `-700`
(badge text, base UI color — must pass contrast on the `-50`/`-100` tint), and a `-800` (rarely,
emphasis).

| Semantic | 50 | 100 | 600 | 700 (base) | 800 |
|---|---|---|---|---|---|
| Success (mint green) | `#f0fdf4` | `#dcfce7` | `#16a34a` | `#15803d` | `#166534` |
| Warning (peach/orange) | `#fff7ed` | `#ffedd5` | `#ea580c` | `#c2410c` | `#9a3412` |
| Error (coral/red) | `#fef2f2` | `#fee2e2` | `#dc2626` | `#b91c1c` | `#991b1b` |
| Info / secondary (lavender/indigo) | `#f4f2fe` | `#e9e5fd` | `#6d5df6` | `#5b47e0` | `#4935bd` |

`info` intentionally shares its literal hex values with the `primary` indigo scale — in this
direction, "secondary/info" pastel badges *are* brand-colored (e.g. a "Medium Priority" badge or an
"AVG Working Hours" stat icon). The two scales are kept as separate tokens (not `var()`-aliased) so
they can diverge later without a structural change — see the rationale in the Design intent note
above. **Warning moved from amber/yellow to true orange** to match "peach" pastel tone — if you see
old `warning-*` usages still reading yellow, the component wasn't using the token (flag it).

**Status → semantic mapping convention** (apply consistently across Attendance/Payroll/ERP; each
module defines its own `STATUS_TONE` map using these four tones — see §5 Badge):

- `neutral` — Draft, not-yet-actioned states
- `info` — Sent, Pending, In Progress, awaiting external action
- `success` — Received, Paid, Approved, Finalized, Active
- `warning` — Partially received/paid, Due soon, Late (attendance), needs attention
- `error` — Cancelled, Rejected, Overdue, Void, Absent

---

## 2. Typography

**Font:** Inter (variable weight), self-hosted via `@fontsource-variable/inter` — no CDN, no
runtime network dependency (this app is offline-first; a webfont that depends on Google Fonts at
runtime is a bug, not a style choice). Fallback stack: `ui-sans-serif, system-ui, -apple-system,
"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

Inter is chosen specifically because it has reliable **tabular figures** — numeric columns
(payroll amounts, invoice totals, quantities) must align vertically when stacked in a table. Apply
Tailwind's built-in `tabular-nums` class to any cell containing numbers.

### Scale

This is a desktop, data-dense app — the base size is 14px, not a marketing-site 16px.

| Role | Size / Line-height | Weight | Tailwind |
|---|---|---|---|
| Page title (H1) | 28px / 36px | **700 (bold)** | `text-[28px] leading-9 font-bold` |
| Section heading (H2) | 18px / 26px | 600 (semibold) | `text-lg leading-snug font-semibold` |
| Card title / H3 | 16px / 24px | 600 (semibold) | `text-base leading-6 font-semibold` |
| Headline stat (e.g. "12 Days") | 28–32px / tight | **700 (bold)** | `text-[28px] font-bold` or `text-3xl font-bold` |
| Body (default) | 14px / 20px | 400 (regular) | `text-sm leading-5 font-normal` |
| Table header | 12px / 16px | 500 (medium), uppercase tracking-wide | `text-xs leading-4 font-medium tracking-wide uppercase` |
| Table data | 14px / 20px | 400 (regular); 500 for emphasized totals | `text-sm leading-5` (+ `tabular-nums` for numbers) |
| Form label | 13px / 18px | 500 (medium) | `text-[13px] leading-[18px] font-medium` |
| Helper / caption / badge text | 12px / 16px | 400–500 | `text-xs leading-4` |

Weight usage: **400** body text, **500** labels/table headers/emphasis, **600** section/card
headings, **700 (bold)** reserved for the page title (H1) and headline stat numbers only — this is
a reversal from the original system, which avoided bold entirely. Bold is now the intended way to
make a page's name or a key number ("Good Morning, **Aysha Nazim**", "**12 Days**") stand out
against muted gray secondary text; don't extend bold to body text or it goes back to "shouting."

---

## 3. Spacing Scale & Layout Grid

Spacing uses Tailwind's default 4px-based scale as-is — no custom scale. The discipline is in
*which* step you reach for, not in inventing new ones:

| Step | Px | Use for |
|---|---|---|
| `1` | 4px | Icon-to-text gap, tight inline spacing |
| `2` | 8px | Gap between related inline elements (badge + label) |
| `3` | 12px | Form field internal padding, compact list item padding |
| `4` | 16px | Default gap between form fields, card internal padding (compact) |
| `6` | 24px | Gap between sections within a page, compact card padding |
| `7` | 28px | **Card internal padding (default, "generous" per the new direction)** |
| `8` | 32px | Page-level padding, gap between major page regions |
| `12` | 48px | Rare — large vertical separation (e.g. above an empty-state block) |

### Layout

- **App shell:** fixed left sidebar (240px) + main content area — **kept** in this direction
  (confirmed with project owner 2026-06-25) even though the reference screenshot uses a top nav bar.
  Reason: EZOffice's nav surface (Master Data's 4 entities + Attendance/Payroll/ERP, each with their
  own sub-pages) is larger than the reference app's ~6 icon-only links, and a labeled sidebar scales
  better as more modules land. The sidebar is **restyled** to match the new direction — `ink-900`
  background, fully-rounded nav items, active item a solid `primary-600` pill (see AppShell) —
  rather than replaced structurally. Do not switch to a top nav without re-confirming.
- **Page padding:** 24px (`p-6`) on all sides of the main content area.
- **Forms:** single-column, max width ~640px even on wide screens — multi-column forms are harder
  to scan and error-prone for data entry. Exception: explicitly side-by-side fields that are
  logically paired (e.g. date range From/To).
- **Tables:** full width of the content area. Don't constrain table width artificially.
- **Gutter:** 24px between independent layout regions (e.g. a filter sidebar next to a table).

---

## 4. Border Radius & Elevation

**Reversed from the original system (see Design intent)** — generously rounded corners and an
always-on soft shadow are now the intended look, not something to avoid.

| Token | Px | Use for |
|---|---|---|
| `radius-sm` | 8px | Checkboxes, small non-pill chips |
| `radius-md` | 12px | Inputs, selects, dropdown menus |
| `radius-lg` | 16px | Modals, secondary panels |
| `radius-xl` | 20px | **Cards, tables — the primary surface radius** |
| `rounded-full` | — | Buttons, status pills, sidebar nav items, avatar/icon circles |

| Token | Use for |
|---|---|
| `shadow-sm` | **Default for every white card/table surface** against `background` — soft, neutral (`ink`-tinted, never colored), always on. This is no longer a last resort. |
| `shadow-md` | Anything that floats above page content: modal panels, dropdown/select menus, popovers |

Borders are now secondary to shadow for separating surfaces — `border-neutral-200` is still used
for internal dividers (card header/footer rules, table row dividers), but the outer edge of a
Card/Table is defined by `shadow-sm`, not a 1px border.

---

## 5. Component Variants

All components below live in `src/shared/components/` and are shared across every module. A
module-specific copy of any of these is a bug — extend the shared component instead.

### Button

All variants are fully rounded (`rounded-full` — pill shape), per the new direction.

| Variant | Use for |
|---|---|
| `primary` | The one primary action on a screen/dialog (Save, Create Invoice, Run Payroll) — **indigo** (`primary-600`), not ink. See the locked decision in §1. |
| `secondary` | Default/neutral actions (Cancel, Back, secondary filters) — white + neutral border |
| `dark` | **New variant.** Sparingly-used, high-emphasis global actions that sit outside the normal one-primary-per-screen rule — modeled on the reference's "Manage Team" / "Add Task" buttons. `ink-900` bg. Not a substitute for `primary`; don't reach for it just to make a button stand out more. |
| `danger` | Destructive actions (Delete, Void Invoice, Cancel PO) |
| `ghost` | Low-emphasis actions, typically inline/in-table (row-level Edit/View) |

Sizes: `sm` (32px, in-table row actions), `md` (40px, default — forms, toolbars), `lg` (48px,
rare — a single standalone prominent CTA). Default is `md`. Padding is generous relative to the
original system — buttons read as pills, not tight rectangles.

Only **one** `primary` button per view/dialog. If you find yourself wanting two primary buttons,
one of them is actually `secondary` (or, rarely, the screen genuinely needs a `dark` action that
lives outside the dialog's own action flow — e.g. a page-level "Manage Team" next to a page title).

A future pastel "soft" variant (tone-colored bg, e.g. the reference's mint-green "Clock In" /
lavender "Clock Out" buttons) is intentionally **not** added yet — there's no consumer for it until
the Attendance module exists. Don't add unused variant code; revisit when Attendance is built.

### Input / Select

Label always sits **above** the field (not floating, not placeholder-as-label — both hurt
scanability in long forms). Structure: label → field → helper/error text below.

- Required fields: asterisk after the label text, never color alone.
- Error state: `error-600` border + `error-700` helper text replacing the normal helper text (not
  both shown at once).
- Disabled: `neutral-100` background, `neutral-400` text, no border color change on focus.

Use `Select` for a closed, known set of options (status, department, customer). Don't use it for
free text with suggestions — that's a future combobox component, not in scope yet.

### Table

The default way to present any list of records (employees, attendance logs, PO/DO/Invoice lists,
products). Rules:

- Container: `rounded-xl` + `shadow-sm`, matching Card — no outer border.
- Header: transparent background (not a gray band), `border-b neutral-200`, `neutral-500` text,
  sticky on vertical scroll for long lists.
- Rows: white background, `border-t neutral-200` divider, subtle `neutral-50` hover highlight to
  help track a row while scanning. **No zebra striping by default** — clean dividers + hover scan
  better for this app's table widths; revisit only if a specific table proves hard to scan.
- Numeric columns: right-aligned, `tabular-nums`.
- Sortable columns: clickable header with a chevron indicator; sorting state is visual (active
  column + direction), never the only way to find a row — pair with filters where the list can grow
  large (attendance logs, invoices).
- Empty state: centered message inside the table body (not a separate page) — short explanation +
  primary action when there's an obvious next step (e.g. "No employees yet" → "Add Employee").

### Card

Use when content is a **distinct, self-contained unit** with its own boundary: a stat summary
widget, a grouped sub-section inside a modal, a single document preview (one PO/DO/Invoice).

Do **not** use a Card as the default wrapper for a page's main content — a normal page section
(optional heading + spacing) is correct for "the main thing this page is about." This rule is
unchanged even though shadow is now the default *within* the cards this system does use — the
discipline is about not wrapping every section in a Card, not about avoiding shadow itself. Ask:
"is this one of several distinct things on the page, or is it the page?" — only the former gets a
Card. Style: `rounded-xl`, `shadow-sm`, generous `p-7` (28px) internal padding.

### Badge / Status Pill

Reserved for **workflow/document status fields** — PO status, DO status, Invoice status, Payroll
run status, attendance flags (Late/OT/Absent). Style: small pill (`rounded-full`), `-100` tint
background, `-700` text of the matching semantic tone, `text-xs font-medium`.

Do not use Badge for arbitrary labels or boolean toggles (e.g. an employee active/inactive switch is
a toggle control, not a badge) — if everything is a badge, badges stop signaling "this is a status
you should notice."

Tone mapping is defined **per module** (e.g. `erp/constants/poStatus.ts` maps `POStatus` →
`BadgeTone`), not inside the shared `StatusBadge` component — the shared component must stay
domain-agnostic (it knows about visual tones, not about what "Received" means).

### Modal

Use for focused, single-task interactions that should block the main flow: confirmations
(delete/void), quick create/edit forms for master data (Add Employee, Add Product) when the form
is short, and single-action confirmations (Mark PO as Received).

Do **not** use a Modal for long or multi-section flows (full Payroll run review, Invoice creation
with line items) — those get a dedicated page/route. A modal that becomes a scrollable mini-app is a
sign it should not be a modal.

Sizes: `sm` (~400px, confirmations), `md` (~560px, short forms — default), `lg` (~720px, richer
content). Structure: backdrop (`neutral-900` at 50% opacity) → panel (title + close button, scrollable
body, footer with actions right-aligned, primary action rightmost).

---

## 6. Decision shortcuts (quick reference)

- **Card vs plain section?** Card = one of several distinct things on the page. Plain section =
  the page's main content.
- **Badge vs plain text?** Badge = a workflow/document status value. Plain text = everything else,
  including booleans (use a toggle/switch instead).
- **Modal vs page?** Modal = short, single task, blocks flow. Page = anything with line items,
  multiple sections, or a review step.
- **Which gray for this text?** `neutral-900` body/headings, `neutral-600` secondary/labels,
  `neutral-400` placeholder/disabled. Never pure black, never below `neutral-400` for text that must
  be read.
- **Indigo or ink for this button?** Indigo (`primary`) for the screen's one primary action.
  Ink (`dark`) only for sparingly-used, standout global actions outside that one-primary rule
  (e.g. "Manage Team"). When in doubt, use `primary`.
- **Does this need a shadow?** If it's a Card or Table, yes (`shadow-sm`) — that's the default now,
  not an exception. Don't add shadow to anything else (buttons, badges, inline elements).
