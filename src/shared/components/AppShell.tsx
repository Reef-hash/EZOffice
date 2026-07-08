// App shell component — fixed left sidebar (240px) + main content area.
// Per design system layout spec: sidebar holds module navigation, main area scrolls.
// Phase A: Includes logout button and audit log access.

import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './Button'
import {
  UserIcon,
  CustomerIcon,
  SupplierIcon,
  ProductIcon,
  AttendanceIcon,
  PayrollIcon,
  AuditIcon,
  SettingsIcon,
} from './icons'

interface NavItemProps {
  to: string
  label: string
  icon: ReactNode
  collapsed: boolean
}

interface AppShellProps {
  onLogout: () => void
  isDarkMode: boolean
  onToggleDarkMode: () => void
}

function SidebarNavItem({ to, label, icon, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center transition-colors rounded-full font-medium text-sm',
          collapsed ? 'justify-center p-2.5' : 'gap-3 px-4 py-2',
          isActive
            ? 'bg-primary-600 text-white'
            : 'text-neutral-400 hover:bg-white/5 hover:text-white',
        )
      }
    >
      <span className="size-5 shrink-0 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

export function AppShell({ onLogout, isDarkMode, onToggleDarkMode }: AppShellProps) {
  const location = useLocation()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarCollapsed')
      return stored ? JSON.parse(stored) : false
    } catch {
      return false
    }
  })

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev: boolean) => {
      const nextVal = !prev
      localStorage.setItem('sidebarCollapsed', JSON.stringify(nextVal))
      return nextVal
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Fixed sidebar */}
      <aside
        className={cn(
          'flex shrink-0 flex-col bg-ink-900 transition-all duration-300',
          isSidebarCollapsed ? 'w-[64px]' : 'w-[240px]',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-14 items-center gap-2.5',
            isSidebarCollapsed ? 'justify-center px-2' : 'px-5',
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white">
            EZ
          </div>
          {!isSidebarCollapsed && (
            <span className="text-base font-semibold text-white truncate">EZOffice</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {isSidebarCollapsed ? (
            <hr className="my-1 border-t border-white/10" />
          ) : (
            <p className="mb-1 px-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Master Data
            </p>
          )}
          <SidebarNavItem to="/employees" label="Employees" icon={<UserIcon className="size-5" />} collapsed={isSidebarCollapsed} />
          <SidebarNavItem to="/customers" label="Customers" icon={<CustomerIcon className="size-5" />} collapsed={isSidebarCollapsed} />
          <SidebarNavItem to="/suppliers" label="Suppliers" icon={<SupplierIcon className="size-5" />} collapsed={isSidebarCollapsed} />
          <SidebarNavItem to="/products" label="Products" icon={<ProductIcon className="size-5" />} collapsed={isSidebarCollapsed} />

          {isSidebarCollapsed ? (
            <hr className="my-2 border-t border-white/10" />
          ) : (
            <p className="mb-1 mt-4 px-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Modules
            </p>
          )}
          <SidebarNavItem to="/attendance" label="Attendance" icon={<AttendanceIcon className="size-5" />} collapsed={isSidebarCollapsed} />
          <SidebarNavItem to="/payroll" label="Payroll" icon={<PayrollIcon className="size-5" />} collapsed={isSidebarCollapsed} />
          {isSidebarCollapsed ? (
            <span className="flex items-center justify-center p-2.5 text-sm font-medium text-neutral-600 cursor-not-allowed select-none" title="ERP (Unavailable)">
              E
            </span>
          ) : (
            <span className="block rounded-full px-4 py-2 text-sm font-medium text-neutral-500 cursor-not-allowed select-none">
              ERP
            </span>
          )}

          {isSidebarCollapsed ? (
            <hr className="my-2 border-t border-white/10" />
          ) : (
            <p className="mb-1 mt-4 px-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Admin
            </p>
          )}
          <SidebarNavItem to="/audit" label="Audit Log" icon={<AuditIcon className="size-5" />} collapsed={isSidebarCollapsed} />
          <SidebarNavItem to="/settings" label="Settings" icon={<SettingsIcon className="size-5" />} collapsed={isSidebarCollapsed} />
        </nav>

        {/* User profile & toggle sidebar */}
        <div className="border-t border-white/10 p-3 space-y-2 flex flex-col">
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggleDarkMode}
            className="w-full text-xs"
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isSidebarCollapsed ? (isDarkMode ? '☀️' : '🌙') : (isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode')}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onLogout}
            className="w-full text-xs"
            title={isSidebarCollapsed ? 'Logout' : undefined}
          >
            {isSidebarCollapsed ? (
              <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            ) : (
              'Logout'
            )}
          </Button>

          <button
            type="button"
            onClick={toggleSidebar}
            className="flex items-center justify-center rounded-lg p-2 text-neutral-400 hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? (
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium w-full px-2">
                <svg className="size-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
                <span>Collapse Sidebar</span>
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto p-6">
        <div key={location.pathname} className="animate-[fade-in_0.15s_ease-out]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
