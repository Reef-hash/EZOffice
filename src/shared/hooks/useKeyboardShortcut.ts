import { useEffect, useRef } from 'react'

export interface ShortcutConfig {
  key: string
  ctrlKey?: boolean
  callback: (e: KeyboardEvent) => void
}

export function useKeyboardShortcut(shortcuts: ShortcutConfig[], enabled = true) {
  const shortcutsRef = useRef(shortcuts)

  useEffect(() => {
    shortcutsRef.current = shortcuts
  }, [shortcuts])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // If a modal/dialog is currently open in the DOM, do not fire page-level list shortcuts
      const hasOpenModal = document.querySelector('[role="dialog"]') !== null
      if (hasOpenModal) return

      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable

      for (const shortcut of shortcutsRef.current) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()
        // Match Ctrl or Command key
        const ctrlMatch = shortcut.ctrlKey ? (e.ctrlKey || e.metaKey) : true

        if (keyMatch && ctrlMatch) {
          // If the user is typing in an input, only allow Escape or Save (Ctrl+S) shortcuts
          if (isInput && shortcut.key.toLowerCase() !== 'escape' && shortcut.key.toLowerCase() !== 's') {
            continue
          }
          e.preventDefault()
          shortcut.callback(e)
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
