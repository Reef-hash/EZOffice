import { useEffect, useRef } from 'react'

export function useFocusTrap(isOpen: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    // Save the element that triggered the modal
    previousFocusRef.current = document.activeElement as HTMLElement

    const container = containerRef.current
    if (!container) return

    const focusableElementsQuery =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const getFocusableElements = () => {
      return Array.from(
        container.querySelectorAll<HTMLElement>(focusableElementsQuery)
      )
    }

    // Set initial focus
    const focusable = getFocusableElements()
    if (focusable.length > 0) {
      focusable[0].focus()
    } else {
      container.focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const elements = getFocusableElements()
      if (elements.length === 0) {
        e.preventDefault()
        return
      }

      const firstElement = elements[0]
      const lastElement = elements[elements.length - 1]
      const activeElement = document.activeElement

      if (e.shiftKey) {
        // Shift + Tab
        if (activeElement === firstElement || activeElement === container) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab
        if (activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore focus on close
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus()
      }
    }
  }, [isOpen])

  return containerRef
}
