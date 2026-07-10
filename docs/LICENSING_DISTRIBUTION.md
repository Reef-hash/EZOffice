# EZOffice: Distribution, Updates & Licensing

> **⚠️ SUPERSEDED (2026-07-08):** The license key scheme in Section 2 below (forgeable
> SHA256, no secret) and the standalone Python-script issuance flow are **scrapped**.
> EZOffice now integrates with the existing EZPos-Web licensing platform instead — see
> `docs/LICENSE_INTEGRATION_AUDIT.md` for the current design. Sections on installer
> distribution (Section 1) and update delivery may still be useful reference; ignore
> Sections 2–3 (License Key System / Activation) entirely.

## Overview

For Phase A launch (first client), you need:
1. **Installer delivery** — how client gets the `.exe`
2. **License activation** — how they validate purchase
3. **Update delivery** — how they get bug fixes & improvements
4. **License key generation** — who creates keys, where they live

This document covers all four.

---

## 1. Installer Distribution

### Option A: Direct File Share (Simplest, for MVP)

**How it works:**
```
You → Generate installer (npm run build:installer)
   → Upload to file share (Google Drive, Dropbox, OneDrive, or self-hosted)
   → Share link with client via email
   → Client downloads & installs
```

**Setup (pick one):**

**1a. Google Drive**
- Upload `dist/EZOffice-0.1.0.exe` to a shared folder
- Share link: `https://drive.google.com/file/d/xxxxx/view?usp=sharing`
- Client: download, double-click, install

**1b. Dropbox**
- Upload to `Dropbox/EZOffice/installers/`
- Share link: `https://www.dropbox.com/s/xxxxx/EZOffice-0.1.0.exe?dl=1`
- Client: download, install

**1c. Self-hosted (AWS S3 / Backblaze B2)**
- Upload to S3 bucket (cheap, ~$0.023/GB/month)
- Share signed URL with expiry (48 hours)
- Client: download, install

**Pros:**
- ✅ Zero setup, works immediately
- ✅ Client has permanent link to versions
- ✅ Easy to track download count

**Cons:**
- ❌ Manual file upload each time
- ❌ No automatic updates (client must re-download)

**Recommended for MVP:** Use **Dropbox** (free tier covers small user base) or **Google Drive** (easiest).

---

### Option B: GitHub Releases (Professional)

**How it works:**
```
You → Create GitHub release tag (v0.1.0)
   → Upload dist/EZOffice-0.1.0.exe as release asset
   → Client downloads from GitHub releases page
```

**Setup:**
```bash
# Tag current commit
git tag v0.1.0
git push origin v0.1.0

# Create release via gh CLI
gh release create v0.1.0 dist/EZOffice-0.1.0.exe \
  --title "EZOffice v0.1.0" \
  --notes "Initial release"
```

**Client access:**
- GitHub: `https://github.com/yourusername/ezoffice/releases/tag/v0.1.0`
- Direct link: `https://github.com/yourusername/ezoffice/releases/download/v0.1.0/EZOffice-0.1.0.exe`

**Pros:**
- ✅ Professional, version-tracked
- ✅ Client can check release notes
- ✅ Easy to manage multiple versions

**Cons:**
- ❌ Requires public GitHub repo (if privacy is concern)
- ❌ Still manual uploads

**Recommended for:** Later, when you have multiple versions/clients.

---

## 2. License Key System

### License Key Format

**Simple, time-based format:**
```
EZOF-2026-001-ABCD1234-HASH
```

**Breakdown:**
- `EZOF` — product code
- `2026` — issue year
- `001` — client ID (001 = first client, 002 = second, etc.)
- `ABCD1234` — readable identifier (client initials + 4 chars)
- `HASH` — validation hash (SHA256 of above)

**Example:**
```
EZOF-2026-001-AMIT0001-a7f3e8b2c91d4k6m2p9x5q1r8s3t7u9v
```

---

### License Key Generation

**Step 1: Create a simple license generator script**

```python
# scripts/generate_license.py
import hashlib
from datetime import datetime

def generate_license(client_name, client_id):
    """Generate a license key for a client."""
    year = datetime.now().year
    initials = client_name[:4].upper()
    
    # Base string (what gets hashed)
    base = f"EZOF-{year}-{client_id:03d}-{initials}0001"
    
    # Generate hash
    hash_obj = hashlib.sha256(base.encode())
    hash_str = hash_obj.hexdigest()[:32]  # First 32 chars
    
    # Final key
    license_key = f"{base}-{hash_str}"
    return license_key

# Usage
if __name__ == "__main__":
    # Client 1
    key = generate_license("Ahmad Imports", 1)
    print(f"Client 1: {key}")
    
    # Client 2
    key = generate_license("Siti Manufacturing", 2)
    print(f"Client 2: {key}")
```

**Run it:**
```bash
python scripts/generate_license.py
# Output:
# Client 1: EZOF-2026-001-AHMA-a7f3e8b2c91d4k6m2p9x5q1r8s3t7u9v
# Client 2: EZOF-2026-002-SITI-k3d8e9f1b2c4a5k6m7n8o9p1q2r3s4t5
```

