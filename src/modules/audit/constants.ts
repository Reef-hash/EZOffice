import type { BadgeTone } from '@/shared/components/StatusBadge'

export const AUDIT_ACTION_TONE: Record<string, BadgeTone> = {
  create: 'info',
  update: 'warning',
  delete: 'error',
  login: 'neutral',
  logout: 'neutral',
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  login: 'login',
  logout: 'logout',
}
