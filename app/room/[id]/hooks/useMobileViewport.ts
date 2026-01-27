'use client'

import { useEffect } from 'react'

/**
 * Simple hook to lock body scroll on the room page.
 * No viewport calculations - the fixed header handles everything.
 */
export function useMobileViewport() {
  useEffect(() => {
    // Lock body scroll on mount
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      // Restore on unmount
      document.body.style.overflow = originalOverflow
    }
  }, [])
}
