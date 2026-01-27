'use client'

import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabaseClient'
import { usePushNotifications } from '@/lib/usePushNotifications'
import { useThemePreference, type ThemePreference } from '@/lib/useThemePreference'
import { hapticTick, clearTextSelection, clearTextSelectionAggressive, setGlobalNoSelect } from '@/lib/haptics'
import { getThemeForMode, isDarkTheme, getThemeCSSVars, type ChatTheme } from '@/lib/themes'
import { useParams, useRouter } from 'next/navigation'

// Hook to handle mobile viewport height and keyboard
function useMobileViewport() {
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

// Message Selection Overlay with context menu (WhatsApp style)
// Renders via portal: dark backdrop + blur + menu anchored to selected message
function MessageSelectionOverlay({
  anchorRef,
  emojis,
  onReact,
  onReply,
  onCopy,
  onClose,
  canCopy,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  emojis: readonly string[]
  onReact: (emoji: string) => void
  onReply: () => void
  onCopy?: () => void
  onClose: () => void
  canCopy: boolean
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  // Calculate menu position
  useLayoutEffect(() => {
    if (!mounted) return

    const calculatePosition = () => {
      const anchor = anchorRef.current
      const menu = menuRef.current
      if (!anchor || !menu) return

      const anchorRect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const padding = 12

      const menuWidth = menuRect.width
      const menuHeight = menuRect.height

      // Prefer above, fall back to below, then center
      const spaceAbove = anchorRect.top - padding
      const spaceBelow = viewportHeight - anchorRect.bottom - padding

      let top: number
      if (spaceAbove >= menuHeight) {
        top = anchorRect.top - menuHeight - 8
      } else if (spaceBelow >= menuHeight) {
        top = anchorRect.bottom + 8
      } else {
        top = Math.max(padding, (viewportHeight - menuHeight) / 2)
      }

      // Center horizontally on anchor, clamp to viewport
      let left = anchorRect.left + anchorRect.width / 2 - menuWidth / 2
      left = Math.max(padding, Math.min(viewportWidth - menuWidth - padding, left))
      top = Math.max(padding, Math.min(viewportHeight - menuHeight - padding, top))

      setPosition({ top, left })
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', calculatePosition)
    }

    return () => {
      window.removeEventListener('resize', calculatePosition)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', calculatePosition)
      }
    }
  }, [mounted, anchorRef])

  // Handle Esc key and prevent scroll while open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // Prevent scrolling on the body while overlay is open
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.overflow = 'hidden'

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore scroll position
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.overflow = ''
      window.scrollTo(0, scrollY)
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <>
      {/* Backdrop overlay with blur */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
        style={{ zIndex: 9998 }}
        onClick={onClose}
        onTouchEnd={(e) => { e.preventDefault(); onClose() }}
      />

      {/* Context menu - modern design */}
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          zIndex: 10000,
        }}
        className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-slate-200/50 overflow-hidden min-w-[240px] animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Emoji reaction bar */}
        <div className="flex justify-center gap-1.5 p-3 border-b border-slate-100/80 bg-slate-50/50">
          {emojis.map(emoji => (
            <button
              key={emoji}
              onClick={() => { onReact(emoji); onClose() }}
              aria-label={`React with ${emoji}`}
              className="w-12 h-12 flex items-center justify-center hover:bg-white rounded-xl text-2xl active:scale-110 transition-all shadow-sm bg-white/80 ring-1 ring-slate-100"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Action menu */}
        <div className="py-1.5">
          <button
            onClick={() => { onReply(); onClose() }}
            aria-label="Reply"
            className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Reply
          </button>

          {canCopy && (
            <button
              onClick={() => { onCopy?.(); onClose() }}
              aria-label="Copy text"
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy text
            </button>
          )}

          <button
            onClick={onClose}
            aria-label="Cancel"
            className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

// Legacy emoji picker (keeping for compatibility, but prefer MessageSelectionOverlay)
function EmojiPickerPortal({
  anchorRef,
  emojis,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  emojis: readonly string[]
  onSelect: (emoji: string) => void
  onClose: () => void
}) {
  const pickerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!mounted) return

    const calculatePosition = () => {
      const anchor = anchorRef.current
      const picker = pickerRef.current
      if (!anchor || !picker) return

      const anchorRect = anchor.getBoundingClientRect()
      const pickerRect = picker.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const padding = 12

      const pickerWidth = pickerRect.width
      const pickerHeight = pickerRect.height

      const spaceAbove = anchorRect.top - padding
      const spaceBelow = viewportHeight - anchorRect.bottom - padding

      let top: number
      if (spaceAbove >= pickerHeight) {
        top = anchorRect.top - pickerHeight - 8
      } else if (spaceBelow >= pickerHeight) {
        top = anchorRect.bottom + 8
      } else {
        top = Math.max(padding, (viewportHeight - pickerHeight) / 2)
      }

      let left = anchorRect.left + anchorRect.width / 2 - pickerWidth / 2
      left = Math.max(padding, Math.min(viewportWidth - pickerWidth - padding, left))
      top = Math.max(padding, Math.min(viewportHeight - pickerHeight - padding, top))

      setPosition({ top, left })
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', calculatePosition)
    }

    return () => {
      window.removeEventListener('resize', calculatePosition)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', calculatePosition)
      }
    }
  }, [mounted, anchorRef])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const picker = pickerRef.current
      if (picker && !picker.contains(e.target as Node)) {
        onClose()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      ref={pickerRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
      className="bg-white rounded-xl shadow-lg ring-1 ring-stone-200 p-2 flex gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {emojis.map(emoji => (
        <button
          key={emoji}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(emoji)
          }}
          className="w-10 h-10 flex items-center justify-center hover:bg-stone-100 rounded-lg text-xl active:scale-110 transition-transform"
        >
          {emoji}
        </button>
      ))}
    </div>,
    document.body
  )
}

// Photo Lightbox - fullscreen image viewer
function PhotoLightbox({
  imageUrl,
  onClose,
}: {
  imageUrl: string
  onClose: () => void
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Prevent background scrolling when lightbox is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Close when clicking overlay (not the image)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose()
    }
  }

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
      style={{ touchAction: 'pinch-zoom' }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        aria-label="Close"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Image container with scroll/zoom support */}
      <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
        <img
          src={imageUrl}
          alt="Full size"
          className="max-w-full max-h-full object-contain select-none"
          style={{ touchAction: 'pinch-zoom' }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>,
    document.body
  )
}

type Msg = {
  id: string
  room_id: string
  user_id: string | null
  type: 'chat' | 'turn_response' | 'system' | 'image'
  content: string
  created_at: string
  reply_to_message_id: string | null
}

type Reaction = {
  id: string
  message_id: string
  user_id: string
  emoji: string
}

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '😢'] as const

type TurnSession = {
  room_id: string
  prompt_text: string
  current_prompt_type: 'text' | 'photo'
  turn_order: string[]
  current_turn_index: number
  current_turn_user_id: string | null
  turn_instance_id: string | null
  is_active: boolean
  waiting_until: string | null
}

type UserInfo = {
  id: string
  email: string
  displayName: string
  initials: string
  color: string
  textColor: string
  isHost: boolean
  avatarUrl: string | null
  bio: string | null
}

type RoomMember = {
  user_id: string
  role: 'host' | 'member'
  prompt_interval_minutes: number
}

const FREQUENCY_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once a day' },
] as const

