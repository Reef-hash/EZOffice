// Payroll module constants — label, tone, and option maps.
// Reusable across payroll pages; mirrors attendance/constants.ts pattern.

import type { StatusBadgeProps } from '@/shared/components/StatusBadge'

export const RATE_TYPE_LABEL: Record<string, string> = {
  daily: 'Daily Rate',
  hourly: 'Hourly Rate',
  monthly: 'Monthly Salary',
}

export const OT_RULE_TYPE_LABEL: Record<string, string> = {
  flat_addition: 'Flat Addition (RM per OT hour)',
  multiplier: 'Multiplier (× regular rate)',
}

export const PAYROLL_RUN_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  finalized: 'Finalized',
}

export const PAYROLL_RUN_STATUS_TONE: Record<string, StatusBadgeProps['tone']> = {
  draft: 'warning',
  finalized: 'success',
}

export const ADVANCE_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  settled: 'Settled',
  cancelled: 'Cancelled',
}

export const ADVANCE_STATUS_TONE: Record<string, StatusBadgeProps['tone']> = {
  active: 'warning',
  settled: 'success',
  cancelled: 'neutral',
}

export const DEDUCTION_MODE_LABEL: Record<string, string> = {
  full_balance: 'Full Balance',
  fixed_installment: 'Fixed Installment',
}

export const PCB_CATEGORY_LABEL: Record<string, string> = {
  single: 'Single',
  married_no_spouse_income: 'Married (Spouse Not Working)',
  married_with_spouse_income: 'Married (Spouse Working)',
}

export const RATE_TYPE_OPTIONS = [
  { value: 'daily', label: 'Daily Rate' },
  { value: 'hourly', label: 'Hourly Rate' },
  { value: 'monthly', label: 'Monthly Salary' },
]

export const OT_RULE_TYPE_OPTIONS = [
  { value: 'flat_addition', label: 'Flat Addition (RM/hour)' },
  { value: 'multiplier', label: 'Multiplier (× rate)' },
]

export const DEDUCTION_MODE_OPTIONS = [
  { value: 'full_balance', label: 'Deduct Full Balance' },
  { value: 'fixed_installment', label: 'Fixed Installment' },
]

export const PCB_CATEGORY_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married_no_spouse_income', label: 'Married (Spouse Not Working)' },
  { value: 'married_with_spouse_income', label: 'Married (Spouse Working)' },
]
