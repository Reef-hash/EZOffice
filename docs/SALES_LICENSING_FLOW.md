# EZOffice: Sales & Licensing Flow

**Purpose:** How clients purchase EZOffice, get license keys, and activate the software.

---

## Sales Process (Your Side)

### Step 1: Client Inquiry
```
Client contacts you:
  "Berapa harga EZOffice? Boleh guna untuk payroll?"
```

**Your response template:**
```
Hello [Client Name],

Thank you for your interest in EZOffice.

📋 PACKAGE: Attendance + Payroll System
✅ Features:
  - Fingerprint attendance (ZKTeco integration ready)
  - Monthly payroll calculation (EPF, SOCSO, EIS, PCB)
  - Salary advances tracking
  - Master data (employees, customers, suppliers, products)
  - Admin audit trail

💰 PRICING:
  - One-time license: RM 2,500 (5-15 employees)
  - Annual support: RM 500 (optional)
  - Setup/training: RM 800 (optional)
  
  Total Year 1: RM 2,500 - RM 3,800

⏰ DELIVERY:
  - License key issued within 24 hours of payment
  - Installer provided same day
  - Setup call: 1 hour remote training

Interested? Proceed to payment.
```

---

### Step 2: Client Decides to Purchase

**Two options (you choose):**

#### Option A: Manual (MVP Stage — Recommended for first 5 clients)

**How it works:**
```
Client says: "Yes, I want it"
   ↓
You send: Invoice (manually created in Excel/Word)
   ↓
Client pays: Bank transfer to your account
   ↓
You verify: Payment received in your bank
   ↓
You generate: License key (Python script)
   ↓
You send: License key + installer link (email)
   ↓
Client: Activates and uses
```

**Tools you need:**
- Invoice template (Word/Excel)
- Bank account for receiving payments
- Python script to generate license keys (already provided)
- Dropbox/Google Drive to host installers

**Process (5 min per client):**
1. Create invoice with your details + pricing
2. Send to client via email
3. Wait for payment confirmation
4. Run: `python scripts/generate_license.py "Client Name" [CLIENT_ID]`
5. Save key to `secrets/licenses.csv`
6. Email key + Dropbox installer link
7. Client activates + done

---

#### Option B: Online Payment Gateway (Later, when scaling)

**Recommended when you have 10+ clients:**

Use one of:
- **Stripe** (international, PayPal compatible)
- **2Checkout/Verifone** (Malaysia-friendly)
- **Wise/Payoneer** (low fees)

**Flow:**
```
Client clicks "Buy Now" on your website
   ↓
Redirected to Stripe checkout
   ↓
Client enters card details + email
   ↓
Stripe confirms payment
   ↓
Webhook triggers automation:
  - Generate license key automatically
  - Send key + installer link via email
  - Add to clients database
   ↓
Client receives email:
  "Your license: EZOF-2026-XXX-..."
  "Download: [link]"
```

**Setup effort:** ~8–10 hours (requires backend API)  
**Recommended for:** After first 10 paying clients

---

## Payment Tracking (Your Side)

### Spreadsheet: `secrets/sales_log.csv`

```csv
date,client_name,client_id,license_key,amount_rm,payment_method,payment_date,status,notes
2026-07-15,Ahmad Imports,001,EZOF-2026-001-AHMA-a7f3e8b2c91d,2500,bank_transfer,2026-07-15,paid,first client
2026-07-20,Siti Manufacturing,002,EZOF-2026-002-SITI-k3d8e9f1b2c4,2500,bank_transfer,2026-07-21,paid,referred by Ahmad
```

**Track:**
- ✅ Payment received (date + amount)
- ✅ License key issued
- ✅ Installer sent
- ✅ Support period (1 year from issue date)

---

## License Activation Flow (Client Side)

```
┌─────────────────────────────────┐
│ Client Receives Email:           │
│ 1. License key: EZOF-2026-001... │
│ 2. Installer link: [Dropbox]     │
│ 3. Setup guide                   │
└────────────┬────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │ Download installer │
    │ from Dropbox link  │
    └────────┬───────────┘
             │
             ▼
    ┌──────────────────────────────┐
    │ Run EZOffice-0.1.0.exe       │
    │ (Windows only)               │
    └────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────┐
    │ License Activation Screen:   │
    │ - Enter License Key          │
    │ - Enter Company Name         │
    │ - Click Activate             │
    └────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────┐
    │ Admin Signup Screen:         │
    │ - Username                   │
    │ - Password (8+, uppercase... │
    │ - Click Create Account       │
    └────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────┐
    │ ✅ App Ready                  │
    │ Attendance + Payroll active  │
    └──────────────────────────────┘
```

---

## Pricing Strategy (for your consideration)

