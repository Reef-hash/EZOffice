// Attendance type / source → badge tone mapping (per design system convention).
import type { BadgeTone } from '@/shared/components/StatusBadge'
import {
  ATTENDANCE_TYPE,
  ATTENDANCE_SOURCE,
  ATTENDANCE_STATUS,
  LEAVE_TYPE,
  LEAVE_STATUS,
  type AttendanceType,
  type AttendanceSource,
  type AttendanceStatus,
  type LeaveType,
  type LeaveStatus,
} from '@/shared/types/entities'

export { ATTENDANCE_TYPE, ATTENDANCE_SOURCE, ATTENDANCE_STATUS, LEAVE_TYPE, LEAVE_STATUS }

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

// Phase C — attendance log status (lateness / absence / excused)
export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, BadgeTone> = {
  [ATTENDANCE_STATUS.ON_TIME]: 'success',
  [ATTENDANCE_STATUS.LATE]: 'warning',
  [ATTENDANCE_STATUS.EXCUSED_LATE]: 'info',
  [ATTENDANCE_STATUS.ABSENT]: 'error',
}

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  [ATTENDANCE_STATUS.ON_TIME]: 'On Time',
  [ATTENDANCE_STATUS.LATE]: 'Late',
  [ATTENDANCE_STATUS.EXCUSED_LATE]: 'Excused',
  [ATTENDANCE_STATUS.ABSENT]: 'Absent',
}

// Phase C — leave types
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  [LEAVE_TYPE.ANNUAL]: 'Annual',
  [LEAVE_TYPE.SICK]: 'Sick',
  [LEAVE_TYPE.UNPAID]: 'Unpaid',
}

// Phase C — leave request status
export const LEAVE_STATUS_TONE: Record<LeaveStatus, BadgeTone> = {
  [LEAVE_STATUS.PENDING]: 'warning',
  [LEAVE_STATUS.APPROVED]: 'success',
  [LEAVE_STATUS.REJECTED]: 'error',
}

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  [LEAVE_STATUS.PENDING]: 'Pending',
  [LEAVE_STATUS.APPROVED]: 'Approved',
  [LEAVE_STATUS.REJECTED]: 'Rejected',
}
