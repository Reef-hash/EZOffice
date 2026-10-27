// App shell component — light left sidebar (260px, 72px collapsed) + main content area.
// Sidebar holds grouped module navigation, a user card and logout; main area scrolls.

import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './Button'
import { Logo } from './Logo'
import {
  UserIcon,
  CustomerIcon,
  SupplierIcon,
  ProductIcon,
  AttendanceIcon,
  PayrollIcon,
  AuditIcon,
  SettingsIcon,
  CalendarIcon,
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
          'flex items-center rounded-lg border text-sm font-medium transition-colors',
          collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
          isActive
            ? 'border-primary-600/20 bg-primary-600/10 text-primary-600'
            : 'border-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-700',
        )
      }
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

function SidebarSection({ title, collapsed, children }: { title: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {collapsed ? (
        <hr className="my-2 border-t border-border" />
      ) : (
        <p className="mb-1 mt-4 px-3 text-[11px] font-medium uppercase tracking-wider text-neutral-500">{title}</p>
      )}
      {children}
    </div>
  )
}

export function AppShell({ onLogout, isDarkMode, onToggleDarkMode }: AppShellProps) {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('sidebarCollapsed')
      return stored ? JSON.parse(stored) : false
    } catch {
      return false
    }
  })

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('sidebarCollapsed', JSON.stringify(next))
      } catch {
        // persistence is a convenience only; the toggle still works for this session
      }
      return next
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-surface transition-all duration-300',
          collapsed ? 'w-[72px]' : 'w-[260px]',
        )}
      >
        {/* Brand + collapse toggle */}
        <div
          className={cn(
            'flex items-center border-b border-border',
            collapsed ? 'flex-col gap-2 px-2 py-3' : 'h-16 justify-between px-4',
          )}
        >
          <Logo markOnly={collapsed} />

          <button
            type="button"
            onClick={toggleSidebar}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={collapsed ? 'M13 5l7 7-7 7M5 5l7 7-7 7' : 'M11 19l-7-7 7-7m8 14l-7-7 7-7'}
              />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
          <SidebarSection title="People" collapsed={collapsed}>
            <SidebarNavItem to="/employees" label="Employees" icon={<UserIcon className="size-5" />} collapsed={collapsed} />
            <SidebarNavItem to="/attendance" label="Attendance" icon={<AttendanceIcon className="size-5" />} collapsed={collapsed} />
            <SidebarNavItem to="/calendar" label="Calendar" icon={<CalendarIcon className="size-5" />} collapsed={collapsed} />
            <SidebarNavItem to="/payroll" label="Payroll" icon={<PayrollIcon className="size-5" />} collapsed={collapsed} />
          </SidebarSection>

          <SidebarSection title="Business" collapsed={collapsed}>
            <SidebarNavItem to="/customers" label="Customers" icon={<CustomerIcon className="size-5" />} collapsed={collapsed} />
            <SidebarNavItem to="/suppliers" label="Suppliers" icon={<SupplierIcon className="size-5" />} collapsed={collapsed} />
            <SidebarNavItem to="/products" label="Products" icon={<ProductIcon className="size-5" />} collapsed={collapsed} />
            {collapsed ? (
              <span
                className="flex cursor-not-allowed select-none items-center justify-center p-2.5 text-sm font-medium text-neutral-500"
                title="ERP (Unavailable)"
              >
                E
              </span>
            ) : (
              <span className="block cursor-not-allowed select-none rounded-lg px-3 py-2 text-sm font-medium text-neutral-500">
                ERP <span className="ml-1 text-xs">(soon)</span>
              </span>
            )}
          </SidebarSection>

          <SidebarSection title="System" collapsed={collapsed}>
            <SidebarNavItem to="/audit" label="Audit Log" icon={<AuditIcon className="size-5" />} collapsed={collapsed} />
            <SidebarNavItem to="/settings" label="Settings" icon={<SettingsIcon className="size-5" />} collapsed={collapsed} />
          </SidebarSection>
        </nav>

        {/* User card + logout */}
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <div
            className={cn(
              'flex items-center rounded-lg border border-border',
              collapsed ? 'justify-center p-2' : 'gap-3 p-2.5',
            )}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-600/10 text-sm font-semibold text-primary-600">
              A
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-700">Administrator</p>
                  <p className="truncate text-xs text-neutral-500">EZOffice admin</p>
                </div>
                <button
                  type="button"
                  onClick={onToggleDarkMode}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sm transition-colors hover:bg-neutral-100"
                  title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDarkMode ? '☀️' : '🌙'}
                </button>
              </>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={onLogout}
            className="w-full gap-2 text-xs"
            title={collapsed ? 'Logout' : undefined}
          >
            {!collapsed && 'Log out'}
            <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </Button>
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
