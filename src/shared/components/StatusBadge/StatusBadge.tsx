import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/**
 * Visual tone only — shared components stay domain-agnostic. Each module maps its own
 * status enum to a tone (e.g. erp/constants/poStatus.ts maps POStatus -> BadgeTone).
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  info: 'bg-info-100 text-info-700',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  error: 'bg-error-100 text-error-700',
}

export function StatusBadge({ tone, className, children, ...props }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium leading-4',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
