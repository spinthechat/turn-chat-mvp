'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface ViewportState {
  keyboardHeight: number
  keyboardOpen: boolean
  viewportHeight: number
  visualViewportHeight: number
}

// Hook to handle mobile viewport height and keyboard - WhatsApp-style behavior
export function useMobileViewport() {
  const [state, setState] = useState<ViewportState>({
    keyboardHeight: 0,
    keyboardOpen: false,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
    visualViewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  })

  // Track the initial viewport height (before keyboard opens)
  const initialViewportHeight = useRef<number>(0)

  const updateViewport = useCallback(() => {
    const windowHeight = window.innerHeight
    const visualHeight = window.visualViewport?.height ?? windowHeight

    // Store initial height on first call or when keyboard is closed
    if (initialViewportHeight.current === 0 || visualHeight >= windowHeight * 0.9) {
      initialViewportHeight.current = windowHeight
    }

    // Calculate keyboard height
    // On iOS, visualViewport.height shrinks when keyboard opens
    // On Android, window.innerHeight shrinks when keyboard opens
    const keyboardH = Math.max(0, initialViewportHeight.current - visualHeight)
    const keyboardOpen = keyboardH > 100 // Threshold to detect keyboard vs small UI changes

    // Update CSS custom properties for layout
    document.documentElement.style.setProperty('--viewport-height', `${visualHeight}px`)
    document.documentElement.style.setProperty('--keyboard-height', `${keyboardH}px`)
    document.documentElement.style.setProperty('--vh', `${visualHeight * 0.01}px`)

    // Add/remove class to body for keyboard state
    if (keyboardOpen) {
      document.body.classList.add('keyboard-open')
    } else {
      document.body.classList.remove('keyboard-open')
    }

    setState({
      keyboardHeight: keyboardH,
      keyboardOpen,
      viewportHeight: windowHeight,
      visualViewportHeight: visualHeight,
    })
  }, [])

  useEffect(() => {
    // Initial measurement
    updateViewport()

    // Debounce for performance
    let rafId: number | null = null
    const throttledUpdate = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        updateViewport()
        rafId = null
      })
    }

    // Listen to resize events
    window.addEventListener('resize', throttledUpdate)
    window.addEventListener('orientationchange', throttledUpdate)

    // VisualViewport API for keyboard detection (iOS Safari + modern browsers)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', throttledUpdate)
      window.visualViewport.addEventListener('scroll', throttledUpdate)
    }

    // Also listen to focus/blur on inputs for keyboard detection
    const handleFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Small delay to let keyboard animation start
        setTimeout(throttledUpdate, 100)
        setTimeout(throttledUpdate, 300)
      }
    }
    const handleFocusOut = () => {
      setTimeout(throttledUpdate, 100)
      setTimeout(throttledUpdate, 300)
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      window.removeEventListener('resize', throttledUpdate)
      window.removeEventListener('orientationchange', throttledUpdate)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', throttledUpdate)
        window.visualViewport.removeEventListener('scroll', throttledUpdate)
      }
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [updateViewport])

  return state
}
