import { forwardRef, useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { Field } from './Field'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string
  helperText?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helperText, error, required, id, className, options, placeholder, ...props }, ref) => {
    const generatedId = useId()
    const selectId = id ?? generatedId

    return (
      <Field id={selectId} label={label} required={required} helperText={helperText} error={error}>
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full rounded-md border bg-white px-3.5 text-sm text-neutral-900',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-primary-600/40',
            error
              ? 'border-error-600 focus:ring-error-600/30'
              : 'border-neutral-300 focus:border-primary-600',
            'disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    )
  },
)

Select.displayName = 'Select'
