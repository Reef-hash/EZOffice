# EZOffice ↔ EZPos-Web Licensing Integration Audit (2026-07-08)

Senior-level audit of how EZOffice desktop app should integrate with the existing
EZPos-Web licensing platform, instead of the standalone/forgeable scheme described in
the now-superseded `docs/LICENSING_DISTRIBUTION.md` and `docs/SALES_LICENSING_FLOW.md`.

**This is a findings + solutions document. No code has been changed.** Written for an
implementing agent that will touch BOTH repos: `EZOffice` (Electron desktop app) and
`EZOffice/EZPos-Web` (Express + Next.js licensing backend, already live for EZPos/CrossxPos).

---

## Why the old plan is scrapped

`docs/LICENSING_DISTRIBUTION.md` proposed a license key of the form
`EZOF-YYYY-CCC-XXXX-SHA256(...)` with **no secret in the hash** — anyone who unpacks the
Electron app can read the algorithm and mint valid keys for any name. It also assumed a
Python script + `secrets/licenses.csv` for tracking, and treated Stripe as future work.

None of that is needed: **EZPos-Web already has a real licensing platform**
(`backend/supabase-licensing-v1.sql`, contract in `backend/../docs/LICENSING-V1-CONTRACT.md`)
serving EZPos and CrossxPos today, with Stripe fully wired, an admin manual-issue endpoint,
and a Postgres/Supabase schema designed to hold N products. EZOffice becomes product #3,
not a new system.

---

## Current state of EZPos-Web (what already exists, verified by reading the code)

- **Schema** (`backend/supabase-licensing-v1.sql`): `products` → `plans` → `entitlements`
  (customer_id, product_id, plan_id, status: pending/active/suspended/revoked/expired,
  starts/expires_at) → `license_credentials` (license_key) → `activations` (device binding)
  → `validation_events` (audit). No CHECK constraint restricting product codes.
- **Legacy schema** (`backend/supabase-schema.sql`) DOES CHECK-constrain product to
  `('ezpos','crossxpos')`. Whether `ezoffice` needs a legacy row too depends on whether
  `createV1LicensingRecords` (in `webhook.ts`) also writes legacy tables — **implementing
  agent must check this function before assuming V1-only is sufficient.**
- **Customer identity:** Supabase Auth **magic-link only** — no passwords are stored for
  customers. `requirePortalAuth` (`backend/src/middleware/...`) validates a Supabase
  session token, then looks up `customers` by email. Admin login (JWT, single hardcoded
  credential) is a completely separate mechanism — irrelevant to end-client identity.
- **Manual issuance (cash/transfer clients):** `POST /api/admin/v1/keys/generate` in
  `adminV1.ts` already upserts a customer + creates entitlement + credential directly,
  no checkout required. **This is the "boss generates account for cash-paying client"
  flow — it already exists, confirm it accepts an arbitrary product code.**
- **Online purchase (Stripe):** `backend/src/routes/webhook.ts` handles
  `checkout.session.completed` and writes both legacy + V1 licensing records automatically,
  emails the license via Resend. Already live for other products.
- **Validation contract** (`LICENSING-V1-CONTRACT.md`): `POST /api/v1/licensing/activate`
  and `/validate` return a decision (`allow` / `deny` / `allow_temporarily`) + a
  **policy hint** (`graceDays`, `revalidateAfterHours`) — this is a **"validate once, cache
  the decision, trust the cache until graceDays elapses" model, not a signed offline
  token.** Policy is per-product via `product_policy_profiles` — EZPos uses graceDays=7,
  CrossxPos uses 1-3. **Gap:** the doc itself states *"Activation persistence (activations
  table write) is planned in next iteration"* — device-binding enforcement on `/activate`
  is not fully wired yet; must be completed as part of this work, not assumed done.

---

## Decisions — LOCKED by project owner (2026-07-08)

| # | Decision | Outcome |
|---|----------|---------|
| L1 | Desktop first-activation identity | **Reuse Supabase magic-link**, same mechanism as the website's customer portal. No new password system. Client types their email once in EZOffice, receives a code/link, done — same "account" whether they paid cash or via Stripe, because either path ends up as the same `customers` row. |
| L2 | Offline grace period for EZOffice specifically | **60–90 days** (recommend 75 as the concrete value), configured as EZOffice's own `product_policy_profiles` row — does NOT change EZPos's 7-day or CrossxPos's 1–3 day policies. Reasoning: payroll must run even through weeks of factory-side internet outage; EZPos/CrossxPos are store-front apps with more reliable connectivity and stay untouched. |

