// SupplierListPage — list + CRUD for Suppliers.

import { useState, useCallback } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { SupplierForm } from './SupplierForm'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useKeyboardShortcut } from '@/shared/hooks/useKeyboardShortcut'
import type { Column } from '@/shared/components/Table'
import type { Supplier } from '@/shared/types/entities'
import type { CreateSupplierInput, UpdateSupplierInput } from '@/shared/types/inputs'

const columns: Column<Supplier>[] = [
  { key: 'name', header: 'Name', accessor: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'contact_person', header: 'Contact', accessor: (r) => r.contact_person || '—', sortable: true, sortValue: (r) => r.contact_person || '' },
  { key: 'email', header: 'Email', accessor: (r) => r.email || '—', sortable: true, sortValue: (r) => r.email || '' },
  { key: 'phone', header: 'Phone', accessor: (r) => r.phone || '—', sortable: true, sortValue: (r) => r.phone || '' },
]

export function SupplierListPage() {
  const { data: suppliers = [], isLoading } = useIpcQuery<Supplier[]>(
    ['suppliers'],
    () => window.api.suppliers.list(),
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const createMutation = useIpcMutation<Supplier, CreateSupplierInput>(
    (data) => window.api.suppliers.create(data),
    [['suppliers']],
    { onSuccessMessage: 'Supplier created successfully' },
  )

  const updateMutation = useIpcMutation<Supplier, { id: number; data: UpdateSupplierInput }>(
    ({ id, data }) => window.api.suppliers.update(id, data),
    [['suppliers']],
    { onSuccessMessage: 'Supplier updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.suppliers.delete(id),
    [['suppliers']],
    { onSuccessMessage: 'Supplier deleted successfully' },
  )

  const handleCreate = useCallback(() => {
    setEditingSupplier(null)
    setIsFormOpen(true)
  }, [])

  useKeyboardShortcut([
    {
      key: 'n',
      ctrlKey: true,
      callback: handleCreate,
    },
  ])

  const handleEdit = useCallback((supplier: Supplier) => {
    setEditingSupplier(supplier)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (data: CreateSupplierInput | UpdateSupplierInput) => {
      if (editingSupplier) {
        await updateMutation.mutateAsync({ id: editingSupplier.id, data: data as UpdateSupplierInput })
      } else {
        await createMutation.mutateAsync(data as CreateSupplierInput)
      }
      setIsFormOpen(false)
      setEditingSupplier(null)
    },
    [editingSupplier, createMutation, updateMutation],
  )

  const handleDelete = useCallback(async () => {
    if (!editingSupplier) return
    setShowDeleteConfirm(true)
  }, [editingSupplier])

  const handleConfirmDelete = useCallback(async () => {
    if (!editingSupplier) return
    await deleteMutation.mutateAsync(editingSupplier.id)
    setIsFormOpen(false)
    setEditingSupplier(null)
    setShowDeleteConfirm(false)
  }, [editingSupplier, deleteMutation])

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={handleCreate}>Add Supplier</Button>}
      />

      <Table
        columns={columns}
        data={suppliers}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No suppliers yet',
          description: 'Add your first supplier to get started.',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Supplier</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      <SupplierForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingSupplier(null) }}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        supplier={editingSupplier}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Supplier"
        message={`Are you sure you want to delete supplier "${editingSupplier?.name || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
