// Licensing configuration — reads EZOFFICE_LICENSING_API_URL / EZOFFICE_SUPABASE_URL /
// EZOFFICE_SUPABASE_ANON_KEY from process.env (populated by dotenv in main.ts).
// Lazy getter (not a module-level constant) so this file can be imported before
// dotenv.config() has run without capturing stale/undefined values.

export interface LicensingConfig {
  apiBaseUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export function getLicensingConfig(): LicensingConfig {
  const apiBaseUrl = process.env.EZOFFICE_LICENSING_API_URL
  const supabaseUrl = process.env.EZOFFICE_SUPABASE_URL
  const supabaseAnonKey = process.env.EZOFFICE_SUPABASE_ANON_KEY

  if (!apiBaseUrl || !supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Licensing configuration missing. Set EZOFFICE_LICENSING_API_URL, ' +
      'EZOFFICE_SUPABASE_URL, and EZOFFICE_SUPABASE_ANON_KEY in .env — see .env.example.',
    )
  }

  return { apiBaseUrl, supabaseUrl, supabaseAnonKey }
}