## Open decisions — flag to owner, do not implement silently

| # | Question | Recommendation |
|---|----------|-----------------|
| O1 | Pricing/billing model in the `plans` row | Old sales doc assumed one-time (perpetual) + optional annual "support" fee, not real subscription enforcement. Schema supports both (`billing_model: perpetual|subscription`). Confirm with owner which to actually configure — this changes whether `expires_at` ever meaningfully fires a deny. |
| O2 | Seats/devices per license | Recommend `seat_limit = 1` (one installation per company, matches SME single-office use), with the existing `transfer_requests` flow used for legitimate hardware replacement (new PC). |
| O3 | Tamper-resistance on the cached local decision | MVP: cache the last `/validate` response as plain JSON in EZOffice's local SQLite — good enough for the SME threat model (this is a business-integrity control, not defense against a sophisticated attacker). Hardening option: have the backend HMAC-sign the cached decision with a secret embedded in the Electron app, so editing the local SQLite row can't fake validity — recommend deferring unless piracy becomes an actual observed problem. |
| O4 | `revalidateAfterHours` value | Recommend 24–48h when online — frequent enough to catch a revoke/suspend promptly, loose enough to never matter to an offline client (grace period is what protects them, not this number). |

---

## Target flow — first activation (needs internet, once)

1. Client (cash-paying, boss set them up manually via `POST /api/admin/v1/keys/generate`,
   OR self-registered + paid via Stripe checkout on the website) ends up as a row in
   `customers` with an active `entitlements` row for product `ezoffice`.
2. Client installs EZOffice, launches it. **New gate, before the existing Phase A
   admin-login/signup screen**: "Activate EZOffice" — enter email.
3. EZOffice app (bundled with the Supabase **anon** key — public, safe to ship) calls
   Supabase Auth directly to send a magic link/OTP code to that email. Client enters the
   code in the app (or clicks the link, which deep-links back if feasible — OTP code is
   simpler for a desktop app and recommended).
4. App now holds a Supabase session token for that customer. App calls EZPos-Web's
   `POST /api/v1/licensing/activate` with: Supabase session token (Authorization header,
   validated the same way `requirePortalAuth` already does), `product: "ezoffice"`,
   `DeviceId`: a stable machine fingerprint (e.g. `node-machine-id` — new dependency,
   isolated to one module).
5. Backend resolves customer from the session token → finds `entitlements` row for
   `ezoffice` → writes the `activations` row (the currently-missing persistence, see gap
   above) → returns the decision + policy hint (`graceDays`, `revalidateAfterHours`).
6. EZOffice stores the full decision + a `checked_at` timestamp locally (new SQLite table,
   see below). Proceeds to the existing Phase A admin-account creation screen if this is
   truly first launch, otherwise straight into the app.

## Target flow — every subsequent launch (works fully offline)

1. Read the locally cached decision.
2. If `now - checked_at < graceDays` → allow, proceed immediately. **Never blocks for
   lacking internet within the grace window** — offline-first is preserved.
