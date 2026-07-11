import { useState, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { cn } from '@/shared/lib/cn'
import { Table } from '@/shared/components/Table'
import type { Column } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PageHeader } from '@/shared/components/PageHeader'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { CalendarEventForm } from './CalendarEventForm'
import type { CalendarEvent, CompanyCalendarProfile } from '@/shared/types/entities'
import type { UpdateCalendarEventInput, CreateCalendarEventInput, UpdateCompanyCalendarProfileInput } from '@/shared/types/inputs'
import {
  CALENDAR_EVENT_TYPE_LABEL,
  CALENDAR_EVENT_TYPE_TONE,
} from './constants'

type CalendarTab = 'workingWeek' | 'events'

const TABS: Array<{ key: CalendarTab; label: string }> = [
  { key: 'workingWeek', label: 'Working Week' },
  { key: 'events', label: 'Events' },
]

const DAYS = [
  { key: 'monday_is_working' as const, label: 'Monday' },
  { key: 'tuesday_is_working' as const, label: 'Tuesday' },
  { key: 'wednesday_is_working' as const, label: 'Wednesday' },
  { key: 'thursday_is_working' as const, label: 'Thursday' },
  { key: 'friday_is_working' as const, label: 'Friday' },
  { key: 'saturday_is_working' as const, label: 'Saturday' },
  { key: 'sunday_is_working' as const, label: 'Sunday' },
]

const eventColumns: Column<CalendarEvent>[] = [
  {
    key: 'event_date',
    header: 'Date',
    accessor: (r) => r.event_date,
    sortable: true,
    sortValue: (r) => r.event_date,
  },
  {
    key: 'event_type',
    header: 'Type',
    accessor: (r) => (
      <StatusBadge tone={CALENDAR_EVENT_TYPE_TONE[r.event_type]}>
        {CALENDAR_EVENT_TYPE_LABEL[r.event_type]}
      </StatusBadge>
    ),
    sortable: true,
    sortValue: (r) => r.event_type,
  },
  {
    key: 'name',
    header: 'Name',
    accessor: (r) => r.name,
    sortable: true,
    sortValue: (r) => r.name,
  },
  {
    key: 'is_recurring',
    header: 'Recurring',
    accessor: (r) => (r.is_recurring ? 'Yes' : 'No'),
    align: 'center',
    width: '90px',
  },
  { key: 'description', header: 'Description', accessor: (r) => r.description || '—' },
]

