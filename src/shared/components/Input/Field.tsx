import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface FieldProps {
  id: string
  label?: string
  required?: boolean
  helperText?: string
  error?: string
  children: ReactNode
}

/** Shared label + helper/error text layout for Input and Select — keeps both visually identical. */
export function Field({ id, label, required, helperText, error, children }: FieldProps) {
  const message = error ?? helperText

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[13px] leading-[18px] font-medium text-neutral-800">
          {label}
          {required && <span className="text-error-700"> *</span>}
        </label>
      )}
      {children}
      {message && (
        <p className={cn('text-xs leading-4', error ? 'text-error-700' : 'text-neutral-500')}>
          {message}
        </p>
      )}
    </div>
  )
}
