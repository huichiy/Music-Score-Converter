import { useRef } from 'react'

/**
 * Backdrop handlers for a modal: close only when the press STARTED on the backdrop.
 * A plain onClick also fires when a drag begins inside the modal and ends outside it
 * (selecting text in an input, dragging a crop corner past the edge), because the
 * browser sends the click to the common ancestor — the modal closed and the input
 * or selection was lost.
 */
export function useBackdropClose(onClose: () => void) {
  const pressedBackdrop = useRef(false)
  return {
    // Capture phase: a child that stops propagation must not leave a stale flag behind
    onPointerDownCapture: (e: React.PointerEvent) => { pressedBackdrop.current = e.target === e.currentTarget },
    onClick: (e: React.MouseEvent) => {
      if (pressedBackdrop.current && e.target === e.currentTarget) onClose()
      pressedBackdrop.current = false
    },
  }
}
