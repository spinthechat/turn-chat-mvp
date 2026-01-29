'use client'

import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import { usePushNotifications } from '@/lib/usePushNotifications'
import { hapticTick, clearTextSelection, clearTextSelectionAggressive, setGlobalNoSelect } from '@/lib/haptics'
import { getThemeForMode, isDarkTheme, getThemeCSSVars, type ChatTheme } from '@/lib/themes'
import { useParams, useRouter } from 'next/navigation'
import { GroupAvatarMosaic, type GroupMember } from '@/app/components/GroupAvatarMosaic'
import { StoryRing } from '@/app/components/StoryRing'
import { StoryViewer } from '@/app/components/stories/StoryViewer'
import { groupStoriesByUser, type Story, type StoryUser } from '@/app/components/stories/types'

// Local imports from extracted modules
import { useMobileViewport } from './hooks'
import { formatTimeRemaining, formatTime, getInitials, getDisplayName } from './utils/formatters'
import { stringToColors, getMessageGroupPosition } from './utils/colors'
import {
  Avatar,
  MembersButton,
  EmptyState,
  LoadingState,
  PhotoActionSheet,
  PhotoLightbox,
  ProfileDrawer,
  MessageSelectionOverlay,
  EmojiPickerPortal,
} from './components'
import type {
  Msg,
  Reaction,
  TurnSession,
  UserInfo,
  RoomMember,
  RoomInfo,
  MessageGroupPosition,
} from './types'
import { EMOJI_OPTIONS, FREQUENCY_OPTIONS, PROMPT_MODES } from './types'


// Vote info type
type VoteInfo = {
  score: number
  user_vote: 'up' | 'down' | null
}

