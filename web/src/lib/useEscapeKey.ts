import { useEffect } from 'react'

/**
 * Calls `onEscape` when the user presses Escape anywhere in the
 * document. Intended for modal dismissal — pairs with click-on-
 * backdrop in <Modal>.
 */
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onEscape])
}