3. If online AND `now - checked_at > revalidateAfterHours` → silently call `/validate` in
   the background, refresh the cache, continue regardless of the call's outcome timing
   (don't make the user wait on this).
4. If the last cached decision itself was `deny` (expired/revoked/suspended), or the grace
   window has elapsed with no successful revalidation → block with the specific message
   from the contract's `client_action` (`renew_subscription`, `contact_support`, etc.), not
   a generic error.

## Exception paths

| Problem | What happens | What the admin/client does |
|---|---|---|
| Client activates offline (no internet at install) | Activation cannot complete — this is the one moment internet is mandatory | Client connects to any internet (phone hotspot is enough) once, then retries |
| Subscription/support lapses (O1-dependent) | `/validate`'s next successful call returns `expired` → cached, surfaces `renew_subscription` message once grace elapses | Client pays renewal → owner reactivates via admin panel → next online check picks it up |
| Owner revokes (non-payment, dispute) | Same mechanism as expiry — `revoked` status, `contact_support` action | Owner and client resolve manually |
| Client replaces their PC | New machine fingerprint → `/activate` returns `device_mismatch` (or seat_exceeded if `seat_limit=1` and old device still counted active) | Use the existing `transfer_requests` flow already built for EZPos/CrossxPos — same code reused |
| EZPos-Web itself is down when a background revalidate fires | Revalidate silently fails, cached decision keeps being trusted until graceDays | No client-visible impact — this is the entire point of the grace design |
| Local SQLite `license_state` row deleted/corrupted (accidental or deliberate) | Falls back to "not activated" — client must reactivate (needs internet once) | If accidental: acceptable inconvenience. If this becomes a recurring support cost, revisit O3 (signed cache) |

---

## Work items — Backend (EZPos-Web)

1. Insert a `products` row (`code='ezoffice'`) and at least one `plans` row (billing model
   per O1). Verify whether the legacy CHECK-constrained table also needs a row (check
   `createV1LicensingRecords` in `webhook.ts`) — either loosen the CHECK or confirm the
   webhook path can skip the legacy table for this product.
2. Add a `product_policy_profiles` row for `ezoffice`: `graceDays=75`, `revalidateAfterHours`
   per O4, `seat_limit` per O2, transfer_mode allowed.
3. **Complete the missing `activations` table write** in the `/activate` handler — this is
   the one real backend gap, currently stubbed per the contract doc's own admission.
4. Verify `POST /api/admin/v1/keys/generate` accepts an arbitrary/new product code
   end-to-end (manual cash-client issuance path) — write one manual test case.
5. Confirm CORS / auth wiring accepts the Electron app calling `/api/v1/licensing/*` with
   a Supabase session token the same way the customer portal does (`requirePortalAuth`) —
   may need a small adapter if the portal middleware assumes a browser-originated request.
6. No new payment/auth system — explicitly do not build a parallel license-key generator,
   parallel customer table, or parallel Stripe integration. Reuse only.

## Work items — EZOffice (Electron app)

1. New migration: `license_state` table — columns: `id` (singleton, =1), `entitlement_json`
   (last full `/validate` or `/activate` response), `checked_at`, `device_fingerprint`,
   `created_at`, `updated_at`. Service layer (`electron/services/license.ts`), db-first-arg
   pattern per CLAUDE.md §4.
2. New "Activate EZOffice" screen, gated **before** the existing `isFirstLaunch`/login
   branch in `src/App.tsx` — email entry → OTP code entry → calls backend → stores result
   → proceeds to existing Phase A flow.
3. Launch-time check (in `main.ts` before window shows, or very early in `App.tsx`):
   implement the grace-window logic from the target flow above. Background revalidation
   must never block the render of the main window.
4. New dependency: a machine-fingerprint library (`node-machine-id` or equivalent) —
   isolate behind a typed wrapper per CLAUDE.md §3 (no `any` leaking out).
5. New dependency: `@supabase/supabase-js` in the Electron main process (or a minimal
   direct HTTPS call to Supabase's OTP endpoint, avoiding a second full SDK if the bundle
   size / native-module interaction with `vite-plugin-electron` is a concern — evaluate
   both, prefer the SDK unless it fights the Electron build like `pdfmake` did in Phase 4).
6. Renderer never talks to Supabase or the licensing backend directly — same IPC boundary
   rule as everything else in this app. All of this lives behind `electron/services/license.ts`
   + `electron/ipc/license.ts`.

---

## Documentation cleanup

`docs/LICENSING_DISTRIBUTION.md` and `docs/SALES_LICENSING_FLOW.md` describe the scrapped
forgeable-key/Python-script scheme and predate discovery of EZPos-Web. Mark both
superseded-by-this-doc (a banner at the top, not deletion — they still have usable pricing/
invoice-template content for O1) rather than following their license/activation mechanics.

## Suggested implementation order

1. Backend: schema data (`products`/`plans`/`product_policy_profiles` rows) + complete the
   `activations` write gap — smallest, unblocks everything else, no Electron changes yet.
2. Backend: confirm/adapt Supabase-session auth on `/api/v1/licensing/*` for a non-browser
   (Electron) caller.
3. EZOffice: `license_state` migration + service + IPC (no UI yet, testable in isolation).
4. EZOffice: Activate screen + first-launch gating.
5. EZOffice: launch-time grace-window check + background revalidation.
6. End-to-end test: activate on a real machine, kill network, confirm app still opens for
   the grace window; revoke from admin panel, confirm next online check blocks correctly.