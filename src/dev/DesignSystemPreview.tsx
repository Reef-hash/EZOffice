import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  Card,
  Input,
  Modal,
  Select,
  StatusBadge,
  Table,
  type BadgeTone,
  type Column,
} from '../shared/components'

/**
 * Visual reference for every base component, used to sanity-check the design system in a
 * browser. Not a real app screen — gets replaced by real routing/modules in Phase 1.
 */

interface SampleEmployee {
  id: number
  name: string
  department: string
  status: 'Active' | 'Inactive'
  baseSalary: number
}

const SAMPLE_EMPLOYEES: SampleEmployee[] = [
  { id: 1, name: 'Aisyah Rahman', department: 'Finance', status: 'Active', baseSalary: 3800 },
  { id: 2, name: 'Bala Krishnan', department: 'Warehouse', status: 'Active', baseSalary: 2600 },
  { id: 3, name: 'Chong Wei Ling', department: 'Sales', status: 'Inactive', baseSalary: 3200 },
  { id: 4, name: 'Danial Hakim', department: 'Warehouse', status: 'Active', baseSalary: 2750 },
]

const STATUS_TONE: Record<SampleEmployee['status'], BadgeTone> = {
  Active: 'success',
  Inactive: 'neutral',
}

const columns: Column<SampleEmployee>[] = [
  { key: 'name', header: 'Name', accessor: (row) => row.name, sortable: true, sortValue: (row) => row.name },
  {
    key: 'department',
    header: 'Department',
    accessor: (row) => row.department,
    sortable: true,
    sortValue: (row) => row.department,
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (row) => <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>,
  },
  {
    key: 'baseSalary',
    header: 'Base Salary (RM)',
    align: 'right',
    accessor: (row) => (
      <span className="tabular-nums">{row.baseSalary.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
    ),
    sortable: true,
    sortValue: (row) => row.baseSalary,
  },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold leading-snug text-neutral-900">{title}</h2>
      {children}
    </section>
  )
}

export function DesignSystemPreview() {
  const [isTableEmpty, setIsTableEmpty] = useState(false)
  const [isTableLoading, setIsTableLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
      <header>
        <h1 className="text-[28px] font-bold leading-9 text-neutral-900">EZOffice Design System</h1>
        <p className="mt-1 text-sm text-neutral-500">Base component reference — Indigo/Ink, Inter.</p>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Save</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="dark">Manage Team</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="ghost">View</Button>
          <Button variant="primary" isLoading>
            Saving
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid max-w-xl gap-4">
          <Input label="Employee name" placeholder="e.g. Aisyah Rahman" required />
          <Input label="IC number" helperText="12 digits, no dashes" />
          <Input label="Email" defaultValue="not-an-email" error="Enter a valid email address" />
          <Select
            label="Department"
            placeholder="Select a department"
            options={[
              { value: 'finance', label: 'Finance' },
              { value: 'warehouse', label: 'Warehouse' },
              { value: 'sales', label: 'Sales' },
            ]}
          />
          <Input label="Disabled field" disabled defaultValue="Locked" />
        </div>
      </Section>

      <Section title="Status badges">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="neutral">Draft</StatusBadge>
          <StatusBadge tone="info">Sent</StatusBadge>
          <StatusBadge tone="success">Received</StatusBadge>
          <StatusBadge tone="warning">Partially Received</StatusBadge>
          <StatusBadge tone="error">Cancelled</StatusBadge>
        </div>
      </Section>

      <Section title="Card">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="This month's payroll" subtitle="June 2026" actions={<Button size="sm" variant="ghost">View</Button>}>
            <p className="text-sm text-neutral-600">4 employees · RM 12,350.00 gross</p>
          </Card>
          <Card footer={<Button size="sm">Run Payroll</Button>}>
            <p className="text-sm text-neutral-600">Plain card body with footer action, no header.</p>
          </Card>
        </div>
      </Section>

      <Section title="Table">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => setIsTableEmpty((value) => !value)}>
            Toggle empty state
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setIsTableLoading((value) => !value)}>
            Toggle loading
          </Button>
        </div>
        <Table
          columns={columns}
          data={isTableEmpty ? [] : SAMPLE_EMPLOYEES}
          rowKey={(row) => row.id}
          isLoading={isTableLoading}
          emptyState={{
            title: 'No employees yet',
            description: 'Add your first employee to get started.',
            action: <Button size="sm">Add Employee</Button>,
          }}
        />
      </Section>

      <Section title="Modal">
        <div>
          <Button variant="danger" onClick={() => setIsModalOpen(true)}>
            Delete Employee
          </Button>
        </div>
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Delete employee?"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setIsModalOpen(false)}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-neutral-600">
            This will permanently remove Aisyah Rahman and all associated attendance records.
          </p>
        </Modal>
      </Section>
    </div>
  )
}
