'use client'

import { useEffect } from 'react'

/**
 * iOS Safari keyboard handling using visualViewport API.
 *
 * The problem: On iOS, `position: fixed` elements are fixed to the
 * LAYOUT viewport, not the VISUAL viewport. When the keyboard opens,
 * the visual viewport shrinks but fixed elements don't move with it.
 *
 * The solution: Track the visual viewport via CSS custom properties
 * and use them to position the chat container correctly.
 */
export function useMobileViewport() {
  useEffect(() => {
    // Lock body scroll
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const updateViewport = () => {
      const vv = window.visualViewport
      if (!vv) return

      // Set CSS custom properties for the visual viewport
      // --vv-height: The actual visible height (shrinks when keyboard opens)
      // --vv-offset-top: How far down the visual viewport is from layout viewport top
      document.documentElement.style.setProperty('--vv-height', `${vv.height}px`)
      document.documentElement.style.setProperty('--vv-offset-top', `${vv.offsetTop}px`)
    }

    // Initial update
    updateViewport()

    // Listen to visual viewport changes (keyboard open/close, zoom, scroll)
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', updateViewport)
      vv.addEventListener('scroll', updateViewport)
    }

    // Also listen to regular resize for non-iOS browsers
    window.addEventListener('resize', updateViewport)

    return () => {
      document.body.style.overflow = originalOverflow
      if (vv) {
        vv.removeEventListener('resize', updateViewport)
        vv.removeEventListener('scroll', updateViewport)
      }
      window.removeEventListener('resize', updateViewport)
    }
  }, [])
}