### Option 1: Flat Per-Installation (Recommended MVP)
```
RM 2,500 per company (one-time)
RM 500/year optional support
```

**Pros:**
- Simple to understand
- Client feels they "own" it
- Works for 5–50 employee range

**Cons:**
- No recurring revenue without support
- No scaling with company size

---

### Option 2: Tiered by Employee Count (Later)
```
1-15 employees:   RM 2,000
16-30 employees:  RM 3,500
31-50 employees:  RM 5,000
50+ employees:    Custom quote
```

**Pros:**
- Fair pricing by usage
- Encourages larger deals

**Cons:**
- More complex to explain
- Need to validate employee count

---

### Option 3: SaaS Monthly (Not recommended — breaks offline-first promise)
```
RM 200/month per company
```

**Pros:**
- Recurring revenue
- Easy to add/remove

**Cons:**
- Requires cloud server (adds infrastructure cost)
- Kills offline-first value prop
- Won't appeal to Malaysian SMEs (internet-sensitive)

---

## Support & Renewal

### Year 1 (Included in License)
- ✅ Bug fixes
- ✅ Email support (24-hour response)
- ✅ All feature updates (Phase B, C, D)
- ✅ License valid for 1 year

### Year 2+

**Client receives email (11 months after purchase):**
```
Subject: EZOffice License Renewal Required

Hi [Client Name],

Your EZOffice license expires on [Date].
To continue receiving updates and support, renew for RM 500/year.

[Renew button] or reply to this email.

Support after expiry: License stays active, but no updates.
```

**Options:**
- ✅ Renew: RM 500 (get another year of support)
- ✅ Don't renew: License stays active forever (no support)

---

## For First Client (Action Steps)

### Week 1 (Before ZKTeco Arrives)

1. **Create invoice template** (5 min)
   ```
   [Your Company Name]
   [Your Email]
   [Bank Account Details]
   
   INVOICE
   Date: ___
   Client: ___
   
   EZOffice License (5-15 employees) — RM 2,500
   Setup & Training (optional)            — RM 800
   Annual Support (optional)              — RM 500
   ─────────────────────────────────────────
   Total: RM ___
   
   Payment: Bank transfer to [Account]
   Due Date: [Date]
   ```

2. **Prepare license generator** (already done)
   ```bash
   python scripts/generate_license.py "Client Name" 1
   ```

3. **Set up payment tracking** (5 min)
   - Create `secrets/sales_log.csv`
   - Save template above

### Week 2 (When Ready to Sell)

1. **Client says yes** → Send invoice
2. **Client pays** → Verify in bank
3. **Generate key:**
   ```bash
   python scripts/generate_license.py "Ahmad Imports" 1
   # Output: EZOF-2026-001-AHMA-a7f3e8b2c91d...
   ```
4. **Send email:**
   ```
   Subject: EZOffice License & Installer

   Hi Ahmad,

   Thank you for your purchase!

   📥 Download Installer:
   https://www.dropbox.com/s/xxxxx/EZOffice-0.1.0.exe?dl=1

   🔑 License Key:
   EZOF-2026-001-AHMA-a7f3e8b2c91d...

   📖 Setup Steps:
   1. Download installer
   2. Run EZOffice-0.1.0.exe
   3. Enter license key on first launch
   4. Create admin account
   5. Start using!

   Questions? Reply to this email.

   Best,
   [Your Name]
   ```
5. **Done.** Client activates and uses.

---

## License Key Tracking (You)

**Keep safe:**
- `secrets/licenses.csv` — all issued keys
- `secrets/sales_log.csv` — payment records
- Bank statements — payment confirmations

**Backup:**
- Weekly backup to external drive
- Once per month to cloud (Google Drive personal backup)

---

## Scaling to 10+ Clients (Later)

When you have 10+ clients, consider:

1. **License management dashboard** (simple web app)
   - View all issued licenses
   - Track renewals
   - See support expiry dates

2. **Automated email reminders** (1 month before renewal)
   - "Your license expires on X"
   - "Renew now for RM 500"

3. **Auto-update delivery** (electron-updater)
   - Client gets updates automatically
   - No manual installer uploads

4. **Support ticketing** (Linear / Jira)
   - Track issues per client
   - SLA tracking (24-hour response)

---

## Summary: Flow for First Client

```
You:
  1. Client asks → Send pricing email (5 min)
  2. Client says yes → Create invoice (2 min)
  3. Client pays → Verify payment (2 min)
  4. Generate key → python script (1 min)
  5. Send license + link → Email (2 min)
  
Client:
  1. Download installer
  2. Run .exe
  3. Enter license key
  4. Create admin account
  5. Use app

Total time from inquiry to handoff: ~30 min
```

---

**For first 5 clients: Manual process is fine.**  
**When you hit 10+ clients: Automate with Stripe + webhook.**

Ready to sell?
