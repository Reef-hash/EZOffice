// EZOffice App — root component with routing & authentication.
// Phase A: Admin login required before accessing main app.
// Uses HashRouter because Electron works best with hash-based routing (no server to handle paths).

import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './shared/components/AppShell'
import { LoginPage } from './modules/auth/LoginPage'
import { EmployeeListPage } from './modules/master-data/employees/EmployeeListPage'
import { CustomerListPage } from './modules/master-data/customers/CustomerListPage'
import { SupplierListPage } from './modules/master-data/suppliers/SupplierListPage'
import { ProductListPage } from './modules/master-data/products/ProductListPage'
import { AttendanceListPage } from './modules/attendance/AttendanceListPage'
import { PayrollListPage } from './modules/payroll/PayrollListPage'
import { AuditLogPage } from './modules/audit/AuditLogPage'
import { SettingsPage } from './shared/components/SettingsPage'

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
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Phase D2: Initialize dark mode from localStorage
    const stored = localStorage.getItem('darkMode')
    return stored ? JSON.parse(stored) : false
  })

  // Check on app start if any admin exists in the database (determines if first launch).
  // Uses the IPC call admin:hasAny so the check survives Vite dev server restarts
  // and rebuilds — it queries the actual database, not volatile localStorage.
  useEffect(() => {
    const checkFirstLaunch = async () => {
      try {
        const result = await window.api.admin.hasAny()
        setAuth((prev) => ({
          ...prev,
          isFirstLaunch: !result.hasAdmin,
        }))
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

  // Phase D2: Persist dark mode preference
  const handleToggleDarkMode = () => {
    setIsDarkMode((prev: boolean) => {
      const newValue = !prev
      localStorage.setItem('darkMode', JSON.stringify(newValue))
      return newValue
    })
  }

  const handleLoginSuccess = (adminId: number) => {
    localStorage.setItem('adminId', String(adminId))
    setAuth({
      isAuthenticated: true,
      adminId,
      isFirstLaunch: false,
    })
  }

  const handleLogout = () => {
    if (auth.adminId) {
      window.api.admin.logout(auth.adminId).catch(() => {
        // Logout failed, but proceed anyway
      })
    }
    localStorage.removeItem('adminId')
    setAuth({
      isAuthenticated: false,
      adminId: null,
      isFirstLaunch: false,
    })
  }

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">EZOffice</h1>
          <p className="mt-2 text-sm text-neutral-600">Initializing...</p>
        </div>
      </div>
    )
  }

  // QueryClientProvider wraps the WHOLE tree (including the login screen) because
  // LoginPage uses useIpcMutation, which calls useQueryClient — rendering it outside
  // the provider crashes on first launch with "No QueryClient set".
  if (!auth.isAuthenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          isFirstLaunch={auth.isFirstLaunch}
        />
      </QueryClientProvider>
    )
  }

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <Routes>
            <Route element={<AppShell onLogout={handleLogout} isDarkMode={isDarkMode} onToggleDarkMode={handleToggleDarkMode} />}>
            <Route index element={<Navigate to="/employees" replace />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/suppliers" element={<SupplierListPage />} />
            <Route path="/products" element={<ProductListPage />} />
            <Route path="/attendance" element={<AttendanceListPage />} />
            <Route path="/payroll" element={<PayrollListPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
    </div>
  )
}
