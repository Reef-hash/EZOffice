// PayrollSettingsPage — singleton OT rule form.
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
  )

  const [otRuleType, setOtRuleType] = useState<'flat_addition' | 'multiplier'>('flat_addition')
  const [otRuleValue, setOtRuleValue] = useState('0.50')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      setOtRuleType(settings.ot_rule_type)
      setOtRuleValue(String(settings.ot_rule_value))
    }
  }, [settings])

  const handleSave = useCallback(async () => {
    setSaved(false)
    await updateMutation.mutateAsync({
      ot_rule_type: otRuleType,
      ot_rule_value: Number(otRuleValue),
    })
    setSaved(true)
  }, [updateMutation, otRuleType, otRuleValue])

  if (isLoading) {
    return <p className="text-sm text-neutral-500">Loading settings...</p>
  }

  return (
    <Card title="Overtime Rule" subtitle="Applies to every employee's OT hours during payroll calculation.">
      <div className="flex flex-col gap-4 max-w-md">
        <Select
          label="Rule Type"
          value={otRuleType}
          onChange={(e) => { setOtRuleType(e.target.value as 'flat_addition' | 'multiplier'); setSaved(false) }}
          options={OT_RULE_TYPE_OPTIONS}
        />
        <Input
          label={otRuleType === 'flat_addition' ? 'Flat Addition Per OT Hour (RM)' : 'Multiplier'}
          type="number"
          step="0.01"
          value={otRuleValue}
          onChange={(e) => { setOtRuleValue(e.target.value); setSaved(false) }}
          helperText={
            otRuleType === 'flat_addition'
              ? 'OT rate/hour = hourly rate + this amount (default RM 0.50).'
              : 'OT rate/hour = hourly rate × this multiplier (e.g. 1.5).'
          }
        />

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
    </Card>
  )
}
