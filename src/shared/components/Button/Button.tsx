import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from '../Spinner/Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
  secondary:
    'bg-surface text-neutral-800 border border-neutral-300 hover:bg-neutral-100 active:bg-neutral-200',
  // High-emphasis, sparingly used — global/standout actions (e.g. "Manage Team", "Add Task"),
  // not the per-form primary action. See DESIGN_SYSTEM.md Button section.
  dark: 'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950',
  danger: 'bg-error-700 text-white hover:bg-error-600 active:bg-error-800',
  ghost: 'bg-transparent text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
}



export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', isLoading = false, disabled, className, children, ...props },
    ref,
  ): ReactNode => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={cn(
          'inline-flex items-center justify-center rounded-full font-medium leading-none',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {isLoading && <Spinner className="size-4" />}
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'
