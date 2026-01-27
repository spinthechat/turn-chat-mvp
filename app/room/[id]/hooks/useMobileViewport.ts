'use client'

import { useEffect, useRef } from 'react'

/**
 * Hook to handle iOS Safari keyboard layout using visualViewport API
 *
 * Sets CSS variables on document.documentElement:
 * - --vvh: visualViewport.height (or window.innerHeight fallback)
 * - --vvo: visualViewport.offsetTop (or 0 fallback)
 *
 * These variables drive the chat-viewport-shell sizing.
 */
export function useMobileViewport() {
  const rafId = useRef<number | null>(null)
  const lastVvh = useRef<number>(0)
  const lastVvo = useRef<number>(0)

  useEffect(() => {
    const updateViewport = () => {
      // Cancel any pending rAF to avoid stacking
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }

      rafId.current = requestAnimationFrame(() => {
        const vv = window.visualViewport

        // Get values from visualViewport or fallback
        const vvh = vv ? vv.height : window.innerHeight
        const vvo = vv ? vv.offsetTop : 0

        // Only update DOM if values actually changed (avoid layout thrash)
        if (vvh !== lastVvh.current || vvo !== lastVvo.current) {
          lastVvh.current = vvh
          lastVvo.current = vvo

          // Write CSS variables directly - no React state to avoid re-renders
          document.documentElement.style.setProperty('--vvh', String(vvh))
          document.documentElement.style.setProperty('--vvo', String(vvo))

          // Toggle keyboard-open class for touch-action styles
          const keyboardOpen = vv ? (window.innerHeight - vvh > 100) : false
          if (keyboardOpen) {
            document.body.classList.add('keyboard-open')
          } else {
            document.body.classList.remove('keyboard-open')
          }
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

    // Fallback listeners for browsers without visualViewport
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)

    // Also update on focus events (keyboard open/close)
    const handleFocus = () => {
      // Delay to allow keyboard animation to start
      setTimeout(updateViewport, 100)
      setTimeout(updateViewport, 300)
    }

    document.addEventListener('focusin', handleFocus)
    document.addEventListener('focusout', handleFocus)

    return () => {
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
