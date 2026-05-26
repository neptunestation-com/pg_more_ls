import type { ReactNode } from 'react'
import { useEscapeKey } from '../lib/useEscapeKey'

interface Props {
  /** Called when the user clicks the backdrop OR presses Escape. */
  onClose: () => void
  /** id of the heading element inside `children` for aria-labelledby. */
  labelledBy: string
  children: ReactNode
}

/**
 * Shared modal wrapper. Renders a click-outside-to-dismiss backdrop
 * + a centered dialog with proper ARIA. Escape closes via
 * useEscapeKey so keyboard users have the same affordance as click.
 *
 * The eslint-disable comments below are intentional: the backdrop is
 * a visual scrim, not an interactive control. It has a role of
 * presentation; keyboard users press Escape to dismiss. The native
 * <dialog> element is the long-term right answer but its API is
 * imperative (.showModal() etc.) and would require larger plumbing.
 */
export function Modal({ onClose, labelledBy, children }: Props) {
  useEscapeKey(onClose)
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      {/* Click stopPropagation keeps clicks inside the modal from
          triggering the backdrop's onClose. Keyboard pairing for
          dismiss is Escape (useEscapeKey). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
