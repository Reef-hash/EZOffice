// ProductForm — Add/Edit form for Products.

import { useState, useEffect } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import type { Product } from '@/shared/types/entities'
import type { CreateProductInput, UpdateProductInput } from '@/shared/types/inputs'

interface ProductFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateProductInput | UpdateProductInput) => Promise<void>
  isSubmitting: boolean
  product?: Product | null
}

export function ProductForm({ isOpen, onClose, onSubmit, isSubmitting, product }: ProductFormProps) {
  const isEdit = !!product

  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')
  const [defaultPrice, setDefaultPrice] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (product) {
      setSku(product.sku)
      setName(product.name)
      setUnitOfMeasure(product.unit_of_measure)
      setDefaultPrice(String(product.default_price))
    } else {
      setSku('')
      setName('')
      setUnitOfMeasure('')
      setDefaultPrice('')
    }
    setValidationError(null)
  }, [isOpen, product])

  function validate(): boolean {
    if (!sku.trim()) { setValidationError('SKU is required'); return false }
    if (!name.trim()) { setValidationError('Name is required'); return false }
    if (!unitOfMeasure.trim()) { setValidationError('Unit of measure is required'); return false }
    if (!defaultPrice || isNaN(Number(defaultPrice)) || Number(defaultPrice) < 0) {
      setValidationError('Price must be a non-negative number'); return false
    }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateProductInput = {
      sku: sku.trim(),
      name: name.trim(),
      unit_of_measure: unitOfMeasure.trim(),
      default_price: Number(defaultPrice),
    }

    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Product' : 'Add Product'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Add Product'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Input
          label="SKU"
          required
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="e.g. PRD-001"
        />

        <Input
          label="Product Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Product name"
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Unit of Measure"
            required
            value={unitOfMeasure}
            onChange={(e) => setUnitOfMeasure(e.target.value)}
            placeholder="e.g. pcs, kg, box"
          />
          <Input
            label="Default Price (RM)"
            required
            type="number"
            min="0"
            step="0.01"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </form>
    </Modal>
  )
}