**Store keys in a simple CSV (for you):**
```csv
client_id,client_name,license_key,issue_date,expiry_date,status
1,Ahmad Imports,EZOF-2026-001-AHMA-a7f3e8b2c91d...,2026-06-29,2027-06-29,active
2,Siti Manufacturing,EZOF-2026-002-SITI-k3d8e9f...,2026-06-29,2027-06-29,active
```

**Keep this file safe:** `secrets/licenses.csv` (git-ignored)

---

## 3. License Activation (In-App)

### How It Works

**First Launch:**
```
User runs EZOffice.exe
  ↓
No database exists yet
  ↓
Show "License Activation" screen
  ↓
User enters: License Key
  ↓
App validates key (hash check)
  ↓
If valid: Store key in DB, proceed to signup
If invalid: Show error, block app
```

### Implementation

**Step 1: Add license key to database**

```sql
-- Migration: 0006_license_activation.sql
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  client_name TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  status TEXT CHECK(status IN ('active', 'expired', 'revoked')) DEFAULT 'active',
  activated_at TEXT,
  notes TEXT
);
```

**Step 2: Create license validation service**

```typescript
// electron/services/license.ts
import { createHash } from 'node:crypto'

export function validateLicenseKey(key: string): { valid: boolean; error?: string } {
  // Format: EZOF-YYYY-CCC-XXXX-HASH
  const parts = key.split('-')
  if (parts.length !== 5) {
    return { valid: false, error: 'Invalid license key format' }
  }

  const [prefix, year, clientId, identifier, providedHash] = parts

  if (prefix !== 'EZOF') {
    return { valid: false, error: 'Invalid product code' }
  }

  // Recreate expected hash
  const baseString = `${prefix}-${year}-${clientId}-${identifier}`
  const expectedHash = createHash('sha256')
    .update(baseString)
    .digest('hex')
    .substring(0, 32)

  if (providedHash !== expectedHash) {
    return { valid: false, error: 'Invalid license key (checksum mismatch)' }
  }

  const currentYear = new Date().getFullYear()
  if (Number(year) < currentYear - 1) {
    return { valid: false, error: 'License key expired' }
  }

  return { valid: true }
}

export function activateLicense(db: Database.Database, licenseKey: string, clientName: string): boolean {
  const validation = validateLicenseKey(licenseKey)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const expiryDate = new Date()
  expiryDate.setFullYear(expiryDate.getFullYear() + 1)

  db.prepare(`
    INSERT INTO licenses (license_key, client_name, expires_at, activated_at, status)
    VALUES (@key, @name, @expiry, datetime('now'), 'active')
  `).run({
    key: licenseKey,
    name: clientName,
    expiry: expiryDate.toISOString(),
  })

  return true
}

export function checkLicenseStatus(db: Database.Database): { valid: boolean; clientName?: string; error?: string } {
  const license = db.prepare(`
    SELECT client_name, expires_at, status FROM licenses WHERE status = 'active' LIMIT 1
  `).get() as any

  if (!license) {
    return { valid: false, error: 'No active license found' }
  }

  if (new Date(license.expires_at) < new Date()) {
    return { valid: false, error: 'License expired' }
  }

  return { valid: true, clientName: license.client_name }
}
```

**Step 3: Create license activation UI**

```typescript
// src/modules/auth/LicenseActivationPage.tsx
import { useState } from 'react'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'

interface LicenseActivationPageProps {
  onActivationSuccess: (clientName: string) => void
}

export function LicenseActivationPage({ onActivationSuccess }: LicenseActivationPageProps) {
  const [licenseKey, setLicenseKey] = useState('')
  const [clientName, setClientName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activateMutation = useIpcMutation(
    (data: { licenseKey: string; clientName: string }) => 
      window.api.license.activate(data.licenseKey, data.clientName),
    []
  )

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      await activateMutation.mutateAsync({ licenseKey, clientName })
      onActivationSuccess(clientName)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">EZOffice</h1>
        <p className="mt-2 text-sm text-neutral-600">License Activation</p>

        {error && (
          <div className="mt-4 rounded-sm bg-error-50 p-3 text-sm text-error-700">
            {error}
          </div>
        )}

        <form onSubmit={handleActivate} className="mt-6 space-y-4">
          <Input
            label="Client Name"
            value={clientName}
            onChange={(e) => {
              setClientName(e.target.value)
              setError(null)
            }}
            placeholder="Your company name"
            required
          />

          <Input
            label="License Key"
            value={licenseKey}
            onChange={(e) => {
              setLicenseKey(e.target.value)
              setError(null)
            }}
            placeholder="EZOF-XXXX-XXX-XXXX-XXXXX..."
            required
          />

          <Button
            type="submit"
            variant="primary"
            disabled={activateMutation.isPending}
            isLoading={activateMutation.isPending}
            className="w-full"
          >
            Activate License
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-500">
          Enter your license key to activate EZOffice
        </p>
      </div>
    </div>
  )
}
```

**Step 4: Update App.tsx flow**