// Format remaining time for cooldown display
const formatTimeRemaining = (targetDate: Date): string => {
  const now = new Date()
  const diff = targetDate.getTime() - now.getTime()
  if (diff <= 0) return 'now'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

type RoomInfo = {
  id: string
  name: string
  type: 'dm' | 'group'
  prompt_interval_minutes: number
  last_active_at: string | null
  prompt_mode: 'fun' | 'family' | 'deep' | 'flirty' | 'couple'
}

// Prompt mode options for extensibility
const PROMPT_MODES = [
  { value: 'fun', label: 'Fun', description: 'Lighthearted prompts for friends' },
  { value: 'family', label: 'Family', description: 'Warm prompts for family groups' },
  { value: 'deep', label: 'Deep', description: 'More reflective questions. Answer at your own depth.' },
  { value: 'flirty', label: 'Flirty', description: 'Playful, bold prompts (not explicit).' },
  { value: 'couple', label: 'Couple', description: 'Designed for partners — reflective, connective prompts.' },
] as const

// Generate consistent colors from user ID
const stringToColors = (str: string): { bg: string; text: string } => {
  const colorPairs = [
    { bg: 'bg-red-500', text: 'text-red-600' },
    { bg: 'bg-orange-500', text: 'text-orange-600' },
    { bg: 'bg-amber-500', text: 'text-amber-600' },
    { bg: 'bg-yellow-500', text: 'text-yellow-600' },
    { bg: 'bg-lime-500', text: 'text-lime-600' },
    { bg: 'bg-green-500', text: 'text-green-600' },
    { bg: 'bg-emerald-500', text: 'text-emerald-600' },
    { bg: 'bg-teal-500', text: 'text-teal-600' },
    { bg: 'bg-cyan-500', text: 'text-cyan-600' },
    { bg: 'bg-sky-500', text: 'text-sky-600' },
    { bg: 'bg-blue-500', text: 'text-blue-600' },
    { bg: 'bg-indigo-500', text: 'text-indigo-600' },
    { bg: 'bg-violet-500', text: 'text-violet-600' },
    { bg: 'bg-purple-500', text: 'text-purple-600' },
    { bg: 'bg-fuchsia-500', text: 'text-fuchsia-600' },
    { bg: 'bg-pink-500', text: 'text-pink-600' },
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colorPairs[Math.abs(hash) % colorPairs.length]
}

const getInitials = (email: string): string => {
  const name = email.split('@')[0]
  const cleaned = name.replace(/[0-9]/g, '')
  const parts = cleaned.split(/[._-]/).filter(p => p.length > 0)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return cleaned.toUpperCase() || '??'
}

const getDisplayName = (email: string): string => {
  const name = email.split('@')[0]
  const formatted = name
    .replace(/[._-]/g, ' ')
    .replace(/[0-9]/g, '')
    .trim()
    .split(' ')
    .filter(p => p.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
  return formatted || name
}

const formatTime = (date: string) => {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Message grouping types
type MessageGroupPosition = 'single' | 'first' | 'middle' | 'last'

// Calculate message group position based on surrounding messages
// Groups messages from the same user that are consecutive (no system messages or other users in between)
// Time gap of > 5 minutes also breaks a group
const getMessageGroupPosition = (
  messages: Msg[],
  index: number
): MessageGroupPosition => {
  const current = messages[index]
  const prev = index > 0 ? messages[index - 1] : null
  const next = index < messages.length - 1 ? messages[index + 1] : null

  // System messages are always standalone
  if (current.type === 'system') return 'single'

  const TIME_GAP_MS = 5 * 60 * 1000 // 5 minutes

  const isSameGroup = (a: Msg | null, b: Msg | null): boolean => {
    if (!a || !b) return false
    // Different user or no user
    if (a.user_id !== b.user_id || !a.user_id) return false
    // System messages break groups
    if (a.type === 'system' || b.type === 'system') return false
    // Time gap check
    const timeDiff = Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    if (timeDiff > TIME_GAP_MS) return false
    return true
  }

  const hasPrevInGroup = isSameGroup(prev, current)
  const hasNextInGroup = isSameGroup(current, next)

  if (!hasPrevInGroup && !hasNextInGroup) return 'single'
  if (!hasPrevInGroup && hasNextInGroup) return 'first'
  if (hasPrevInGroup && hasNextInGroup) return 'middle'
  return 'last' // hasPrevInGroup && !hasNextInGroup
}

// Avatar component
function Avatar({
  user,
  size = 'md',
  className = '',
  showRing = false,
  showHostBadge = false,
  onClick,
}: {
  user: UserInfo | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  showRing?: boolean
  showHostBadge?: boolean
  onClick?: () => void
}) {
  const sizeClasses = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm'
  }

  if (!user) {
    return (
      <div className={`${sizeClasses[size]} rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0 ${className}`}>
        <span className="text-stone-400">?</span>
      </div>
    )
  }

  const Wrapper = onClick ? 'button' : 'div'
  const wrapperProps = onClick ? { onClick, type: 'button' as const } : {}

  return (
    <Wrapper {...wrapperProps} className={`relative flex-shrink-0 ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${className}`}>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className={`${sizeClasses[size]} rounded-full object-cover ${showRing ? 'ring-2 ring-white shadow-md' : ''}`}
          title={user.email}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} rounded-full ${user.color} flex items-center justify-center text-white font-semibold ${showRing ? 'ring-2 ring-white shadow-md' : ''}`}
          title={user.email}
        >
          {user.initials}
        </div>
      )}
      {showHostBadge && user.isHost && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 rounded-full flex items-center justify-center ring-2 ring-white">
          <svg className="w-2 h-2 text-amber-900" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </div>
      )}
    </Wrapper>
  )
}

// Compact members button for header - modern design
function MembersButton({
  memberCount,
  onlineCount,
  onClick
}: {
  memberCount: number
  onlineCount: number
  onClick: () => void
}) {
  const hasOnline = onlineCount > 0

  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100/80 hover:bg-slate-200/80 transition-all duration-200 active:scale-95"
      title={`${memberCount} members${hasOnline ? `, ${onlineCount} online` : ''}`}
    >
      {/* Users icon */}
      <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>

      {/* Member count badge */}
      <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] flex items-center justify-center bg-slate-700 text-white text-[10px] font-semibold rounded-full px-1.5 shadow-sm">
        {memberCount}
      </span>

      {/* Online indicator dot */}
      {hasOnline && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full ring-2 ring-white shadow-sm" />
      )}
    </button>
  )
}

// Message bubble component - compact WhatsApp-style
function MessageBubble({
  message,
  isMe,
  user,
  showMeta = true,
  replyToMessage,
  replyToUser,
  reactions,
  currentUserId,
  users,
  onReply,
  onReact,
  onScrollToMessage,
  onProfileClick,
  groupPosition = 'single',
  seenCount = 0,
  isSeenBoundary = false,
  onVisible,
}: {
  message: Msg
  isMe: boolean
  user: UserInfo | null
  showMeta?: boolean
  replyToMessage?: Msg | null
  replyToUser?: UserInfo | null
  reactions: Reaction[]
  currentUserId: string | null
  users: Map<string, UserInfo>
  onReply: (msg: Msg) => void
  onReact: (messageId: string, emoji: string) => void
  onScrollToMessage: (messageId: string) => void
  onProfileClick: (userId: string) => void
  groupPosition?: MessageGroupPosition
  seenCount?: number
  isSeenBoundary?: boolean
  onVisible?: () => void
}) {
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [showReactorsFor, setShowReactorsFor] = useState<string | null>(null)
  const [showLightbox, setShowLightbox] = useState(false)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const hasBeenVisible = useRef(false)

  // Gesture state refs (to avoid re-renders during gesture)
  const gestureState = useRef({
    isLongPressing: false,
    longPressTimer: null as NodeJS.Timeout | null,
    startX: 0,
    startY: 0,
    isSwiping: false,
    swipeLocked: false, // true once we decide this is a horizontal swipe
  })

  // Long press threshold (400ms)
  const LONG_PRESS_DURATION = 400
  // Swipe threshold to trigger reply (pixels)
  const SWIPE_THRESHOLD = 48
  // Max swipe distance for visual feedback (subtle, not too far)
  const MAX_SWIPE = 56
  // Movement threshold to cancel long press
  const MOVE_CANCEL_THRESHOLD = 10

  // Clean up gesture state
  const resetGesture = useCallback(() => {
    if (gestureState.current.longPressTimer) {
      clearTimeout(gestureState.current.longPressTimer)
      gestureState.current.longPressTimer = null
    }
    gestureState.current.isLongPressing = false
    gestureState.current.isSwiping = false
    gestureState.current.swipeLocked = false
    setSwipeOffset(0)
  }, [])

  // State for haptic fallback animation
  const [hapticPulse, setHapticPulse] = useState(false)

  // Handle pointer down - start long press detection
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore if clicking on interactive elements
    if ((e.target as HTMLElement).closest('button, a, img')) return

    gestureState.current.startX = e.clientX
    gestureState.current.startY = e.clientY
    gestureState.current.isLongPressing = true

    // Start long press timer
    gestureState.current.longPressTimer = setTimeout(() => {
      if (gestureState.current.isLongPressing) {
        // Aggressively clear any browser text selection (iOS re-applies selection)
        clearTextSelectionAggressive(300)

        // Haptic feedback - use fallback animation if vibration unsupported
        const didVibrate = hapticTick('light')
        if (!didVibrate) {
          // Visual fallback: quick pulse animation
          setHapticPulse(true)
          setTimeout(() => setHapticPulse(false), 100)
        }

        // Apply global no-select mode while overlay is open
        setGlobalNoSelect(true)
        setShowContextMenu(true)
        resetGesture()
      }
    }, LONG_PRESS_DURATION)
  }, [resetGesture])

  // Handle pointer move - detect swipe or cancel long press
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!gestureState.current.isLongPressing && !gestureState.current.isSwiping) return

    const deltaX = e.clientX - gestureState.current.startX
    const deltaY = e.clientY - gestureState.current.startY
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    // If we haven't locked the gesture yet
    if (!gestureState.current.swipeLocked && gestureState.current.isLongPressing) {
      // Check if user moved enough to cancel long press
      if (absX > MOVE_CANCEL_THRESHOLD || absY > MOVE_CANCEL_THRESHOLD) {
        // Cancel long press
        if (gestureState.current.longPressTimer) {
          clearTimeout(gestureState.current.longPressTimer)
          gestureState.current.longPressTimer = null
        }
        gestureState.current.isLongPressing = false

        // Determine if this is a horizontal swipe (swipe-to-reply)
        // Use stricter check: absX > 12 AND absX > absY * 1.2
        if (absX > 12 && absX > absY * 1.2 && deltaX > 0) {
          gestureState.current.swipeLocked = true
          gestureState.current.isSwiping = true
          // Prevent browser horizontal scroll when we lock into swipe mode
          e.preventDefault()
        }
        // If vertical scroll dominates, let it happen naturally (don't set isSwiping)
      }
    }

    // If swiping, update the swipe offset and prevent default
    if (gestureState.current.swipeLocked && gestureState.current.isSwiping) {
      // Prevent browser's horizontal panning during our swipe
      e.preventDefault()
      // Only allow right swipe (positive deltaX), clamp to 0-56px for subtle feedback
      const offset = Math.max(0, Math.min(56, deltaX))
      setSwipeOffset(offset)
    }
  }, [])

  // Handle pointer up - complete gesture
  const handlePointerUp = useCallback(() => {
    // Check if swipe completed
    if (gestureState.current.isSwiping && swipeOffset >= SWIPE_THRESHOLD) {
      // Trigger reply with haptic feedback
      hapticTick('turn')
      onReply(message)
    }
    resetGesture()
  }, [swipeOffset, onReply, message, resetGesture])

  // Handle pointer cancel/leave
  const handlePointerCancel = useCallback(() => {
    resetGesture()
  }, [resetGesture])

  // Handle right-click context menu (desktop)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setShowContextMenu(true)
  }, [])

  // Prevent native drag (iOS/Android can trigger selection via drag)
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // Prevent native text selection start
  const handleSelectStart = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault()
  }, [])

  // Handle click - desktop quick action (toggle actions or close context menu)
  const handleClick = useCallback(() => {
    if (showReactorsFor) {
      setShowReactorsFor(null)
      return
    }
    // On click, just close context menu if open
    if (showContextMenu) {
      setShowContextMenu(false)
    }
  }, [showReactorsFor, showContextMenu])

  // Copy message text to clipboard
  const handleCopy = useCallback(async () => {
    const textContent = message.type === 'turn_response'
      ? message.content.includes('\n\n')
        ? message.content.split('\n\n').slice(1).join('\n\n')
        : message.content
      : message.content

    try {
      await navigator.clipboard.writeText(textContent)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = textContent
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }, [message])

  // Determine if this message can be copied (text content only)
  const canCopy = message.type !== 'image' && !message.content.startsWith('{')

  // Selected bubble styling (WhatsApp-like lift effect)
  // Also includes haptic pulse fallback animation when vibration is unsupported
  const selectedBubbleClass = showContextMenu
    ? 'scale-[1.02] shadow-xl ring-2 ring-indigo-400/50 relative z-[9999]'
    : hapticPulse
      ? 'scale-[0.98]'
      : ''

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gestureState.current.longPressTimer) {
        clearTimeout(gestureState.current.longPressTimer)
      }
      // Ensure global no-select is removed on unmount
      setGlobalNoSelect(false)
    }
  }, [])

  // Manage global no-select state when context menu opens/closes
  useEffect(() => {
    if (showContextMenu) {
      setGlobalNoSelect(true)
      // Extra aggressive clearing when menu first opens
      clearTextSelectionAggressive(300)
    } else {
      setGlobalNoSelect(false)
    }
  }, [showContextMenu])

  // Intersection Observer to detect when message is scrolled into view
  useEffect(() => {
    if (!onVisible || hasBeenVisible.current || !bubbleRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasBeenVisible.current) {
          hasBeenVisible.current = true
          onVisible()
          observer.disconnect()
        }
      },
      { threshold: 0.5 }
    )

    observer.observe(bubbleRef.current)
    return () => observer.disconnect()
  }, [onVisible])

  const isTurnResponse = message.type === 'turn_response'
  const isSystem = message.type === 'system'
  const isImage = message.type === 'image'

  // Grouping-aware flags
  const isFirstInGroup = groupPosition === 'first' || groupPosition === 'single'
  const isLastInGroup = groupPosition === 'last' || groupPosition === 'single'
  const isGrouped = groupPosition !== 'single'

  // Parse turn response content - check for photo turn (JSON) first
  const photoTurnData = useMemo(() => {
    if (!isTurnResponse) return null
    try {
      const parsed = JSON.parse(message.content)
      if (parsed.kind === 'photo_turn' && parsed.image_url) {
        return { prompt: parsed.prompt, imageUrl: parsed.image_url }
      }
    } catch {
      // Not JSON, regular text turn response
    }
    return null
  }, [isTurnResponse, message.content])

  const isPhotoTurn = photoTurnData !== null
  const hasTurnPrompt = isTurnResponse && !isPhotoTurn && message.content.startsWith('Reply to "')
  const promptLine = hasTurnPrompt ? message.content.split('\n\n')[0] : null
  const responseContent = hasTurnPrompt
    ? message.content.split('\n\n').slice(1).join('\n\n')
    : message.content

  // Group reactions by emoji with user info
  const reactionData = useMemo(() => {
    const data: { [emoji: string]: { count: number; hasMyReaction: boolean; userIds: string[] } } = {}
    reactions.forEach(r => {
      if (!data[r.emoji]) data[r.emoji] = { count: 0, hasMyReaction: false, userIds: [] }
      data[r.emoji].count++
      data[r.emoji].userIds.push(r.user_id)
      if (r.user_id === currentUserId) data[r.emoji].hasMyReaction = true
    })
    return data
  }, [reactions, currentUserId])

  const hasReactions = Object.keys(reactionData).length > 0

  // Show "Seen by N" only when:
  // - This message is a "boundary" (next message has different seenCount or this is the last message)
  // - For own messages: only if seenCount > 1 (meaning someone else besides author saw it)
  // - For others' messages: show if seenCount > 0
  // - Never show on system messages
  // Note: seenCount includes the viewer themselves
  // This creates a WhatsApp-like collapsed view where seen indicators only appear
  // at the last message of a contiguous run with the same seen count.
  const showSeenIndicator = !isSystem && seenCount > 0 && (isMe ? seenCount > 1 : true)
  const seenDisplayCount = isMe ? seenCount - 1 : seenCount
  const shouldShowSeen = showSeenIndicator && seenDisplayCount > 0 && isSeenBoundary

  // System messages - subtle, refined
  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="bg-slate-100/80 backdrop-blur-sm text-slate-500 text-[11px] px-4 py-1.5 rounded-full font-medium tracking-wide">
          {message.content}
        </div>
      </div>
    )
  }

  // Quoted reply preview component - refined design
  const QuotedReply = () => {
    if (!replyToMessage) return null
    let previewText: string
    if (replyToMessage.type === 'image') {
      previewText = '📷 Photo'
    } else if (replyToMessage.type === 'turn_response') {
      try {
        const parsed = JSON.parse(replyToMessage.content)
        if (parsed.kind === 'photo_turn') {
          previewText = '📷 Photo Turn'
        } else {
          previewText = replyToMessage.content.slice(0, 60) + (replyToMessage.content.length > 60 ? '...' : '')
        }
      } catch {
        previewText = replyToMessage.content.slice(0, 60) + (replyToMessage.content.length > 60 ? '...' : '')
      }
    } else {
      previewText = replyToMessage.content.slice(0, 60) + (replyToMessage.content.length > 60 ? '...' : '')
    }

    return (
      <div
        onClick={(e) => { e.stopPropagation(); onScrollToMessage(replyToMessage.id) }}
        className={`text-[11px] px-2.5 py-1.5 mb-2 rounded-lg border-l-[3px] cursor-pointer transition-colors ${
          isMe
            ? 'bg-white/15 border-white/50 text-white/80 hover:bg-white/20'
            : 'bg-slate-100/80 border-slate-400 text-slate-600 hover:bg-slate-100'
        }`}
      >
        <div className="font-semibold">{replyToUser?.displayName ?? 'Unknown'}</div>
        <div className="truncate opacity-80">{previewText}</div>
      </div>
    )
  }

  // Meta row: seen indicator (left) + reaction chips (right) - WhatsApp/Telegram style
  const MetaRow = () => {
    const emojis = Object.entries(reactionData)
    const hasContent = shouldShowSeen || emojis.length > 0

    if (!hasContent) return null

    return (
      <div className={`flex items-center gap-2 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
        {/* Seen indicator - left side, can truncate */}
        {shouldShowSeen && (
          <span className="text-[10px] text-stone-400 truncate min-w-0 flex-shrink">
            Seen by {seenDisplayCount}
          </span>
        )}

        {/* Spacer to push reactions right when there's seen text */}
        {shouldShowSeen && emojis.length > 0 && <div className="flex-1 min-w-1" />}

        {/* Reaction chips - right side, never truncated */}
        {emojis.length > 0 && (
          <div className="inline-flex items-center gap-0.5 flex-shrink-0">
            {emojis.map(([emoji, { count, hasMyReaction, userIds }]) => (
              <div key={emoji} className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowReactorsFor(showReactorsFor === emoji ? null : emoji)
                  }}
                  className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full shadow-sm transition-all ${
                    hasMyReaction
                      ? 'bg-indigo-50 ring-1 ring-indigo-200'
                      : 'bg-white ring-1 ring-stone-200'
                  }`}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="text-[10px] text-stone-500">{count}</span>}
                </button>

                {/* Who reacted popover */}
                {showReactorsFor === emoji && (
                  <div
                    className={`absolute z-50 bottom-full mb-1 ${isMe ? 'right-0' : 'left-0'} bg-white rounded-lg shadow-lg ring-1 ring-stone-200 py-1 min-w-[140px]`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-2 py-1 border-b border-stone-100 flex items-center justify-between">
                      <span className="text-sm">{emoji}</span>
                      <button
                        onClick={() => setShowReactorsFor(null)}
                        className="p-0.5 text-stone-400 hover:text-stone-600"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto">
                      {userIds.map(uid => {
                        const reactor = users.get(uid)
                        const isCurrentUser = uid === currentUserId
                        return (
                          <div
                            key={uid}
                            className="px-2 py-1.5 flex items-center gap-2 hover:bg-stone-50"
                          >
                            {reactor?.avatarUrl ? (
                              <img src={reactor.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                            ) : (
                              <div className={`w-5 h-5 rounded-full ${reactor?.color ?? 'bg-stone-300'} flex items-center justify-center text-white text-[9px] font-medium`}>
                                {reactor?.initials ?? '??'}
                              </div>
                            )}
                            <span className="text-xs text-stone-700 truncate">
                              {reactor?.displayName ?? 'Unknown'}
                              {isCurrentUser && <span className="text-stone-400"> (you)</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {/* Tap own reaction to toggle */}
                    {reactionData[emoji].hasMyReaction && (
                      <button
                        onClick={() => { onReact(message.id, emoji); setShowReactorsFor(null) }}
                        className="w-full px-2 py-1.5 text-[11px] text-red-500 hover:bg-red-50 border-t border-stone-100 text-left"
                      >
                        Remove your {emoji}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Add reaction button (shows when viewing reactions) */}
            {showReactorsFor && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowReactorsFor(null)
                  setShowContextMenu(true)
                }}
                className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-full bg-white ring-1 ring-stone-200 shadow-sm text-stone-400 hover:text-stone-600"
                aria-label="Add reaction"
              >
                +
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Desktop hover menu button (accessibility - allows reply/react without gestures)
  const HoverMenuButton = () => {
    if (!isHovered) return null

    return (
      <button
        onClick={(e) => { e.stopPropagation(); setShowContextMenu(true) }}
        aria-label="Message actions"
        className={`absolute top-1 ${isMe ? 'left-1' : 'right-1'} p-1 rounded-full bg-white/90 shadow-sm ring-1 ring-stone-200 text-stone-400 hover:text-stone-600 hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity z-10`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
    )
  }

  // Handle image tap - open lightbox
  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowLightbox(true)
  }

  // Image messages - modern rounded design
  if (isImage) {
    return (
      <div
        ref={rowRef}
        className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative touch-pan-y select-none msg-bubble-container`}
        style={{ WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', transform: `translateX(${swipeOffset}px)`, transition: swipeOffset === 0 ? 'transform 0.2s ease-out' : 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onSelectCapture={handleSelectStart}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Swipe reply indicator */}
        {swipeOffset > 0 && (
          <div className={`absolute ${isMe ? 'right-full mr-2' : 'left-0 -ml-8'} top-1/2 -translate-y-1/2 transition-opacity ${swipeOffset >= SWIPE_THRESHOLD ? 'opacity-100' : 'opacity-50'}`}>
            <div className={`p-1.5 rounded-full transition-all ${swipeOffset >= SWIPE_THRESHOLD ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' : 'bg-slate-200 text-slate-500'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
          </div>
        )}
        {/* Avatar: visible only on last message in group */}
        <div className={`flex-shrink-0 ${isMe ? 'ml-2' : 'mr-2'}`}>
          {isLastInGroup ? (
            <Avatar user={user} size="xs" className="mt-0.5" onClick={user ? () => onProfileClick(user.id) : undefined} />
          ) : (
            <div className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col max-w-[70%] min-w-0">
          {/* Name: visible only on first message in group */}
          {showMeta && !isMe && isFirstInGroup && (
            <button
              onClick={(e) => { e.stopPropagation(); user && onProfileClick(user.id) }}
              className={`text-[11px] font-semibold mb-1 ${user?.textColor ?? 'text-slate-500'} hover:underline cursor-pointer text-left`}
            >
              {user?.displayName ?? 'Unknown'}
            </button>
          )}
          <div ref={bubbleRef} className={`relative transition-all duration-150 ${selectedBubbleClass}`} onClick={handleClick}>
            <QuotedReply />
            <div
              className={`rounded-2xl overflow-hidden cursor-pointer shadow-sm ${isMe ? '' : 'ring-1 ring-slate-200/80'} ${showContextMenu ? 'ring-0' : ''}`}
              onClick={handleImageClick}
            >
              <img src={message.content} alt="Photo" className="max-w-full max-h-52 object-contain bg-slate-100" loading="lazy" />
            </div>
            <div className={`text-[10px] mt-1 ${isMe ? 'text-right text-slate-400' : 'text-slate-400'}`}>
              {formatTime(message.created_at)}
            </div>
            <HoverMenuButton />
          </div>
          <MetaRow />
        </div>
        {showLightbox && (
          <PhotoLightbox
            imageUrl={message.content}
            onClose={() => setShowLightbox(false)}
          />
        )}
        {showContextMenu && (
          <MessageSelectionOverlay
            anchorRef={bubbleRef}
            emojis={EMOJI_OPTIONS}
            onReact={(emoji) => onReact(message.id, emoji)}
            onReply={() => onReply(message)}
            onClose={() => setShowContextMenu(false)}
            canCopy={false}
          />
        )}
      </div>
    )
  }

  // Photo turn response - modern, visually distinct design
  if (isPhotoTurn && photoTurnData) {
    return (
      <div
        ref={rowRef}
        className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative touch-pan-y select-none msg-bubble-container`}
        style={{ WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', transform: `translateX(${swipeOffset}px)`, transition: swipeOffset === 0 ? 'transform 0.2s ease-out' : 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onSelectCapture={handleSelectStart}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Swipe reply indicator */}
        {swipeOffset > 0 && (
          <div className={`absolute ${isMe ? 'right-full mr-2' : 'left-0 -ml-8'} top-1/2 -translate-y-1/2 transition-opacity ${swipeOffset >= SWIPE_THRESHOLD ? 'opacity-100' : 'opacity-50'}`}>
            <div className={`p-1.5 rounded-full transition-all ${swipeOffset >= SWIPE_THRESHOLD ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/30' : 'bg-slate-200 text-slate-500'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
          </div>
        )}
        {/* Accent bar - photo gradient */}
        <div className={`w-1 rounded-full self-stretch ${isMe ? 'bg-gradient-to-b from-violet-500 to-purple-500' : 'bg-gradient-to-b from-violet-400 to-purple-400'} ${isMe ? 'ml-2' : 'mr-2'}`} />
        {/* Avatar: visible only on last message in group */}
        <div className={`flex-shrink-0 ${isMe ? 'ml-2' : 'mr-2'}`}>
          {isLastInGroup ? (
            <Avatar user={user} size="xs" className="mt-0.5" onClick={user ? () => onProfileClick(user.id) : undefined} />
          ) : (
            <div className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col max-w-[70%] min-w-0">
          {/* Name: visible only on first message in group */}
          {showMeta && !isMe && isFirstInGroup && (
            <button
              onClick={(e) => { e.stopPropagation(); user && onProfileClick(user.id) }}
              className={`text-[11px] font-semibold mb-1 ${user?.textColor ?? 'text-slate-500'} hover:underline cursor-pointer text-left`}
            >
              {user?.displayName ?? 'Unknown'}
            </button>
          )}
          <div ref={bubbleRef} className={`relative transition-all duration-150 ${selectedBubbleClass}`} onClick={handleClick}>
            <QuotedReply />
            <div className={`rounded-2xl overflow-hidden ${
              isMe
                ? 'bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20'
                : `bg-white ${showContextMenu ? '' : 'ring-1 ring-violet-200/60'} text-slate-900 shadow-sm`
            }`}>
              <div className="px-3.5 pt-2.5 pb-2">
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${isMe ? 'text-white/80' : 'text-violet-500'}`}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Photo Turn
                </div>
                {photoTurnData.prompt && (
                  <div className={`text-[12px] italic leading-snug ${isMe ? 'text-white/80' : 'text-violet-600'}`}>
                    &ldquo;{photoTurnData.prompt}&rdquo;
                  </div>
                )}
              </div>
              <div
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setShowLightbox(true) }}
              >
                <img
                  src={photoTurnData.imageUrl}
                  alt="Photo turn response"
                  className="w-full max-h-52 object-cover"
                  loading="lazy"
                />
              </div>
              <div className={`text-[10px] px-3.5 py-2 ${isMe ? 'text-white/50' : 'text-slate-400'}`}>
                {formatTime(message.created_at)}
              </div>
            </div>
            <HoverMenuButton />
          </div>
          <MetaRow />
        </div>
        {showLightbox && (
          <PhotoLightbox
            imageUrl={photoTurnData.imageUrl}
            onClose={() => setShowLightbox(false)}
          />
        )}
        {showContextMenu && (
          <MessageSelectionOverlay
            anchorRef={bubbleRef}
            emojis={EMOJI_OPTIONS}
            onReact={(emoji) => onReact(message.id, emoji)}
            onReply={() => onReply(message)}
            onClose={() => setShowContextMenu(false)}
            canCopy={false}
          />
        )}
      </div>
    )
  }

  // Turn response - modern, visually distinct design
  if (isTurnResponse) {
    return (
      <div
        ref={rowRef}
        className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative touch-pan-y select-none msg-bubble-container`}
        style={{ WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', transform: `translateX(${swipeOffset}px)`, transition: swipeOffset === 0 ? 'transform 0.2s ease-out' : 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onSelectCapture={handleSelectStart}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Swipe reply indicator */}
        {swipeOffset > 0 && (
          <div className={`absolute ${isMe ? 'right-full mr-2' : 'left-0 -ml-8'} top-1/2 -translate-y-1/2 transition-opacity ${swipeOffset >= SWIPE_THRESHOLD ? 'opacity-100' : 'opacity-50'}`}>
            <div className={`p-1.5 rounded-full transition-all ${swipeOffset >= SWIPE_THRESHOLD ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' : 'bg-slate-200 text-slate-500'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
          </div>
        )}
        {/* Accent bar - refined gradient */}
        <div className={`w-1 rounded-full self-stretch ${isMe ? 'bg-gradient-to-b from-indigo-500 to-violet-500' : 'bg-gradient-to-b from-indigo-400 to-violet-400'} ${isMe ? 'ml-2' : 'mr-2'}`} />
        {/* Avatar: visible only on last message in group */}
        <div className={`flex-shrink-0 ${isMe ? 'ml-2' : 'mr-2'}`}>
          {isLastInGroup ? (
            <Avatar user={user} size="xs" className="mt-0.5" onClick={user ? () => onProfileClick(user.id) : undefined} />
          ) : (
            <div className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col max-w-[70%] min-w-0">
          {/* Name: visible only on first message in group */}
          {showMeta && !isMe && isFirstInGroup && (
            <button
              onClick={(e) => { e.stopPropagation(); user && onProfileClick(user.id) }}
              className={`text-[11px] font-semibold mb-1 ${user?.textColor ?? 'text-slate-500'} hover:underline cursor-pointer text-left`}
            >
              {user?.displayName ?? 'Unknown'}
            </button>
          )}
          <div ref={bubbleRef} className={`relative transition-all duration-150 ${selectedBubbleClass}`} onClick={handleClick}>
            <QuotedReply />
            <div className={`rounded-2xl px-3.5 py-2.5 cursor-pointer ${
              isMe
                ? 'bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20'
                : `bg-white ${showContextMenu ? '' : 'ring-1 ring-indigo-200/60'} text-slate-900 shadow-sm`
            }`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${isMe ? 'text-white/80' : 'text-indigo-500'}`}>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Turn Response
              </div>
              {hasTurnPrompt && (
                <div className={`text-[11px] mb-2 italic ${isMe ? 'text-white/70' : 'text-indigo-400'}`}>
                  {promptLine}
                </div>
              )}
              <span className="msg-text text-[14px] leading-relaxed whitespace-pre-wrap block">{responseContent}</span>
              <div className={`text-[10px] mt-1.5 ${isMe ? 'text-white/50' : 'text-slate-400'}`}>
                {formatTime(message.created_at)}
              </div>
            </div>
            <HoverMenuButton />
          </div>
          <MetaRow />
        </div>
        {showContextMenu && (
          <MessageSelectionOverlay
            anchorRef={bubbleRef}
            emojis={EMOJI_OPTIONS}
            onReact={(emoji) => onReact(message.id, emoji)}
            onReply={() => onReply(message)}
            onCopy={handleCopy}
            onClose={() => setShowContextMenu(false)}
            canCopy={canCopy}
          />
        )}
      </div>
    )
  }

  // Regular chat message - modern, clean design with grouping support
  // Border radius adjustments for stacked bubbles
  const getBubbleRadius = () => {
    if (!isGrouped) return 'rounded-2xl'
    if (isMe) {
      if (groupPosition === 'first') return 'rounded-2xl rounded-br-md'
      if (groupPosition === 'middle') return 'rounded-2xl rounded-r-md'
      if (groupPosition === 'last') return 'rounded-2xl rounded-tr-md'
    } else {
      if (groupPosition === 'first') return 'rounded-2xl rounded-bl-md'
      if (groupPosition === 'middle') return 'rounded-2xl rounded-l-md'
      if (groupPosition === 'last') return 'rounded-2xl rounded-tl-md'
    }
    return 'rounded-2xl'
  }

  return (
    <div
      ref={rowRef}
      className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative touch-pan-y select-none msg-bubble-container`}
      style={{ WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', transform: `translateX(${swipeOffset}px)`, transition: swipeOffset === 0 ? 'transform 0.2s ease-out' : 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onSelectCapture={handleSelectStart}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Swipe reply indicator */}
      {swipeOffset > 0 && (
        <div className={`absolute ${isMe ? 'right-full mr-2' : 'left-0 -ml-8'} top-1/2 -translate-y-1/2 transition-opacity ${swipeOffset >= SWIPE_THRESHOLD ? 'opacity-100' : 'opacity-50'}`}>
          <div className={`p-1.5 rounded-full transition-all ${swipeOffset >= SWIPE_THRESHOLD ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' : 'bg-slate-200 text-slate-500'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </div>
        </div>
      )}
      {/* Avatar: visible only on last message in group */}
      <div className={`flex-shrink-0 ${isMe ? 'ml-2' : 'mr-2'}`}>
        {isLastInGroup ? (
          <Avatar user={user} size="xs" className="mt-0.5" onClick={user ? () => onProfileClick(user.id) : undefined} />
        ) : (
          <div className="w-5 h-5" />
        )}
      </div>
      <div className="flex flex-col max-w-[75%] min-w-0">
        {/* Name: visible only on first message in group */}
        {showMeta && !isMe && isFirstInGroup && (
          <span className={`text-[11px] font-semibold mb-1 ${user?.textColor ?? 'text-slate-500'}`}>
            {user?.displayName ?? 'Unknown'}
          </span>
        )}
        <div ref={bubbleRef} className={`relative transition-all duration-150 ${selectedBubbleClass}`} onClick={handleClick}>
          <div className={`${getBubbleRadius()} px-3.5 py-2 cursor-pointer ${
            isMe
              ? 'bg-slate-800 text-white shadow-sm'
              : `bg-white ${showContextMenu ? '' : 'ring-1 ring-slate-200/80'} text-slate-900 shadow-sm`
          }`}>
            <QuotedReply />
            <span className="msg-text text-[14px] leading-relaxed whitespace-pre-wrap block">{message.content}</span>
            <div className={`text-[10px] mt-1 ${isMe ? 'text-white/50 text-right' : 'text-slate-400'}`}>
              {formatTime(message.created_at)}
            </div>
          </div>
          <HoverMenuButton />
        </div>
        <MetaRow />
      </div>
      {showContextMenu && (
        <MessageSelectionOverlay
          anchorRef={bubbleRef}
          emojis={EMOJI_OPTIONS}
          onReact={(emoji) => onReact(message.id, emoji)}
          onReply={() => onReply(message)}
          onCopy={handleCopy}
          onClose={() => setShowContextMenu(false)}
          canCopy={canCopy}
        />
      )}
    </div>
  )
}

// Empty state - modern, welcoming design
function EmptyState({ gameActive, isHost }: { gameActive: boolean, isHost: boolean }) {
  return (
    <div className="text-center py-20 px-6">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center mx-auto mb-5 shadow-sm">
        <svg className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      </div>
      <h3 className="text-slate-900 font-semibold text-lg mb-2">No messages yet</h3>
      <p className="text-slate-500 text-sm max-w-xs mx-auto leading-relaxed">
        {gameActive
          ? "The game is on! Wait for your turn or send a chat message."
          : isHost
            ? "Start the game to begin taking turns, or just chat freely."
            : "Send a message to start the conversation."
        }
      </p>
    </div>
  )
}

// Photo Action Sheet - WhatsApp-like bottom sheet for choosing photo source
function PhotoActionSheet({
  isOpen,
  onClose,
  onTakePhoto,
  onChooseLibrary,
}: {
  isOpen: boolean
  onClose: () => void
  onTakePhoto: () => void
  onChooseLibrary: () => void
}) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Action Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 pb-safe animate-in slide-in-from-bottom duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Photo options"
      >
        <div className="mx-3 mb-3 space-y-2">
          {/* Options card */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-xl">
            <button
              onClick={() => {
                onClose()
                // Small delay to let sheet close before triggering input
                setTimeout(onTakePhoto, 100)
              }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors border-b border-stone-100"
            >
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="text-base font-medium text-stone-900">Take Photo</span>
            </button>
            <button
              onClick={() => {
                onClose()
                setTimeout(onChooseLibrary, 100)
              }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-base font-medium text-stone-900">Choose from Library</span>
            </button>
          </div>

          {/* Cancel button */}
          <button
            onClick={onClose}
            className="w-full py-4 bg-white rounded-2xl text-base font-semibold text-indigo-600 hover:bg-stone-50 active:bg-stone-100 transition-colors shadow-xl"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

// Profile Drawer - shows user profile with option to start DM
function ProfileDrawer({
  isOpen,
  onClose,
  user,
  currentUserId,
  onStartDM,
}: {
  isOpen: boolean
  onClose: () => void
  user: UserInfo | null
  currentUserId: string | null
  onStartDM: (userId: string) => Promise<void>
}) {
  const [startingDM, setStartingDM] = useState(false)

  if (!isOpen || !user) return null

  const isOwnProfile = user.id === currentUserId

  const handleStartDM = async () => {
    if (isOwnProfile || startingDM) return
    setStartingDM(true)
    try {
      await onStartDM(user.id)
      onClose()
    } catch (error) {
      console.error('Failed to start DM:', error)
    } finally {
      setStartingDM(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-200">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-stone-300 rounded-full" />
        </div>

        {/* Content */}
        <div className="px-6 pb-8 pt-2">
          {/* Avatar and name */}
          <div className="flex flex-col items-center text-center mb-6">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-24 h-24 rounded-full object-cover ring-4 ring-stone-100 mb-4"
              />
            ) : (
              <div className={`w-24 h-24 rounded-full ${user.color} flex items-center justify-center text-white text-3xl font-semibold ring-4 ring-stone-100 mb-4`}>
                {user.initials}
              </div>
            )}
            <h2 className="text-xl font-semibold text-stone-900">{user.displayName}</h2>
            <p className="text-sm text-stone-500">{user.email}</p>
            {isOwnProfile && (
              <span className="mt-1 text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">This is you</span>
            )}
          </div>

          {/* Bio */}
          {user.bio && (
            <div className="mb-6">
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">About</h3>
              <p className="text-sm text-stone-700 leading-relaxed">{user.bio}</p>
            </div>
          )}

          {/* Message button */}
          {!isOwnProfile && (
            <button
              onClick={handleStartDM}
              disabled={startingDM}
              className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium rounded-xl hover:from-indigo-600 hover:to-violet-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {startingDM ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Opening chat...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Message
                </>
              )}
            </button>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full mt-3 py-2.5 px-4 text-sm text-stone-500 hover:text-stone-700 hover:bg-stone-50 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}

// Group Details Drawer
function GroupDetailsDrawer({
  isOpen,
  onClose,
  roomInfo,
  roomId,
  members,
  users,
  currentUserId,
  roomFrequency,
  onLeave,
  onUpdateFrequency,
  onAddMember,
  onGetInviteLink,
  onUpdateRoomName,
  onUpdatePromptMode,
  onProfileClick,
}: {
  isOpen: boolean
  onClose: () => void
  roomInfo: RoomInfo | null
  roomId: string
  members: RoomMember[]
  users: Map<string, UserInfo>
  currentUserId: string | null
  roomFrequency: number
  onLeave: () => void
  onUpdateFrequency: (minutes: number) => void
  onAddMember: (email: string) => Promise<{ success: boolean; error?: string; inviteCode?: string; alreadyMember?: boolean; alreadyInvited?: boolean }>
  onGetInviteLink: () => Promise<string | null>
  onUpdateRoomName: (name: string) => Promise<{ success: boolean; error?: string }>
  onUpdatePromptMode: (mode: 'fun' | 'family' | 'deep' | 'flirty' | 'couple') => void
  onProfileClick: (userId: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)
  const [emailInviteLink, setEmailInviteLink] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Push notifications
  const {
    permission,
    isSubscribed,
    isLoading: notifLoading,
    isPWAInstalled,
    isSupported,
    subscribe,
    unsubscribe,
  } = usePushNotifications()

  // Theme preference
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference()

  const handleToggleNotifications = async () => {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }

  // Message notification preferences
  const [messageNotifsEnabled, setMessageNotifsEnabled] = useState(true)
  const [messageNotifsLoading, setMessageNotifsLoading] = useState(false)

  // Load message notification preference when drawer opens
  useEffect(() => {
    if (isOpen && currentUserId) {
      supabase.rpc('get_notification_prefs', { p_room_id: roomId })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setMessageNotifsEnabled(data[0].message_notifs_enabled)
          }
        })
    }
  }, [isOpen, currentUserId, roomId])

  const handleToggleMessageNotifs = async () => {
    setMessageNotifsLoading(true)
    const newValue = !messageNotifsEnabled
    const { error } = await supabase.rpc('update_notification_prefs', {
      p_room_id: roomId,
      p_message_notifs_enabled: newValue,
    })
    if (!error) {
      setMessageNotifsEnabled(newValue)
    }
    setMessageNotifsLoading(false)
  }

  if (!isOpen) return null

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLeave = async () => {
    setLeaving(true)
    await onLeave()
    setLeaving(false)
  }

  const handleAddMember = async () => {
    if (!emailInput.trim()) return
    setAddingMember(true)
    setAddError(null)
    setAddSuccess(null)
    setEmailInviteLink(null)

    const result = await onAddMember(emailInput.trim())

    if (!result.success) {
      setAddError(result.error || 'Failed to create invite')
    } else if (result.alreadyMember) {
      setAddError('This person is already a member of the group')
    } else if (result.inviteCode) {
      // Invite created (or already exists)
      const link = `${window.location.origin}/join/${result.inviteCode}`
      setEmailInviteLink(link)
      setAddSuccess(result.alreadyInvited
        ? `An invite for ${emailInput.trim()} already exists`
        : `Invite created for ${emailInput.trim()}`)
    }
    setAddingMember(false)
  }

  const handleCopyEmailInvite = () => {
    if (emailInviteLink) {
      navigator.clipboard.writeText(emailInviteLink)
      setCopiedInvite(true)
      setTimeout(() => setCopiedInvite(false), 2000)
    }
  }

  const handleSendEmailInvite = () => {
    if (emailInviteLink && emailInput) {
      const roomName = roomInfo?.name || 'a group'
      const subject = encodeURIComponent(`Join ${roomName} on Turn Chat`)
      const body = encodeURIComponent(`You've been invited to join ${roomName}!\n\nClick this link to join:\n${emailInviteLink}`)
      window.open(`mailto:${emailInput}?subject=${subject}&body=${body}`)
    }
  }

  const handleResetEmailInvite = () => {
    setEmailInput('')
    setEmailInviteLink(null)
    setAddSuccess(null)
    setAddError(null)
  }

  const handleGetInviteLink = async () => {
    setLoadingInvite(true)
    const code = await onGetInviteLink()
    if (code) {
      const link = `${window.location.origin}/join/${code}`
      setInviteLink(link)
    }
    setLoadingInvite(false)
  }

  const handleStartEditName = () => {
    setNewName(roomInfo?.name ?? '')
    setNameError(null)
    setEditingName(true)
  }

  const handleSaveName = async () => {
    if (!newName.trim()) {
      setNameError('Name cannot be empty')
      return
    }
    setSavingName(true)
    setNameError(null)
    const result = await onUpdateRoomName(newName.trim())
    if (result.success) {
      setEditingName(false)
    } else {
      setNameError(result.error || 'Failed to update name')
    }
    setSavingName(false)
  }

  const handleCopyInviteLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink)
      setCopiedInvite(true)
      setTimeout(() => setCopiedInvite(false), 2000)
    }
  }

  // Format relative time for "Last active"
  const formatLastActive = (dateStr: string | null): string => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Sort members: host first, then alphabetically
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === 'host' && b.role !== 'host') return -1
    if (b.role === 'host' && a.role !== 'host') return 1
    const userA = users.get(a.user_id)
    const userB = users.get(b.user_id)
    return (userA?.displayName ?? '').localeCompare(userB?.displayName ?? '')
  })

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white z-50 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-stone-200">
          <h2 className="text-lg font-semibold text-stone-900">Group Info</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Group name and ID */}
          <div className="p-4 border-b border-stone-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                {editingName ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={50}
                      className="w-full px-2 py-1 text-sm font-semibold bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveName()
                        if (e.key === 'Escape') setEditingName(false)
                      }}
                    />
                    {nameError && (
                      <p className="text-xs text-red-500">{nameError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveName}
                        disabled={savingName}
                        className="px-2 py-1 text-xs font-medium bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50"
                      >
                        {savingName ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingName(false)}
                        className="px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-stone-900 truncate">{roomInfo?.name ?? 'Room'}</h3>
                    <button
                      onClick={handleStartEditName}
                      className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded"
                      title="Edit group name"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                )}
                <p className="text-sm text-stone-500">{members.length} members</p>
              </div>
            </div>
            <button
              onClick={handleCopyRoomId}
              className="w-full flex items-center justify-between px-3 py-2 bg-stone-50 rounded-lg text-sm hover:bg-stone-100 transition-colors"
            >
              <span className="text-stone-500">Room ID</span>
              <span className="flex items-center gap-2 font-mono text-stone-700">
                {roomId.slice(0, 8)}...
                {copied ? (
                  <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </span>
            </button>
          </div>

          {/* Last active indicator */}
          {roomInfo?.last_active_at && (
            <div className="px-4 py-2 border-b border-stone-100 bg-stone-50">
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Last active: {formatLastActive(roomInfo.last_active_at)}</span>
              </div>
            </div>
          )}

          {/* Prompt frequency setting - room-wide */}
          <div className="p-4 border-b border-stone-100">
            <h4 className="text-sm font-medium text-stone-700 mb-2">Prompt Frequency</h4>
            <p className="text-xs text-stone-500 mb-3">Time between prompts (applies to everyone)</p>
            <div className="space-y-1">
              {FREQUENCY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => onUpdateFrequency(option.value)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    roomFrequency === option.value
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                      : 'hover:bg-stone-50 text-stone-700'
                  }`}
                >
                  <span>{option.label}</span>
                  {roomFrequency === option.value && (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Mode */}
          <div className="p-4 border-b border-stone-100">
            <h4 className="text-sm font-medium text-stone-700 mb-2">Prompt Mode</h4>
            <p className="text-xs text-stone-500 mb-3">This changes the tone of future prompts for the group</p>
            <div className="space-y-1">
              {PROMPT_MODES.map(mode => (
                <button
                  key={mode.value}
                  onClick={() => onUpdatePromptMode(mode.value)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    roomInfo?.prompt_mode === mode.value
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                      : 'hover:bg-stone-50 text-stone-700'
                  }`}
                >
                  <div className="text-left">
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-xs text-stone-400">{mode.description}</div>
                  </div>
                  {roomInfo?.prompt_mode === mode.value && (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            {roomInfo?.prompt_mode === 'couple' && members.length > 2 && (
              <p className="text-xs text-amber-600 mt-2 px-1">
                Couple mode works best in 1:1 chats.
              </p>
            )}
          </div>

          {/* Appearance */}
          <div className="p-4 border-b border-stone-100">
            <h4 className="text-sm font-medium text-stone-700 mb-2">Appearance</h4>
            <p className="text-xs text-stone-500 mb-3">Only you can see this setting</p>
            <div className="flex gap-1 bg-stone-100 p-1 rounded-lg">
              {([
                { value: 'system', label: 'System', icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )},
                { value: 'light', label: 'Light', icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )},
                { value: 'dark', label: 'Dark', icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )},
              ] as { value: ThemePreference; label: string; icon: React.ReactNode }[]).map(option => (
                <button
                  key={option.value}
                  onClick={() => setThemePreference(option.value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    themePreference === option.value
                      ? 'bg-white text-stone-900 shadow-sm'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Turn Notifications */}
          <div className="p-4 border-b border-stone-100">
            <h4 className="text-sm font-medium text-stone-700 mb-2">Turn Notifications</h4>
            <p className="text-xs text-stone-500 mb-3">Get notified when it's your turn</p>

            {!isSupported ? (
              <p className="text-xs text-stone-400">Notifications not supported on this browser</p>
            ) : permission === 'denied' ? (
              <p className="text-xs text-amber-600">Notifications blocked. Enable in browser settings.</p>
            ) : !isPWAInstalled && /iPhone|iPad/.test(navigator.userAgent) ? (
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-700">
                  <span className="font-medium">Install this app</span> to get turn notifications on iPhone.
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Tap the Share button, then "Add to Home Screen"
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={handleToggleNotifications}
                  disabled={notifLoading}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isSubscribed
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    {isSubscribed ? 'Notifications enabled' : 'Enable notifications'}
                  </span>
                  {notifLoading ? (
                    <div className="w-4 h-4 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
                  ) : isSubscribed ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </button>

              </div>
            )}
          </div>

          {/* Message Notifications */}
          {isSupported && permission !== 'denied' && isSubscribed && (
            <div className="p-4 border-b border-stone-100">
              <h4 className="text-sm font-medium text-stone-700 mb-2">Message Notifications</h4>
              <p className="text-xs text-stone-500 mb-3">Get notified when someone messages the group</p>
              <button
                onClick={handleToggleMessageNotifs}
                disabled={messageNotifsLoading}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  messageNotifsEnabled
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {messageNotifsEnabled ? 'Message alerts on' : 'Message alerts off'}
                </span>
                {messageNotifsLoading ? (
                  <div className="w-4 h-4 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
                ) : messageNotifsEnabled ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            </div>
          )}

          {/* Add Members section */}
          <div className="p-4 border-b border-stone-100">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-stone-700">Add Members</h4>
              {!showAddMember && (
                <button
                  onClick={() => setShowAddMember(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  + Add
                </button>
              )}
            </div>

            {showAddMember && (
              <div className="space-y-3 mb-3">
                {/* Invite by email */}
                {!emailInviteLink ? (
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">Invite by email</label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="Enter email address"
                        className="flex-1 px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddMember()
                        }}
                      />
                      <button
                        onClick={handleAddMember}
                        disabled={addingMember || !emailInput.trim()}
                        className="px-3 py-2 text-sm font-medium bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingMember ? '...' : 'Invite'}
                      </button>
                    </div>
                    {addError && (
                      <p className="text-xs text-red-500 mt-1">{addError}</p>
                    )}
                    <p className="text-xs text-stone-400 mt-1">
                      Works even if they haven't signed up yet
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-50 rounded-lg p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-emerald-800">{addSuccess}</p>
                        <p className="text-xs text-emerald-600 mt-0.5">Share the link below to invite them</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={emailInviteLink}
                        readOnly
                        className="flex-1 px-2 py-1.5 text-xs bg-white border border-emerald-200 rounded-lg text-stone-600 font-mono"
                      />
                      <button
                        onClick={handleCopyEmailInvite}
                        className="px-2 py-1.5 text-xs font-medium bg-white border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-100 flex items-center gap-1"
                      >
                        {copiedInvite ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          'Copy'
                        )}
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleSendEmailInvite}
                        className="flex-1 px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Send via Email
                      </button>
                      <button
                        onClick={handleResetEmailInvite}
                        className="px-3 py-2 text-sm font-medium bg-white border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50"
                      >
                        Invite Another
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-stone-400">
                  <div className="flex-1 h-px bg-stone-200" />
                  <span>or</span>
                  <div className="flex-1 h-px bg-stone-200" />
                </div>

                {/* General invite link (open to anyone) */}
                <div>
                  <label className="text-xs text-stone-500 mb-1 block">Share open invite link</label>
                  {inviteLink ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inviteLink}
                        readOnly
                        className="flex-1 px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg text-stone-600 font-mono text-xs"
                      />
                      <button
                        onClick={handleCopyInviteLink}
                        className="px-3 py-2 text-sm font-medium bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 flex items-center gap-1"
                      >
                        {copiedInvite ? (
                          <>
                            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          'Copy'
                        )}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleGetInviteLink}
                      disabled={loadingInvite}
                      className="w-full px-3 py-2 text-sm font-medium bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 disabled:opacity-50"
                    >
                      {loadingInvite ? 'Generating...' : 'Generate Open Link'}
                    </button>
                  )}
                  <p className="text-xs text-stone-400 mt-1">
                    Anyone with this link can join
                  </p>
                </div>

                <button
                  onClick={() => {
                    setShowAddMember(false)
                    setAddError(null)
                    setAddSuccess(null)
                    setEmailInput('')
                    setEmailInviteLink(null)
                  }}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Members list */}
          <div className="p-4">
            <h4 className="text-sm font-medium text-stone-700 mb-3">Members ({members.length})</h4>
            <div className="space-y-1">
              {sortedMembers.map(member => {
                const user = users.get(member.user_id)
                const isMe = member.user_id === currentUserId
                const isHost = member.role === 'host'

                return (
                  <button
                    key={member.user_id}
                    onClick={() => onProfileClick(member.user_id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-stone-50 transition-colors text-left"
                  >
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className={`w-9 h-9 rounded-full ${user?.color ?? 'bg-stone-300'} flex items-center justify-center text-white text-sm font-medium`}>
                        {user?.initials ?? '??'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-900 truncate">
                          {user?.displayName ?? 'Unknown'}
                        </span>
                        {isMe && (
                          <span className="text-xs text-stone-400">(you)</span>
                        )}
                        {isHost && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Host</span>
                        )}
                      </div>
                      <div className="text-xs text-stone-400">
                        {user?.email}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer with Leave button */}
        <div className="p-4 border-t border-stone-200">
          {showLeaveConfirm ? (
            <div className="space-y-2">
              <p className="text-sm text-stone-600 text-center">Are you sure you want to leave this group?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="flex-1 py-2 px-4 text-sm font-medium text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLeave}
                  disabled={leaving}
                  className="flex-1 py-2 px-4 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {leaving ? 'Leaving...' : 'Leave Group'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="w-full py-2.5 px-4 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Leave Group
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// Loading state
function LoadingState() {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center">
      <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mb-4" />
      <p className="text-stone-500 text-sm">Loading room...</p>
    </div>
  )
}

export default function RoomPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const roomId = params.id

  // Set up mobile viewport height and keyboard handling
  const { keyboardHeight } = useMobileViewport()

  const [userId, setUserId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [messages, setMessages] = useState<Msg[]>([])
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const INITIAL_MESSAGES = 20
  const PAGE_SIZE = 30

  const [chatText, setChatText] = useState('')
  const [turnText, setTurnText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [turnSession, setTurnSession] = useState<TurnSession | null>(null)

  const [users, setUsers] = useState<Map<string, UserInfo>>(new Map())
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([])
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [showGroupDetails, setShowGroupDetails] = useState(false)
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())

  // For DM rooms, compute the "other member" display info
  const dmDisplayInfo = useMemo(() => {
    if (roomInfo?.type !== 'dm' || !userId) return null

    // Find the other member (not the current user)
    const otherMemberId = roomMembers.find(m => m.user_id !== userId)?.user_id
    if (!otherMemberId) return null

    const otherUser = users.get(otherMemberId)
    if (!otherUser) {
      // Fallback if user not loaded yet
      return {
        displayName: 'Direct Message',
        initials: 'DM',
        color: 'bg-stone-400',
        avatarUrl: null,
        isOnline: onlineUsers.has(otherMemberId)
      }
    }

    return {
      displayName: otherUser.displayName,
      initials: otherUser.initials,
      color: otherUser.color,
      avatarUrl: otherUser.avatarUrl,
      isOnline: onlineUsers.has(otherMemberId)
    }
  }, [roomInfo?.type, userId, roomMembers, users, onlineUsers])

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const turnInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const turnCameraInputRef = useRef<HTMLInputElement | null>(null)
  const turnLibraryInputRef = useRef<HTMLInputElement | null>(null)
  const chatInputRef = useRef<HTMLInputElement | null>(null)
  const hasInitiallyScrolled = useRef(false)

  // Photo action sheet state
  const [showPhotoSheet, setShowPhotoSheet] = useState(false)
  const [showTurnPhotoSheet, setShowTurnPhotoSheet] = useState(false)

  // Track if user is at bottom of scroll
  const isNearBottomRef = useRef(true)

  // Scroll the messages container to bottom (not the window!)
  const scrollToBottom = useCallback((smooth = true) => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      })
      setHasNewMessages(false)
    }
  }, [])

  // Handle input focus - scroll container to bottom so messages stay visible
  const handleInputFocus = useCallback(() => {
    // Small delay to let keyboard animation start
    setTimeout(() => {
      scrollToBottom(true)
    }, 150)
  }, [scrollToBottom])

  const [uploadingImage, setUploadingImage] = useState(false)

  // Reply and reactions state
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Nudge state (scoped to current turn, not per-day)
  const [hasNudgedThisTurn, setHasNudgedThisTurn] = useState(false)
  const [nudgeLoading, setNudgeLoading] = useState(false)
  const [nudgeToast, setNudgeToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [nudgeStatus, setNudgeStatus] = useState<{
    eligible_count: number
    nudge_count: number
    all_nudged: boolean
    all_nudged_at: string | null
  } | null>(null)
  const [wasRemoved, setWasRemoved] = useState(false)

  // Turn Pulse state - visual signature moment when it becomes user's turn
  const [turnPulseActive, setTurnPulseActive] = useState(false)
  const lastTurnInstanceRef = useRef<string | null>(null)
  const turnPulseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Seen tracking state
  const [seenCounts, setSeenCounts] = useState<Map<string, number>>(new Map())
  const pendingSeenRef = useRef<Set<string>>(new Set())
  const seenDebounceRef = useRef<NodeJS.Timeout | null>(null)

  const gameActive = turnSession?.is_active ?? false

  // Use current_turn_user_id directly (dynamic turn order from room_members)
  const currentTurnUserId = useMemo(() => {
    if (!turnSession || !turnSession.is_active) return null
    // current_turn_user_id is the source of truth (derived from room_members on each turn)
    return turnSession.current_turn_user_id ?? null
  }, [turnSession])

  const isMyTurn = useMemo(() => {
    if (!turnSession || !turnSession.is_active || !userId) return false
    return currentTurnUserId === userId
  }, [turnSession, userId, currentTurnUserId])

  const currentPlayerInfo = useMemo(() => {
    if (!currentTurnUserId) return null
    return users.get(currentTurnUserId) ?? null
  }, [currentTurnUserId, users])

  // With dynamic turn order, we just show if it's your turn or not
  // Position calculation is no longer reliable since order is dynamic
  const myTurnPosition = useMemo(() => {
    if (!turnSession || !userId) return null
    if (currentTurnUserId === userId) return { position: 0, label: "Your turn!" }
    return { position: 1, label: "Waiting..." }
  }, [turnSession, userId, currentTurnUserId])

  // Next player info - with dynamic ordering, we don't predict who's next
  const nextPlayerInfo = useMemo(() => {
    return null
  }, [turnSession, users])

  // Room-wide prompt frequency setting
  const roomFrequency = useMemo(() => {
    return roomInfo?.prompt_interval_minutes ?? 0
  }, [roomInfo?.prompt_interval_minutes])

  // Check if we're waiting for cooldown
  const waitingUntil = useMemo(() => {
    if (!turnSession?.waiting_until) return null
    return new Date(turnSession.waiting_until)
  }, [turnSession?.waiting_until])

  const isWaitingForCooldown = useMemo(() => {
    if (!waitingUntil) return false
    return waitingUntil > new Date()
  }, [waitingUntil])

  // For countdown timer - force re-render every minute when waiting
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isWaitingForCooldown) return
    const interval = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [isWaitingForCooldown])

  // Pre-compute message metadata (group positions, seen boundaries) to avoid recalculating in render loop
  const messageMetadata = useMemo(() => {
    const metadata = new Map<string, { groupPosition: MessageGroupPosition; isSeenBoundary: boolean; spacingClass: string }>()

    for (let index = 0; index < messages.length; index++) {
      const m = messages[index]
      const groupPosition = getMessageGroupPosition(messages, index)
      const isFirstOrSingle = groupPosition === 'first' || groupPosition === 'single'
      const spacingClass = index === 0 ? '' : isFirstOrSingle ? 'mt-2' : 'mt-0.5'

      // Compute seen boundary
      const currentSeenCount = seenCounts.get(m.id) ?? 0
      const nextMessage = messages[index + 1]
      const nextSeenCount = nextMessage ? (seenCounts.get(nextMessage.id) ?? 0) : -1
      const isSeenBoundary = nextMessage === undefined || currentSeenCount !== nextSeenCount

      metadata.set(m.id, { groupPosition, isSeenBoundary, spacingClass })
    }

    return metadata
  }, [messages, seenCounts])

  // Check if user has nudged this turn and get nudge status - re-check when turn_instance_id changes
  useEffect(() => {
    if (!userId || !roomId) return

    // Fetch both in parallel
    Promise.all([
      supabase.rpc('has_nudged_this_turn', { p_room_id: roomId }),
      supabase.rpc('get_nudge_status', { p_room_id: roomId })
    ]).then(([nudgedResult, statusResult]) => {
      setHasNudgedThisTurn(nudgedResult.data === true)
      if (statusResult.data?.active) {
        setNudgeStatus({
          eligible_count: statusResult.data.eligible_count,
          nudge_count: statusResult.data.nudge_count,
          all_nudged: statusResult.data.all_nudged,
          all_nudged_at: statusResult.data.all_nudged_at
        })
      } else {
        setNudgeStatus(null)
      }
    })
  }, [userId, roomId, turnSession?.turn_instance_id])

  // Hide nudge toast after 3 seconds
  useEffect(() => {
    if (!nudgeToast) return
    const timer = setTimeout(() => setNudgeToast(null), 3000)
    return () => clearTimeout(timer)
  }, [nudgeToast])

  // Load older messages (pagination)
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages || !hasMoreMessages || messages.length === 0) return

    setLoadingOlderMessages(true)
    const oldestMessage = messages[0]
    const scrollContainer = scrollContainerRef.current
    const previousScrollHeight = scrollContainer?.scrollHeight ?? 0

    try {
      const { data: olderMsgs, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .lt('created_at', oldestMessage.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      if (error) {
        console.error('Error loading older messages:', error)
        return
      }

      if (olderMsgs && olderMsgs.length > 0) {
        const sortedOlder = olderMsgs.reverse() as Msg[]
        // Dedupe by message id
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const newMsgs = sortedOlder.filter(m => !existingIds.has(m.id))
          return [...newMsgs, ...prev]
        })
        setHasMoreMessages(olderMsgs.length >= PAGE_SIZE)

        // Fetch reactions for older messages
        const olderMsgIds = sortedOlder.map(m => m.id)
        const { data: reactionsData } = await supabase
          .from('message_reactions')
          .select('*')
          .in('message_id', olderMsgIds)

        if (reactionsData && reactionsData.length > 0) {
          setReactions(prev => [...prev, ...reactionsData as Reaction[]])
        }

        // Maintain scroll position after prepending
        requestAnimationFrame(() => {
          if (scrollContainer) {
            const newScrollHeight = scrollContainer.scrollHeight
            scrollContainer.scrollTop = newScrollHeight - previousScrollHeight
          }
        })
      } else {
        setHasMoreMessages(false)
      }
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [loadingOlderMessages, hasMoreMessages, messages, roomId])

  // Handle scroll for infinite scroll up and tracking position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Check if near bottom (within 100px)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    isNearBottomRef.current = isNearBottom

    // If user scrolled to bottom, clear "new messages" indicator
    if (isNearBottom) {
      setHasNewMessages(false)
    }

    // Check if near top (within 200px) - trigger loading older messages
    if (container.scrollTop < 200 && hasMoreMessages && !loadingOlderMessages) {
      loadOlderMessages()
    }
  }, [hasMoreMessages, loadingOlderMessages, loadOlderMessages])

  const handleNudge = async () => {
    if (!userId || nudgeLoading || hasNudgedThisTurn || isMyTurn || !currentTurnUserId) return

    setNudgeLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) {
        setNudgeToast({ message: 'Not logged in', type: 'error' })
        return
      }

      const res = await fetch('/api/push/nudge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ roomId }),
      })

      const result = await res.json()

      if (result.success) {
        setHasNudgedThisTurn(true)
        setNudgeToast({
          message: result.sent ? 'Nudge sent!' : 'Nudge sent (notifications off)',
          type: 'success'
        })
        // Refresh nudge status to update the count
        const { data: statusResult } = await supabase.rpc('get_nudge_status', { p_room_id: roomId })
        if (statusResult?.active) {
          setNudgeStatus({
            eligible_count: statusResult.eligible_count,
            nudge_count: statusResult.nudge_count,
            all_nudged: statusResult.all_nudged,
            all_nudged_at: statusResult.all_nudged_at
          })
        }
      } else {
        setNudgeToast({ message: result.error || 'Failed to nudge', type: 'error' })
      }
    } catch {
      setNudgeToast({ message: 'Failed to nudge', type: 'error' })
    } finally {
      setNudgeLoading(false)
    }
  }

  // Mark a message as seen (adds to pending batch)
  const markMessageSeen = useCallback((messageId: string) => {
    if (!userId) return
    pendingSeenRef.current.add(messageId)

    // Debounce: flush pending seen messages after 500ms of inactivity
    if (seenDebounceRef.current) {
      clearTimeout(seenDebounceRef.current)
    }
    seenDebounceRef.current = setTimeout(async () => {
      const pending = Array.from(pendingSeenRef.current)
      if (pending.length === 0) return
      pendingSeenRef.current.clear()

      // Mark messages as seen in batch
      await supabase.rpc('mark_messages_seen', { p_message_ids: pending })

      // Refresh seen counts for these messages
      const { data } = await supabase.rpc('get_message_seen_counts', { p_message_ids: pending })
      if (data) {
        setSeenCounts(prev => {
          const next = new Map(prev)
          for (const row of data as { message_id: string; seen_count: number }[]) {
            next.set(row.message_id, row.seen_count)
          }
          return next
        })
      }
    }, 500)
  }, [userId])

  // Fetch seen counts for all current messages
  const fetchSeenCounts = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return
    const { data } = await supabase.rpc('get_message_seen_counts', { p_message_ids: messageIds })
    if (data) {
      setSeenCounts(prev => {
        const next = new Map(prev)
        for (const row of data as { message_id: string; seen_count: number }[]) {
          next.set(row.message_id, row.seen_count)
        }
        return next
      })
    }
  }, [])

  // Fetch initial seen counts when messages load
  useEffect(() => {
    if (messages.length > 0) {
      const ids = messages.map(m => m.id).filter(id => !id.startsWith('optimistic-'))
      fetchSeenCounts(ids)
    }
  }, [messages.length, fetchSeenCounts])

  const getUserInfo = (uid: string): UserInfo | null => {
    const existing = users.get(uid)
    if (existing) return existing

    const shortId = uid.slice(0, 4)
    const colors = stringToColors(uid)
    return {
      id: uid,
      email: `user-${shortId}`,
      displayName: `User ${shortId}`,
      initials: shortId.slice(0, 2).toUpperCase(),
      color: colors.bg,
      textColor: colors.text,
      isHost: false,
      avatarUrl: null,
      bio: null
    }
  }

  // Focus turn input when it becomes your turn
  useEffect(() => {
    if (isMyTurn && turnInputRef.current) {
      turnInputRef.current.focus()
    }
  }, [isMyTurn])

  // Turn Pulse - signature visual moment when turn becomes active
  // Triggers ONCE when: turn becomes mine AND cooldown is done AND it's a new turn instance
  useEffect(() => {
    const currentInstance = turnSession?.turn_instance_id ?? null
    const shouldTrigger = isMyTurn && !isWaitingForCooldown && gameActive

    // Only trigger if this is a NEW turn instance that we haven't pulsed for
    if (shouldTrigger && currentInstance && currentInstance !== lastTurnInstanceRef.current) {
      lastTurnInstanceRef.current = currentInstance

      // Clear any pending timeout
      if (turnPulseTimeoutRef.current) {
        clearTimeout(turnPulseTimeoutRef.current)
      }

      // Fire haptic feedback (once)
      hapticTick('turn')

      // Activate the pulse animation
      setTurnPulseActive(true)

      // Deactivate after 1.2 seconds - settle back to calm state
      turnPulseTimeoutRef.current = setTimeout(() => {
        setTurnPulseActive(false)
      }, 1200)
    }

    // Cleanup on unmount
    return () => {
      if (turnPulseTimeoutRef.current) {
        clearTimeout(turnPulseTimeoutRef.current)
      }
    }
  }, [isMyTurn, isWaitingForCooldown, gameActive, turnSession?.turn_instance_id])

  useEffect(() => {
    let msgChannel: any = null
    let sessChannel: any = null
    let reactChannel: any = null
    let membersChannel: any = null
    let presenceChannel: any = null

    const boot = async () => {
      setError(null)
      setIsLoading(true)
      const bootStart = performance.now()

      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        router.push('/login')
        return
      }

      const uid = authData.user.id
      const email = authData.user.email ?? ''
      setUserId(uid)

      // PARALLEL FETCH: Room, Members, Session, Messages all at once
      const [roomResult, membersResult, sessResult, msgsResult] = await Promise.all([
        supabase
          .from('rooms')
          .select('id, name, type, prompt_interval_minutes, last_active_at, prompt_mode')
          .eq('id', roomId)
          .single(),
        supabase
          .from('room_members')
          .select('user_id, role, prompt_interval_minutes')
          .eq('room_id', roomId),
        supabase
          .from('turn_sessions')
          .select('*')
          .eq('room_id', roomId)
          .maybeSingle(),
        supabase
          .from('messages')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: false })
          .limit(INITIAL_MESSAGES)
      ])

      if (process.env.NODE_ENV === 'development') {
        console.log('[room] initial fetch ms', Math.round(performance.now() - bootStart))
      }

      const room = roomResult.data
      const members = membersResult.data
      const sess = sessResult.data
      const msgs = msgsResult.data
      const msgsErr = msgsResult.error

      // Set room info
      if (room) setRoomInfo({ ...room, type: room.type || 'group', prompt_mode: room.prompt_mode || 'fun' } as RoomInfo)

      // Set members and host
      if (members) {
        setRoomMembers(members as RoomMember[])
        const meMember = members.find(m => m.user_id === uid)
        setIsHost(meMember?.role === 'host')
      }

      // Build role map
      const roleMap = new Map<string, 'host' | 'member'>()
      if (members) {
        for (const m of members) {
          roleMap.set(m.user_id, m.role as 'host' | 'member')
        }
      }

      // Fetch profiles ONLY for room members (not all profiles!)
      const memberIds = members?.map(m => m.user_id) ?? []
      const { data: profiles } = memberIds.length > 0
        ? await supabase
            .from('profiles')
            .select('id, email, display_name, avatar_url, bio')
            .in('id', memberIds)
        : { data: [] }

      setUsers(prev => {
        const next = new Map(prev)

        // Add current user first
        const myProfile = profiles?.find(p => p.id === uid)
        const myColors = stringToColors(uid)
        const myDisplayName = myProfile?.display_name || getDisplayName(email)
        next.set(uid, {
          id: uid,
          email: email,
          displayName: myDisplayName,
          initials: myProfile?.display_name
            ? myProfile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
            : getInitials(email),
          color: myColors.bg,
          textColor: myColors.text,
          isHost: roleMap.get(uid) === 'host',
          avatarUrl: myProfile?.avatar_url || null,
          bio: myProfile?.bio || null
        })

        // Add other profiles
        if (profiles) {
          for (const profile of profiles) {
            if (profile.email && profile.id !== uid) {
              const colors = stringToColors(profile.id)
              const displayName = profile.display_name || getDisplayName(profile.email)
              next.set(profile.id, {
                id: profile.id,
                email: profile.email,
                displayName: displayName,
                initials: profile.display_name
                  ? profile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                  : getInitials(profile.email),
                color: colors.bg,
                textColor: colors.text,
                isHost: roleMap.get(profile.id) === 'host',
                avatarUrl: profile.avatar_url || null,
                bio: profile.bio || null
              })
            }
          }
        }

        // Add fallback for members not in profiles
        if (members) {
          for (const member of members) {
            if (!next.has(member.user_id)) {
              const shortId = member.user_id.slice(0, 4)
              const colors = stringToColors(member.user_id)
              next.set(member.user_id, {
                id: member.user_id,
                email: `user-${shortId}`,
                displayName: `User ${shortId}`,
                initials: shortId.slice(0, 2).toUpperCase(),
                color: colors.bg,
                textColor: colors.text,
                isHost: member.role === 'host',
                avatarUrl: null,
                bio: null
              })
            }
          }
        }
        return next
      })

      // Set session
      if (sess && (sess as any).is_active) {
        setTurnSession(sess as TurnSession)
      } else {
        setTurnSession(null)
      }

      // Set messages (reverse to ascending order for display)
      if (msgsErr) {
        setError(msgsErr.message)
      } else {
        const sortedMsgs = (msgs ?? []).reverse() as Msg[]
        setMessages(sortedMsgs)
        setHasMoreMessages((msgs?.length ?? 0) >= INITIAL_MESSAGES)

        if (process.env.NODE_ENV === 'development') {
          console.log('[room] render messages count', sortedMsgs.length)
        }

        // Fetch reactions for these messages (parallel with seen counts would require messages first)
        const msgIds = sortedMsgs.map(m => m.id)
        if (msgIds.length > 0) {
          const { data: reactionsData } = await supabase
            .from('message_reactions')
            .select('*')
            .in('message_id', msgIds)

          if (reactionsData) {
            setReactions(reactionsData as Reaction[])
          }
        }
      }

      setIsLoading(false)

      // Mark room as read now that we've loaded it
      supabase.rpc('mark_room_read', { p_room_id: roomId }).then(({ error }) => {
        if (error) console.warn('[room] Failed to mark room as read:', error)
      })

      // Subscribe to messages with proper handling for new members
      msgChannel = supabase
        .channel(`room:${roomId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
          async (payload) => {
            const newMsg = payload.new as Msg
            console.log('[Realtime] New message received:', newMsg.id, 'from:', newMsg.user_id)

            // Check if message already exists or if there's a matching optimistic message
            setMessages((prev) => {
              // Skip if exact ID already exists
              if (prev.some(m => m.id === newMsg.id)) {
                console.log('[Realtime] Message already exists, skipping:', newMsg.id)
                return prev
              }

              // Check for matching optimistic message (same content, user, room)
              const optimisticIndex = prev.findIndex(m =>
                m.id.startsWith('optimistic-') &&
                m.content === newMsg.content &&
                m.user_id === newMsg.user_id &&
                m.room_id === newMsg.room_id
              )

              if (optimisticIndex !== -1) {
                // Replace optimistic message with real one
                console.log('[Realtime] Replacing optimistic message with real:', newMsg.id)
                const next = [...prev]
                next[optimisticIndex] = newMsg
                return next
              }

              // Show "new messages" pill if user is scrolled up
              if (!isNearBottomRef.current) {
                setHasNewMessages(true)
              }

              return [...prev, newMsg]
            })

            // Fetch user profile if unknown (using setUsers callback to avoid stale closure)
            const msgUserId = newMsg.user_id
            if (msgUserId) {
              setUsers(prevUsers => {
                if (prevUsers.has(msgUserId)) {
                  return prevUsers // Already have this user
                }
                // Fetch profile asynchronously and update
                supabase
                  .from('profiles')
                  .select('id, email, display_name, avatar_url, bio')
                  .eq('id', msgUserId)
                  .single()
                  .then(({ data: profile }) => {
                    if (profile && profile.email) {
                      const colors = stringToColors(profile.id)
                      const displayName = profile.display_name || getDisplayName(profile.email)
                      setUsers(prev => {
                        const next = new Map(prev)
                        next.set(profile.id, {
                          id: profile.id,
                          email: profile.email,
                          displayName: displayName,
                          initials: profile.display_name
                            ? profile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                            : getInitials(profile.email),
                          color: colors.bg,
                          textColor: colors.text,
                          isHost: false,
                          avatarUrl: profile.avatar_url || null,
                          bio: profile.bio || null
                        })
                        return next
                      })
                    }
                  })
                return prevUsers
              })
            }
          }
        )
        .subscribe((status, err) => {
          console.log('[Realtime] Messages subscription:', status, 'roomId:', roomId, err ? `error: ${err}` : '')
        })

      // Subscribe to session updates
      sessChannel = supabase
        .channel(`session:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'turn_sessions', filter: `room_id=eq.${roomId}` },
          (payload) => {
            console.log('[Realtime] Session update:', payload.eventType)
            const row = payload.new as any
            if (row && row.is_active) {
              setTurnSession(row as TurnSession)
            } else {
              setTurnSession(null)
            }
          }
        )
        .subscribe((status, err) => {
          console.log('[Realtime] Session subscription:', status, err ? `error: ${err}` : '')
        })

      // Subscribe to reactions
      reactChannel = supabase
        .channel(`reactions:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'message_reactions' },
          async (payload) => {
            console.log('[Realtime] Reaction:', payload.eventType)
            if (payload.eventType === 'INSERT') {
              setReactions(prev => [...prev, payload.new as Reaction])
            } else if (payload.eventType === 'DELETE') {
              setReactions(prev => prev.filter(r => r.id !== (payload.old as any).id))
            }
          }
        )
        .subscribe((status, err) => {
          console.log('[Realtime] Reactions subscription:', status, err ? `error: ${err}` : '')
        })

      // Subscribe to room members changes (joins and removals)
      membersChannel = supabase
        .channel(`members:${roomId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
          async (payload) => {
            const newMember = payload.new as RoomMember
            console.log('[Realtime] New member joined:', newMember.user_id)

            // Fetch their profile
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, email, display_name, avatar_url, bio')
              .eq('id', newMember.user_id)
              .single()

            if (profile && profile.email) {
              const colors = stringToColors(profile.id)
              const displayName = profile.display_name || getDisplayName(profile.email)
              setUsers(prev => {
                const next = new Map(prev)
                next.set(profile.id, {
                  id: profile.id,
                  email: profile.email,
                  displayName: displayName,
                  initials: profile.display_name
                    ? profile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                    : getInitials(profile.email),
                  color: colors.bg,
                  textColor: colors.text,
                  isHost: newMember.role === 'host',
                  avatarUrl: profile.avatar_url || null,
                  bio: profile.bio || null
                })
                return next
              })
            }

            // Update room members list
            setRoomMembers(prev => [...prev, newMember])
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
          (payload) => {
            const removedMember = payload.old as { user_id: string }
            console.log('[Realtime] Member removed:', removedMember.user_id)

            // Check if we were removed
            if (removedMember.user_id === uid) {
              console.log('[Realtime] Current user was removed from room')
              setWasRemoved(true)
            }

            // Update room members list
            setRoomMembers(prev => prev.filter(m => m.user_id !== removedMember.user_id))
          }
        )
        .subscribe((status, err) => {
          console.log('[Realtime] Members subscription:', status, err ? `error: ${err}` : '')
        })

      // Set up presence tracking
      presenceChannel = supabase.channel(`presence:${roomId}`, {
        config: { presence: { key: uid } }
      })

      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = presenceChannel.presenceState()
          const onlineUserIds = new Set(Object.keys(state))
          console.log('[Presence] Online users:', onlineUserIds.size)
          setOnlineUsers(onlineUserIds)
        })
        .on('presence', { event: 'join' }, ({ key }: { key: string }) => {
          console.log('[Presence] User joined:', key)
          setOnlineUsers(prev => new Set([...prev, key]))
        })
        .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
          console.log('[Presence] User left:', key)
          setOnlineUsers(prev => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        })
        .subscribe(async (status: string) => {
          console.log('[Presence] Subscription:', status)
          if (status === 'SUBSCRIBED') {
            await presenceChannel.track({ user_id: uid, online_at: new Date().toISOString() })
          }
        })
    }

    boot()

    return () => {
      if (msgChannel) supabase.removeChannel(msgChannel)
      if (sessChannel) supabase.removeChannel(sessChannel)
      if (reactChannel) supabase.removeChannel(reactChannel)
      if (membersChannel) supabase.removeChannel(membersChannel)
      if (presenceChannel) supabase.removeChannel(presenceChannel)
    }
  }, [roomId, router])

  // Check if user is near the bottom of the scroll container
  const isNearBottom = () => {
    const container = scrollContainerRef.current
    if (!container) return true
    const threshold = 150 // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }

  // Scroll to bottom when loading finishes (initial page load)
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !hasInitiallyScrolled.current) {
      // Wait for DOM to fully render after loading completes
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' })
        hasInitiallyScrolled.current = true
      }, 100)
    }
  }, [isLoading, messages.length])

  // Scroll to bottom when new messages arrive (realtime updates)
  useEffect(() => {
    // Skip if we haven't done initial scroll yet, or no messages
    if (!hasInitiallyScrolled.current || messages.length === 0) return

    // Only auto-scroll if user is near the bottom
    if (isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  const sendChat = async () => {
    if (!userId || !chatText.trim()) return
    setError(null)

    const messageContent = chatText.trim()
    const replyToId = replyingTo?.id || null

    // Optimistic update: add message immediately
    const optimisticId = `optimistic-${Date.now()}`
    const optimisticMsg: Msg = {
      id: optimisticId,
      room_id: roomId,
      user_id: userId,
      type: 'chat',
      content: messageContent,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyToId,
    }
    setMessages(prev => [...prev, optimisticMsg])
    setChatText('')
    setReplyingTo(null)

    // Actually insert the message
    const { data, error } = await supabase
      .from('messages')
      .insert({
        room_id: roomId,
        user_id: userId,
        type: 'chat',
        content: messageContent,
        reply_to_message_id: replyToId,
      })
      .select()
      .single()

    if (error) {
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticId))
      setError(error.message)
    } else if (data) {
      // Replace optimistic message with real one (if it still exists and realtime hasn't already)
      setMessages(prev => {
        const hasOptimistic = prev.some(m => m.id === optimisticId)
        const hasReal = prev.some(m => m.id === (data as Msg).id)

        if (hasReal) {
          // Realtime already added it, just remove optimistic if still there
          return hasOptimistic ? prev.filter(m => m.id !== optimisticId) : prev
        }
        if (hasOptimistic) {
          // Replace optimistic with real
          return prev.map(m => m.id === optimisticId ? data as Msg : m)
        }
        // Neither exists (shouldn't happen), add the real one
        return [...prev, data as Msg]
      })

      // Fire-and-forget: notify other members about the new message
      fetch('/api/push/notify-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          messageId: (data as Msg).id,
          senderId: userId,
        }),
      }).catch(() => {}) // Ignore errors silently
    }
  }

  const handleReply = (msg: Msg) => {
    // Focus FIRST - must be synchronous to satisfy iOS user gesture requirement
    // The input is always mounted so focus persists through re-render
    chatInputRef.current?.focus()
    // Then set state - input stays focused during re-render
    setReplyingTo(msg)
    // onFocus handler will trigger scroll after keyboard animation starts
  }

  const handleReact = async (messageId: string, emoji: string) => {
    if (!userId) return
    const { error } = await supabase.rpc('toggle_reaction', {
      p_message_id: messageId,
      p_emoji: emoji,
    })
    if (error) console.error('Reaction error:', error)
  }

  const handleStartDM = async (otherUserId: string) => {
    if (!userId) return
    const { data: dmRoomId, error } = await supabase.rpc('get_or_create_dm', {
      p_other_user_id: otherUserId,
    })
    if (error) {
      console.error('Failed to create DM:', error)
      throw error
    }
    if (dmRoomId) {
      router.push(`/room/${dmRoomId}`)
    }
  }

  const handleProfileClick = (userId: string) => {
    setSelectedProfileUserId(userId)
  }

  const scrollToMessage = (messageId: string) => {
    const el = messageRefs.current.get(messageId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-yellow-100')
      setTimeout(() => el.classList.remove('bg-yellow-100'), 1500)
    }
  }

  const getReactionsForMessage = (messageId: string) => {
    return reactions.filter(r => r.message_id === messageId)
  }

  const sendImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !userId) return

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB')
      return
    }

    setUploadingImage(true)
    setError(null)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `chat/${roomId}/${Date.now()}.${fileExt}`

      console.log('Uploading to:', fileName)
      const { error: uploadError, data: uploadData } = await supabase.storage
        .from('media')
        .upload(fileName, file)

      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        throw new Error(uploadError.message || 'Failed to upload to storage')
      }

      console.log('Upload successful:', uploadData)

      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(fileName)

      const imageUrl = urlData.publicUrl
      console.log('Image URL:', imageUrl)

      const { data: msgData, error: msgError } = await supabase.from('messages').insert({
        room_id: roomId,
        user_id: userId,
        type: 'image',
        content: imageUrl,
      }).select().single()

      if (msgError) {
        console.error('Message insert error:', JSON.stringify(msgError))
        throw new Error(msgError.message || msgError.details || msgError.hint || 'Failed to save message')
      }

      // Fire-and-forget: notify other members about the new image
      if (msgData) {
        fetch('/api/push/notify-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            messageId: msgData.id,
            senderId: userId,
          }),
        }).catch(() => {}) // Ignore errors silently
      }
    } catch (err: any) {
      console.error('Image upload error:', err)
      const errorMsg = err?.message || err?.details || err?.hint || 'Failed to upload image'
      setError(errorMsg)
    } finally {
      setUploadingImage(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  // Auto-start game when there's no active session and 2+ members
  useEffect(() => {
    const autoStart = async () => {
      if (!isLoading && !gameActive && roomMembers.length >= 2 && isHost) {
        console.log('Auto-starting game session...')
        const { error } = await supabase.rpc('start_session', { p_room_id: roomId })
        if (error) {
          console.error('Auto-start failed:', error.message)
        }
      }
    }
    autoStart()
  }, [isLoading, gameActive, roomMembers.length, isHost, roomId])

  const leaveRoom = async () => {
    setError(null)
    const { error } = await supabase.rpc('leave_room', { p_room_id: roomId })
    if (error) {
      setError(error.message)
    } else {
      router.push('/rooms')
    }
  }

  const updateRoomFrequency = async (minutes: number) => {
    setError(null)
    const { error } = await supabase.rpc('update_room_frequency', {
      p_room_id: roomId,
      p_interval_minutes: minutes,
    })
    if (error) {
      setError(error.message)
    } else {
      // Update local state
      setRoomInfo(prev => prev ? { ...prev, prompt_interval_minutes: minutes } : prev)
    }
  }

  const updateRoomName = async (name: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.rpc('update_room_name', {
      p_room_id: roomId,
      p_name: name,
    })
    if (error) {
      return { success: false, error: error.message }
    }
    // Update local state
    setRoomInfo(prev => prev ? { ...prev, name } : prev)
    return { success: true }
  }

  const updateRoomPromptMode = async (mode: 'fun' | 'family' | 'deep' | 'flirty' | 'couple') => {
    setError(null)
    const { error } = await supabase.rpc('update_room_prompt_mode', {
      p_room_id: roomId,
      p_mode: mode,
    })
    if (error) {
      setError(error.message)
    } else {
      // Update local state
      setRoomInfo(prev => prev ? { ...prev, prompt_mode: mode } : prev)
    }
  }

  const addMemberByEmail = async (email: string): Promise<{ success: boolean; error?: string; inviteCode?: string; alreadyMember?: boolean; alreadyInvited?: boolean }> => {
    const { data, error } = await supabase.rpc('create_email_invite', {
      p_room_id: roomId,
      p_email: email,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    // The RPC returns a table with: code, already_member, already_invited
    const result = data?.[0]
    if (!result) {
      return { success: false, error: 'Failed to create invite' }
    }

    if (result.already_member) {
      return { success: true, alreadyMember: true }
    }

    return {
      success: true,
      inviteCode: result.code,
      alreadyInvited: result.already_invited
    }
  }

  const getInviteLink = async (): Promise<string | null> => {
    const { data, error } = await supabase.rpc('get_room_invite', {
      p_room_id: roomId,
    })
    if (error) {
      setError(error.message)
      return null
    }
    return data as string
  }

  // Notify next user about their turn (fire and forget)
  const notifyNextTurn = async () => {
    try {
      await fetch('/api/push/notify-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      })
    } catch {
      // Silently ignore notification errors
    }
  }

  const submitTurn = async () => {
    if (!turnText.trim()) return
    setError(null)

    const prompt = turnSession?.prompt_text || ''
    const content = prompt
      ? `Reply to "${prompt}"\n\n${turnText.trim()}`
      : turnText.trim()

    const { error } = await supabase.rpc('submit_turn', {
      p_room_id: roomId,
      p_content: content,
    })

    if (error) {
      setError(error.message)
    } else {
      setTurnText('')
      // Notify next user about their turn
      notifyNextTurn()
    }
  }

  // Submit photo for photo-required prompts
  const submitPhotoTurn = async (file: File) => {
    if (!userId) return
    setError(null)
    setUploadingImage(true)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `chat/${roomId}/${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file)

      if (uploadError) throw new Error(uploadError.message)

      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(fileName)

      const imageUrl = urlData.publicUrl

      // Call the photo turn RPC
      const { error: turnError } = await supabase.rpc('submit_photo_turn', {
        p_room_id: roomId,
        p_image_url: imageUrl,
      })

      if (turnError) throw new Error(turnError.message)

      // Notify next user about their turn
      notifyNextTurn()
    } catch (err: unknown) {
      const error = err as Error
      setError(error.message || 'Failed to submit photo')
    } finally {
      setUploadingImage(false)
    }
  }

  // Check if current prompt requires a photo
  const isPhotoPrompt = turnSession?.current_prompt_type === 'photo'

  if (isLoading) return <LoadingState />

  // Show removal screen if user was removed from the room
  if (wasRemoved) {
    return (
      <div className="h-screen-safe bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">👋</div>
          <h2 className="text-xl font-semibold text-stone-800 mb-2">
            You&apos;ve been removed
          </h2>
          <p className="text-stone-500 mb-6">
            You were removed from this room due to inactivity. You can always join other rooms or create a new one.
          </p>
          <button
            onClick={() => router.push('/')}
            className="w-full bg-stone-800 text-white py-3 rounded-xl font-medium hover:bg-stone-700 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    )
  }

  // Determine chat mode for visual styling
  const isDM = roomInfo?.type === 'dm'

  // Get theme based on room mode (only for group chats)
  const theme = useMemo(() => {
    if (isDM) return getThemeForMode('fun') // DMs use default theme
    return getThemeForMode(roomInfo?.prompt_mode)
  }, [isDM, roomInfo?.prompt_mode])

  const isFlirtyTheme = theme.mode === 'flirty'

  return (
    <div
      className={`chat-theme-container h-screen-safe flex flex-col overflow-hidden max-w-full ${
        isDM
          ? 'bg-gradient-to-b from-stone-50 via-stone-50/95 to-stone-100/90'
          : theme.bgGradient
      } ${!isDM && theme.bgOverlay ? `theme-${theme.mode}` : ''}`}
      style={!isDM ? getThemeCSSVars(theme) : undefined}
    >
      {/* Group Details Drawer */}
      <GroupDetailsDrawer
        isOpen={showGroupDetails}
        onClose={() => setShowGroupDetails(false)}
        roomInfo={roomInfo}
        roomId={roomId}
        members={roomMembers}
        users={users}
        currentUserId={userId}
        roomFrequency={roomFrequency}
        onLeave={leaveRoom}
        onUpdateFrequency={updateRoomFrequency}
        onAddMember={addMemberByEmail}
        onGetInviteLink={getInviteLink}
        onUpdateRoomName={updateRoomName}
        onUpdatePromptMode={updateRoomPromptMode}
        onProfileClick={handleProfileClick}
      />

      {/* Profile Drawer */}
      <ProfileDrawer
        isOpen={selectedProfileUserId !== null}
        onClose={() => setSelectedProfileUserId(null)}
        user={selectedProfileUserId ? users.get(selectedProfileUserId) ?? null : null}
        currentUserId={userId}
        onStartDM={handleStartDM}
      />

      {/* Turn Pulse - Background dim overlay (only during pulse animation) */}
      <div
        className={`fixed inset-0 pointer-events-none z-20 transition-opacity duration-500 ease-out ${
          turnPulseActive ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ backgroundColor: isDM ? 'rgba(0, 0, 0, 0.06)' : theme.turnPulseBg }}
        aria-hidden="true"
      />

      {/* Header - glassy, floating feel */}
      <header className={`flex-shrink-0 sticky top-0 z-30 ${
        isDM
          ? 'bg-white/80 backdrop-blur-xl border-b border-stone-200/40'
          : isFlirtyTheme
            ? 'bg-slate-900/90 backdrop-blur-xl border-b border-slate-700/50'
            : 'bg-white/85 backdrop-blur-xl border-b border-slate-200/50'
      }`}>
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/rooms')}
              className={`p-2.5 -ml-2 rounded-xl transition-all duration-200 ${
                isDM
                  ? 'text-stone-400 hover:text-stone-700 hover:bg-stone-100/80 active:scale-95'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/80 active:scale-95'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              onClick={() => setShowGroupDetails(true)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 -mx-2 transition-all duration-200 ${
                isDM
                  ? 'hover:bg-stone-100/60 active:bg-stone-100'
                  : 'hover:bg-slate-100/60 active:bg-slate-100'
              }`}
            >
              {/* Avatar: DM shows larger avatar, group shows styled icon */}
              {isDM && dmDisplayInfo ? (
                <div className="relative">
                  {dmDisplayInfo.avatarUrl ? (
                    <img
                      src={dmDisplayInfo.avatarUrl}
                      alt={dmDisplayInfo.displayName}
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-white/80 shadow-sm"
                    />
                  ) : (
                    <div className={`w-10 h-10 rounded-full ${dmDisplayInfo.color} flex items-center justify-center ring-2 ring-white/80 shadow-sm`}>
                      <span className="text-sm font-semibold text-white">{dmDisplayInfo.initials}</span>
                    </div>
                  )}
                  {/* Online indicator - refined */}
                  {dmDisplayInfo.isOnline && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full border-[2.5px] border-white shadow-sm" />
                  )}
                </div>
              ) : (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-500 flex items-center justify-center shadow-sm shadow-indigo-500/20">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
              )}
              <div className="text-left">
                <h1 className={`text-[15px] font-semibold leading-tight flex items-center gap-1.5 ${
                  isDM ? 'text-stone-900' : 'text-slate-900'
                }`}>
                  {isDM && dmDisplayInfo ? dmDisplayInfo.displayName : (roomInfo?.name ?? 'Room')}
                  <svg className={`w-3.5 h-3.5 ${isDM ? 'text-stone-300' : 'text-slate-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </h1>
                <span className={`text-[12px] ${
                  isDM
                    ? dmDisplayInfo?.isOnline ? 'text-emerald-500 font-medium' : 'text-stone-400'
                    : 'text-slate-400'
                }`}>
                  {isDM && dmDisplayInfo
                    ? (dmDisplayInfo.isOnline ? 'Online now' : 'Offline')
                    : `${roomMembers.length} members${onlineUsers.size > 0 ? ` · ${onlineUsers.size} online` : ''}`}
                </span>
              </div>
            </button>
          </div>

          {/* Only show members button for groups */}
          {!isDM && (
            <MembersButton
              memberCount={roomMembers.length}
              onlineCount={onlineUsers.size}
              onClick={() => setShowGroupDetails(true)}
            />
          )}
        </div>

        {/* Turn status bar - refined, glassy design with theme support */}
        {gameActive && (
          <div className={`${
            isMyTurn && !isWaitingForCooldown
              ? isDM
                ? 'bg-gradient-to-r from-indigo-50/90 via-violet-50/80 to-purple-50/90 border-b border-indigo-200/40'
                : isFlirtyTheme
                  ? 'bg-gradient-to-r from-rose-950/40 via-pink-950/30 to-rose-950/40 border-b border-rose-800/30'
                  : theme.mode === 'family'
                    ? 'bg-gradient-to-r from-amber-50/90 via-orange-50/70 to-amber-50/90 border-b border-amber-200/40'
                    : theme.mode === 'deep'
                      ? 'bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-blue-50/90 border-b border-blue-200/40'
                      : theme.mode === 'couple'
                        ? 'bg-gradient-to-r from-pink-50/90 via-rose-50/70 to-pink-50/90 border-b border-pink-200/40'
                        : 'bg-gradient-to-r from-indigo-50/90 via-violet-50/80 to-purple-50/90 border-b border-indigo-200/40'
              : isDM
                ? 'bg-stone-50/80 border-b border-stone-200/40'
                : isFlirtyTheme
                  ? 'bg-slate-900/60 border-b border-slate-700/40'
                  : 'bg-slate-50/80 border-b border-slate-200/40'
          }`}>
            <div className="max-w-3xl mx-auto px-4 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {isMyTurn ? (
                    isWaitingForCooldown ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
                        <span className={`font-medium ${isFlirtyTheme ? 'text-amber-400' : 'text-amber-600'}`}>Your turn</span>
                        <span className={isDM ? 'text-stone-300' : isFlirtyTheme ? 'text-slate-500' : 'text-slate-300'}>·</span>
                        <span className={`text-xs ${isDM ? 'text-stone-400' : isFlirtyTheme ? 'text-slate-400' : 'text-slate-400'}`}>
                          available in {waitingUntil ? formatTimeRemaining(waitingUntil) : '...'}
                        </span>
                      </>
                    ) : (
                      <>
                        {/* Live indicator - uses theme accent color */}
                        <span className="relative flex h-2 w-2">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 motion-reduce:animate-none ${isDM ? 'bg-indigo-400' : theme.liveDotPulse}`}></span>
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${isDM ? 'bg-indigo-500 shadow-indigo-500/50' : theme.liveDotColor}`} style={{ boxShadow: isDM ? undefined : `0 1px 3px ${theme.accentGlow}` }}></span>
                        </span>
                        <span className={`font-semibold ${isDM ? 'text-indigo-600' : theme.accentText}`}>
                          Your turn {isPhotoPrompt ? '— photo required' : '— ready now'}
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <span className={`w-2 h-2 rounded-full ${isWaitingForCooldown ? (isDM ? 'bg-stone-300' : 'bg-slate-300') : 'bg-amber-400 animate-pulse shadow-sm shadow-amber-400/50'}`} />
                      <span className={isDM ? 'text-stone-600' : 'text-slate-600'}>
                        {isWaitingForCooldown ? (
                          <>
                            <span className="font-medium">{currentPlayerInfo?.displayName ?? 'Someone'}</span>&apos;s turn
                            <span className={isDM ? 'text-stone-400' : 'text-slate-400'}> · in {waitingUntil ? formatTimeRemaining(waitingUntil) : '...'}</span>
                          </>
                        ) : (
                          <>
                            Waiting for <span className="font-medium">{currentPlayerInfo?.displayName ?? 'Someone'}</span>
                          </>
                        )}
                      </span>
                      {!isWaitingForCooldown && myTurnPosition && myTurnPosition.position > 0 && (
                        <>
                          <span className={isDM ? 'text-stone-300' : 'text-slate-300'}>·</span>
                          <span className={`text-xs ${isDM ? 'text-stone-400' : 'text-slate-400'}`}>{myTurnPosition.label}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
                {/* Nudge button - refined */}
                {!isMyTurn && currentTurnUserId && (
                  <button
                    onClick={handleNudge}
                    disabled={hasNudgedThisTurn || nudgeLoading || isMyTurn}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                      hasNudgedThisTurn || nudgeLoading
                        ? (isDM ? 'bg-stone-100 text-stone-400' : 'bg-slate-100 text-slate-400') + ' cursor-not-allowed'
                        : 'bg-amber-100/80 text-amber-700 hover:bg-amber-200 active:scale-95 shadow-sm'
                    }`}
                  >
                    {nudgeLoading ? (
                      <div className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
                    ) : (
                      <span>👀</span>
                    )}
                    <span>{hasNudgedThisTurn ? 'Nudged' : 'Nudge'}</span>
                  </button>
                )}
              </div>
              {/* Nudge toast notification */}
              {nudgeToast && (
                <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${
                  nudgeToast.type === 'success' ? 'bg-emerald-100/80 text-emerald-700' : 'bg-red-100/80 text-red-700'
                }`}>
                  {nudgeToast.message}
                </div>
              )}
              {/* Nudge status */}
              {!isMyTurn && nudgeStatus && nudgeStatus.eligible_count > 0 && (
                <div className={`mt-1.5 text-xs ${isDM ? 'text-stone-400' : 'text-slate-400'}`}>
                  {nudgeStatus.all_nudged ? (
                    <span className="text-amber-600">All nudged — auto-skip in 24h if not completed</span>
                  ) : nudgeStatus.nudge_count > 0 ? (
                    <span>{nudgeStatus.nudge_count}/{nudgeStatus.eligible_count} nudged</span>
                  ) : null}
                </div>
              )}
              {/* Prompt display - refined */}
              <div className={`mt-2 text-sm truncate flex items-center gap-2 ${isDM ? 'text-stone-500' : 'text-slate-500'}`}>
                <span className="flex items-center gap-1.5">
                  {isMyTurn && !isWaitingForCooldown && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 motion-reduce:animate-none"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  )}
                  <span className={isDM ? 'text-stone-400' : 'text-slate-400'}>Prompt:</span>
                  <span className="font-medium">&ldquo;{turnSession?.prompt_text}&rdquo;</span>
                </span>
                {isPhotoPrompt && (
                  <span className="inline-flex items-center gap-1 text-xs bg-violet-100/80 text-violet-700 px-2 py-0.5 rounded-md font-medium">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    </svg>
                    Photo
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

      </header>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain relative">
        <div className={`max-w-3xl mx-auto py-4 ${isDM ? 'px-3' : 'px-4'}`}>
          {/* Error banner */}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}
          {isLoading ? (
            /* Skeleton loading state */
            <div className="space-y-3 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                  <div className={`flex gap-2 max-w-[75%] ${i % 2 === 0 ? '' : 'flex-row-reverse'}`}>
                    <div className="w-8 h-8 rounded-full bg-stone-200 dark:bg-stone-700 flex-shrink-0" />
                    <div className="space-y-1.5">
                      <div className={`h-4 bg-stone-200 dark:bg-stone-700 rounded-lg ${i % 3 === 0 ? 'w-48' : i % 3 === 1 ? 'w-32' : 'w-56'}`} />
                      <div className={`h-4 bg-stone-200 dark:bg-stone-700 rounded-lg ${i % 2 === 0 ? 'w-36' : 'w-24'}`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState gameActive={gameActive} isHost={isHost} />
          ) : (
            <>
              {/* Load older messages button */}
              {hasMoreMessages && (
                <div className="flex justify-center py-2 mb-2">
                  <button
                    onClick={loadOlderMessages}
                    disabled={loadingOlderMessages}
                    className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loadingOlderMessages ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
                        Loading...
                      </span>
                    ) : (
                      'Load older messages'
                    )}
                  </button>
                </div>
              )}
              {messages.map((m) => {
              // Use pre-computed metadata for performance
              const meta = messageMetadata.get(m.id)
              const groupPosition = meta?.groupPosition ?? 'single'
              const spacingClass = meta?.spacingClass ?? ''
              const isSeenBoundary = meta?.isSeenBoundary ?? false
              const currentSeenCount = seenCounts.get(m.id) ?? 0

              const replyTo = m.reply_to_message_id
                ? messages.find(msg => msg.id === m.reply_to_message_id)
                : null
              const replyToUser = replyTo?.user_id ? getUserInfo(replyTo.user_id) : null

              return (
                <div
                  key={m.id}
                  ref={(el) => { if (el) messageRefs.current.set(m.id, el) }}
                  className={`transition-colors duration-300 ${spacingClass}`}
                >
                  <MessageBubble
                    message={m}
                    isMe={Boolean(userId && m.user_id === userId)}
                    user={m.user_id ? getUserInfo(m.user_id) : null}
                    replyToMessage={replyTo}
                    replyToUser={replyToUser}
                    reactions={getReactionsForMessage(m.id)}
                    currentUserId={userId}
                    users={users}
                    onReply={handleReply}
                    onReact={handleReact}
                    onScrollToMessage={scrollToMessage}
                    onProfileClick={handleProfileClick}
                    groupPosition={groupPosition}
                    seenCount={currentSeenCount}
                    isSeenBoundary={isSeenBoundary}
                    onVisible={() => markMessageSeen(m.id)}
                  />
                </div>
              )
            })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* New messages pill - modern floating design */}
        {hasNewMessages && (
          <button
            onClick={() => scrollToBottom(true)}
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-5 py-2.5 text-white text-sm font-semibold rounded-full shadow-lg hover:shadow-xl transition-all active:scale-95 animate-in slide-in-from-bottom-2 duration-200 ${
              isDM
                ? 'bg-slate-800 hover:bg-slate-900'
                : isFlirtyTheme
                  ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 shadow-rose-500/25'
                  : theme.mode === 'family'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/25'
                    : theme.mode === 'deep'
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-blue-500/25'
                      : theme.mode === 'couple'
                        ? 'bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-pink-500/25'
                        : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 shadow-indigo-500/25'
            }`}
          >
            New messages
            <svg className="w-4 h-4 inline ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom panel: Chat input - floating, modern design */}
      <div className={`flex-shrink-0 pb-safe ${
        isDM
          ? 'bg-white/80 backdrop-blur-xl border-t border-stone-200/40'
          : isFlirtyTheme
            ? 'bg-slate-900/90 backdrop-blur-xl border-t border-slate-700/50'
            : 'bg-white/85 backdrop-blur-xl border-t border-slate-200/50'
      }`}>
        {/* Turn response input - only when it's your turn AND cooldown passed */}
        {gameActive && isMyTurn && !isWaitingForCooldown && (
          <div className={`border-b transition-all duration-500 ${
            isDM
              ? (isPhotoPrompt ? 'border-violet-100/60 bg-gradient-to-r from-violet-50/60 to-purple-50/60' : 'border-indigo-100/60 bg-gradient-to-r from-indigo-50/60 to-violet-50/60')
              : isFlirtyTheme
                ? 'border-rose-500/20 bg-gradient-to-r from-rose-950/40 to-pink-950/30'
                : `border-${theme.accentPrimary}/10 bg-gradient-to-r from-${theme.accentPrimary}/5 to-${theme.accentSecondary}/5`
          }`} style={!isDM && !isFlirtyTheme ? {
            borderColor: `rgb(var(--theme-accent-border, 99 102 241) / 0.1)`,
            background: `linear-gradient(to right, var(--theme-accent-glow), transparent)`
          } : undefined}>
            <div className="max-w-3xl mx-auto px-safe py-3">
              <div className="flex items-center gap-2 mb-2.5">
                {/* Live indicator dot - subtle opacity pulse, stays for entire turn */}
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className={`absolute inline-flex h-full w-full rounded-full ${isDM ? 'bg-red-500/40' : theme.liveDotPulse} animate-[pulse-opacity_2s_ease-in-out_infinite]`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isDM ? 'bg-red-500' : theme.liveDotColor}`}></span>
                </span>
                <span className={`text-xs font-semibold ${isDM ? (isPhotoPrompt ? 'text-violet-600' : 'text-indigo-600') : theme.accentText}`}>
                  Your turn {isPhotoPrompt && '— upload a photo'}
                </span>
                <span className={`text-xs ${isDM ? (isPhotoPrompt ? 'text-violet-400' : 'text-indigo-400') : theme.mutedText}`}>
                  · &ldquo;{turnSession?.prompt_text}&rdquo;
                </span>
              </div>

              {isPhotoPrompt ? (
                <div className="flex gap-2">
                  <input
                    ref={turnCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) submitPhotoTurn(file)
                      e.target.value = ''
                    }}
                  />
                  <input
                    ref={turnLibraryInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) submitPhotoTurn(file)
                      e.target.value = ''
                    }}
                  />
                  <PhotoActionSheet
                    isOpen={showTurnPhotoSheet}
                    onClose={() => setShowTurnPhotoSheet(false)}
                    onTakePhoto={() => turnCameraInputRef.current?.click()}
                    onChooseLibrary={() => turnLibraryInputRef.current?.click()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTurnPhotoSheet(true)}
                    disabled={uploadingImage}
                    className={`flex-1 flex items-center justify-center gap-2.5 py-3.5 backdrop-blur-sm rounded-xl ring-1 shadow-sm cursor-pointer transition-all duration-500 active:scale-[0.98] ${
                      isDM
                        ? `bg-white/90 hover:bg-violet-50/50 ${turnPulseActive ? 'ring-violet-400/80 shadow-violet-500/20 shadow-lg' : 'ring-violet-200/60'}`
                        : isFlirtyTheme
                          ? `bg-slate-800/80 hover:bg-slate-700/80 ${turnPulseActive ? `${theme.turnPulseRing} ${theme.turnPulseShadow} shadow-lg` : theme.ringColor}`
                          : `bg-white/90 hover:bg-white ${turnPulseActive ? `${theme.turnPulseRing} ${theme.turnPulseShadow} shadow-lg` : theme.ringColor}`
                    } ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    {uploadingImage ? (
                      <>
                        <div className={`w-5 h-5 border-2 rounded-full animate-spin ${
                          isDM ? 'border-violet-200 border-t-violet-600' : isFlirtyTheme ? 'border-rose-300/40 border-t-rose-400' : 'border-slate-200 border-t-slate-600'
                        }`} />
                        <span className={`text-sm font-semibold ${isDM ? 'text-violet-600' : theme.accentText}`}>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <svg className={`w-5 h-5 ${isDM ? 'text-violet-500' : isFlirtyTheme ? 'text-rose-400' : `text-${theme.accentPrimary}`}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className={`text-sm font-semibold ${isDM ? 'text-violet-600' : theme.accentText}`}>Take or Choose Photo</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className={`flex gap-2 backdrop-blur-sm rounded-xl p-1.5 ring-1 shadow-sm transition-all duration-500 ${
                  isDM
                    ? `bg-white/90 ${turnPulseActive ? 'ring-indigo-400/80 shadow-indigo-500/20 shadow-lg' : 'ring-indigo-200/60'}`
                    : isFlirtyTheme
                      ? `bg-slate-800/80 ${turnPulseActive ? `${theme.turnPulseRing} ${theme.turnPulseShadow} shadow-lg` : theme.ringColor}`
                      : `bg-white/90 ${turnPulseActive ? `${theme.turnPulseRing} ${theme.turnPulseShadow} shadow-lg` : theme.ringColor}`
                }`}>
                  <input
                    ref={turnInputRef}
                    value={turnText}
                    onChange={(e) => setTurnText(e.target.value)}
                    placeholder="Type your response..."
                    className={`flex-1 bg-transparent px-3 py-2.5 text-base focus:outline-none ${
                      isDM
                        ? 'placeholder:text-indigo-300'
                        : isFlirtyTheme
                          ? 'placeholder:text-rose-300/60 text-slate-100'
                          : 'placeholder:text-slate-400'
                    }`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        submitTurn()
                      }
                    }}
                    onFocus={handleInputFocus}
                  />
                  <button
                    onClick={submitTurn}
                    disabled={!turnText.trim()}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm ${
                      isDM
                        ? 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600'
                        : isFlirtyTheme
                          ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600'
                          : theme.mode === 'family'
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600'
                            : theme.mode === 'deep'
                              ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600'
                              : theme.mode === 'couple'
                                ? 'bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500'
                                : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600'
                    }`}
                  >
                    Submit
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reply preview - refined */}
        {replyingTo && (
          <div className={`border-b ${
            isDM
              ? 'border-stone-200/50 bg-stone-50/80'
              : isFlirtyTheme
                ? 'border-slate-700/50 bg-slate-800/80'
                : 'border-slate-200/50 bg-slate-50/80'
          }`}>
            <div className="max-w-3xl mx-auto px-safe py-2.5 flex items-center gap-3">
              <div className={`w-1 h-10 rounded-full ${
                isDM
                  ? 'bg-gradient-to-b from-indigo-400 to-violet-400'
                  : isFlirtyTheme
                    ? 'bg-gradient-to-b from-rose-400 to-pink-400'
                    : 'bg-gradient-to-b from-indigo-400 to-violet-400'
              }`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold ${isDM ? 'text-indigo-600' : theme.accentText}`}>
                  Replying to {replyingTo.user_id ? getUserInfo(replyingTo.user_id)?.displayName : 'message'}
                </div>
                <div className={`text-xs truncate ${
                  isDM
                    ? 'text-stone-500'
                    : isFlirtyTheme
                      ? 'text-slate-400'
                      : 'text-slate-500'
                }`}>
                  {replyingTo.type === 'image' ? '📷 Photo' : (() => {
                    if (replyingTo.type === 'turn_response') {
                      try {
                        const parsed = JSON.parse(replyingTo.content)
                        if (parsed.kind === 'photo_turn') return '📷 Photo Turn'
                      } catch { /* not JSON */ }
                    }
                    return replyingTo.content.slice(0, 50)
                  })()}
                </div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDM
                    ? 'text-stone-400 hover:text-stone-600 hover:bg-stone-100'
                    : isFlirtyTheme
                      ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Photo Action Sheet */}
        <PhotoActionSheet
          isOpen={showPhotoSheet}
          onClose={() => setShowPhotoSheet(false)}
          onTakePhoto={() => cameraInputRef.current?.click()}
          onChooseLibrary={() => imageInputRef.current?.click()}
        />

        {/* Chat input - floating pill design */}
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className={`flex gap-2 rounded-2xl p-1.5 shadow-sm ${
            isDM
              ? 'bg-stone-100/80 ring-1 ring-stone-200/50'
              : isFlirtyTheme
                ? 'bg-slate-800/80 ring-1 ring-slate-600/50'
                : 'bg-slate-100/80 ring-1 ring-slate-200/50'
          }`}>
            <button
              onClick={() => setShowPhotoSheet(true)}
              disabled={uploadingImage}
              className={`p-2.5 rounded-xl transition-all duration-200 disabled:opacity-50 ${
                isDM
                  ? 'text-stone-400 hover:text-stone-600 hover:bg-white/80 active:scale-95'
                  : isFlirtyTheme
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 active:scale-95'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-white/80 active:scale-95'
              }`}
              title="Attach photo"
              aria-label="Attach photo"
            >
              {uploadingImage ? (
                <div className={`w-5 h-5 border-2 rounded-full animate-spin ${
                  isDM ? 'border-stone-300 border-t-stone-600' : isFlirtyTheme ? 'border-slate-500 border-t-slate-300' : 'border-slate-300 border-t-slate-600'
                }`} />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              )}
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={sendImage}
              className="hidden"
              aria-hidden="true"
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={sendImage}
              className="hidden"
              aria-hidden="true"
            />

            <input
              ref={chatInputRef}
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Type a message..."
              className={`flex-1 min-w-0 bg-transparent px-3 py-2.5 text-base focus:outline-none ${
                isDM
                  ? 'placeholder:text-stone-400'
                  : isFlirtyTheme
                    ? 'placeholder:text-slate-500 text-slate-100'
                    : 'placeholder:text-slate-400'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendChat()
                }
              }}
              onFocus={handleInputFocus}
            />
            <button
              onClick={() => {
                hapticTick('light')
                sendChat()
              }}
              disabled={!chatText.trim()}
              aria-label="Send message"
              className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-white transition-all duration-200 active:scale-90 ${
                chatText.trim()
                  ? isDM
                    ? 'bg-gradient-to-br from-stone-700 to-stone-900 shadow-sm hover:shadow-md'
                    : isFlirtyTheme
                      ? 'bg-gradient-to-br from-rose-500 via-pink-500 to-rose-600 shadow-sm shadow-rose-500/25 hover:shadow-md hover:shadow-rose-500/30'
                      : 'bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-500 shadow-sm shadow-indigo-500/25 hover:shadow-md hover:shadow-indigo-500/30'
                  : isDM
                    ? 'bg-stone-300 cursor-not-allowed'
                    : isFlirtyTheme
                      ? 'bg-slate-600 cursor-not-allowed'
                      : 'bg-slate-300 cursor-not-allowed'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
