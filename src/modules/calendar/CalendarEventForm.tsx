import { useState, useEffect } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import type { CalendarEvent, CalendarEventType } from '@/shared/types/entities'
import type { CreateCalendarEventInput, UpdateCalendarEventInput } from '@/shared/types/inputs'
import { CALENDAR_EVENT_TYPE, CALENDAR_EVENT_TYPE_LABEL } from './constants'

interface CalendarEventFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateCalendarEventInput | UpdateCalendarEventInput) => Promise<void>
  onDelete?: () => Promise<void>
  isSubmitting: boolean
  isDeleting?: boolean
  event?: CalendarEvent | null
}

const EVENT_TYPE_OPTIONS = Object.values(CALENDAR_EVENT_TYPE).map((v) => ({
  value: v,
  label: CALENDAR_EVENT_TYPE_LABEL[v],
}))

export function CalendarEventForm({
  isOpen,
  onClose,
  onSubmit,
  onDelete,
  isSubmitting,
  isDeleting,
  event,
}: CalendarEventFormProps) {
  const isEdit = !!event

  const [eventType, setEventType] = useState<CalendarEventType>(CALENDAR_EVENT_TYPE.PUBLIC_HOLIDAY)
  const [name, setName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [description, setDescription] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (event) {
      setEventType(event.event_type)
      setName(event.name)
      setEventDate(event.event_date)
      setDescription(event.description ?? '')
      setIsRecurring(event.is_recurring)
    } else {
      setEventType(CALENDAR_EVENT_TYPE.PUBLIC_HOLIDAY)
      setName('')
      setEventDate('')
      setDescription('')
      setIsRecurring(false)
    }
    setValidationError(null)
  }, [isOpen, event])

  function validate(): boolean {
    if (!name.trim()) { setValidationError('Event name is required'); return false }
    if (!eventDate.match(/^\d{4}-\d{2}-\d{2}$/)) { setValidationError('Valid date (YYYY-MM-DD) is required'); return false }
    return true
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setValidationError(null)
    if (!validate()) return

    const data: CreateCalendarEventInput = {
      event_type: eventType,
      name: name.trim(),
      event_date: eventDate,
      description: description.trim() || null,
      is_recurring: isRecurring,
    }

    await onSubmit(data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Calendar Event' : 'Add Calendar Event'}
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
            {isEdit ? 'Save Changes' : 'Add Event'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {validationError && (
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{validationError}</p>
        )}

        <Select
          label="Event Type"
          required
          value={eventType}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setEventType(e.target.value as CalendarEventType)}
          options={EVENT_TYPE_OPTIONS}
        />

        <Input
          label="Event Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hari Merdeka"
        />

        <Input
          label="Date"
          required
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
        />

        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional notes"
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          Repeats every year
        </label>
      </form>
    </Modal>
  )
}
