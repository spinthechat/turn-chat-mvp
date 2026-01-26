'use client'

import { useState, useEffect, useCallback } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme-preference'

/**
 * Get the effective theme based on preference and system setting
 */
function getEffectiveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }
  return preference
}

/**
 * Apply theme to the document
 */
function applyTheme(theme: 'light' | 'dark') {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    // Also update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#1c1917' : '#2c4a7c')
    }
  }
}

/**
 * Hook to manage theme preference with localStorage persistence
 * and system theme detection
 */
export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [mounted, setMounted] = useState(false)

  // Load preference from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      setPreferenceState(stored)
    }
    setMounted(true)
  }, [])

  // Apply theme when preference changes or on mount
  useEffect(() => {
    if (!mounted) return

    const effectiveTheme = getEffectiveTheme(preference)
    applyTheme(effectiveTheme)

    // Listen for system theme changes when in system mode
    if (preference === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light')
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [preference, mounted])

  const setPreference = useCallback((newPreference: ThemePreference) => {
    setPreferenceState(newPreference)
    localStorage.setItem(STORAGE_KEY, newPreference)
    const effectiveTheme = getEffectiveTheme(newPreference)
    applyTheme(effectiveTheme)
  }, [])

  return {
    preference,
    setPreference,
    effectiveTheme: mounted ? getEffectiveTheme(preference) : 'light',
    mounted,
  }
}
