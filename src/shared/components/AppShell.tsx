// App shell component — fixed left sidebar (240px) + main content area.
// Per design system layout spec: sidebar holds module navigation, main area scrolls.

import { NavLink, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

interface NavItemProps {
  to: string
  children: ReactNode
}

function SidebarNavItem({ to, children }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'block rounded-full px-4 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary-600 text-white'
            : 'text-neutral-400 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {children}
    </NavLink>
  )
}

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Fixed sidebar */}
      <aside className="flex w-[240px] shrink-0 flex-col bg-ink-900">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white">
            EZ
          </div>
          <span className="text-base font-semibold text-white">EZOffice</span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <p className="mb-1 px-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Master Data
          </p>
          <SidebarNavItem to="/employees">Employees</SidebarNavItem>
          <SidebarNavItem to="/customers">Customers</SidebarNavItem>
          <SidebarNavItem to="/suppliers">Suppliers</SidebarNavItem>
          <SidebarNavItem to="/products">Products</SidebarNavItem>

          <p className="mb-1 mt-4 px-4 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Modules
          </p>
          <SidebarNavItem to="/attendance">Attendance</SidebarNavItem>
          <SidebarNavItem to="/payroll">Payroll</SidebarNavItem>
          <span className="block rounded-full px-4 py-2 text-sm font-medium text-neutral-500 cursor-not-allowed select-none">
            ERP
          </span>
        </nav>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
