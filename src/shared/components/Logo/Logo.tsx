// EZOffice logo — concept C "Attendance Grid" (designeqp/EZOffice Logo.pdf).
// A 3x3 grid of attendance cells: one amber "present" cell, one outlined "pending" cell.
// The mark and wordmark both use currentColor so the logo flips to white on dark
// surfaces by changing the text colour, never by swapping assets.

import { cn } from '../../lib/cn'

// Brand amber — the only fixed (non-currentColor) colour in the mark.
const BRAND_AMBER = '#f2a33a'

const GRID_CELLS = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 },
  { x: 0, y: 40 }, /* amber */ { x: 80, y: 80 },
  { x: 0, y: 80 }, { x: 40, y: 80 },
] as const

interface LogoMarkProps {
  className?: string
}

export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 110 110" className={cn('size-8 shrink-0', className)} role="img" aria-label="EZOffice">
      {GRID_CELLS.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="30" height="30" rx="8" fill="currentColor" />
      ))}
      <rect x="40" y="40" width="30" height="30" rx="8" fill={BRAND_AMBER} />
      <rect x="81.5" y="41.5" width="27" height="27" rx="7" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
    </svg>
  )
}

interface LogoProps {
  /** Mark only — used by the collapsed sidebar. */
  markOnly?: boolean
  className?: string
  markClassName?: string
  wordmarkClassName?: string
}

export function Logo({ markOnly = false, className, markClassName, wordmarkClassName }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-primary-600 dark:text-white', className)}>
      <LogoMark className={markClassName} />
      {!markOnly && (
        <span className={cn('text-xl leading-none tracking-tight', wordmarkClassName)}>
          <span className="font-extrabold">EZ</span>
          <span className="font-normal">Office</span>
        </span>
      )}
    </span>
  )
}