export function CalendarPage() {
  const [activeTab, setActiveTab] = useState<CalendarTab>('workingWeek')
  const [formEvent, setFormEvent] = useState<CalendarEvent | null | 'new'>(null)
  const [eventFilterMonth, setEventFilterMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [weekEdits, setWeekEdits] = useState<Record<string, boolean> | null>(null)

  const { data: companyProfile } = useIpcQuery<CompanyCalendarProfile>(
    ['calendar', 'companyProfile'],
    () => window.api.calendar.getCompanyProfile(),
  )

  const eventFilterYear = parseInt(eventFilterMonth.split('-')[0], 10)
  const eventFilterMonthNum = parseInt(eventFilterMonth.split('-')[1], 10)

  // Sync local edits when profile loads
  useEffect(() => {
    if (companyProfile && weekEdits === null) {
      setWeekEdits({
        monday_is_working: companyProfile.monday_is_working,
        tuesday_is_working: companyProfile.tuesday_is_working,
        wednesday_is_working: companyProfile.wednesday_is_working,
        thursday_is_working: companyProfile.thursday_is_working,
        friday_is_working: companyProfile.friday_is_working,
        saturday_is_working: companyProfile.saturday_is_working,
        sunday_is_working: companyProfile.sunday_is_working,
      })
    }
  }, [companyProfile, weekEdits])

  // ── Calendar Events ─────────────────────────────────────

  const { data: events = [], isLoading: eventsLoading } = useIpcQuery<CalendarEvent[]>(
    ['calendar', 'events', String(eventFilterYear), String(eventFilterMonthNum)],
    () => window.api.calendar.listEvents({ year: eventFilterYear, month: eventFilterMonthNum }),
  )

  const createMutation = useIpcMutation<CalendarEvent, CreateCalendarEventInput>(
    (data) => window.api.calendar.createEvent(data),
    [['calendar', 'events']],
    { onSuccessMessage: 'Event created' },
  )

  const updateMutation = useIpcMutation<CalendarEvent, { id: number; data: UpdateCalendarEventInput }>(
    ({ id, data }) => window.api.calendar.updateEvent(id, data),
    [['calendar', 'events']],
    { onSuccessMessage: 'Event updated' },
  )

  const deleteMutation = useIpcMutation<void, number>(
    (id) => window.api.calendar.deleteEvent(id),
    [['calendar', 'events']],
    { onSuccessMessage: 'Event deleted' },
  )

  const updateProfileMutation = useIpcMutation<CompanyCalendarProfile, UpdateCompanyCalendarProfileInput>(
    (data) => window.api.calendar.updateCompanyProfile(data),
    [['calendar', 'companyProfile']],
    { onSuccessMessage: 'Working week updated' },
  )

  const handleFormSubmit = useCallback(async (data: CreateCalendarEventInput | UpdateCalendarEventInput) => {
    if (formEvent === 'new') {
      createMutation.mutate(data as CreateCalendarEventInput)
    } else if (formEvent) {
      updateMutation.mutate({ id: formEvent.id, data: data as UpdateCalendarEventInput })
    }
  }, [formEvent, createMutation, updateMutation])

  const handleFormDelete = useCallback(async () => {
    if (formEvent && formEvent !== 'new') {
      deleteMutation.mutate(formEvent.id)
    }
  }, [formEvent, deleteMutation])

  return (
    <div>
      <PageHeader
        title="Company Calendar"
        subtitle="Manage working days, holidays, and company events"
      />

      <div className="mb-6 flex gap-1 rounded-xl bg-neutral-100 p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer',
              activeTab === tab.key
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Working Week Tab */}
      {activeTab === 'workingWeek' && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl bg-white p-7 shadow-sm">
            <h3 className="mb-1 text-base font-semibold text-neutral-900">Default Working Week</h3>
            <p className="mb-4 text-sm text-neutral-500">
              Configure which days are regular working days. Weekly off days do not expect attendance.
              Employees without a custom calendar profile will use these defaults.
            </p>
            <div className="flex flex-col gap-3">
              {DAYS.map((day) => (
                <label key={day.key} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={weekEdits?.[day.key] ?? false}
                    onChange={(e) => {
                      setWeekEdits((prev) => ({ ...prev, [day.key]: e.target.checked }))
                    }}
                    className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="w-24 font-medium">{day.label}</span>
                  <span className="text-neutral-400">
                    {weekEdits?.[day.key] ? 'Working Day' : 'Weekly Off'}
                  </span>
                </label>
              ))}
            </div>
            <Button
              className="mt-4"
              onClick={() => {
                if (!weekEdits) return
                updateProfileMutation.mutate({
                  monday_is_working: weekEdits.monday_is_working,
                  tuesday_is_working: weekEdits.tuesday_is_working,
                  wednesday_is_working: weekEdits.wednesday_is_working,
                  thursday_is_working: weekEdits.thursday_is_working,
                  friday_is_working: weekEdits.friday_is_working,
                  saturday_is_working: weekEdits.saturday_is_working,
                  sunday_is_working: weekEdits.sunday_is_working,
                })
              }}
              isLoading={updateProfileMutation.isPending}
            >
              Save Working Week
            </Button>
          </div>
        </div>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Input
              type="month"
              value={eventFilterMonth}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEventFilterMonth(e.target.value)}
              className="w-44"
            />
            <Button onClick={() => setFormEvent('new')}>Add Event</Button>
          </div>

          <Table
            columns={eventColumns}
            data={events}
            rowKey={(r) => String(r.id)}
            isLoading={eventsLoading}
            emptyState={{ title: 'No calendar events for this month' }}
            onRowClick={(row) => setFormEvent(row)}
          />
        </div>
      )}

      {/* Calendar Event Form Modal */}
      <CalendarEventForm
        isOpen={formEvent !== null}
        onClose={() => setFormEvent(null)}
        onSubmit={handleFormSubmit}
        onDelete={formEvent !== 'new' ? handleFormDelete : undefined}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
        event={formEvent !== 'new' ? formEvent : null}
      />
    </div>
  )
}
