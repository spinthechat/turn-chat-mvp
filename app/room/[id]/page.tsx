'use client'

import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabaseClient'
import { usePushNotifications } from '@/lib/usePushNotifications'
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

// Emoji picker with smart positioning via portal
// Renders to document.body and positions itself relative to anchor element
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

  // Calculate position after mount
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

      // Viewport dimensions
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Safe area padding
      const padding = 12

      // Picker dimensions
      const pickerWidth = pickerRect.width
      const pickerHeight = pickerRect.height

      // Prefer positioning above the message
      // Check if there's enough space above
      const spaceAbove = anchorRect.top - padding
      const spaceBelow = viewportHeight - anchorRect.bottom - padding

      let top: number
      if (spaceAbove >= pickerHeight) {
        // Position above
        top = anchorRect.top - pickerHeight - 8
      } else if (spaceBelow >= pickerHeight) {
        // Position below
        top = anchorRect.bottom + 8
      } else {
        // Not enough space either way, position in center of viewport
        top = Math.max(padding, (viewportHeight - pickerHeight) / 2)
      }

      // Horizontal: center on anchor, but clamp to viewport
      let left = anchorRect.left + anchorRect.width / 2 - pickerWidth / 2

      // Clamp horizontal position
      const minLeft = padding
      const maxLeft = viewportWidth - pickerWidth - padding
      left = Math.max(minLeft, Math.min(maxLeft, left))

      // Clamp vertical position
      const minTop = padding
      const maxTop = viewportHeight - pickerHeight - padding
      top = Math.max(minTop, Math.min(maxTop, top))

      setPosition({ top, left })
    }

    calculatePosition()

    // Recalculate on resize
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

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const picker = pickerRef.current
      if (picker && !picker.contains(e.target as Node)) {
        onClose()
      }
    }

    // Delay adding listener to prevent immediate close
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
  prompt_interval_minutes: number
}

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
  showHostBadge = false
}: {
  user: UserInfo | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  showRing?: boolean
  showHostBadge?: boolean
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

  return (
    <div className={`relative flex-shrink-0 ${className}`}>
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
    </div>
  )
}

