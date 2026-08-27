// PayrollSettingsPage — singleton pay-rule form (overtime + non-working-day premiums).
// payroll_settings has exactly one row (id = 1); this page just loads and updates it.

import { useState, useEffect, useCallback } from 'react'
import { Input, Select } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Card } from '@/shared/components/Card'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import type { PayrollSettings } from '@/shared/types/entities'
import type { UpdatePayrollSettingsInput } from '@/shared/types/inputs'
import { OT_RULE_TYPE_OPTIONS } from '../constants'

export function PayrollSettingsPage() {
  const { data: settings, isLoading } = useIpcQuery<PayrollSettings>(
    ['payroll', 'settings'],
    () => window.api.payroll.settings.get(),
  )

  const updateMutation = useIpcMutation<PayrollSettings, UpdatePayrollSettingsInput>(
    (data) => window.api.payroll.settings.update(data),
    [['payroll', 'settings']],
    { onSuccessMessage: 'Payroll settings updated successfully' },
  )

  const [otRuleType, setOtRuleType] = useState<'flat_addition' | 'multiplier'>('multiplier')
  const [otRuleValue, setOtRuleValue] = useState('1.5')
  const [restDay, setRestDay] = useState('1')
  const [restDayOt, setRestDayOt] = useState('2')
  const [holiday, setHoliday] = useState('2')
  const [holidayOt, setHolidayOt] = useState('3')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      setOtRuleType(settings.ot_rule_type)
      setOtRuleValue(String(settings.ot_rule_value))
      setRestDay(String(settings.rest_day_multiplier))
      setRestDayOt(String(settings.rest_day_ot_multiplier))
      setHoliday(String(settings.holiday_multiplier))
      setHolidayOt(String(settings.holiday_ot_multiplier))
    }
  }, [settings])

  const markDirty = useCallback(() => setSaved(false), [])

  const handleSave = useCallback(async () => {
    setSaved(false)
    await updateMutation.mutateAsync({
      ot_rule_type: otRuleType,
      ot_rule_value: Number(otRuleValue),
      rest_day_multiplier: Number(restDay),
      rest_day_ot_multiplier: Number(restDayOt),
      holiday_multiplier: Number(holiday),
      holiday_ot_multiplier: Number(holidayOt),
    })
    setSaved(true)
  }, [updateMutation, otRuleType, otRuleValue, restDay, restDayOt, holiday, holidayOt])

  if (isLoading) {
    return <p className="text-sm text-neutral-500">Loading settings...</p>
  }

  // The Employment Act 1955 sets these as minimums, so anything lower is worth
  // warning about — the admin can still save it (company policy and the employee's
  // contract, not this screen, decide what is actually lawful for them).
  const otBelowMinimum = otRuleType !== 'multiplier' || Number(otRuleValue) < 1.5

  return (
    <div className="flex flex-col gap-6">
      <Card title="Overtime Rule" subtitle="Applies to OT hours worked on a normal working day.">
        <div className="flex flex-col gap-4 max-w-md">
          <Select
            label="Rule Type"
            value={otRuleType}
            onChange={(e) => { setOtRuleType(e.target.value as 'flat_addition' | 'multiplier'); markDirty() }}
            options={OT_RULE_TYPE_OPTIONS}
          />
          <Input
            label={otRuleType === 'flat_addition' ? 'Flat Addition Per OT Hour (RM)' : 'Multiplier'}
            type="number"
            step="0.01"
            value={otRuleValue}
            onChange={(e) => { setOtRuleValue(e.target.value); markDirty() }}
            helperText={
              otRuleType === 'flat_addition'
                ? 'OT rate/hour = hourly rate + this amount.'
                : 'OT rate/hour = hourly rate × this multiplier.'
            }
          />
          {otBelowMinimum && (
            <div className="rounded-md border border-warning-600 bg-warning-50 px-4 py-3 text-sm text-warning-700">
              <strong>Below the statutory minimum.</strong> The Employment Act 1955 (s.60A)
              sets overtime on a normal working day at no less than <strong>1.5×</strong> the
              ordinary hourly rate. Confirm this setting with your accountant before running payroll.
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Rest Day & Public Holiday Rates"
        subtitle="Multipliers applied to the ordinary hourly rate for work performed on a non-working day."
      >
        <div className="flex flex-col gap-4 max-w-md">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Rest Day"
              type="number"
              step="0.1"
              value={restDay}
              onChange={(e) => { setRestDay(e.target.value); markDirty() }}
              helperText="Normal hours on a rest day."
            />
            <Input
              label="Rest Day — Overtime"
              type="number"
              step="0.1"
              value={restDayOt}
              onChange={(e) => { setRestDayOt(e.target.value); markDirty() }}
              helperText="Hours beyond the normal day."
            />
            <Input
              label="Public Holiday"
              type="number"
              step="0.1"
              value={holiday}
              onChange={(e) => { setHoliday(e.target.value); markDirty() }}
              helperText="Normal hours on a holiday."
            />
            <Input
              label="Public Holiday — Overtime"
              type="number"
              step="0.1"
              value={holidayOt}
              onChange={(e) => { setHolidayOt(e.target.value); markDirty() }}
              helperText="Hours beyond the normal day."
            />
          </div>
          <p className="text-sm text-neutral-500">
            Defaults follow the Employment Act 1955 minimums (s.60(3), s.60D(3)). Working up
            to half a rest day earns half a day&apos;s wages and anything beyond that earns a
            full day&apos;s — the app applies those tiers automatically, which is why the rest
            day rate is 1× rather than 2×. Any work on a public holiday earns the full holiday
            premium regardless of hours.
          </p>
        </div>
      </Card>

      <div className="flex flex-col gap-3 max-w-md">
        {updateMutation.error && (
          <p className="text-sm text-error-700">{updateMutation.error.message}</p>
        )}
        {saved && !updateMutation.isPending && (
          <p className="text-sm text-success-700">Settings saved.</p>
        )}
        <div>
          <Button isLoading={updateMutation.isPending} onClick={handleSave}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  )
}
