// SupplierForm — Add/Edit form for Suppliers.

import { useState, useEffect } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import type { Supplier } from '@/shared/types/entities'
import type { CreateSupplierInput, UpdateSupplierInput } from '@/shared/types/inputs'

interface SupplierFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateSupplierInput | UpdateSupplierInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  supplier?: Supplier | null
}

export function SupplierForm({ isOpen, onClose, onSubmit, onDelete, isSubmitting, isDeleting, supplier }: SupplierFormProps) {
  const isEdit = !!supplier

  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (supplier) {
      setName(supplier.name)
      setContactPerson(supplier.contact_person ?? '')
      setPhone(supplier.phone ?? '')
      setEmail(supplier.email ?? '')
      setAddress(supplier.address ?? '')
    } else {
      setName('')
      setContactPerson('')
      setPhone('')
      setEmail('')
      setAddress('')
    }
    setValidationError(null)
  }, [isOpen, supplier])

  function validate(): boolean {
    if (!name.trim()) { setValidationError('Name is required'); return false }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateSupplierInput = {
      name: name.trim(),
      contact_person: contactPerson.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
    }

    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Supplier' : 'Add Supplier'}
      size="md"
      footer={
        <>
          {isEdit && onDelete && (
            <Button variant="danger" isLoading={isDeleting} onClick={onDelete}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Add Supplier'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Input
          label="Supplier Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Supplier / company name"
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Contact Person"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="Primary contact"
          />
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 012-3456789"
          />
        </div>

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="supplier@company.com"
        />

        <Input
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, City, State"
        />
      </form>
    </Modal>
  )
}
