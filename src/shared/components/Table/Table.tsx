import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type ColumnAlign = 'left' | 'right' | 'center'

interface BaseColumn<T> {
  key: string
  header: string
  accessor: (row: T) => ReactNode
  align?: ColumnAlign
  width?: string
}

/** Sortable columns must supply `sortValue` — `accessor` may return formatted JSX that can't be sorted directly. */
export type Column<T> =
  | (BaseColumn<T> & { sortable?: false })
  | (BaseColumn<T> & { sortable: true; sortValue: (row: T) => string | number })

interface EmptyState {
  title: string
  description?: string
  action?: ReactNode
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => string | number
  isLoading?: boolean
  emptyState?: EmptyState
  onRowClick?: (row: T) => void
  className?: string
}

type SortDirection = 'asc' | 'desc'

const alignClass: Record<ColumnAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

export function Table<T>({
  columns,
  data,
  rowKey,
  isLoading = false,
  emptyState,
  onRowClick,
  className,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const sortedData = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey)
    if (!column || !column.sortable) return data

    const sorted = [...data].sort((a, b) => {
      const aValue = column.sortValue(a)
      const bValue = column.sortValue(b)
      if (aValue === bValue) return 0
      return aValue > bValue ? 1 : -1
    })
    return sortDirection === 'asc' ? sorted : sorted.reverse()
  }, [data, sortKey, sortDirection, columns])

  function toggleSort(column: Column<T>) {
    if (!column.sortable) return
    if (sortKey !== column.key) {
      setSortKey(column.key)
      setSortDirection('asc')
      return
    }
    setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
  }

  return (
    <div className={cn('overflow-x-auto rounded-xl bg-white shadow-sm', className)}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'whitespace-nowrap px-5 py-3.5 text-xs font-medium uppercase tracking-wide text-neutral-500',
                  alignClass[column.align ?? 'left'],
                )}
              >
                {column.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className={cn(
                      'inline-flex items-center gap-1 hover:text-neutral-900',
                      column.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {column.header}
                    <SortIcon active={sortKey === column.key} direction={sortDirection} />
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} className="border-t border-neutral-200">
                {columns.map((column) => (
                  <td key={column.key} className="px-5 py-3.5">
                    <div className="h-4 w-full max-w-32 animate-pulse rounded-sm bg-neutral-200" />
                  </td>
                ))}
              </tr>
            ))}

          {!isLoading && data.length === 0 && emptyState && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center">
                <p className="text-sm font-medium text-neutral-700">{emptyState.title}</p>
                {emptyState.description && (
                  <p className="mt-1 text-sm text-neutral-500">{emptyState.description}</p>
                )}
                {emptyState.action && (
                  <div className="mt-4 flex justify-center">{emptyState.action}</div>
                )}
              </td>
            </tr>
          )}

          {!isLoading &&
            sortedData.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-t border-neutral-200',
                  onRowClick && 'cursor-pointer hover:bg-neutral-50',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn('px-5 py-3.5 text-neutral-900', alignClass[column.align ?? 'left'])}
                  >
                    {column.accessor(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  const upActive = active && direction === 'asc'
  const downActive = active && direction === 'desc'

  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <path
        d="M4 6.5 8 3l4 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={upActive ? 'text-neutral-700' : 'text-neutral-300'}
      />
      <path
        d="M4 9.5 8 13l4-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={downActive ? 'text-neutral-700' : 'text-neutral-300'}
      />
    </svg>
  )
}