// Message bubble component - compact WhatsApp-style
// Memoized to prevent re-renders when other messages update
const MessageBubble = memo(function MessageBubble({
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
  voteInfo,
  onVote,
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
  voteInfo?: VoteInfo
  onVote?: (messageId: string, voteType: 'up' | 'down') => void
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

  // Track if gesture resulted in action (to prevent tap-through to lightbox)
  const [gestureTriggered, setGestureTriggered] = useState(false)

  // Handle pointer down - start long press detection
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore if clicking on buttons or links (but allow images for gestures)
    if ((e.target as HTMLElement).closest('button, a')) return

    // Reset gesture triggered state
    setGestureTriggered(false)

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
        // Mark gesture as triggered to prevent lightbox opening on release
        setGestureTriggered(true)
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
      // Mark gesture as triggered to prevent lightbox opening
      setGestureTriggered(true)
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
  const isStoryReply = message.type === 'story_reply'

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

  // System messages - refined pill design
  if (isSystem) {
    return (
      <div className="flex justify-center py-3">
        <div className="system-message-pill flex items-center gap-1.5">
          <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {message.content}
        </div>
      </div>
    )
  }

  // Quoted reply preview component - refined design with image thumbnails
  const QuotedReply = () => {
    if (!replyToMessage) return null

    // Determine if reply is to an image
    let imageUrl: string | null = null
    let previewText: string

    if (replyToMessage.type === 'image') {
      imageUrl = replyToMessage.content
      previewText = 'Photo'
    } else if (replyToMessage.type === 'turn_response') {
      try {
        const parsed = JSON.parse(replyToMessage.content)
        if (parsed.kind === 'photo_turn' && parsed.image_url) {
          imageUrl = parsed.image_url
          previewText = 'Photo'
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
        className={`text-[11px] px-2.5 py-1.5 mb-2 rounded-lg border-l-[3px] cursor-pointer transition-colors flex items-center gap-2 ${
          isMe
            ? 'bg-white/15 border-white/50 text-white/80 hover:bg-white/20'
            : 'bg-slate-100/80 border-slate-400 text-slate-600 hover:bg-slate-100'
        }`}
      >
        {/* Image thumbnail */}
        {imageUrl && (
          <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden">
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{replyToUser?.displayName ?? 'Unknown'}</div>
          <div className="truncate opacity-80 flex items-center gap-1">
            {imageUrl && (
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
            {previewText}
          </div>
        </div>
      </div>
    )
  }

  // Story reply preview component - shows story thumbnail and author
  const StoryReplyPreview = () => {
    if (!isStoryReply || !message.story_snapshot) return null

    const snapshot = message.story_snapshot
    const isExpired = new Date(snapshot.expires_at) < new Date()

    return (
      <div
        className={`mb-2 rounded-xl overflow-hidden ${
          isMe ? 'bg-white/10' : 'bg-stone-100 dark:bg-stone-800'
        }`}
      >
        <div className="flex gap-2 p-2">
          {/* Story thumbnail */}
          <div className="flex-shrink-0 w-12 h-16 rounded-lg overflow-hidden relative">
            <img
              src={snapshot.image_url}
              alt=""
              className={`w-full h-full object-cover ${isExpired ? 'opacity-50' : ''}`}
              loading="lazy"
            />
            {isExpired && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className={`text-[10px] font-medium uppercase tracking-wide ${
              isMe ? 'text-white/60' : 'text-stone-400 dark:text-stone-500'
            }`}>
              Replied to story
            </div>
            <div className={`text-xs font-semibold truncate ${
              isMe ? 'text-white/90' : 'text-stone-700 dark:text-stone-300'
            }`}>
              {snapshot.author_name}
            </div>
            {snapshot.overlay_text && (
              <div className={`text-[11px] truncate mt-0.5 ${
                isMe ? 'text-white/70' : 'text-stone-500 dark:text-stone-400'
              }`}>
                &ldquo;{snapshot.overlay_text}&rdquo;
              </div>
            )}
            {isExpired && (
              <div className={`text-[10px] mt-0.5 ${
                isMe ? 'text-white/50' : 'text-stone-400'
              }`}>
                Story expired
              </div>
            )}
          </div>
        </div>
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
                  className={`inline-flex items-center gap-0.5 reaction-chip ${
                    hasMyReaction ? 'reaction-chip-active' : ''
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
                              <Image src={reactor.avatarUrl} alt="" width={20} height={20} className="w-5 h-5 rounded-full object-cover" />
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

  // Vote controls for turn responses (Reddit-style)
  const VoteControls = () => {
    if (!isTurnResponse || !onVote || !voteInfo || isMe) return null

    const { score, user_vote } = voteInfo

    const handleVote = (voteType: 'up' | 'down') => (e: React.MouseEvent) => {
      e.stopPropagation()
      hapticTick()
      onVote(message.id, voteType)
    }

    return (
      <div className="flex flex-col items-center gap-0.5 mr-1.5 select-none">
        <button
          onClick={handleVote('up')}
          className={`p-1 rounded transition-colors ${
            user_vote === 'up'
              ? 'text-indigo-500'
              : 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'
          }`}
          aria-label="Upvote"
        >
          <svg className="w-4 h-4" fill={user_vote === 'up' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <span className={`text-xs font-semibold tabular-nums ${
          score > 0 ? 'text-indigo-500' : score < 0 ? 'text-red-400' : 'text-stone-400'
        }`}>
          {score}
        </span>
        <button
          onClick={handleVote('down')}
          className={`p-1 rounded transition-colors ${
            user_vote === 'down'
              ? 'text-red-400'
              : 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'
          }`}
          aria-label="Downvote"
        >
          <svg className="w-4 h-4" fill={user_vote === 'down' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    )
  }

  // Handle image tap - open lightbox (but not if gesture was triggered)
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // Don't open lightbox if a gesture (swipe/long-press) just completed
    if (gestureTriggered) {
      setGestureTriggered(false)
      return
    }
    setShowLightbox(true)
  }, [gestureTriggered])

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
              <img
                src={message.content}
                alt="Photo"
                className="max-w-full max-h-52 object-contain bg-slate-100 select-none pointer-events-none"
                loading="lazy"
                draggable={false}
                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              />
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
                onClick={handleImageClick}
              >
                <img
                  src={photoTurnData.imageUrl}
                  alt="Photo turn response"
                  className="w-full max-h-52 object-cover select-none pointer-events-none"
                  loading="lazy"
                  draggable={false}
                  style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
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
        {/* Vote controls - only for others' messages */}
        {!isMe && <VoteControls />}
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
            <div className={`rounded-2xl px-4 py-3 cursor-pointer ${
              isMe
                ? 'turn-response-card text-white'
                : `turn-response-card-other ${showContextMenu ? 'border-transparent' : ''} text-slate-900`
            }`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${isMe ? 'text-white/90' : 'text-indigo-500'}`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Turn Response
              </div>
              {hasTurnPrompt && (
                <div className={`text-[12px] mb-2.5 italic leading-snug ${isMe ? 'text-white/75' : 'text-indigo-400'}`}>
                  {promptLine}
                </div>
              )}
              <span className="msg-text text-[15px] leading-[1.5] whitespace-pre-wrap block">{responseContent}</span>
              <div className={`msg-timestamp mt-2 ${isMe ? '' : ''}`}>
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
          <button
            onClick={(e) => { e.stopPropagation(); user && onProfileClick(user.id) }}
            className={`text-[12px] font-semibold mb-1.5 tracking-tight ${user?.textColor ?? 'text-slate-500'} hover:underline cursor-pointer text-left`}
          >
            {user?.displayName ?? 'Unknown'}
          </button>
        )}
        <div ref={bubbleRef} className={`relative transition-all duration-150 ${selectedBubbleClass}`} onClick={handleClick}>
          <div className={`${getBubbleRadius()} px-3.5 py-2.5 cursor-pointer ${
            isMe
              ? 'chat-bubble-mine'
              : `chat-bubble-other ${showContextMenu ? 'border-transparent' : ''}`
          }`}>
            <QuotedReply />
            <StoryReplyPreview />
            <span className="msg-text text-[15px] leading-[1.45] whitespace-pre-wrap block">{message.content}</span>
            <div className={`msg-timestamp mt-1.5 ${isMe ? 'text-right' : ''}`}>
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
})




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

  // Push notifications (for checking if user has enabled notifications)
  const {
    permission,
    isSubscribed,
    isSupported,
  } = usePushNotifications()

  // Message notification preferences
  const [messageNotifsEnabled, setMessageNotifsEnabled] = useState(true)
  const [messageNotifsLoading, setMessageNotifsLoading] = useState(false)

  // Top answers state
  const [topAnswers, setTopAnswers] = useState<{
    message_id: string
    user_id: string
    content: string
    created_at: string
    score: number
    user_email: string
    user_display_name: string | null
    user_avatar_url: string | null
  }[]>([])
  const [topAnswersLoading, setTopAnswersLoading] = useState(false)
  const [showTopAnswers, setShowTopAnswers] = useState(false)

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

  // Load top answers when section is expanded
  useEffect(() => {
    if (showTopAnswers && topAnswers.length === 0) {
      setTopAnswersLoading(true)
      supabase.rpc('get_top_answers', { p_room_id: roomId, p_min_score: 1, p_limit: 10 })
        .then(({ data, error }) => {
          if (error) {
            console.error('Failed to load top answers:', error)
          } else if (data) {
            setTopAnswers(data)
          }
          setTopAnswersLoading(false)
        })
    }
  }, [showTopAnswers, roomId, topAnswers.length])

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

  // Body scroll lock when drawer is open
  useEffect(() => {
    if (!isOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

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

  // Render via portal to escape chat-page stacking context
  const content = (
    <>
      {/* Backdrop - z-[200] to be above header (z-100) */}
      <div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[200] transition-opacity"
        onClick={onClose}
      />

      {/* Drawer - z-[201] to be above backdrop */}
      <div
        className="fixed inset-y-0 right-0 w-full max-w-sm bg-white dark:bg-stone-900 z-[201] shadow-xl flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-stone-200 dark:border-stone-700">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-50">Group Info</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-50 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Group name and ID */}
          <div className="p-4 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 dark:from-indigo-400 dark:to-violet-400 flex items-center justify-center">
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
                      className="w-full px-2 py-1 text-sm font-semibold bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent text-stone-900 dark:text-stone-50"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveName()
                        if (e.key === 'Escape') setEditingName(false)
                      }}
                    />
                    {nameError && (
                      <p className="text-xs text-red-500 dark:text-red-400">{nameError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveName}
                        disabled={savingName}
                        className="px-2 py-1 text-xs font-medium bg-indigo-500 dark:bg-indigo-600 text-white rounded hover:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {savingName ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingName(false)}
                        className="px-2 py-1 text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-stone-900 dark:text-stone-50 truncate">{roomInfo?.name ?? 'Room'}</h3>
                    <button
                      onClick={handleStartEditName}
                      className="p-1 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded"
                      title="Edit group name"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                )}
                <p className="text-sm text-stone-500 dark:text-stone-400">{members.length} members</p>
              </div>
            </div>
            <button
              onClick={handleCopyRoomId}
              className="w-full flex items-center justify-between px-3 py-2 bg-stone-50 dark:bg-stone-800 rounded-lg text-sm hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              <span className="text-stone-500 dark:text-stone-400">Room ID</span>
              <span className="flex items-center gap-2 font-mono text-stone-700 dark:text-stone-300">
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
            <div className="px-4 py-2 border-b border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50">
              <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Last active: {formatLastActive(roomInfo.last_active_at)}</span>
              </div>
            </div>
          )}

          {/* Prompt frequency setting - room-wide */}
          <div className="p-4 border-b border-stone-100 dark:border-stone-800">
            <h4 className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">Prompt Frequency</h4>
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">Time between prompts (applies to everyone)</p>
            <div className="space-y-1">
              {FREQUENCY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => onUpdateFrequency(option.value)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    roomFrequency === option.value
                      ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-700'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'
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
          <div className="p-4 border-b border-stone-100 dark:border-stone-800">
            <h4 className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">Prompt Mode</h4>
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">This changes the tone of future prompts for the group</p>
            <div className="space-y-1">
              {PROMPT_MODES.map(mode => (
                <button
                  key={mode.value}
                  onClick={() => onUpdatePromptMode(mode.value)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    roomInfo?.prompt_mode === mode.value
                      ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-700'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'
                  }`}
                >
                  <div className="text-left">
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-xs text-stone-400 dark:text-stone-500">{mode.description}</div>
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
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 px-1">
                Couple mode works best in 1:1 chats.
              </p>
            )}
          </div>

          {/* Top Answers */}
          <div className="border-b border-stone-100 dark:border-stone-800">
            <button
              onClick={() => setShowTopAnswers(!showTopAnswers)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
            >
              <div>
                <h4 className="text-sm font-medium text-stone-700 dark:text-stone-200">Top Answers</h4>
                <p className="text-xs text-stone-500 dark:text-stone-400">Best turn responses voted by members</p>
              </div>
              <svg
                className={`w-5 h-5 text-stone-400 transition-transform ${showTopAnswers ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showTopAnswers && (
              <div className="px-4 pb-4">
                {topAnswersLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="w-5 h-5 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
                  </div>
                ) : topAnswers.length === 0 ? (
                  <div className="text-center py-6">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                      <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
                      </svg>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">No top answers yet</p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Vote on turn responses to see them here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topAnswers.map((answer, index) => {
                      // Parse content to get prompt and response
                      let prompt = ''
                      let response = answer.content
                      let isPhoto = false
                      let photoUrl = ''

                      try {
                        const parsed = JSON.parse(answer.content)
                        if (parsed.kind === 'photo_turn') {
                          isPhoto = true
                          prompt = parsed.prompt
                          photoUrl = parsed.image_url
                        }
                      } catch {
                        if (answer.content.startsWith('Reply to "')) {
                          const parts = answer.content.split('\n\n')
                          prompt = parts[0].replace(/^Reply to "/, '').replace(/"$/, '')
                          response = parts.slice(1).join('\n\n')
                        }
                      }

                      const displayName = answer.user_display_name || answer.user_email?.split('@')[0] || 'Unknown'

                      return (
                        <div
                          key={answer.message_id}
                          className="bg-stone-50 dark:bg-stone-800 rounded-xl p-3"
                        >
                          <div className="flex items-start gap-2">
                            {/* Rank badge */}
                            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              index === 0 ? 'bg-amber-100 text-amber-700' :
                              index === 1 ? 'bg-stone-200 text-stone-600' :
                              index === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-stone-100 text-stone-500'
                            }`}>
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Prompt */}
                              {prompt && (
                                <p className="text-[11px] text-indigo-500 dark:text-indigo-400 italic mb-1 truncate">
                                  {prompt}
                                </p>
                              )}
                              {/* Content */}
                              {isPhoto ? (
                                <div className="w-16 h-16 rounded-lg overflow-hidden mb-2">
                                  <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                                </div>
                              ) : (
                                <p className="text-sm text-stone-700 dark:text-stone-200 line-clamp-2">
                                  {response}
                                </p>
                              )}
                              {/* Author and score */}
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-stone-500 dark:text-stone-400">
                                  {displayName}
                                </span>
                                <span className={`text-xs font-semibold ${answer.score > 0 ? 'text-indigo-500' : 'text-stone-400'}`}>
                                  +{answer.score}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Message Notifications */}
          {isSupported && permission !== 'denied' && isSubscribed && (
            <div className="p-4 border-b border-stone-100 dark:border-stone-800">
              <h4 className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">Message Notifications</h4>
              <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">Get notified when someone messages the group</p>
              <button
                onClick={handleToggleMessageNotifs}
                disabled={messageNotifsLoading}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  messageNotifsEnabled
                    ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-700'
                    : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'
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
          <div className="p-4 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-stone-700 dark:text-stone-200">Add Members</h4>
              {!showAddMember && (
                <button
                  onClick={() => setShowAddMember(true)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
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
                    <label className="text-xs text-stone-500 dark:text-stone-400 mb-1 block">Invite by email</label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="Enter email address"
                        className="flex-1 px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent text-stone-900 dark:text-stone-50 placeholder:text-stone-400 dark:placeholder:text-stone-500"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddMember()
                        }}
                      />
                      <button
                        onClick={handleAddMember}
                        disabled={addingMember || !emailInput.trim()}
                        className="px-3 py-2 text-sm font-medium bg-indigo-500 dark:bg-indigo-600 text-white rounded-lg hover:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingMember ? '...' : 'Invite'}
                      </button>
                    </div>
                    {addError && (
                      <p className="text-xs text-red-500 dark:text-red-400 mt-1">{addError}</p>
                    )}
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                      Works even if they haven't signed up yet
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-lg p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-emerald-500 dark:text-emerald-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">{addSuccess}</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Share the link below to invite them</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={emailInviteLink}
                        readOnly
                        className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-stone-800 border border-emerald-200 dark:border-emerald-700 rounded-lg text-stone-600 dark:text-stone-300 font-mono"
                      />
                      <button
                        onClick={handleCopyEmailInvite}
                        className="px-2 py-1.5 text-xs font-medium bg-white dark:bg-stone-800 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center gap-1"
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
                        className="flex-1 px-3 py-2 text-sm font-medium bg-emerald-600 dark:bg-emerald-700 text-white rounded-lg hover:bg-emerald-700 dark:hover:bg-emerald-600 flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Send via Email
                      </button>
                      <button
                        onClick={handleResetEmailInvite}
                        className="px-3 py-2 text-sm font-medium bg-white dark:bg-stone-800 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                      >
                        Invite Another
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                  <div className="flex-1 h-px bg-stone-200 dark:bg-stone-700" />
                  <span>or</span>
                  <div className="flex-1 h-px bg-stone-200 dark:bg-stone-700" />
                </div>

                {/* General invite link (open to anyone) */}
                <div>
                  <label className="text-xs text-stone-500 dark:text-stone-400 mb-1 block">Share open invite link</label>
                  {inviteLink ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inviteLink}
                        readOnly
                        className="flex-1 px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-600 dark:text-stone-300 font-mono text-xs"
                      />
                      <button
                        onClick={handleCopyInviteLink}
                        className="px-3 py-2 text-sm font-medium bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-600 flex items-center gap-1"
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
                      className="w-full px-3 py-2 text-sm font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50"
                    >
                      {loadingInvite ? 'Generating...' : 'Generate Open Link'}
                    </button>
                  )}
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
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
                  className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Members list */}
          <div className="p-4">
            <h4 className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-3">Members ({members.length})</h4>
            <div className="space-y-1">
              {sortedMembers.map(member => {
                const user = users.get(member.user_id)
                const isMe = member.user_id === currentUserId
                const isHost = member.role === 'host'

                return (
                  <button
                    key={member.user_id}
                    onClick={() => onProfileClick(member.user_id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors text-left"
                  >
                    {user?.avatarUrl ? (
                      <Image src={user.avatarUrl} alt="" width={36} height={36} className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className={`w-9 h-9 rounded-full ${user?.color ?? 'bg-stone-300'} flex items-center justify-center text-white text-sm font-medium`}>
                        {user?.initials ?? '??'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-900 dark:text-stone-50 truncate">
                          {user?.displayName ?? 'Unknown'}
                        </span>
                        {isMe && (
                          <span className="text-xs text-stone-400 dark:text-stone-500">(you)</span>
                        )}
                        {isHost && (
                          <span className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">Host</span>
                        )}
                      </div>
                      <div className="text-xs text-stone-400 dark:text-stone-500">
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
        <div className="p-4 border-t border-stone-200 dark:border-stone-700" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
          {showLeaveConfirm ? (
            <div className="space-y-2">
              <p className="text-sm text-stone-600 dark:text-stone-300 text-center">Are you sure you want to leave this group?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="flex-1 py-2 px-4 text-sm font-medium text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLeave}
                  disabled={leaving}
                  className="flex-1 py-2 px-4 text-sm font-medium text-white bg-red-500 dark:bg-red-600 rounded-lg hover:bg-red-600 dark:hover:bg-red-500 transition-colors disabled:opacity-50"
                >
                  {leaving ? 'Leaving...' : 'Leave Group'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="w-full py-2.5 px-4 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            >
              Leave Group
            </button>
          )}
        </div>
      </div>
    </>
  )

  // Render via portal at document.body to escape chat-page stacking context
  return createPortal(content, document.body)
}


export default function RoomPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const roomId = params.id

  // Set up mobile viewport height via CSS variables (--vvh, --vvo)
  useMobileViewport()

  const [userId, setUserId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [messages, setMessages] = useState<Msg[]>([])
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const INITIAL_MESSAGES = 20
  const PAGE_SIZE = 30

  // Vote state for turn responses
  const [votes, setVotes] = useState<Map<string, VoteInfo>>(new Map())

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
  const [activeStoryUserIds, setActiveStoryUserIds] = useState<Set<string>>(new Set())

  // Story viewer state
  const [storyViewerUsers, setStoryViewerUsers] = useState<StoryUser[]>([])
  const [storyViewerOpen, setStoryViewerOpen] = useState(false)
  const [storyViewerInitialIndex, setStoryViewerInitialIndex] = useState(0)

  // Derived state: any drawer/modal is open (hides chat input to prevent layering issues)
  const isAnyDrawerOpen = showGroupDetails || selectedProfileUserId !== null

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
        userId: otherMemberId,
        displayName: 'Direct Message',
        initials: 'DM',
        color: 'bg-stone-400',
        avatarUrl: null,
        isOnline: onlineUsers.has(otherMemberId)
      }
    }

    return {
      userId: otherMemberId,
      displayName: otherUser.displayName,
      initials: otherUser.initials,
      color: otherUser.color,
      avatarUrl: otherUser.avatarUrl,
      isOnline: onlineUsers.has(otherMemberId)
    }
  }, [roomInfo?.type, userId, roomMembers, users, onlineUsers])

  // For group rooms, compute members for the avatar mosaic (up to 4, excluding current user)
  const groupMosaicMembers = useMemo((): GroupMember[] => {
    if (roomInfo?.type === 'dm' || !userId) return []

    // Get up to 4 members excluding current user
    const otherMembers = roomMembers
      .filter(m => m.user_id !== userId)
      .slice(0, 4)
      .map(m => {
        const user = users.get(m.user_id)
        return {
          id: m.user_id,
          displayName: user?.displayName ?? 'Unknown',
          initials: user?.initials ?? '??',
          color: user?.color ?? 'bg-stone-400',
          avatarUrl: user?.avatarUrl ?? null
        }
      })

    // If alone in group, show own avatar
    if (otherMembers.length === 0) {
      const myUser = users.get(userId)
      if (myUser) {
        return [{
          id: userId,
          displayName: myUser.displayName,
          initials: myUser.initials,
          color: myUser.color,
          avatarUrl: myUser.avatarUrl
        }]
      }
    }

    return otherMembers
  }, [roomInfo?.type, userId, roomMembers, users])

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)
  const inputAreaRef = useRef<HTMLDivElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(64) // Default header height
  const [inputHeight, setInputHeight] = useState(60) // Default input height
  const turnInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const turnCameraInputRef = useRef<HTMLInputElement | null>(null)
  const turnLibraryInputRef = useRef<HTMLInputElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
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

  // Track previous input height to detect significant changes
  const prevInputHeightRef = useRef(inputHeight)

  // When input height changes significantly (e.g., turn prompt card appears),
  // scroll to keep the last message visible if user was near bottom
  useEffect(() => {
    const prevHeight = prevInputHeightRef.current
    const heightDelta = inputHeight - prevHeight
    prevInputHeightRef.current = inputHeight

    // Only adjust if height increased significantly (turn prompt appeared)
    // and user was near the bottom
    if (heightDelta > 30 && isNearBottomRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        scrollToBottom(false) // instant scroll to prevent jarring
      })
    }
  }, [inputHeight, scrollToBottom])

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

  // Determine chat mode for visual styling (must be before any early returns)
  const isDM = roomInfo?.type === 'dm'

  // Get theme based on room mode (only for group chats)
  const theme = useMemo(() => {
    if (isDM) return getThemeForMode('fun') // DMs use default theme
    return getThemeForMode(roomInfo?.prompt_mode)
  }, [isDM, roomInfo?.prompt_mode])

  const isFlirtyTheme = theme.mode === 'flirty'

  // Room-wide prompt frequency setting
  const roomFrequency = useMemo(() => {
    return roomInfo?.prompt_interval_minutes ?? 0
  }, [roomInfo?.prompt_interval_minutes])

  // For countdown timer - tick counter forces recomputation of isWaitingForCooldown
  const [tick, setTick] = useState(0)

  // Check if we're waiting for cooldown
  const waitingUntil = useMemo(() => {
    if (!turnSession?.waiting_until) return null
    return new Date(turnSession.waiting_until)
  }, [turnSession?.waiting_until])

  // CRITICAL: Include tick in dependencies so this recomputes as time passes
  // Without tick, the memo caches the result and never detects when cooldown ends
  const isWaitingForCooldown = useMemo(() => {
    if (!waitingUntil) return false
    return waitingUntil > new Date()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingUntil, tick])

  // Run interval whenever we have a waiting_until timestamp
  // This catches both when we're waiting AND when cooldown ends
  useEffect(() => {
    if (!waitingUntil) return
    // Check every minute (60s) to update countdown and detect cooldown end
    const interval = setInterval(() => setTick(t => t + 1), 60000)
    // Also check immediately on mount/change
    setTick(t => t + 1)
    return () => clearInterval(interval)
  }, [waitingUntil])

  // Dev-only debug logging for cooldown state
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (!turnSession?.waiting_until) return

    const now = new Date()
    const serverWaitingUntil = turnSession.waiting_until
    const parsedWaitingUntil = waitingUntil
    const remaining = parsedWaitingUntil ? parsedWaitingUntil.getTime() - now.getTime() : 0
    const remainingMins = Math.round(remaining / 60000)

    console.log('[Cooldown Debug]', {
      serverTimestamp: serverWaitingUntil,
      parsedDate: parsedWaitingUntil?.toISOString(),
      nowLocal: now.toISOString(),
      isWaiting: isWaitingForCooldown,
      remainingMs: remaining,
      remainingMins,
      tick,
      roomFrequency,
    })
  }, [turnSession?.waiting_until, waitingUntil, isWaitingForCooldown, tick, roomFrequency])

  // Measure header and input heights for fixed layout offsets
  // Uses ResizeObserver to continuously track changes (critical for turn prompt card)
  useLayoutEffect(() => {
    const updateHeights = () => {
      // Measure header (includes turn panel when visible)
      const hHeight = headerRef.current?.getBoundingClientRect().height ?? 64
      setHeaderHeight(hHeight)

      // Measure input area - CRITICAL: must include full height for scroll padding
      const iHeight = inputAreaRef.current?.getBoundingClientRect().height ?? 60
      setInputHeight(iHeight)
    }
    updateHeights()

    // ResizeObserver for continuous tracking of input area height changes
    // This catches: turn prompt card appearing/disappearing, reply preview, etc.
    let resizeObserver: ResizeObserver | null = null
    if (inputAreaRef.current) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
          if (newHeight > 0) {
            setInputHeight(newHeight)
          }
        }
      })
      resizeObserver.observe(inputAreaRef.current)
    }

    // Also observe header for turn banner changes
    let headerObserver: ResizeObserver | null = null
    if (headerRef.current) {
      headerObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
          if (newHeight > 0) {
            setHeaderHeight(newHeight)
          }
        }
      })
      headerObserver.observe(headerRef.current)
    }

    // Fallback: window resize and delayed check
    window.addEventListener('resize', updateHeights)
    const timer = setTimeout(updateHeights, 100)

    return () => {
      window.removeEventListener('resize', updateHeights)
      clearTimeout(timer)
      resizeObserver?.disconnect()
      headerObserver?.disconnect()
    }
  }, [gameActive, isMyTurn, isWaitingForCooldown])

  // Debug assertion - header must always be at top (dev mode only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && headerRef.current) {
      const checkHeader = () => {
        const rect = headerRef.current?.getBoundingClientRect()
        if (rect && rect.top !== 0) {
          console.error('❌ HEADER MOVED — THIS IS A BUG. header.top =', rect.top)
        }
      }
      checkHeader()
      window.addEventListener('resize', checkHeader)
      return () => window.removeEventListener('resize', checkHeader)
    }
  }, [])

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

  // Throttle ref for scroll handler - prevents excessive checks
  const scrollThrottleRef = useRef<NodeJS.Timeout | null>(null)
  const lastScrollCheckRef = useRef(0)

  // Handle scroll for infinite scroll up and tracking position
  // Throttled to run at most every 100ms for the "load older" check
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Check if near bottom (within 100px) - always run immediately for UI responsiveness
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    isNearBottomRef.current = isNearBottom

    // If user scrolled to bottom, clear "new messages" indicator
    if (isNearBottom) {
      setHasNewMessages(false)
    }

    // Throttle the "load older messages" check to every 100ms
    const now = Date.now()
    if (now - lastScrollCheckRef.current < 100) return
    lastScrollCheckRef.current = now

    // Check if near top (within 200px) - trigger loading older messages
    if (container.scrollTop < 200 && hasMoreMessages && !loadingOlderMessages) {
      loadOlderMessages()
    }
  }, [hasMoreMessages, loadingOlderMessages, loadOlderMessages])

  const handleNudge = async () => {
    // Debug logging for nudge
    if (process.env.NODE_ENV === 'development') {
      console.log('[Nudge] Clicked', {
        userId,
        currentTurnUserId,
        isMyTurn,
        hasNudgedThisTurn,
        nudgeLoading,
        gameActive,
      })
    }

    if (!userId || nudgeLoading || hasNudgedThisTurn || isMyTurn || !currentTurnUserId) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Nudge] Early return - condition failed', {
          noUserId: !userId,
          isLoading: nudgeLoading,
          alreadyNudged: hasNudgedThisTurn,
          isMyTurn,
          noCurrentTurn: !currentTurnUserId,
        })
      }
      return
    }

    setNudgeLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) {
        console.error('[Nudge] No access token')
        setNudgeToast({ message: 'Not logged in', type: 'error' })
        return
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[Nudge] Calling API with roomId:', roomId)
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

      if (process.env.NODE_ENV === 'development') {
        console.log('[Nudge] API response:', result)
      }

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
        console.error('[Nudge] API returned error:', result.error)
        setNudgeToast({ message: result.error || 'Failed to nudge', type: 'error' })
      }
    } catch (err) {
      console.error('[Nudge] Exception:', err)
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

      // Set messages FIRST so UI renders immediately (before profiles/reactions load)
      const sortedMsgs = (msgs ?? []).reverse() as Msg[]
      if (msgsResult.error) {
        setError(msgsResult.error.message)
      } else {
        setMessages(sortedMsgs)
        setHasMoreMessages((msgs?.length ?? 0) >= INITIAL_MESSAGES)
      }

      // Set session
      if (sess && (sess as any).is_active) {
        setTurnSession(sess as TurnSession)
      } else {
        setTurnSession(null)
      }

      // RENDER NOW - show messages immediately with skeleton avatars
      setIsLoading(false)

      // Fire-and-forget: update last seen on room open
      supabase.rpc('update_last_seen').then(() => {})

      if (process.env.NODE_ENV === 'development') {
        console.log('[room] first render in', Math.round(performance.now() - bootStart), 'ms, msgs:', sortedMsgs.length)
      }

      // HYDRATE: Fetch profiles, reactions, active stories, and effective follows in parallel (non-blocking)
      const memberIds = members?.map(m => m.user_id) ?? []
      const msgIds = sortedMsgs.map(m => m.id)

      // Get turn response message IDs for vote fetching
      const turnResponseIds = sortedMsgs.filter(m => m.type === 'turn_response').map(m => m.id)

      const [profilesResult, reactionsResult, storiesResult, effectiveFollowsResult, votesResult] = await Promise.all([
        memberIds.length > 0
          ? supabase.from('profiles').select('id, email, display_name, avatar_url, bio').in('id', memberIds)
          : Promise.resolve({ data: [] }),
        msgIds.length > 0
          ? supabase.from('message_reactions').select('*').in('message_id', msgIds)
          : Promise.resolve({ data: [] }),
        // Fetch active stories for room members (created within 24h)
        memberIds.length > 0
          ? supabase.from('stories').select('user_id').in('user_id', memberIds).gt('expires_at', new Date().toISOString())
          : Promise.resolve({ data: [] }),
        // Get effectively followed users (explicit + implicit, excluding overrides)
        memberIds.length > 0
          ? supabase.rpc('get_effective_following_ids', { p_target_ids: memberIds })
          : Promise.resolve({ data: [] }),
        // Fetch votes for turn responses
        turnResponseIds.length > 0
          ? supabase.rpc('get_messages_vote_info', { p_message_ids: turnResponseIds })
          : Promise.resolve({ data: [] })
      ])

      const profiles = profilesResult.data

      // Build set of effectively followed user IDs (includes implicit auto-follows)
      const followedUserIds = new Set<string>(
        (effectiveFollowsResult.data || []).map((f: { user_id: string }) => f.user_id)
      )
      followedUserIds.add(uid) // Always include self

      if (storiesResult.data) {
        const storyUserIds = new Set<string>(
          storiesResult.data
            .map((s: { user_id: string }) => s.user_id)
            .filter((id: string) => followedUserIds.has(id))
        )
        setActiveStoryUserIds(storyUserIds)
      }

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

      // Update reactions after hydration
      if (reactionsResult.data) {
        setReactions(reactionsResult.data as Reaction[])
      }

      // Update votes after hydration
      if (votesResult.data) {
        const votesMap = new Map<string, VoteInfo>()
        for (const v of votesResult.data as { message_id: string; score: number; user_vote: 'up' | 'down' | null }[]) {
          votesMap.set(v.message_id, { score: v.score, user_vote: v.user_vote })
        }
        setVotes(votesMap)
      }

      // Mark room as read (fire and forget)
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
      // Use multiple attempts to ensure scroll happens after layout is computed
      const scrollAttempt = () => {
        scrollToBottom(false) // instant scroll on initial load
      }

      // First attempt after short delay
      setTimeout(scrollAttempt, 50)
      // Second attempt after layout should be stable
      setTimeout(() => {
        scrollAttempt()
        hasInitiallyScrolled.current = true
      }, 150)
    }
  }, [isLoading, messages.length, scrollToBottom])

  // Scroll to bottom when new messages arrive (realtime updates)
  useEffect(() => {
    // Skip if we haven't done initial scroll yet, or no messages
    if (!hasInitiallyScrolled.current || messages.length === 0) return

    // Only auto-scroll if user is near the bottom
    if (isNearBottom()) {
      // Use scrollToBottom for consistent behavior
      // Small delay to ensure DOM has updated with new message
      requestAnimationFrame(() => {
        scrollToBottom(true)
      })
    }
  }, [messages.length, scrollToBottom])

  // Auto-resize textarea to content (up to max 4 lines ~96px)
  const autoResizeTextarea = useCallback(() => {
    const textarea = chatInputRef.current
    if (!textarea) return
    // Reset to single line to measure content
    textarea.style.height = 'auto'
    // Calculate new height (max ~4 lines at 24px line-height = 96px)
    const maxHeight = 96
    const newHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${newHeight}px`
  }, [])

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
    // Reset textarea height to single line
    if (chatInputRef.current) {
      chatInputRef.current.style.height = 'auto'
    }

    // Scroll to show the new message immediately
    requestAnimationFrame(() => {
      scrollToBottom(true)
    })

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

      // Fire-and-forget: update last seen
      supabase.rpc('update_last_seen').then(() => {})
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

  const handleVote = useCallback(async (messageId: string, voteType: 'up' | 'down') => {
    if (!userId) return

    // Optimistic update
    setVotes(prev => {
      const next = new Map(prev)
      const current = next.get(messageId) || { score: 0, user_vote: null }
      let newScore = current.score
      let newVote: 'up' | 'down' | null = voteType

      if (current.user_vote === voteType) {
        // Toggle off
        newScore += voteType === 'up' ? -1 : 1
        newVote = null
      } else if (current.user_vote === null) {
        // New vote
        newScore += voteType === 'up' ? 1 : -1
      } else {
        // Switch vote
        newScore += voteType === 'up' ? 2 : -2
      }

      next.set(messageId, { score: Math.max(-99, newScore), user_vote: newVote })
      return next
    })

    try {
      const { data, error } = await supabase.rpc('vote_on_message', {
        p_message_id: messageId,
        p_vote_type: voteType,
      })

      if (error) {
        console.error('Vote error:', error)
        // Revert optimistic update on error
        const { data: refreshData } = await supabase.rpc('get_message_vote_info', { p_message_id: messageId })
        if (refreshData) {
          setVotes(prev => {
            const next = new Map(prev)
            next.set(messageId, refreshData as VoteInfo)
            return next
          })
        }
      } else if (data) {
        // Update with server response
        setVotes(prev => {
          const next = new Map(prev)
          next.set(messageId, data as VoteInfo)
          return next
        })
      }
    } catch (err) {
      console.error('Vote failed:', err)
    }
  }, [userId])

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

  // Handle viewing a user's story from profile drawer
  const handleViewStory = useCallback(async (targetUserId: string) => {
    if (!userId) return

    if (process.env.NODE_ENV === 'development') {
      console.log('[Story] Opening story for user:', targetUserId)
    }

    try {
      // Fetch stories from that user
      const { data, error } = await supabase.rpc('get_stories_feed', {
        for_user_id: userId,
      })

      if (error) {
        console.error('[Story] Failed to fetch stories:', error)
        return
      }

      const stories = (data || []) as Story[]
      const storyUsers = groupStoriesByUser(stories)

      // Find the index of the target user
      const userIndex = storyUsers.findIndex(u => u.user_id === targetUserId)

      if (userIndex === -1) {
        console.error('[Story] User has no active stories')
        return
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[Story] Found user at index:', userIndex, 'stories:', storyUsers[userIndex].stories.length)
      }

      setStoryViewerUsers(storyUsers)
      setStoryViewerInitialIndex(userIndex)
      setStoryViewerOpen(true)
    } catch (err) {
      console.error('[Story] Error opening story viewer:', err)
    }
  }, [userId])

  // Handle story viewed - mark as seen
  const handleStoryViewed = useCallback((storyId: string) => {
    // Update local state to mark as viewed
    setStoryViewerUsers(prev => prev.map(user => ({
      ...user,
      stories: user.stories.map(s =>
        s.story_id === storyId ? { ...s, is_viewed: true } : s
      ),
      has_unseen: user.stories.some(s =>
        s.story_id !== storyId && !s.is_viewed
      ),
    })))
  }, [])

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

        // Fire-and-forget: update last seen
        supabase.rpc('update_last_seen').then(() => {})
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
      // Fire-and-forget: update last seen
      supabase.rpc('update_last_seen').then(() => {})
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
      // Fire-and-forget: update last seen
      supabase.rpc('update_last_seen').then(() => {})
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

  return (
    <div
      className={`chat-page chat-theme-container ${
        isDM
          ? 'bg-stone-50 dark:bg-stone-900'
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
        onFollowChange={(userId, isFollowing) => {
          // Update activeStoryUserIds when follow status changes
          setActiveStoryUserIds(prev => {
            const next = new Set(prev)
            if (!isFollowing) {
              next.delete(userId)
            }
            return next
          })
        }}
        hasActiveStory={selectedProfileUserId ? activeStoryUserIds.has(selectedProfileUserId) : false}
        onViewStory={handleViewStory}
      />

      {/* Story Viewer */}
      {storyViewerOpen && storyViewerUsers.length > 0 && userId && (
        <StoryViewer
          users={storyViewerUsers}
          initialUserIndex={storyViewerInitialIndex}
          currentUserId={userId}
          onClose={() => setStoryViewerOpen(false)}
          onStoryViewed={handleStoryViewed}
          onNavigateToRoom={(roomId) => router.push(`/room/${roomId}`)}
        />
      )}

      {/* Turn Pulse - Background dim overlay (only during pulse animation) */}
      <div
        className={`fixed inset-0 pointer-events-none z-20 transition-opacity duration-500 ease-out ${
          turnPulseActive ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ backgroundColor: isDM ? 'rgba(0, 0, 0, 0.06)' : theme.turnPulseBg }}
        aria-hidden="true"
      />

      {/* Header - flex item at top, does not scroll */}
      <header ref={headerRef} className={`chat-header ${
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
                <StoryRing active={activeStoryUserIds.has(dmDisplayInfo.userId)} size="sm">
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
                </StoryRing>
              ) : (
                <StoryRing active={groupMosaicMembers.some(m => activeStoryUserIds.has(m.id))} size="sm">
                  <GroupAvatarMosaic members={groupMosaicMembers} size="sm" />
                </StoryRing>
              )}
              <div className="text-left">
                <h1 className={`chat-header-title flex items-center gap-1.5 ${
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

      {/* Messages scroller - the ONLY scrollable area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="chat-messages-scroller"
        style={{
          paddingTop: headerHeight,
          // Input height already includes safe-area-inset-bottom (from .chat-input-area CSS)
          // Add buffer for visual spacing to ensure last message is visible above input
          paddingBottom: inputHeight + 16
        }}
      >
        <div className="chat-messages">
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
                    voteInfo={m.type === 'turn_response' ? votes.get(m.id) : undefined}
                    onVote={m.type === 'turn_response' ? handleVote : undefined}
                  />
                </div>
              )
            })}
            </>
          )}
          {/* Scroll anchor - ensures last message is never clipped */}
          <div ref={bottomRef} className="h-1" aria-hidden="true" />
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
        </div>

      {/* Bottom panel: Chat input - docked at bottom, hidden when drawers are open */}
      {!isAnyDrawerOpen && (
      <div ref={inputAreaRef} className={`chat-input-area ${
        isDM
          ? 'bg-white/80 backdrop-blur-xl border-t border-stone-200/40'
          : isFlirtyTheme
            ? 'bg-slate-900/90 backdrop-blur-xl border-t border-slate-700/50'
            : 'bg-white/85 backdrop-blur-xl border-t border-slate-200/50'
      }`}>
        {/* TURN ANSWER PANEL - Completely distinct from chat input */}
        {gameActive && isMyTurn && !isWaitingForCooldown && (
          <div className="px-3 pt-4 pb-3">
            <div className={`rounded-3xl shadow-xl transition-all duration-300 overflow-hidden animate-turn-panel-enter animate-turn-glow ${
              isDM
                ? (isPhotoPrompt
                    ? 'bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/50 dark:to-purple-950/50 ring-1 ring-violet-200/80 dark:ring-violet-700/50 shadow-violet-200/50 dark:shadow-violet-900/30'
                    : 'bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/50 dark:to-violet-950/50 ring-1 ring-indigo-200/80 dark:ring-indigo-700/50 shadow-indigo-200/50 dark:shadow-indigo-900/30')
                : isFlirtyTheme
                  ? 'bg-gradient-to-br from-rose-950/60 to-pink-950/50 ring-1 ring-rose-500/40 shadow-rose-500/20'
                  : theme.mode === 'family'
                    ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/50 dark:to-orange-950/50 ring-1 ring-amber-200/80 dark:ring-amber-700/50 shadow-amber-200/50'
                    : theme.mode === 'deep'
                      ? 'bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50 ring-1 ring-blue-200/80 dark:ring-blue-700/50 shadow-blue-200/50'
                      : theme.mode === 'couple'
                        ? 'bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-950/50 dark:to-rose-950/50 ring-1 ring-pink-200/80 dark:ring-pink-700/50 shadow-pink-200/50'
                        : 'bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/50 dark:to-violet-950/50 ring-1 ring-indigo-200/80 dark:ring-indigo-700/50 shadow-indigo-200/50'
            }`}>
              {/* Card Header */}
              <div className={`px-4 py-2.5 flex items-center gap-2 border-b ${
                isDM
                  ? (isPhotoPrompt ? 'border-violet-200/60 dark:border-violet-700/40' : 'border-indigo-200/60 dark:border-indigo-700/40')
                  : isFlirtyTheme
                    ? 'border-rose-500/30'
                    : theme.mode === 'family'
                      ? 'border-amber-200/60 dark:border-amber-700/40'
                      : theme.mode === 'deep'
                        ? 'border-blue-200/60 dark:border-blue-700/40'
                        : theme.mode === 'couple'
                          ? 'border-pink-200/60 dark:border-pink-700/40'
                          : 'border-indigo-200/60 dark:border-indigo-700/40'
              }`}>
                {/* Live indicator */}
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className={`absolute inline-flex h-full w-full rounded-full ${isDM ? 'bg-emerald-500/40' : theme.liveDotPulse} animate-[pulse-opacity_2s_ease-in-out_infinite]`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isDM ? 'bg-emerald-500' : theme.liveDotColor}`}></span>
                </span>
                <span className={`text-sm font-bold tracking-tight ${
                  isDM
                    ? (isPhotoPrompt ? 'text-violet-700 dark:text-violet-300' : 'text-indigo-700 dark:text-indigo-300')
                    : isFlirtyTheme
                      ? 'text-rose-300'
                      : theme.mode === 'family'
                        ? 'text-amber-700 dark:text-amber-300'
                        : theme.mode === 'deep'
                          ? 'text-blue-700 dark:text-blue-300'
                          : theme.mode === 'couple'
                            ? 'text-pink-700 dark:text-pink-300'
                            : 'text-indigo-700 dark:text-indigo-300'
                }`}>
                  Your turn to answer
                </span>
                {isPhotoPrompt && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    isDM
                      ? 'bg-violet-200/60 text-violet-700 dark:bg-violet-800/50 dark:text-violet-300'
                      : isFlirtyTheme
                        ? 'bg-rose-500/30 text-rose-300'
                        : 'bg-violet-200/60 text-violet-700 dark:bg-violet-800/50 dark:text-violet-300'
                  }`}>
                    Photo
                  </span>
                )}
              </div>

              {/* Prompt Question - displayed prominently */}
              <div className={`px-4 py-3 ${
                isDM
                  ? (isPhotoPrompt ? 'bg-violet-100/40 dark:bg-violet-900/30' : 'bg-indigo-100/40 dark:bg-indigo-900/30')
                  : isFlirtyTheme
                    ? 'bg-rose-900/30'
                    : theme.mode === 'family'
                      ? 'bg-amber-100/40 dark:bg-amber-900/30'
                      : theme.mode === 'deep'
                        ? 'bg-blue-100/40 dark:bg-blue-900/30'
                        : theme.mode === 'couple'
                          ? 'bg-pink-100/40 dark:bg-pink-900/30'
                          : 'bg-indigo-100/40 dark:bg-indigo-900/30'
              }`}>
                <p className={`text-base font-medium leading-relaxed ${
                  isDM
                    ? 'text-stone-800 dark:text-stone-100'
                    : isFlirtyTheme
                      ? 'text-slate-100'
                      : 'text-stone-800 dark:text-stone-100'
                }`}>
                  &ldquo;{turnSession?.prompt_text}&rdquo;
                </p>
              </div>

              {/* Input Area */}
              <div className="p-3">
                {isPhotoPrompt ? (
                  <>
                    <input
                      ref={turnCameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      tabIndex={-1}
                      aria-hidden="true"
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
                      tabIndex={-1}
                      aria-hidden="true"
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
                      className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-semibold text-white transition-all active:scale-[0.98] shadow-md ${
                        isDM
                          ? 'bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 shadow-violet-500/25'
                          : isFlirtyTheme
                            ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 shadow-rose-500/25'
                            : theme.mode === 'family'
                              ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/25'
                              : theme.mode === 'deep'
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-blue-500/25'
                                : theme.mode === 'couple'
                                  ? 'bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-pink-500/25'
                                  : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 shadow-indigo-500/25'
                      } ${uploadingImage ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      {uploadingImage ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Uploading Photo...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span>Upload Your Photo</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <div className="space-y-2.5">
                    <input
                      ref={turnInputRef}
                      value={turnText}
                      onChange={(e) => setTurnText(e.target.value)}
                      placeholder="Type your answer here..."
                      inputMode="text"
                      enterKeyHint="send"
                      autoCorrect="on"
                      autoCapitalize="sentences"
                      spellCheck={true}
                      className={`w-full px-4 py-3.5 text-base rounded-xl focus:outline-none transition-all ${
                        isDM
                          ? 'bg-white dark:bg-stone-900 ring-1 ring-indigo-200 dark:ring-indigo-700 focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500 placeholder:text-stone-400 dark:placeholder:text-stone-500'
                          : isFlirtyTheme
                            ? 'bg-slate-800/80 ring-1 ring-rose-500/40 focus:ring-2 focus:ring-rose-400 placeholder:text-slate-500 text-slate-100'
                            : theme.mode === 'family'
                              ? 'bg-white dark:bg-stone-900 ring-1 ring-amber-200 dark:ring-amber-700 focus:ring-2 focus:ring-amber-400 placeholder:text-stone-400'
                              : theme.mode === 'deep'
                                ? 'bg-white dark:bg-stone-900 ring-1 ring-blue-200 dark:ring-blue-700 focus:ring-2 focus:ring-blue-400 placeholder:text-stone-400'
                                : theme.mode === 'couple'
                                  ? 'bg-white dark:bg-stone-900 ring-1 ring-pink-200 dark:ring-pink-700 focus:ring-2 focus:ring-pink-400 placeholder:text-stone-400'
                                  : 'bg-white dark:bg-stone-900 ring-1 ring-indigo-200 dark:ring-indigo-700 focus:ring-2 focus:ring-indigo-400 placeholder:text-stone-400'
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
                      className={`w-full py-4 font-bold rounded-2xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2.5 text-base ${
                        isDM
                          ? 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 shadow-indigo-500/30'
                          : isFlirtyTheme
                            ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 shadow-rose-500/30'
                            : theme.mode === 'family'
                              ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/30'
                              : theme.mode === 'deep'
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-blue-500/30'
                                : theme.mode === 'couple'
                                  ? 'bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-pink-500/30'
                                  : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 shadow-indigo-500/30'
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Submit Answer
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Reply preview - refined with image thumbnails */}
        {replyingTo && (() => {
          // Determine if replying to an image
          let replyImageUrl: string | null = null
          let replyPreviewText: string
          if (replyingTo.type === 'image') {
            replyImageUrl = replyingTo.content
            replyPreviewText = 'Photo'
          } else if (replyingTo.type === 'turn_response') {
            try {
              const parsed = JSON.parse(replyingTo.content)
              if (parsed.kind === 'photo_turn' && parsed.image_url) {
                replyImageUrl = parsed.image_url
                replyPreviewText = 'Photo'
              } else {
                replyPreviewText = replyingTo.content.slice(0, 50)
              }
            } catch {
              replyPreviewText = replyingTo.content.slice(0, 50)
            }
          } else {
            replyPreviewText = replyingTo.content.slice(0, 50)
          }

          return (
            <div className={`border-b ${
              isDM
                ? 'border-stone-200/50 bg-stone-50/80'
                : isFlirtyTheme
                  ? 'border-slate-700/50 bg-slate-800/80'
                  : 'border-slate-200/50 bg-slate-50/80'
            }`}>
              <div className="max-w-3xl mx-auto px-safe py-2.5 flex items-center gap-3">
                <div className={`w-1 ${replyImageUrl ? 'h-12' : 'h-10'} rounded-full ${
                  isDM
                    ? 'bg-gradient-to-b from-indigo-400 to-violet-400'
                    : isFlirtyTheme
                      ? 'bg-gradient-to-b from-rose-400 to-pink-400'
                      : 'bg-gradient-to-b from-indigo-400 to-violet-400'
                }`} />
                {/* Image thumbnail */}
                {replyImageUrl && (
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden">
                    <img
                      src={replyImageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-semibold ${isDM ? 'text-indigo-600' : theme.accentText}`}>
                    Replying to {replyingTo.user_id ? getUserInfo(replyingTo.user_id)?.displayName : 'message'}
                  </div>
                  <div className={`text-xs truncate flex items-center gap-1 ${
                    isDM
                      ? 'text-stone-500'
                      : isFlirtyTheme
                        ? 'text-slate-400'
                        : 'text-slate-500'
                  }`}>
                    {replyImageUrl && (
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                    {replyPreviewText}
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
          )
        })()}

        {/* Photo Action Sheet */}
        <PhotoActionSheet
          isOpen={showPhotoSheet}
          onClose={() => setShowPhotoSheet(false)}
          onTakePhoto={() => cameraInputRef.current?.click()}
          onChooseLibrary={() => imageInputRef.current?.click()}
        />

        {/* CHAT INPUT - Hidden when it's user's turn to answer */}
        {gameActive && isMyTurn && !isWaitingForCooldown ? (
          /* Disabled state when answering */
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className={`flex items-center justify-center gap-2 py-3 px-4 rounded-2xl ${
              isDM
                ? 'bg-stone-100/60 dark:bg-stone-800/60'
                : isFlirtyTheme
                  ? 'bg-slate-800/60'
                  : 'bg-slate-100/60 dark:bg-stone-800/60'
            }`}>
              <svg className={`w-4 h-4 ${
                isDM ? 'text-stone-400 dark:text-stone-500' : isFlirtyTheme ? 'text-slate-500' : 'text-stone-400 dark:text-stone-500'
              }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className={`text-sm ${
                isDM ? 'text-stone-400 dark:text-stone-500' : isFlirtyTheme ? 'text-slate-500' : 'text-stone-400 dark:text-stone-500'
              }`}>
                Submit your answer above to continue chatting
              </span>
            </div>
          </div>
        ) : (
          /* Normal chat input */
          <div className="max-w-3xl mx-auto px-4 py-2.5">
            <div className={`flex items-end gap-1.5 p-1 chat-input-pill transition-all duration-200 ${
              isDM
                ? 'bg-stone-100/90 dark:bg-stone-800/90'
                : isFlirtyTheme
                  ? 'bg-slate-800/90 border-slate-600/30'
                  : 'bg-slate-50/90 dark:bg-stone-800/90'
            }`}>
              <button
                onClick={() => setShowPhotoSheet(true)}
                disabled={uploadingImage}
                className={`p-2 rounded-xl transition-all duration-200 disabled:opacity-50 self-end mb-0.5 ${
                  isDM
                    ? 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-white/80 dark:hover:bg-stone-700/80 active:scale-95'
                    : isFlirtyTheme
                      ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 active:scale-95'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-stone-300 hover:bg-white/80 dark:hover:bg-stone-700/80 active:scale-95'
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
                tabIndex={-1}
                aria-hidden="true"
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={sendImage}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
              />

              <textarea
                ref={chatInputRef}
                value={chatText}
                onChange={(e) => {
                  setChatText(e.target.value)
                  autoResizeTextarea()
                }}
                rows={1}
                placeholder="Type a message..."
                inputMode="text"
                enterKeyHint="send"
                autoCorrect="on"
                autoCapitalize="sentences"
                spellCheck={true}
                className={`flex-1 min-w-0 bg-transparent px-3 py-2 text-base focus:outline-none resize-none leading-6 min-h-[44px] max-h-24 overflow-y-auto ${
                  isDM
                    ? 'placeholder:text-stone-400 dark:placeholder:text-stone-500'
                    : isFlirtyTheme
                      ? 'placeholder:text-slate-500 text-slate-100'
                      : 'placeholder:text-slate-400 dark:placeholder:text-stone-500'
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
                className={`shrink-0 w-9 h-9 flex items-center justify-center text-white self-end mb-0.5 ${
                  chatText.trim()
                    ? isDM
                      ? 'send-button !bg-gradient-to-br !from-stone-700 !to-stone-900 dark:!from-stone-600 dark:!to-stone-800'
                      : isFlirtyTheme
                        ? 'send-button !bg-gradient-to-br !from-rose-500 !via-pink-500 !to-rose-600 !shadow-rose-500/25'
                        : 'send-button'
                    : 'send-button'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
