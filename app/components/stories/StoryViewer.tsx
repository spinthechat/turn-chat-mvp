'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import {
  Story,
  StoryUser,
  StoryViewer as StoryViewerType,
  TextLayer,
  getDisplayNameFromEmail,
  getInitialsFromEmail,
  stringToColor,
} from './types'
import { supabase } from '@/lib/supabaseClient'

interface StoryViewerProps {
  users: StoryUser[]
  initialUserIndex: number
  currentUserId: string
  onClose: () => void
  onStoryViewed: (storyId: string) => void
  onNavigateToRoom?: (roomId: string) => void
}

export function StoryViewer({
  users,
  initialUserIndex,
  currentUserId,
  onClose,
  onStoryViewed,
  onNavigateToRoom,
}: StoryViewerProps) {
  const [currentUserIndex, setCurrentUserIndex] = useState(initialUserIndex)
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<StoryViewerType[]>([])
  const [loadingViewers, setLoadingViewers] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Reply state
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [sendingReply, setSendingReply] = useState(false)
  const replyInputRef = useRef<HTMLInputElement>(null)

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Track keyboard height for reply input positioning
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [mounted, setMounted] = useState(false)
  const initialHeightRef = useRef<number>(0)

  // Mount state for portal
  useEffect(() => {
    setMounted(true)
    // Capture initial viewport height before any keyboard opens
    initialHeightRef.current = window.innerHeight
  }, [])

  // Lock body scroll and handle keyboard
  useEffect(() => {
    if (!mounted) return

    // Lock body scroll completely
    const originalStyles = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      width: document.body.style.width,
      height: document.body.style.height,
      top: document.body.style.top,
    }
    const scrollY = window.scrollY

    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    document.body.style.height = '100%'
    document.body.style.top = `-${scrollY}px`

    // Also lock html element
    const htmlOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    // Keyboard handling via visualViewport
    const layoutHeight = initialHeightRef.current || window.innerHeight

    const handleViewportChange = () => {
      const vv = window.visualViewport
      if (!vv) {
        setKeyboardHeight(0)
        return
      }
      // Calculate keyboard height
      const kbHeight = Math.max(0, layoutHeight - vv.height - vv.offsetTop)
      setKeyboardHeight(kbHeight)
    }

    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', handleViewportChange)
      vv.addEventListener('scroll', handleViewportChange)
    }

    return () => {
      // Restore body styles
      document.body.style.overflow = originalStyles.overflow
      document.body.style.position = originalStyles.position
      document.body.style.width = originalStyles.width
      document.body.style.height = originalStyles.height
      document.body.style.top = originalStyles.top
      document.documentElement.style.overflow = htmlOverflow

      // Restore scroll position
      window.scrollTo(0, scrollY)

      if (vv) {
        vv.removeEventListener('resize', handleViewportChange)
        vv.removeEventListener('scroll', handleViewportChange)
      }
    }
  }, [mounted])

  const currentUser = users[currentUserIndex]
  const currentStory = currentUser?.stories[currentStoryIndex]
  const isOwnStory = currentUser?.user_id === currentUserId
  const STORY_DURATION = 5000 // 5 seconds

  // Mark story as viewed
  useEffect(() => {
    if (currentStory && !currentStory.is_viewed && currentStory.story_user_id !== currentUserId) {
      const markViewed = async () => {
        try {
          await supabase
            .from('story_views')
            .upsert({
              story_id: currentStory.story_id,
              viewer_user_id: currentUserId,
            }, { onConflict: 'story_id,viewer_user_id' })
          onStoryViewed(currentStory.story_id)
        } catch (err) {
          console.error('Failed to mark story as viewed:', err)
        }
      }
      markViewed()
    }
  }, [currentStory, currentUserId, onStoryViewed])

  // Progress timer
  useEffect(() => {
    if (isPaused || !imageLoaded) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
      return
    }

    const startTime = Date.now() - (progress / 100) * STORY_DURATION

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min((elapsed / STORY_DURATION) * 100, 100)
      setProgress(newProgress)

      if (newProgress >= 100) {
        goToNext()
      }
    }, 50)

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [isPaused, imageLoaded, currentUserIndex, currentStoryIndex])

  const goToNext = useCallback(() => {
    setProgress(0)
    setImageLoaded(false)

    // Next story for same user
    if (currentStoryIndex < currentUser.stories.length - 1) {
      setCurrentStoryIndex(prev => prev + 1)
    }
    // Next user
    else if (currentUserIndex < users.length - 1) {
      setCurrentUserIndex(prev => prev + 1)
      setCurrentStoryIndex(0)
    }
    // End - close viewer
    else {
      onClose()
    }
  }, [currentStoryIndex, currentUserIndex, currentUser, users.length, onClose])

  const goToPrevious = useCallback(() => {
    setProgress(0)
    setImageLoaded(false)

    // Previous story for same user
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex(prev => prev - 1)
    }
    // Previous user's last story
    else if (currentUserIndex > 0) {
      const prevUser = users[currentUserIndex - 1]
      setCurrentUserIndex(prev => prev - 1)
      setCurrentStoryIndex(prevUser.stories.length - 1)
    }
    // Already at the beginning - just reset
    else {
      setProgress(0)
    }
  }, [currentStoryIndex, currentUserIndex, users])

  // Handle tap zones (left/right)
  const handleTap = (e: React.MouseEvent | React.TouchEvent) => {
    if (showViewers || isReplying) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = 'touches' in e ? e.changedTouches[0].clientX : e.clientX
    const relativeX = x - rect.left
    const isLeftSide = relativeX < rect.width / 3

    if (isLeftSide) {
      goToPrevious()
    } else {
      goToNext()
    }
  }

  // Touch handlers for swipe down to close
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isReplying) return
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || isReplying) return

    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y
    const deltaX = Math.abs(e.changedTouches[0].clientX - touchStartRef.current.x)

    // Swipe down to close (vertical swipe, more than 100px, and mostly vertical)
    if (deltaY > 100 && deltaX < 50) {
      onClose()
    }

    touchStartRef.current = null
  }

  // Load viewers for own story
  const loadViewers = async () => {
    if (!isOwnStory || !currentStory) return

    setLoadingViewers(true)
    try {
      const { data, error } = await supabase
        .rpc('get_story_viewers', {
          p_story_id: currentStory.story_id,
          p_requesting_user_id: currentUserId,
        })

      if (error) throw error
      setViewers(data || [])
    } catch (err) {
      console.error('Failed to load viewers:', err)
    } finally {
      setLoadingViewers(false)
    }
  }

  // Send story reply
  const handleSendReply = async () => {
    if (!currentStory || !replyText.trim() || sendingReply) return

    setSendingReply(true)
    setReplyError(null)

    try {
      const { data, error } = await supabase.rpc('send_story_reply', {
        p_story_id: currentStory.story_id,
        p_text: replyText.trim(),
      })

      if (error) throw error

      // Navigate to DM room
      if (data && data[0]?.room_id && onNavigateToRoom) {
        onClose()
        onNavigateToRoom(data[0].room_id)
      } else {
        // Fallback: just close
        onClose()
      }
    } catch (err) {
      console.error('Failed to send story reply:', err)
      setReplyError(err instanceof Error ? err.message : 'Failed to send reply')
      setSendingReply(false)
    }
  }

  // Handle reply input focus
  const handleReplyFocus = () => {
    setIsReplying(true)
    setIsPaused(true)
  }

  // Handle reply input blur
  const handleReplyBlur = () => {
    // Small delay to allow send button click to register
    setTimeout(() => {
      if (!replyText.trim()) {
        setIsReplying(false)
      }
      setIsPaused(false)
    }, 100)
  }

  // Preload next image
  useEffect(() => {
    const nextStory = currentUser?.stories[currentStoryIndex + 1] ||
      users[currentUserIndex + 1]?.stories[0]

    if (nextStory) {
      const img = document.createElement('img')
      img.src = nextStory.image_url
    }
  }, [currentUserIndex, currentStoryIndex, currentUser, users])

  if (!currentUser || !currentStory) return null

  const displayName = currentUser.display_name || getDisplayNameFromEmail(currentUser.email)
  const initials = getInitialsFromEmail(currentUser.email)
  const timeAgo = getTimeAgo(currentStory.created_at)

  // Calculate bottom offset for reply composer when keyboard is open
  const composerBottomOffset = keyboardHeight > 0 ? keyboardHeight : 0

  // Don't render until mounted (for portal)
  if (!mounted) return null

  const content = (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
      style={{
        // Use fixed height based on initial viewport, NOT dynamic
        height: '100dvh',
        // Prevent any scroll behavior
        overflow: 'hidden',
        // Ensure touch events don't propagate
        touchAction: 'none',
      }}
    >
      {/* Header - Fixed at top */}
      <div className="flex-shrink-0 z-20 pt-safe bg-gradient-to-b from-black/60 to-transparent">
        {/* Progress bars */}
        <div className="flex gap-1 px-2 pt-2">
          {currentUser.stories.map((_, idx) => (
            <div key={idx} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-75"
                style={{
                  width: idx < currentStoryIndex ? '100%' :
                    idx === currentStoryIndex ? `${progress}%` : '0%'
                }}
              />
            </div>
          ))}
        </div>

        {/* User info */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {currentUser.avatar_url ? (
              <Image
                src={currentUser.avatar_url}
                alt={displayName}
                width={32}
                height={32}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className={`w-8 h-8 rounded-full ${stringToColor(currentUser.email)} flex items-center justify-center text-white font-semibold text-sm`}>
                {initials}
              </div>
            )}
            <div>
              <span className="text-white font-semibold text-sm">{displayName}</span>
              <span className="text-white/60 text-xs ml-2">{timeAgo}</span>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Story image with overlays - Flexible middle section */}
      <div
        className="flex-1 flex items-center justify-center relative min-h-0"
        onClick={handleTap}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={() => !isReplying && setIsPaused(true)}
        onMouseUp={() => !isReplying && setIsPaused(false)}
      >
        <Image
          src={currentStory.image_url}
          alt="Story"
          fill
          className="object-contain"
          onLoad={() => setImageLoaded(true)}
          priority
        />

        {/* Dim overlay */}
        {currentStory.overlays?.dimOverlay && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none" />
        )}

        {/* Text overlays */}
        {currentStory.overlays?.textLayers?.map((layer) => (
          <TextOverlay key={layer.id} layer={layer} />
        ))}
      </div>

      {/* Footer - Fixed at bottom, moves up with keyboard via transform */}
      <div
        className="flex-shrink-0 z-20 bg-gradient-to-t from-black/60 to-transparent pb-safe"
        style={{
          // Use transform to move footer up when keyboard opens - no layout reflow
          transform: composerBottomOffset > 0 ? `translateY(-${composerBottomOffset}px)` : 'none',
          transition: 'transform 0.2s ease-out',
        }}
      >
        {isOwnStory ? (
          <button
            onClick={() => {
              setShowViewers(true)
              loadViewers()
            }}
            className="w-full py-4 flex items-center justify-center gap-2 text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="text-sm font-medium">
              {currentStory.view_count} {currentStory.view_count === 1 ? 'view' : 'views'}
            </span>
          </button>
        ) : (
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  ref={replyInputRef}
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onFocus={(e) => {
                    // Prevent iOS scroll-into-view behavior
                    e.target.scrollIntoView = () => {}
                    handleReplyFocus()
                  }}
                  onBlur={handleReplyBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendReply()
                    }
                  }}
                  placeholder={`Reply to ${displayName}...`}
                  className="w-full px-4 py-2.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white placeholder-white/50 text-sm focus:outline-none focus:border-white/40 focus:bg-white/15 transition-colors"
                  disabled={sendingReply}
                  autoComplete="off"
                  autoCorrect="on"
                  enterKeyHint="send"
                />
              </div>
              {(replyText.trim() || isReplying) && (
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sendingReply}
                  className="p-2.5 bg-white text-black rounded-full disabled:opacity-50 transition-opacity flex-shrink-0"
                >
                  {sendingReply ? (
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            {replyError && (
              <p className="mt-2 text-xs text-red-400 text-center">{replyError}</p>
            )}
          </div>
        )}
      </div>

      {/* Viewers modal */}
      {showViewers && (
        <div className="absolute inset-0 bg-black/80 z-30 flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 pt-safe border-b border-white/10">
            <h3 className="text-white font-semibold">Viewers</h3>
            <button
              onClick={() => setShowViewers(false)}
              className="p-2 text-white/80 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loadingViewers ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            ) : viewers.length === 0 ? (
              <p className="text-center text-white/50 py-8">No views yet</p>
            ) : (
              <div className="space-y-3">
                {viewers.map((viewer) => (
                  <div key={viewer.viewer_id} className="flex items-center gap-3">
                    {viewer.viewer_avatar_url ? (
                      <Image
                        src={viewer.viewer_avatar_url}
                        alt=""
                        width={40}
                        height={40}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className={`w-10 h-10 rounded-full ${stringToColor(viewer.viewer_email)} flex items-center justify-center text-white font-semibold text-sm`}>
                        {getInitialsFromEmail(viewer.viewer_email)}
                      </div>
                    )}
                    <div>
                      <p className="text-white font-medium text-sm">
                        {viewer.viewer_display_name || getDisplayNameFromEmail(viewer.viewer_email)}
                      </p>
                      <p className="text-white/50 text-xs">{getTimeAgo(viewer.viewed_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // Render via portal at document.body to escape any scroll containers
  return createPortal(content, document.body)
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

// Text layer rendering helper
function TextOverlay({ layer }: { layer: TextLayer }) {
  const fontClass = {
    sans: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono',
  }[layer.font]

  const sizeClass = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-3xl',
  }[layer.size]

  const alignClass = `text-${layer.align}`

  const backgroundClass = {
    none: '',
    pill: 'bg-black/40 backdrop-blur-sm px-4 py-1.5 rounded-full',
    solid: 'bg-black/60 px-4 py-2 rounded-lg',
  }[layer.background]

  return (
    <div
      className="absolute pointer-events-none select-none"
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`,
      }}
    >
      <div
        className={`whitespace-nowrap ${fontClass} ${sizeClass} ${alignClass} ${backgroundClass}`}
        style={{
          color: layer.color,
          textShadow: layer.background === 'none' ? '0 2px 8px rgba(0,0,0,0.8)' : 'none',
        }}
      >
        {layer.text}
      </div>
    </div>
  )
}
