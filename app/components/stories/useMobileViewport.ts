'use client'

import { useEffect, useState } from 'react'

/**
 * iOS Safari keyboard handling using visualViewport API.
 *
 * The problem: On iOS, `position: fixed` elements are fixed to the
 * LAYOUT viewport, not the VISUAL viewport. When the keyboard opens,
 * the visual viewport shrinks but fixed elements don't move with it.
 *
 * The solution: Track the visual viewport via CSS custom properties
 * and return the keyboard height for dynamic positioning.
 */
export function useMobileViewport() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  )

  useEffect(() => {
    // Lock body scroll when story viewer is open
    const originalOverflow = document.body.style.overflow
    const originalPosition = document.body.style.position
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'

    const layoutHeight = window.innerHeight

    const updateViewport = () => {
      const vv = window.visualViewport
      if (!vv) {
        setViewportHeight(window.innerHeight)
        setKeyboardHeight(0)
        return
      }

      // Set CSS custom properties for the visual viewport
      document.documentElement.style.setProperty('--vv-height', `${vv.height}px`)
      document.documentElement.style.setProperty('--vv-offset-top', `${vv.offsetTop}px`)

      // Calculate keyboard height (difference between layout and visual viewport)
      const kbHeight = Math.max(0, layoutHeight - vv.height - vv.offsetTop)
      setKeyboardHeight(kbHeight)
      setViewportHeight(vv.height)
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
      document.body.style.position = originalPosition
      document.body.style.width = ''
      if (vv) {
        vv.removeEventListener('resize', updateViewport)
        vv.removeEventListener('scroll', updateViewport)
      }
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  return { keyboardHeight, viewportHeight }
}