```typescript
// In App.tsx, before LoginPage:
if (!auth.isAuthenticated) {
  const licenseStatus = checkLicenseStatus(db) // pseudo-code
  if (!licenseStatus.valid) {
    return <LicenseActivationPage onActivationSuccess={handleLicenseActivation} />
  }
  return <LoginPage ... />
}
```

---

## 4. Update Delivery Strategy

### Option A: Manual (For MVP)

**When you fix a bug or add a feature:**
1. Increment version in `package.json` (e.g., `0.1.0` → `0.1.1`)
2. Run `npm run build:installer`
3. Upload new `.exe` to Dropbox/Google Drive
4. Send email to client: "New version 0.1.1 available, download link: [URL]"
5. Client downloads & reinstalls

**Pros:**
- ✅ No server setup needed
- ✅ Full control over deployment

**Cons:**
- ❌ Manual process each time
- ❌ Client may miss updates

**Recommended for:** First 5–10 clients (manual is fine).

---

### Option B: Auto-Update (Later, Phase 6+)

**When ready to scale:**

1. **Host update manifest on a server:**
   ```json
   // https://your-server.com/updates/latest.json
   {
     "version": "0.2.0",
     "url": "https://your-server.com/releases/EZOffice-0.2.0.exe",
     "notes": "Bug fixes and performance improvements"
   }
   ```

2. **Add auto-update check to app startup:**
   ```typescript
   // electron/updates/checker.ts
   import { autoUpdater } from 'electron-updater'
   
   export function initAutoUpdates() {
     autoUpdater.checkForUpdatesAndNotify()
   }
   ```

3. **User sees prompt:** "Update available (0.2.0). Install now?"

**Requires:**
- Server hosting (AWS S3, GitHub Releases, or third-party like Heroku)
- `electron-updater` npm package (~2 hours setup)

**Recommended for:** After 20+ clients or when manual updates become tedious.

---

## 5. Full Activation Flow (Summary)

```
┌─────────────────────────────────────────┐
│ User installs EZOffice.exe              │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ App launches, checks DB                 │
│ (Does license exist?)                   │
└────────────┬────────────────────────────┘
             │
       No ───┤── Yes
       │     │
       ▼     ▼
┌──────────────────────┐  ┌────────────────┐
│ License Activation   │  │ Check License  │
│ Screen               │  │ Expiry         │
│ (Enter key)          │  │                │
└──────────┬───────────┘  └────────┬───────┘
           │                       │
      Valid?                   Valid?
       │ │                      │ │
       │ No→ Error              │ No→ Error
       │    Retry               │    (Expired/Revoked)
       │                        │
       Yes                      Yes
       │                        │
       └───────┬────────────────┘
               │
               ▼
        ┌──────────────────┐
        │ Admin Login      │
        │ (Create account) │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ EZOffice App     │
        │ Full access      │
        └──────────────────┘
```

---

## 6. For First Client (Action Plan)

### This Week:

1. **Generate license key:**
   ```bash
   python scripts/generate_license.py "Ahmad Imports" 1
   # Output: EZOF-2026-001-AHMA-a7f3e8b2c91d...
   ```

2. **Create installer:**
   ```bash
   npm run build:installer
   # Creates: dist/EZOffice-0.1.0.exe
   ```

3. **Upload to Dropbox/Drive:**
   - Share link with client

4. **Send email to client:**
   ```
   Subject: EZOffice - Installation & License
   
   Hi Ahmad,
   
   Your EZOffice installer and license key are ready:
   
   📥 Installer: [Dropbox link]
   🔑 License Key: EZOF-2026-001-AHMA-a7f3e8b2c91d...
   
   Installation steps:
   1. Download the installer
   2. Run EZOffice-0.1.0.exe
   3. On first launch, enter your license key + company name
   4. Create admin account (username + password, 8+ chars)
   5. Start using EZOffice
   
   Support: Email me if you hit any issues
   
   Best,
   [Your name]
   ```

---

## 7. License Key Storage (You)

**Keep a spreadsheet:**

| Client ID | Client Name | License Key | Issued | Expires | Status | Notes |
|-----------|-------------|-------------|--------|---------|--------|-------|
| 001 | Ahmad Imports | EZOF-2026-001-AHMA-a7f3e8b... | 2026-06-29 | 2027-06-29 | active | Beta tester |
| 002 | Siti Mfg | EZOF-2026-002-SITI-k3d8e9f... | 2026-07-15 | 2027-07-15 | active | Paid customer |

**Store in:** `secrets/licenses.csv` (git-ignored, backup regularly)

---

## Summary

| Step | Tool | Effort |
|------|------|--------|
| **Generate license key** | Python script | 1 hour (one-time) |
| **Build installer** | `npm run build:installer` | 5 min each release |
| **Upload installer** | Dropbox / Google Drive | 2 min each release |
| **Send to client** | Email | 5 min each client |
| **Client installs** | EZOffice.exe | Auto (license activation built-in) |
| **Auto-updates** | electron-updater | Later (Phase 6+) |

---

**Ready to activate first client?** Generate key + build installer + share link?