// Compact members button for header
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
      className="relative flex items-center justify-center w-10 h-10 rounded-full bg-stone-100 hover:bg-stone-200 transition-colors"
      title={`${memberCount} members${hasOnline ? `, ${onlineCount} online` : ''}`}
    >
      {/* Users icon */}
      <svg className="w-5 h-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>

      {/* Member count badge */}
      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-stone-700 text-white text-[10px] font-medium rounded-full px-1">
        {memberCount}
      </span>

      {/* Online indicator dot */}
      {hasOnline && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full ring-2 ring-white" />
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
  groupPosition = 'single',
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
  groupPosition?: MessageGroupPosition
}) {
  const [showActions, setShowActions] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showReactorsFor, setShowReactorsFor] = useState<string | null>(null)
  const [showLightbox, setShowLightbox] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)

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

  // System messages - compact
  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="bg-stone-100 text-stone-500 text-[11px] px-3 py-1 rounded-full">
          {message.content}
        </div>
      </div>
    )
  }

  // Quoted reply preview component
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
        className={`text-[11px] px-2 py-1 mb-1 rounded border-l-2 cursor-pointer ${
          isMe
            ? 'bg-white/10 border-white/40 text-white/70'
            : 'bg-stone-100 border-stone-300 text-stone-500'
        }`}
      >
        <div className="font-medium">{replyToUser?.displayName ?? 'Unknown'}</div>
        <div className="truncate">{previewText}</div>
      </div>
    )
  }

  // Reaction pills - attached to bottom of bubble (WhatsApp style)
  const ReactionPills = () => {
    const emojis = Object.entries(reactionData)
    if (emojis.length === 0) return null

    return (
      <div className={`absolute -bottom-3 ${isMe ? 'right-2' : 'left-2'} flex gap-0.5 z-10`}>
        {emojis.map(([emoji, { count, hasMyReaction, userIds }]) => (
          <div key={emoji} className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowReactorsFor(showReactorsFor === emoji ? null : emoji)
              }}
              className={`text-[11px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm transition-all ${
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
              setShowEmojiPicker(true)
              setShowActions(true)
            }}
            className="text-[11px] px-1.5 py-0.5 rounded-full bg-white ring-1 ring-stone-200 shadow-sm text-stone-400 hover:text-stone-600"
          >
            +
          </button>
        )}
      </div>
    )
  }

  // Action buttons (reply, react) - shown on click/tap
  const ActionButtons = () => {
    if (!showActions && !showEmojiPicker) return null

    return (
      <div className={`absolute top-0 ${isMe ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1'} flex gap-0.5 z-10`}>
        <button
          onClick={(e) => { e.stopPropagation(); onReply(message); setShowActions(false) }}
          className="p-1.5 rounded-full bg-white shadow-md ring-1 ring-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50"
          title="Reply"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker) }}
          className="p-1.5 rounded-full bg-white shadow-md ring-1 ring-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50"
          title="React"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
    )
  }

  // Handle click outside to close actions
  const handleMessageClick = () => {
    if (showReactorsFor) {
      setShowReactorsFor(null)
      return
    }
    if (showEmojiPicker) {
      setShowEmojiPicker(false)
      setShowActions(false)
    } else {
      setShowActions(!showActions)
    }
  }

  // Handle image tap - open lightbox
  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowLightbox(true)
  }

  // Image messages - compact (with grouping support)
  if (isImage) {
    return (
      <div className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative ${hasReactions ? 'mb-2' : ''}`}>
        {/* Avatar: visible only on last message in group, invisible spacer otherwise */}
        <div className={`flex-shrink-0 ${isMe ? 'ml-1.5' : 'mr-1.5'}`}>
          {isLastInGroup ? (
            <Avatar user={user} size="xs" className="mt-0.5" />
          ) : (
            <div className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col max-w-[70%]">
          {/* Name: visible only on first message in group */}
          {showMeta && !isMe && isFirstInGroup && (
            <span className={`text-[10px] font-medium mb-0.5 ${user?.textColor ?? 'text-stone-500'}`}>
              {user?.displayName ?? 'Unknown'}
            </span>
          )}
          <div ref={bubbleRef} className="relative" onClick={handleMessageClick}>
            <QuotedReply />
            <div
              className={`rounded-lg overflow-hidden cursor-pointer ${isMe ? '' : 'ring-1 ring-stone-200'}`}
              onClick={handleImageClick}
            >
              <img src={message.content} alt="Photo" className="max-w-full max-h-48 object-contain bg-stone-100" loading="lazy" />
            </div>
            <div className={`text-[10px] mt-0.5 ${isMe ? 'text-right text-stone-400' : 'text-stone-400'}`}>
              {formatTime(message.created_at)}
            </div>
            <ActionButtons />
            <ReactionPills />
          </div>
        </div>
        {showLightbox && (
          <PhotoLightbox
            imageUrl={message.content}
            onClose={() => setShowLightbox(false)}
          />
        )}
        {showEmojiPicker && (
          <EmojiPickerPortal
            anchorRef={bubbleRef}
            emojis={EMOJI_OPTIONS}
            onSelect={(emoji) => { onReact(message.id, emoji); setShowEmojiPicker(false); setShowActions(false) }}
            onClose={() => { setShowEmojiPicker(false); setShowActions(false) }}
          />
        )}
      </div>
    )
  }

  // Photo turn response - turn with image (distinct from regular image)
  if (isPhotoTurn && photoTurnData) {
    return (
      <div className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative ${hasReactions ? 'mb-2' : ''}`}>
        <div className={`w-0.5 rounded-full self-stretch ${isMe ? 'bg-indigo-500' : 'bg-indigo-300'} ${isMe ? 'ml-1.5' : 'mr-1.5'}`} />
        {/* Avatar: visible only on last message in group, invisible spacer otherwise */}
        <div className={`flex-shrink-0 ${isMe ? 'ml-1.5' : 'mr-1.5'}`}>
          {isLastInGroup ? (
            <Avatar user={user} size="xs" className="mt-0.5" />
          ) : (
            <div className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col max-w-[70%]">
          {/* Name: visible only on first message in group */}
          {showMeta && !isMe && isFirstInGroup && (
            <span className={`text-[10px] font-medium mb-0.5 ${user?.textColor ?? 'text-stone-500'}`}>
              {user?.displayName ?? 'Unknown'}
            </span>
          )}
          <div ref={bubbleRef} className="relative" onClick={handleMessageClick}>
            <QuotedReply />
            <div className={`rounded-lg overflow-hidden ${
              isMe
                ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white'
                : 'bg-white ring-1 ring-indigo-200 text-stone-900'
            }`}>
              <div className="px-2.5 pt-1.5 pb-1">
                <div className={`text-[9px] font-semibold uppercase tracking-wide mb-1 flex items-center gap-1 ${isMe ? 'text-white/70' : 'text-indigo-500'}`}>
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Photo Turn
                </div>
                {photoTurnData.prompt && (
                  <div className={`text-[11px] italic leading-snug ${isMe ? 'text-white/80' : 'text-indigo-600'}`}>
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
                  className="w-full max-h-48 object-cover"
                  loading="lazy"
                />
              </div>
              <div className={`text-[10px] px-2.5 py-1 ${isMe ? 'text-white/50' : 'text-stone-400'}`}>
                {formatTime(message.created_at)}
              </div>
            </div>
            <ActionButtons />
            <ReactionPills />
          </div>
        </div>
        {showLightbox && (
          <PhotoLightbox
            imageUrl={photoTurnData.imageUrl}
            onClose={() => setShowLightbox(false)}
          />
        )}
        {showEmojiPicker && (
          <EmojiPickerPortal
            anchorRef={bubbleRef}
            emojis={EMOJI_OPTIONS}
            onSelect={(emoji) => { onReact(message.id, emoji); setShowEmojiPicker(false); setShowActions(false) }}
            onClose={() => { setShowEmojiPicker(false); setShowActions(false) }}
          />
        )}
      </div>
    )
  }

  // Turn response - compact but distinct (with grouping support)
  if (isTurnResponse) {
    return (
      <div className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative ${hasReactions ? 'mb-2' : ''}`}>
        <div className={`w-0.5 rounded-full self-stretch ${isMe ? 'bg-indigo-500' : 'bg-indigo-300'} ${isMe ? 'ml-1.5' : 'mr-1.5'}`} />
        {/* Avatar: visible only on last message in group, invisible spacer otherwise */}
        <div className={`flex-shrink-0 ${isMe ? 'ml-1.5' : 'mr-1.5'}`}>
          {isLastInGroup ? (
            <Avatar user={user} size="xs" className="mt-0.5" />
          ) : (
            <div className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col max-w-[70%]">
          {/* Name: visible only on first message in group */}
          {showMeta && !isMe && isFirstInGroup && (
            <span className={`text-[10px] font-medium mb-0.5 ${user?.textColor ?? 'text-stone-500'}`}>
              {user?.displayName ?? 'Unknown'}
            </span>
          )}
          <div ref={bubbleRef} className="relative" onClick={handleMessageClick}>
            <QuotedReply />
            <div className={`rounded-lg px-2.5 py-1.5 cursor-pointer ${
              isMe
                ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white'
                : 'bg-white ring-1 ring-indigo-200 text-stone-900'
            }`}>
              <div className={`text-[9px] font-semibold uppercase tracking-wide mb-1 flex items-center gap-1 ${isMe ? 'text-white/70' : 'text-indigo-500'}`}>
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Turn
              </div>
              {hasTurnPrompt && (
                <div className={`text-[10px] mb-1 italic ${isMe ? 'text-white/60' : 'text-indigo-400'}`}>
                  {promptLine}
                </div>
              )}
              <div className="text-[13px] leading-snug whitespace-pre-wrap">{responseContent}</div>
              <div className={`text-[10px] mt-1 ${isMe ? 'text-white/50' : 'text-stone-400'}`}>
                {formatTime(message.created_at)}
              </div>
            </div>
            <ActionButtons />
            <ReactionPills />
          </div>
        </div>
        {showEmojiPicker && (
          <EmojiPickerPortal
            anchorRef={bubbleRef}
            emojis={EMOJI_OPTIONS}
            onSelect={(emoji) => { onReact(message.id, emoji); setShowEmojiPicker(false); setShowActions(false) }}
            onClose={() => { setShowEmojiPicker(false); setShowActions(false) }}
          />
        )}
      </div>
    )
  }

  // Regular chat message - compact WhatsApp style (with grouping support)
  // Border radius adjustments for stacked bubbles
  const getBubbleRadius = () => {
    if (!isGrouped) return 'rounded-lg'
    if (isMe) {
      // Right-aligned bubbles: adjust bottom-right corner
      if (groupPosition === 'first') return 'rounded-lg rounded-br-sm'
      if (groupPosition === 'middle') return 'rounded-lg rounded-r-sm'
      if (groupPosition === 'last') return 'rounded-lg rounded-tr-sm'
    } else {
      // Left-aligned bubbles: adjust bottom-left corner
      if (groupPosition === 'first') return 'rounded-lg rounded-bl-sm'
      if (groupPosition === 'middle') return 'rounded-lg rounded-l-sm'
      if (groupPosition === 'last') return 'rounded-lg rounded-tl-sm'
    }
    return 'rounded-lg'
  }

  return (
    <div className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} group relative ${hasReactions ? 'mb-2' : ''}`}>
      {/* Avatar: visible only on last message in group, invisible spacer otherwise */}
      <div className={`flex-shrink-0 ${isMe ? 'ml-1.5' : 'mr-1.5'}`}>
        {isLastInGroup ? (
          <Avatar user={user} size="xs" className="mt-0.5" />
        ) : (
          <div className="w-5 h-5" />
        )}
      </div>
      <div className="flex flex-col max-w-[75%]">
        {/* Name: visible only on first message in group */}
        {showMeta && !isMe && isFirstInGroup && (
          <span className={`text-[10px] font-medium mb-0.5 ${user?.textColor ?? 'text-stone-500'}`}>
            {user?.displayName ?? 'Unknown'}
          </span>
        )}
        <div ref={bubbleRef} className="relative" onClick={handleMessageClick}>
          <div className={`${getBubbleRadius()} px-2.5 py-1.5 cursor-pointer ${
            isMe
              ? 'bg-stone-800 text-white'
              : 'bg-white ring-1 ring-stone-200 text-stone-900'
          }`}>
            <QuotedReply />
            <div className="text-[13px] leading-snug whitespace-pre-wrap">{message.content}</div>
            <div className={`text-[10px] mt-0.5 ${isMe ? 'text-white/50 text-right' : 'text-stone-400'}`}>
              {formatTime(message.created_at)}
            </div>
          </div>
          <ActionButtons />
          <ReactionPills />
        </div>
      </div>
      {showEmojiPicker && (
        <EmojiPickerPortal
          anchorRef={bubbleRef}
          emojis={EMOJI_OPTIONS}
          onSelect={(emoji) => { onReact(message.id, emoji); setShowEmojiPicker(false); setShowActions(false) }}
          onClose={() => { setShowEmojiPicker(false); setShowActions(false) }}
        />
      )}
    </div>
  )
}

// Empty state
function EmptyState({ gameActive, isHost }: { gameActive: boolean, isHost: boolean }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <h3 className="text-stone-900 font-medium mb-1">No messages yet</h3>
      <p className="text-stone-500 text-sm max-w-xs mx-auto">
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

  const handleToggleNotifications = async () => {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      await subscribe()
    }
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
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-stone-50"
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
                  </div>
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
  const [chatText, setChatText] = useState('')
  const [turnText, setTurnText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [turnSession, setTurnSession] = useState<TurnSession | null>(null)

  const [users, setUsers] = useState<Map<string, UserInfo>>(new Map())
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([])
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [showGroupDetails, setShowGroupDetails] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const turnInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const chatInputRef = useRef<HTMLInputElement | null>(null)
  const hasInitiallyScrolled = useRef(false)

  // Scroll the messages container to bottom (not the window!)
  const scrollToBottom = useCallback((smooth = true) => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      })
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
      avatarUrl: null
    }
  }

  // Focus turn input when it becomes your turn
  useEffect(() => {
    if (isMyTurn && turnInputRef.current) {
      turnInputRef.current.focus()
    }
  }, [isMyTurn])

  useEffect(() => {
    let msgChannel: any = null
    let sessChannel: any = null
    let reactChannel: any = null
    let membersChannel: any = null
    let presenceChannel: any = null

    const boot = async () => {
      setError(null)
      setIsLoading(true)

      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        router.push('/login')
        return
      }

      const uid = authData.user.id
      const email = authData.user.email ?? ''
      setUserId(uid)

      // Fetch room info
      const { data: room } = await supabase
        .from('rooms')
        .select('id, name, prompt_interval_minutes')
        .eq('id', roomId)
        .single()

      if (room) setRoomInfo(room as RoomInfo)

      // Fetch room members
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id, role, prompt_interval_minutes')
        .eq('room_id', roomId)

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

      // Add current user
      // Fetch profiles with new fields
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, display_name, avatar_url')

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
          avatarUrl: myProfile?.avatar_url || null
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
                avatarUrl: profile.avatar_url || null
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
                avatarUrl: null
              })
            }
          }
        }
        return next
      })

      // Fetch session
      const { data: sess } = await supabase
        .from('turn_sessions')
        .select('*')
        .eq('room_id', roomId)
        .maybeSingle()

      if (sess && (sess as any).is_active) {
        setTurnSession(sess as TurnSession)
      } else {
        setTurnSession(null)
      }

      // Fetch messages
      const { data: msgs, error: msgsErr } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(200)

      if (msgsErr) {
        setError(msgsErr.message)
      } else {
        setMessages((msgs ?? []) as Msg[])

        // Fetch reactions for these messages
        const msgIds = (msgs ?? []).map(m => m.id)
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
                  .select('id, email, display_name, avatar_url')
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
                          avatarUrl: profile.avatar_url || null
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

      // Subscribe to room members changes (new members joining)
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
              .select('id, email, display_name, avatar_url')
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
                  avatarUrl: profile.avatar_url || null
                })
                return next
              })
            }

            // Update room members list
            setRoomMembers(prev => [...prev, newMember])
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

      const { error: msgError } = await supabase.from('messages').insert({
        room_id: roomId,
        user_id: userId,
        type: 'image',
        content: imageUrl,
      })

      if (msgError) {
        console.error('Message insert error:', JSON.stringify(msgError))
        throw new Error(msgError.message || msgError.details || msgError.hint || 'Failed to save message')
      }
    } catch (err: any) {
      console.error('Image upload error:', err)
      const errorMsg = err?.message || err?.details || err?.hint || 'Failed to upload image'
      setError(errorMsg)
    } finally {
      setUploadingImage(false)
      if (imageInputRef.current) {
        imageInputRef.current.value = ''
      }
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

  return (
    <div className="h-screen-safe bg-stone-50 flex flex-col overflow-hidden">
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
      />

      {/* Header - fixed at top */}
      <header className="bg-white flex-shrink-0">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between border-b border-stone-200/50">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/rooms')}
              className="p-2 -ml-2 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              onClick={() => setShowGroupDetails(true)}
              className="flex items-center gap-3 hover:bg-stone-50 rounded-lg px-2 py-1 -mx-2 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <div className="text-left">
                <h1 className="text-sm font-semibold text-stone-900 leading-tight flex items-center gap-1">
                  {roomInfo?.name ?? 'Room'}
                  <svg className="w-3 h-3 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </h1>
                <span className="text-[11px] text-stone-400">
                  {roomMembers.length} members
                </span>
              </div>
            </button>
          </div>

          <MembersButton
            memberCount={roomMembers.length}
            onlineCount={onlineUsers.size}
            onClick={() => setShowGroupDetails(true)}
          />
        </div>

        {/* Turn status bar - shows whose turn + the prompt for everyone */}
        {gameActive && (
          <div className="bg-stone-50 border-b border-stone-200/50">
            <div className="max-w-3xl mx-auto px-4 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {isMyTurn ? (
                    isWaitingForCooldown ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-amber-600 font-medium">Your turn</span>
                        <span className="text-stone-300">·</span>
                        <span className="text-stone-400 text-xs">
                          available in {waitingUntil ? formatTimeRemaining(waitingUntil) : '...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                        <span className="text-indigo-600 font-medium">
                          Your turn {isPhotoPrompt ? '— photo required' : '— ready now'}
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <span className={`w-2 h-2 rounded-full ${isWaitingForCooldown ? 'bg-stone-300' : 'bg-amber-400 animate-pulse'}`} />
                      <span className="text-stone-600">
                        {isWaitingForCooldown ? (
                          <>
                            <span className="font-medium">{currentPlayerInfo?.displayName ?? 'Someone'}</span>'s turn
                            <span className="text-stone-400"> · in {waitingUntil ? formatTimeRemaining(waitingUntil) : '...'}</span>
                          </>
                        ) : (
                          <>
                            Waiting for <span className="font-medium">{currentPlayerInfo?.displayName ?? 'Someone'}</span>
                          </>
                        )}
                      </span>
                      {!isWaitingForCooldown && myTurnPosition && myTurnPosition.position > 0 && (
                        <>
                          <span className="text-stone-300">·</span>
                          <span className="text-stone-400 text-xs">{myTurnPosition.label}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              {/* Show the prompt to all participants */}
              <div className="mt-1 text-sm text-stone-500 truncate flex items-center gap-2">
                <span className="flex items-center gap-1.5">
                  {/* Red "live" indicator - only shows when it's my turn and ready */}
                  {isMyTurn && !isWaitingForCooldown && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 motion-reduce:animate-none"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  )}
                  <span className="text-stone-400">Prompt:</span> "{turnSession?.prompt_text}"
                </span>
                {isPhotoPrompt && (
                  <span className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-3xl mx-auto px-3 py-3">
          {/* Error banner */}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}
          {messages.length === 0 ? (
            <EmptyState gameActive={gameActive} isHost={isHost} />
          ) : (
            messages.map((m, index) => {
              const replyTo = m.reply_to_message_id
                ? messages.find(msg => msg.id === m.reply_to_message_id)
                : null
              const replyToUser = replyTo?.user_id ? getUserInfo(replyTo.user_id) : null
              const groupPosition = getMessageGroupPosition(messages, index)

              // Spacing: first/single get full spacing, middle/last get reduced spacing for stacking
              const isFirstOrSingle = groupPosition === 'first' || groupPosition === 'single'
              const spacingClass = index === 0 ? '' : isFirstOrSingle ? 'mt-2' : 'mt-0.5'

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
                    groupPosition={groupPosition}
                  />
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Bottom panel: Chat input (always primary) */}
      <div className="bg-white border-t border-stone-200/50 flex-shrink-0 pb-safe">
        {/* Turn response input - only when it's your turn AND cooldown passed */}
        {gameActive && isMyTurn && !isWaitingForCooldown && (
          <div className={`border-b ${isPhotoPrompt ? 'border-violet-100 bg-violet-50/50' : 'border-indigo-100 bg-indigo-50/50'}`}>
            <div className="max-w-3xl mx-auto px-safe py-2">
              <div className="flex items-center gap-2 mb-2">
                {/* Red "live" indicator */}
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 motion-reduce:animate-none"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className={`text-xs font-medium ${isPhotoPrompt ? 'text-violet-600' : 'text-indigo-600'}`}>
                  Your turn {isPhotoPrompt && '— upload a photo'}
                </span>
                <span className={`text-xs ${isPhotoPrompt ? 'text-violet-400' : 'text-indigo-400'}`}>
                  · "{turnSession?.prompt_text}"
                </span>
              </div>

              {isPhotoPrompt ? (
                /* Photo prompt UI */
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    id="photo-turn-input"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) submitPhotoTurn(file)
                      e.target.value = ''
                    }}
                  />
                  <label
                    htmlFor="photo-turn-input"
                    className={`flex-1 flex items-center justify-center gap-2 py-3 bg-white rounded-lg ring-1 ring-violet-200 cursor-pointer hover:bg-violet-50 transition-colors ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    {uploadingImage ? (
                      <>
                        <div className="w-5 h-5 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                        <span className="text-sm font-medium text-violet-600">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-sm font-medium text-violet-600">Take or Choose Photo</span>
                      </>
                    )}
                  </label>
                </div>
              ) : (
                /* Text prompt UI */
                <div className="flex gap-2 bg-white rounded-lg p-1 ring-1 ring-indigo-200">
                  <input
                    ref={turnInputRef}
                    value={turnText}
                    onChange={(e) => setTurnText(e.target.value)}
                    placeholder="Type your response..."
                    className="flex-1 bg-transparent px-3 py-2 text-base placeholder:text-stone-400 focus:outline-none"
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
                    className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-600 transition-colors"
                  >
                    Submit
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reply preview */}
        {replyingTo && (
          <div className="border-b border-stone-200 bg-stone-50">
            <div className="max-w-3xl mx-auto px-safe py-2 flex items-center gap-2">
              <div className="w-1 h-8 bg-indigo-400 rounded-full" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-indigo-600">
                  Replying to {replyingTo.user_id ? getUserInfo(replyingTo.user_id)?.displayName : 'message'}
                </div>
                <div className="text-xs text-stone-500 truncate">
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
                className="p-1 text-stone-400 hover:text-stone-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Chat input (always available, always primary) */}
        <div className="max-w-3xl mx-auto px-safe py-3">
          <div className="flex gap-2 bg-stone-100 rounded-xl p-1.5">
            {/* Photo upload button */}
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              className="p-2.5 rounded-lg text-stone-500 hover:text-stone-700 hover:bg-stone-200 transition-colors disabled:opacity-50"
              title="Send photo"
            >
              {uploadingImage ? (
                <div className="w-5 h-5 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={sendImage}
              className="hidden"
            />

            <input
              ref={chatInputRef}
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-base placeholder:text-stone-400 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendChat()
                }
              }}
              onFocus={handleInputFocus}
            />
            <button
              onClick={sendChat}
              disabled={!chatText.trim()}
              className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-stone-900 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-800 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
