// CustomerForm — Add/Edit form for Customers.

import { useState, useEffect } from 'react'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import type { Customer } from '@/shared/types/entities'
import type { CreateCustomerInput, UpdateCustomerInput } from '@/shared/types/inputs'

interface CustomerFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateCustomerInput | UpdateCustomerInput) => Promise<void>
  isSubmitting: boolean
  customer?: Customer | null
}

export function CustomerForm({ isOpen, onClose, onSubmit, isSubmitting, customer }: CustomerFormProps) {
  const isEdit = !!customer

  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (customer) {
      setName(customer.name)
      setContactPerson(customer.contact_person ?? '')
      setPhone(customer.phone ?? '')
      setEmail(customer.email ?? '')
      setAddress(customer.address ?? '')
    } else {
      setName('')
      setContactPerson('')
      setPhone('')
      setEmail('')
      setAddress('')
    }
    setValidationError(null)
  }, [isOpen, customer])

  function validate(): boolean {
    if (!name.trim()) { setValidationError('Name is required'); return false }
    return true
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateCustomerInput = {
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
      title={isEdit ? 'Edit Customer' : 'Add Customer'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Add Customer'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Input
          label="Company / Customer Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Customer name"
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
          placeholder="contact@customer.com"
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
