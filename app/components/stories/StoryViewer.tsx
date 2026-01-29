'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { Story, StoryUser, StoryViewer as StoryViewerType, getDisplayNameFromEmail, getInitialsFromEmail, stringToColor } from './types'
import { supabase } from '@/lib/supabaseClient'

interface StoryViewerProps {
  users: StoryUser[]
  initialUserIndex: number
  currentUserId: string
  onClose: () => void
  onStoryViewed: (storyId: string) => void
}

export function StoryViewer({
  users,
  initialUserIndex,
  currentUserId,
  onClose,
  onStoryViewed,
}: StoryViewerProps) {
  const [currentUserIndex, setCurrentUserIndex] = useState(initialUserIndex)
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<StoryViewerType[]>([])
  const [loadingViewers, setLoadingViewers] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

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
    if (showViewers) return

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
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return

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

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 pt-safe">
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

      {/* Story image */}
      <div
        className="flex-1 flex items-center justify-center"
        onClick={handleTap}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={() => setIsPaused(true)}
        onMouseUp={() => setIsPaused(false)}
        onTouchStartCapture={() => setIsPaused(true)}
        onTouchEndCapture={() => setIsPaused(false)}
      >
        <Image
          src={currentStory.image_url}
          alt="Story"
          fill
          className="object-contain"
          onLoad={() => setImageLoaded(true)}
          priority
        />
      </div>

      {/* Footer - viewers count for own stories */}
      {isOwnStory && (
        <div className="absolute bottom-0 left-0 right-0 pb-safe">
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
        </div>
      )}

      {/* Viewers modal */}
      {showViewers && (
        <div className="absolute inset-0 bg-black/80 z-20 flex flex-col">
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
