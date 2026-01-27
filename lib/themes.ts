/**
 * Chat Room Visual Themes
 *
 * Each room mode has an associated theme that subtly changes the atmosphere.
 * Themes are applied at the chat container level and affect:
 * - Background colors/gradients
 * - Accent colors (turn indicators, highlights)
 * - Optional decorative overlays
 *
 * Design principles:
 * - Subtle > loud
 * - Premium > playful
 * - Readability always preserved
 */

export type RoomMode = 'fun' | 'family' | 'deep' | 'flirty' | 'couple'

export interface ChatTheme {
  mode: RoomMode

  // Background styling
  bgGradient: string        // Tailwind gradient classes
  bgOverlay?: string        // Optional CSS for ::before pseudo-element

  // Accent colors (used for turn indicators, highlights, input glow)
  accentPrimary: string     // Main accent (e.g., 'indigo-500')
  accentSecondary: string   // Secondary accent for gradients
  accentGlow: string        // Glow color for turn pulse (rgba format)

  // Text colors for themed elements
  accentText: string        // Text on accent backgrounds
  mutedText: string         // Muted/secondary text

  // Ring/border colors
  ringColor: string         // Ring around inputs
  ringColorActive: string   // Active/focused ring

  // Turn pulse customization
  turnPulseBg: string       // Turn pulse overlay background
  turnPulseRing: string     // Ring color during pulse
  turnPulseShadow: string   // Shadow during pulse

  // Live indicator dot
  liveDotColor: string      // Live dot background
  liveDotPulse: string      // Live dot pulse color
}

// Theme definitions
const themes: Record<RoomMode, ChatTheme> = {
  /**
   * FUN - Default theme
   * Mood: playful, friendly, energetic
   * Clean and neutral with brand accents
   */
  fun: {
    mode: 'fun',
    bgGradient: 'bg-gradient-to-b from-slate-50 via-slate-50/95 to-slate-100/90',
    accentPrimary: 'indigo-500',
    accentSecondary: 'violet-500',
    accentGlow: 'rgba(99, 102, 241, 0.15)',
    accentText: 'text-indigo-600',
    mutedText: 'text-slate-500',
    ringColor: 'ring-indigo-200/60',
    ringColorActive: 'ring-indigo-400/80',
    turnPulseBg: 'rgba(0, 0, 0, 0.06)',
    turnPulseRing: 'ring-indigo-400/80',
    turnPulseShadow: 'shadow-indigo-500/20',
    liveDotColor: 'bg-red-500',
    liveDotPulse: 'bg-red-500/40',
  },

  /**
   * FAMILY - Warm and comforting
   * Mood: warm, safe, nostalgic, togetherness
   * Soft cream/sand tones with amber accents
   */
  family: {
    mode: 'family',
    bgGradient: 'bg-gradient-to-b from-amber-50/80 via-orange-50/40 to-amber-100/60',
    bgOverlay: 'family-silhouette',
    accentPrimary: 'amber-600',
    accentSecondary: 'orange-500',
    accentGlow: 'rgba(217, 119, 6, 0.12)',
    accentText: 'text-amber-700',
    mutedText: 'text-amber-800/60',
    ringColor: 'ring-amber-200/60',
    ringColorActive: 'ring-amber-400/70',
    turnPulseBg: 'rgba(245, 158, 11, 0.06)',
    turnPulseRing: 'ring-amber-400/70',
    turnPulseShadow: 'shadow-amber-500/15',
    liveDotColor: 'bg-amber-500',
    liveDotPulse: 'bg-amber-500/40',
  },

  /**
   * FLIRTY - Moody and intimate
   * Mood: intimate, playful, romantic, bold but classy
   * Dark charcoal/plum with rose accents
   */
  flirty: {
    mode: 'flirty',
    bgGradient: 'bg-gradient-to-b from-slate-900/95 via-purple-950/30 to-slate-900',
    bgOverlay: 'flirty-ambience',
    accentPrimary: 'rose-500',
    accentSecondary: 'pink-500',
    accentGlow: 'rgba(244, 63, 94, 0.15)',
    accentText: 'text-rose-400',
    mutedText: 'text-slate-400',
    ringColor: 'ring-rose-500/30',
    ringColorActive: 'ring-rose-400/60',
    turnPulseBg: 'rgba(244, 63, 94, 0.08)',
    turnPulseRing: 'ring-rose-400/60',
    turnPulseShadow: 'shadow-rose-500/20',
    liveDotColor: 'bg-rose-500',
    liveDotPulse: 'bg-rose-500/40',
  },

  /**
   * DEEP - Minimal and reflective
   * Mood: reflective, calm, introspective, honest
   * Soft slate with cool blue accents
   */
  deep: {
    mode: 'deep',
    bgGradient: 'bg-gradient-to-b from-slate-100 via-slate-100/95 to-slate-200/80',
    accentPrimary: 'blue-500',
    accentSecondary: 'indigo-400',
    accentGlow: 'rgba(59, 130, 246, 0.12)',
    accentText: 'text-blue-600',
    mutedText: 'text-slate-500',
    ringColor: 'ring-blue-200/50',
    ringColorActive: 'ring-blue-400/60',
    turnPulseBg: 'rgba(59, 130, 246, 0.05)',
    turnPulseRing: 'ring-blue-400/60',
    turnPulseShadow: 'shadow-blue-500/15',
    liveDotColor: 'bg-blue-500',
    liveDotPulse: 'bg-blue-500/40',
  },

  /**
   * COUPLE - Personal and emotionally close
   * Mood: intimate, safe, emotionally close
   * Warm blush/linen with soft pink accents
   */
  couple: {
    mode: 'couple',
    bgGradient: 'bg-gradient-to-b from-rose-50/70 via-pink-50/40 to-rose-100/50',
    bgOverlay: 'couple-intertwine',
    accentPrimary: 'pink-500',
    accentSecondary: 'rose-400',
    accentGlow: 'rgba(236, 72, 153, 0.12)',
    accentText: 'text-pink-600',
    mutedText: 'text-pink-800/60',
    ringColor: 'ring-pink-200/60',
    ringColorActive: 'ring-pink-400/60',
    turnPulseBg: 'rgba(236, 72, 153, 0.06)',
    turnPulseRing: 'ring-pink-400/60',
    turnPulseShadow: 'shadow-pink-500/15',
    liveDotColor: 'bg-pink-500',
    liveDotPulse: 'bg-pink-500/40',
  },
}

/**
 * Get theme for a room mode
 * Returns 'fun' theme as fallback for unknown modes
 */
export function getThemeForMode(mode: string | undefined | null): ChatTheme {
  if (mode && mode in themes) {
    return themes[mode as RoomMode]
  }
  return themes.fun
}

/**
 * Check if a mode uses dark styling (for text contrast)
 */
export function isDarkTheme(mode: RoomMode): boolean {
  return mode === 'flirty'
}

/**
 * Get CSS variable overrides for a theme
 * Can be applied as inline styles on the container
 */
export function getThemeCSSVars(theme: ChatTheme): React.CSSProperties {
  return {
    '--theme-accent-glow': theme.accentGlow,
    '--theme-pulse-bg': theme.turnPulseBg,
  } as React.CSSProperties
}
