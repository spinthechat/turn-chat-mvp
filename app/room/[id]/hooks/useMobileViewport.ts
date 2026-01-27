'use client'

import { useEffect, useRef } from 'react'

/**
 * Hook to handle iOS Safari keyboard layout using visualViewport API
 *
 * Sets CSS variable on document.documentElement:
 * - --app-height: visualViewport.height with "px" suffix (e.g., "600px")
 *
 * Also locks body scroll while mounted (only messages container scrolls)
 */
export function useMobileViewport() {
  const rafId = useRef<number | null>(null)
  const lastHeight = useRef<number>(0)

  useEffect(() => {
    // Lock body scroll on mount
    const originalHtmlOverflow = document.documentElement.style.overflow
    const originalBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    const updateViewport = () => {
      // Cancel any pending rAF to avoid stacking
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }

      rafId.current = requestAnimationFrame(() => {
        const vv = window.visualViewport
        // Get height from visualViewport or fallback to innerHeight
        const height = vv ? vv.height : window.innerHeight

        // Only update DOM if value actually changed (avoid layout thrash)
        if (height !== lastHeight.current) {
          lastHeight.current = height
          // Set with px units so CSS can use it directly
          document.documentElement.style.setProperty('--app-height', `${height}px`)
        }

        rafId.current = null
      })
    }

    // Initial measurement
    updateViewport()

    // Listen to visualViewport events (primary method for iOS)
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', updateViewport)
      vv.addEventListener('scroll', updateViewport)
    }

    // Fallback listeners
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)

    // Also update on focus events (keyboard open/close)
    const handleFocus = () => {
      setTimeout(updateViewport, 100)
      setTimeout(updateViewport, 300)
    }

    document.addEventListener('focusin', handleFocus)
    document.addEventListener('focusout', handleFocus)

    return () => {
      // Restore body scroll on unmount
      document.documentElement.style.overflow = originalHtmlOverflow
      document.body.style.overflow = originalBodyOverflow

      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
      if (vv) {
        vv.removeEventListener('resize', updateViewport)
        vv.removeEventListener('scroll', updateViewport)
      }
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
      document.removeEventListener('focusin', handleFocus)
      document.removeEventListener('focusout', handleFocus)
    }
  }, [])
}
