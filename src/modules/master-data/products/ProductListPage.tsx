// ProductListPage — list + CRUD for Products.

import { useState, useCallback } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { ProductForm } from './ProductForm'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useKeyboardShortcut } from '@/shared/hooks/useKeyboardShortcut'
import type { Column } from '@/shared/components/Table'
import type { Product } from '@/shared/types/entities'
import type { CreateProductInput, UpdateProductInput } from '@/shared/types/inputs'

const columns: Column<Product>[] = [
  { key: 'sku', header: 'SKU', accessor: (r) => r.sku, sortable: true, sortValue: (r) => r.sku, width: '110px' },
  { key: 'name', header: 'Name', accessor: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'unit_of_measure', header: 'Unit', accessor: (r) => r.unit_of_measure, sortable: true, sortValue: (r) => r.unit_of_measure, width: '90px' },
  {
    key: 'default_price',
    header: 'Price (RM)',
    accessor: (r) => <span className="tabular-nums">{r.default_price.toFixed(2)}</span>,
    sortable: true,
    sortValue: (r) => r.default_price,
    align: 'right',
    width: '120px',
  },
]

export function ProductListPage() {
  const { data: products = [], isLoading } = useIpcQuery<Product[]>(
    ['products'],
    () => window.api.products.list(),
  )

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productToDelete, setProductToDelete] = useState<Product | null>(null)

  const createMutation = useIpcMutation<Product, CreateProductInput>(
    (data) => window.api.products.create(data),
    [['products']],
    { onSuccessMessage: 'Product created successfully' },
  )

  const updateMutation = useIpcMutation<Product, { id: number; data: UpdateProductInput }>(
    ({ id, data }) => window.api.products.update(id, data),
    [['products']],
    { onSuccessMessage: 'Product updated successfully' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.products.delete(id),
    [['products']],
    { onSuccessMessage: 'Product deleted successfully' },
  )

  const handleCreate = useCallback(() => {
    setEditingProduct(null)
    setIsFormOpen(true)
  }, [])

  useKeyboardShortcut([
    {
      key: 'n',
      ctrlKey: true,
      callback: handleCreate,
    },
  ])

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product)
    setIsFormOpen(true)
  }, [])

  const handleDelete = useCallback((product: Product) => {
    setProductToDelete(product)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!productToDelete) return
    await deleteMutation.mutateAsync(productToDelete.id)
    setProductToDelete(null)
    setEditingProduct(null)
  }, [productToDelete, deleteMutation])

  const handleFormSubmit = useCallback(
    async (data: CreateProductInput | UpdateProductInput) => {
      if (editingProduct) {
        await updateMutation.mutateAsync({ id: editingProduct.id, data: data as UpdateProductInput })
      } else {
        await createMutation.mutateAsync(data as CreateProductInput)
      }
      setIsFormOpen(false)
      setEditingProduct(null)
    },
    [editingProduct, createMutation, updateMutation],
  )

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${products.length} product${products.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={handleCreate}>Add Product</Button>}
      />

      <Table
        columns={columns}
        data={products}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyState={{
          title: 'No products yet',
          description: 'Add your first product to get started.',
          action: (
            <div className="mt-3 flex justify-center">
              <Button size="sm" onClick={handleCreate}>Add Product</Button>
            </div>
          ),
        }}
        onRowClick={handleEdit}
      />

      {editingProduct && !isFormOpen && (
        <div className="mt-3">
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleDelete(editingProduct)}
            disabled={deleteMutation.isPending}
          >
            Delete Selected
          </Button>
        </div>
      )}

      <ProductForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingProduct(null) }}
        onSubmit={handleFormSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        product={editingProduct}
      />

      <ConfirmDialog
        isOpen={productToDelete !== null}
        title="Delete Product"
        message={`Are you sure you want to delete product "${productToDelete?.name || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setProductToDelete(null)}
      />
    </div>
  )
}
