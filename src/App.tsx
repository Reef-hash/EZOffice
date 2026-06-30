// EZOffice App — root component with routing.
// Uses HashRouter because Electron works best with hash-based routing (no server to handle paths).

import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './shared/components/AppShell'
import { EmployeeListPage } from './modules/master-data/employees/EmployeeListPage'
import { CustomerListPage } from './modules/master-data/customers/CustomerListPage'
import { SupplierListPage } from './modules/master-data/suppliers/SupplierListPage'
import { ProductListPage } from './modules/master-data/products/ProductListPage'
import { AttendanceListPage } from './modules/attendance/AttendanceListPage'
import { PayrollListPage } from './modules/payroll/PayrollListPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/employees" replace />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/suppliers" element={<SupplierListPage />} />
            <Route path="/products" element={<ProductListPage />} />
            <Route path="/attendance" element={<AttendanceListPage />} />
            <Route path="/payroll" element={<PayrollListPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}
