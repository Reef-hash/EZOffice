import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  subtitle?: string
  actions?: ReactNode
  footer?: ReactNode
}

export function Card({ title, subtitle, actions, footer, className, children, ...props }: CardProps) {
  const hasHeader = title || subtitle || actions

  return (
    <div
      className={cn('rounded-xl bg-surface shadow-sm', className)}
      {...props}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-7 py-5">
          <div>
            {title && <h3 className="text-base font-semibold leading-6 text-neutral-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className="p-7">{children}</div>

      {footer && <div className="border-t border-neutral-200 px-7 py-5">{footer}</div>}
    </div>
  )
}
