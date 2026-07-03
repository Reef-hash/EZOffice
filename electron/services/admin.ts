// Admin authentication & audit logging service.
// All functions take `db` as the first argument (testable, no hidden global).

import type Database from 'better-sqlite3'

// Password hashing: use bcrypt-compatible algorithm.
// In production, use bcrypt library; for MVP, use Node.js crypto.
import { scryptSync, randomBytes } from 'node:crypto'

// ── Password Hashing ─────────────────────────────────────

/**
 * Validate password strength.
 * Required: 8+ chars, 1 uppercase, 1 number, 1 special char.
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least 1 uppercase letter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least 1 number')
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least 1 special character (!@#$%^&*)')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Hash a password using scrypt (Node.js built-in, bcrypt-compatible).
 * Returns "salt$hash" format (salt embedded for verification).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}$${hash}`
}

/**
 * Verify a password against a stored hash.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split('$')
  if (!salt || !hash) return false

  const computed = scryptSync(password, salt, 32).toString('hex')
  return computed === hash
}

// ── Admin User Management ────────────────────────────────

export interface AdminUser {
  id: number
  username: string
  active: number
  created_at: string
  last_login: string | null
}

/**
 * Create the initial admin user (on first app launch).
 * Validates password strength before creating.
 */
export function createAdminUser(
  db: Database.Database,
  username: string,
  password: string,
): AdminUser {
  const strength = validatePasswordStrength(password)
  if (!strength.valid) {
    throw new Error(`Password does not meet requirements: ${strength.errors.join(', ')}`)
  }

  const passwordHash = hashPassword(password)

  try {
    const result = db.prepare(`
      INSERT INTO admin_users (username, password_hash, active)
      VALUES (@username, @password_hash, 1)
    `).run({
      username,
      password_hash: passwordHash,
    })

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return getAdminUserById(db, result.lastInsertRowid as number)!
  } catch (err) {
    if (String(err).includes('UNIQUE constraint failed')) {
      throw new Error(`Username "${username}" already exists`)
    }
    throw err
  }
}

/**
 * Get admin user by ID.
 */
export function getAdminUserById(db: Database.Database, id: number): AdminUser | null {
  const row = db.prepare(`
    SELECT id, username, active, created_at, last_login
    FROM admin_users WHERE id = ?
  `).get(id) as AdminUser | undefined

  return row ?? null
}

/**
 * Get admin user by username.
 */
export function getAdminUserByUsername(db: Database.Database, username: string): AdminUser | null {
  const row = db.prepare(`
    SELECT id, username, active, created_at, last_login
    FROM admin_users WHERE username = ?
  `).get(username) as AdminUser | undefined

  return row ?? null
}

/**
 * Authenticate admin: verify username/password, log login, return admin ID.
 */
export function authenticateAdmin(
  db: Database.Database,
  username: string,
  password: string,
): { success: boolean; adminId?: number; error?: string } {
  const admin = getAdminUserByUsername(db, username)

  if (!admin) {
    return { success: false, error: 'Username not found' }
  }

  if (!admin.active) {
    return { success: false, error: 'Account is disabled' }
  }

  // Get password hash from DB
  const row = db.prepare(`
    SELECT password_hash FROM admin_users WHERE id = ?
  `).get(admin.id) as { password_hash: string } | undefined

  if (!row) {
    return { success: false, error: 'User not found' }
  }

  if (!verifyPassword(password, row.password_hash)) {
    return { success: false, error: 'Invalid password' }
  }

  // Update last_login timestamp
  db.prepare(`
    UPDATE admin_users SET last_login = datetime('now') WHERE id = ?
  `).run(admin.id)

  // Log login action
  logAuditEntry(db, admin.id, 'login', null, null, null)

  return { success: true, adminId: admin.id }
}

/**
 * Log admin logout.
 */
export function logLogout(db: Database.Database, adminId: number): void {
  logAuditEntry(db, adminId, 'logout', null, null, null)
}

// ── Audit Logging ───────────────────────────────────────

export interface AuditEntry {
  id: number
  admin_id: number
  action: 'create' | 'update' | 'delete' | 'login' | 'logout'
  table_name: string | null
  record_id: number | null
  timestamp: string
  details: string | null
}

/**
 * Log an audit entry (mutation or login/logout).
 * For mutations (create/update/delete): oldValues and newValues are JSON objects.
 * For login/logout: oldValues and newValues are null.
 */
export function logAuditEntry(
  db: Database.Database,
  adminId: number,
  action: 'create' | 'update' | 'delete' | 'login' | 'logout',
  tableName: string | null,
  recordId: number | null,
  details: string | null,
): void {
  db.prepare(`
    INSERT INTO audit_log (admin_id, action, table_name, record_id, details)
    VALUES (@admin_id, @action, @table_name, @record_id, @details)
  `).run({
    admin_id: adminId,
    action,
    table_name: tableName,
    record_id: recordId,
    details,
  })
}

/**
 * Get audit log entries with optional filters.
 */
export function getAuditLog(
  db: Database.Database,
  filters?: {
    adminId?: number
    tableName?: string
    action?: string
    limitDays?: number
  },
): AuditEntry[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filters?.adminId) {
    conditions.push('admin_id = @adminId')
    params.adminId = filters.adminId
  }
  if (filters?.tableName) {
    conditions.push('table_name = @tableName')
    params.tableName = filters.tableName
  }
  if (filters?.action) {
    conditions.push('action = @action')
    params.action = filters.action
  }
  if (filters?.limitDays) {
    conditions.push("timestamp >= datetime('now', '-' || @limitDays || ' days')")
    params.limitDays = filters.limitDays
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT id, admin_id, action, table_name, record_id, timestamp, details
    FROM audit_log
    ${where}
    ORDER BY timestamp DESC
    LIMIT 1000
  `).all(params) as AuditEntry[]
}

/**
 * Get total admin user count (for licensing).
 */
export function getAdminUserCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM admin_users').get() as { count: number }
  return row.count
}
