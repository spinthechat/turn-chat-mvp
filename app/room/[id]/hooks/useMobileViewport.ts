'use client'

import { useState, useEffect } from 'react'

// Hook to handle mobile viewport height and keyboard
export function useMobileViewport() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    // Set --vh CSS variable for viewport height fallback
    const setVH = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }

    // Handle keyboard open/close via VisualViewport API
    const handleViewportResize = () => {
      if (window.visualViewport) {
        const viewport = window.visualViewport
        // Calculate keyboard height as difference between window and viewport
        const keyboardH = window.innerHeight - viewport.height
        setKeyboardHeight(Math.max(0, keyboardH))

        // Also update --vh based on visual viewport
        const vh = viewport.height * 0.01
        document.documentElement.style.setProperty('--vh', `${vh}px`)
      }
    }

    setVH()

    // Listen to resize events
    window.addEventListener('resize', setVH)
    window.addEventListener('orientationchange', setVH)

    // VisualViewport API for keyboard detection (iOS Safari)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize)
      window.visualViewport.addEventListener('scroll', handleViewportResize)
    }

    return () => {
      window.removeEventListener('resize', setVH)
      window.removeEventListener('orientationchange', setVH)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize)
        window.visualViewport.removeEventListener('scroll', handleViewportResize)
      }
    }
  }, [])

  return { keyboardHeight }
}
