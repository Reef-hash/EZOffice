import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { Field } from './Field'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  helperText?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, required, id, className, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId

    return (
      <Field id={inputId} label={label} required={required} helperText={helperText} error={error}>
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full rounded-md border bg-surface px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-primary-600/40',
            error
              ? 'border-error-600 focus:ring-error-600/30'
              : 'border-neutral-300 focus:border-primary-600',
            'disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        />
      </Field>
    )
  },
)

Input.displayName = 'Input'
