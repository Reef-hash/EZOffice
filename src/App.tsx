// EZOffice App — root component with routing & authentication.
// Phase A: Admin login required before accessing main app.
// Uses HashRouter because Electron works best with hash-based routing (no server to handle paths).
import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './shared/components/AppShell'
import { LoginPage } from './modules/auth/LoginPage'
import { ActivateLicensePage } from './modules/auth/ActivateLicensePage'
import { ToastProvider } from './shared/components/Toast'
import { EmployeeListPage } from './modules/master-data/employees/EmployeeListPage'
import { CustomerListPage } from './modules/master-data/customers/CustomerListPage'
import { SupplierListPage } from './modules/master-data/suppliers/SupplierListPage'
import { ProductListPage } from './modules/master-data/products/ProductListPage'
import { AttendanceListPage } from './modules/attendance/AttendanceListPage'
import { CalendarPage } from './modules/calendar/CalendarPage'
import { PayrollListPage } from './modules/payroll/PayrollListPage'
import { AuditLogPage } from './modules/audit/AuditLogPage'
import { SettingsPage } from './shared/components/SettingsPage'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { Spinner } from './shared/components/Spinner/Spinner'
import { UpdateDialog } from './shared/components/UpdateDialog'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

interface AuthState {
  isAuthenticated: boolean
  adminId: number | null
  isFirstLaunch: boolean
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    adminId: null,
    isFirstLaunch: false,
  })
  const [isInitializing, setIsInitializing] = useState(true)
  const [licenseCheck, setLicenseCheck] = useState<{
    done: boolean
    allowed: boolean
    reasonMessage: string | null
  }>({ done: false, allowed: false, reasonMessage: null })
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Phase D2: Initialize dark mode from localStorage
    const stored = localStorage.getItem('darkMode')
    return stored ? JSON.parse(stored) : false
  })

  // Synchronize dark mode class on HTML root element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDarkMode])

  // Check on app start if any admin exists in the database (determines if first launch).
  // Uses the IPC call admin:hasAny so the check survives Vite dev server restarts
  // and rebuilds — it queries the actual database, not volatile localStorage.
  //
  // "Remember me" restore: a rememberMe login stores adminId in localStorage
  // (survives app restart); a non-remembered login stores it in sessionStorage
  // only (cleared when the Electron process quits, so the next launch asks
  // again). Either way, the remembered ID is re-validated against the DB via
  // admin:validateSession before auto-login — never trust localStorage alone,
  // the admin could have been deleted/disabled since it was stored.
  useEffect(() => {
    const checkFirstLaunch = async () => {
      try {
        const result = await window.api.admin.hasAny()
        if (!result.hasAdmin) {
          setAuth((prev) => ({ ...prev, isFirstLaunch: true }))
          return
        }

        const rememberedId = sessionStorage.getItem('adminId')
          ?? (localStorage.getItem('rememberMe') === '1' ? localStorage.getItem('adminId') : null)

        if (rememberedId) {
          const session = await window.api.admin.validateSession(Number(rememberedId))
          if (session.valid) {
            setAuth({ isAuthenticated: true, adminId: Number(rememberedId), isFirstLaunch: false })
            return
          }
          // Stale/invalid — clear so it's not retried on every launch.
          localStorage.removeItem('adminId')
          localStorage.removeItem('rememberMe')
          sessionStorage.removeItem('adminId')
        }

        setAuth((prev) => ({ ...prev, isFirstLaunch: false }))
      } catch {
        // If the IPC call fails (e.g. app not fully initialized yet), fall back to
        // localStorage — but this is the rare path; normally the DB check works.
        const storedAdminId = localStorage.getItem('adminId')
        setAuth((prev) => ({
          ...prev,
          isFirstLaunch: !storedAdminId,
        }))
      } finally {
        setIsInitializing(false)
      }
    }

    checkFirstLaunch()
  }, [])

  // License gate — checked before admin auth, and before rendering the app
  // shell at all. This is a pure local read (checkGrace never touches the
  // network) so it resolves instantly even fully offline.
  useEffect(() => {
    const checkLicense = async () => {
      try {
        const result = await window.api.license.checkGrace()
        if (result.allowed) {
          setLicenseCheck({ done: true, allowed: true, reasonMessage: null })
        } else if (!result.isActivated) {
          setLicenseCheck({ done: true, allowed: false, reasonMessage: null })
        } else {
          setLicenseCheck({
            done: true,
            allowed: false,
            reasonMessage:
              'Your EZOffice activation could not be renewed and the offline grace period has ended. Please reconnect to the internet and reactivate.',
          })
        }
      } catch {
        // IPC itself failing is not expected — fail closed rather than silently unlock.
        setLicenseCheck({ done: true, allowed: false, reasonMessage: null })
      }
    }

    checkLicense()
  }, [])

  const handleLicenseActivated = () => {
    setLicenseCheck({ done: true, allowed: true, reasonMessage: null })
  }

  // Phase D2: Persist dark mode preference
  const handleToggleDarkMode = () => {
    setIsDarkMode((prev: boolean) => {
      const newValue = !prev
      localStorage.setItem('darkMode', JSON.stringify(newValue))
      return newValue
    })
  }

  const handleLoginSuccess = (adminId: number, rememberMe: boolean) => {
    if (rememberMe) {
      localStorage.setItem('adminId', String(adminId))
      localStorage.setItem('rememberMe', '1')
    } else {
      // Not remembered: keep it in sessionStorage only, so a restart of the
      // app (not just the window) requires login again. Also clear any
      // earlier "remembered" state so unchecking the box actually forgets.
      sessionStorage.setItem('adminId', String(adminId))
      localStorage.removeItem('adminId')
      localStorage.removeItem('rememberMe')
    }
    setAuth({
      isAuthenticated: true,
      adminId,
      isFirstLaunch: false,
    })
  }

  const handleLogout = () => {
    localStorage.removeItem('adminId')
    localStorage.removeItem('rememberMe')
    sessionStorage.removeItem('adminId')
    setAuth({
      isAuthenticated: false,
      adminId: null,
      isFirstLaunch: false,
    })
  }

  if (isInitializing || !licenseCheck.done) {
    return (
      <ErrorBoundary>
        <div className={isDarkMode ? 'dark' : ''}>
          <div className="flex h-screen flex-col items-center justify-center bg-background gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary-600 text-lg font-bold text-white shadow-sm animate-pulse">
              EZ
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">EZOffice</h1>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 flex items-center justify-center gap-2">
                <Spinner className="size-4 text-primary-600" />
                Loading...
              </p>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className={isDarkMode ? 'dark' : ''}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <UpdateDialog />
              {!licenseCheck.allowed ? (
              <ActivateLicensePage onActivated={handleLicenseActivated} reasonMessage={licenseCheck.reasonMessage} />
            ) : auth.isFirstLaunch || !auth.isAuthenticated ? (
              <LoginPage
                onLoginSuccess={handleLoginSuccess}
                isFirstLaunch={auth.isFirstLaunch}
              />
            ) : (
              <HashRouter>
                <Routes>
                  <Route element={<AppShell onLogout={handleLogout} isDarkMode={isDarkMode} onToggleDarkMode={handleToggleDarkMode} />}>
                    <Route index element={<Navigate to="/employees" replace />} />
                    <Route path="/employees" element={<EmployeeListPage />} />
                    <Route path="/customers" element={<CustomerListPage />} />
                    <Route path="/suppliers" element={<SupplierListPage />} />
                    <Route path="/products" element={<ProductListPage />} />
                    <Route path="/attendance" element={<AttendanceListPage />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/payroll" element={<PayrollListPage />} />
                    <Route path="/audit" element={<AuditLogPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                </Routes>
              </HashRouter>
            )}
          </ToastProvider>
        </QueryClientProvider>
      </div>
    </ErrorBoundary>
  )
}
