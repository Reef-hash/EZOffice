// Global toast notification system.
// Wrap the app with <ToastProvider> (done in AppShell), then call useToast()
// anywhere in the tree to get addToast(message, tone?).
// Each toast auto-dismisses after 4.5 s and can be manually closed.

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface ToastItem {
  id: string
  message: string
  tone: 'success' | 'error' | 'info'
}

interface ToastContextValue {
  addToast: (message: string, tone?: ToastItem['tone']) => void
}

const TOAST_DURATION_MS = 4500

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, tone: ToastItem['tone'] = 'info') => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, message, tone }])
      setTimeout(() => removeToast(id), TOAST_DURATION_MS)
    },
    [removeToast],
  )

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start justify-between gap-3 rounded-xl border-l-4 px-4 py-3 shadow-md text-sm',
              toast.tone === 'success' && 'border-success-600 bg-success-50 text-success-700',
              toast.tone === 'error' && 'border-error-600 bg-error-50 text-error-700',
              toast.tone === 'info' && 'border-primary-600 bg-primary-50 text-primary-700',
            )}
          >
            <span>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 leading-none opacity-50 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
