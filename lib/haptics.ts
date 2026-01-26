/**
 * Haptics utility for tactile feedback on supported devices
 *
 * Note: iOS Safari may ignore vibrate() unless running as an installed PWA
 * and on recent iOS versions. Android Chrome generally supports it.
 */

let hasLoggedSupport = false

/**
 * Check if vibration API is supported
 */
export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator
}

/**
 * Trigger a haptic feedback tick
 * @param kind - 'light' for subtle tick (10-15ms), 'turn' for slightly stronger (20-25ms)
 * @returns true if vibration was triggered, false if unsupported
 */
export function hapticTick(kind: 'light' | 'turn' = 'light'): boolean {
  // Log support status once in development
  if (process.env.NODE_ENV === 'development' && !hasLoggedSupport) {
    hasLoggedSupport = true
    console.log(`[haptics] supported: ${isHapticsSupported()}`)
  }

  if (!isHapticsSupported()) {
    return false
  }

  try {
    const duration = kind === 'light' ? 12 : 22
    navigator.vibrate(duration)
    return true
  } catch {
    // Silently fail - some browsers throw on vibrate()
    return false
  }
}

/**
 * Clear any active text selection (useful after long-press activation)
 */
export function clearTextSelection(): void {
  try {
    window.getSelection()?.removeAllRanges()
  } catch {
    // Silently fail
  }
}
