'use client'

import { useEffect } from 'react'

/**
 * Mobile viewport handling.
 *
 * iOS Safari: Do NOT use visualViewport-based positioning. iOS natively
 * handles keyboard by scrolling the focused input into view. Using
 * visualViewport to resize/offset the container causes double compensation
 * (input jumps too far up, creating a gap above the keyboard).
 *
 * Instead, we rely on:
 * - 100dvh for container height (iOS handles this correctly)
 * - position: fixed + bottom: 0 for input area
 * - env(safe-area-inset-bottom) for notch padding
 *
 * Android/other: Keep visualViewport tracking as those browsers may need it.
 */
export function useMobileViewport() {
  useEffect(() => {
    // Lock body scroll
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Detect iOS (Safari, Chrome on iOS, PWA)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    // On iOS, don't use visualViewport-based positioning
    // iOS handles keyboard natively - our intervention causes double offset
    if (isIOS) {
      // Just ensure we're not applying any stale values
      document.documentElement.style.removeProperty('--vv-height')
      document.documentElement.style.removeProperty('--vv-offset-top')

      return () => {
        document.body.style.overflow = originalOverflow
      }
    }

    // For non-iOS browsers, use visualViewport tracking
    const updateViewport = () => {
      const vv = window.visualViewport
      if (!vv) return

      // Set CSS custom properties for the visual viewport
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

    // Also listen to regular resize
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
