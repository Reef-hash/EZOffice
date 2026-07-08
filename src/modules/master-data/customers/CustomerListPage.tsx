// CustomerListPage — list + CRUD for Customers.

import { useState, useCallback } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { CustomerForm } from './CustomerForm'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useKeyboardShortcut } from '@/shared/hooks/useKeyboardShortcut'
import type { Column } from '@/shared/components/Table'
import type { Customer } from '@/shared/types/entities'
import type { CreateCustomerInput, UpdateCustomerInput } from '@/shared/types/inputs'

const columns: Column<Customer>[] = [
  { key: 'name', header: 'Name', accessor: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'contact_person', header: 'Contact', accessor: (r) => r.contact_person || '—', sortable: true, sortValue: (r) => r.contact_person || '' },
  { key: 'email', header: 'Email', accessor: (r) => r.email || '—', sortable: true, sortValue: (r) => r.email || '' },
  { key: 'phone', header: 'Phone', accessor: (r) => r.phone || '—', sortable: true, sortValue: (r) => r.phone || '' },
]

export function CustomerListPage() {
  const { data: customers = [], isLoading } = useIpcQuery<Customer[]>(
    ['customers'],
    () => window.api.customers.list(),
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null)

  const createMutation = useIpcMutation<Customer, CreateCustomerInput>(
    (data) => window.api.customers.create(data),
    [['customers']],
    { onSuccessMessage: 'Customer created successfully' },
  )

  const updateMutation = useIpcMutation<Customer, { id: number; data: UpdateCustomerInput }>(
    ({ id, data }) => window.api.customers.update(id, data),
    [['customers']],
    { onSuccessMessage: 'Customer updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.customers.delete(id),
    [['customers']],
    { onSuccessMessage: 'Customer deleted successfully' },
  )

  const handleCreate = useCallback(() => {
    setEditingCustomer(null)
    setIsFormOpen(true)
  }, [])

  useKeyboardShortcut([
    {
      key: 'n',
      ctrlKey: true,
      callback: handleCreate,
    },
  ])

  const handleEdit = useCallback((customer: Customer) => {
    setEditingCustomer(customer)
    setIsFormOpen(true)
  }, [])

  const handleDelete = useCallback((customer: Customer) => {
    setCustomerToDelete(customer)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!customerToDelete) return
    await deleteMutation.mutateAsync(customerToDelete.id)
    setCustomerToDelete(null)
    setEditingCustomer(null)
  }, [customerToDelete, deleteMutation])

  const handleFormSubmit = useCallback(
    async (data: CreateCustomerInput | UpdateCustomerInput) => {
      if (editingCustomer) {
        await updateMutation.mutateAsync({ id: editingCustomer.id, data: data as UpdateCustomerInput })
      } else {
        await createMutation.mutateAsync(data as CreateCustomerInput)
      }
      setIsFormOpen(false)
      setEditingCustomer(null)
    },
    [editingCustomer, createMutation, updateMutation],
  )

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customer${customers.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={handleCreate}>Add Customer</Button>}
      />

      <Table
        columns={columns}
        data={customers}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No customers yet',
          description: 'Add your first customer to get started.',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Customer</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      {/* Context menu for delete — shown per-row via click */}
      {editingCustomer && !isFormOpen && (
        <div className="mt-3">
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleDelete(editingCustomer)}
            disabled={deleteMutation.isPending}
          >
            Delete Selected
          </Button>
        </div>
      )}

      <CustomerForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingCustomer(null) }}
        onSubmit={handleFormSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        customer={editingCustomer}
      />

      <ConfirmDialog
        isOpen={customerToDelete !== null}
        title="Delete Customer"
        message={`Are you sure you want to delete customer "${customerToDelete?.name || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setCustomerToDelete(null)}
      />
    </div>
  )
}
