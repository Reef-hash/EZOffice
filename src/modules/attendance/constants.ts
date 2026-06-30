// Attendance type / source → badge tone mapping (per design system convention).
import type { BadgeTone } from '@/shared/components/StatusBadge'
import {
  ATTENDANCE_TYPE,
  ATTENDANCE_SOURCE,
  type AttendanceType,
  type AttendanceSource,
} from '@/shared/types/entities'

export { ATTENDANCE_TYPE, ATTENDANCE_SOURCE }

export const ATTENDANCE_TYPE_TONE: Record<AttendanceType, BadgeTone> = {
  [ATTENDANCE_TYPE.IN]: 'success',
  [ATTENDANCE_TYPE.OUT]: 'warning',
}

export const ATTENDANCE_TYPE_LABEL: Record<AttendanceType, string> = {
  [ATTENDANCE_TYPE.IN]: 'In',
  [ATTENDANCE_TYPE.OUT]: 'Out',
}

export const ATTENDANCE_SOURCE_TONE: Record<AttendanceSource, BadgeTone> = {
  [ATTENDANCE_SOURCE.MANUAL]: 'info',
  [ATTENDANCE_SOURCE.DEVICE]: 'neutral',
}

export const ATTENDANCE_SOURCE_LABEL: Record<AttendanceSource, string> = {
  [ATTENDANCE_SOURCE.MANUAL]: 'Manual',
  [ATTENDANCE_SOURCE.DEVICE]: 'Device',
}
