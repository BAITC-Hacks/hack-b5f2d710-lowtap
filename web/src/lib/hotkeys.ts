// Четыре клавиши Пульта (VISUAL_SPEC §3.1): Space play/pause, Esc отмена, Ctrl+Z undo, M матрица.

import { useEffect } from 'react'

export interface HotkeyHandlers {
  space?: () => void
  escape?: () => void
  undo?: () => void
  matrix?: () => void
}

function typingInField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function useHotkeys(handlers: HotkeyHandlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typingInField(e.target)) return
      if (e.key === 'Escape' && handlers.escape) {
        handlers.escape()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey && handlers.undo) {
        e.preventDefault()
        handlers.undo()
      } else if (e.code === 'Space' && !e.ctrlKey && handlers.space) {
        e.preventDefault()
        handlers.space()
      } else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && handlers.matrix) {
        handlers.matrix()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
