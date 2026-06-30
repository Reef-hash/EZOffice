// Employee status → badge tone mapping (per design system convention).
import type { BadgeTone } from '@/shared/components/StatusBadge'
import { EMPLOYEE_STATUS, type EmployeeStatus } from '@/shared/types/entities'

export { EMPLOYEE_STATUS }

export const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, BadgeTone> = {
  [EMPLOYEE_STATUS.ACTIVE]: 'success',
  [EMPLOYEE_STATUS.INACTIVE]: 'neutral',
}

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  [EMPLOYEE_STATUS.ACTIVE]: 'Active',
  [EMPLOYEE_STATUS.INACTIVE]: 'Inactive',
}
