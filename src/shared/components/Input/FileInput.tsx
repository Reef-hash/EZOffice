import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { Field } from './Field'

export interface FileInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  helperText?: string
  error?: string
}

export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(
  ({ label, helperText, error, required, id, className, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId

    return (
      <Field id={inputId} label={label} required={required} helperText={helperText} error={error}>
        <input
          ref={ref}
          id={inputId}
          type="file"
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(
            'block w-full text-sm text-neutral-500',
            'file:mr-4 file:py-2 file:px-4',
            'file:rounded-md file:border-0',
            'file:text-xs file:font-semibold',
            'file:bg-primary-50 file:text-primary-700',
            'hover:file:bg-primary-100 file:cursor-pointer',
            className,
          )}
          {...props}
        />
      </Field>
    )
  },
)

FileInput.displayName = 'FileInput'
