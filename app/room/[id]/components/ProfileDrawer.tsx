'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import type { UserInfo } from '../types'

// Follow status: 'explicit' | 'implicit' | 'none' | 'unfollowed'
type FollowStatus = 'explicit' | 'implicit' | 'none' | 'unfollowed' | null

type ProfileStats = {
  followers_count: number
  following_count: number
  groups_count: number
  mutual_groups_count: number
}

// Haptic feedback helper
function hapticTick() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(10)
  }
}

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
  user: UserInfo | null
  currentUserId: string | null
  onStartDM: (userId: string) => Promise<void>
  onFollowChange?: (userId: string, isFollowing: boolean) => void
  hasActiveStory?: boolean
  onViewStory?: (userId: string) => void
}

export function ProfileDrawer({
  isOpen,
  onClose,
  user,
  currentUserId,
  onStartDM,
  onFollowChange,
  hasActiveStory = false,
  onViewStory,
}: ProfileDrawerProps) {
  const [startingDM, setStartingDM] = useState(false)
  const [followStatus, setFollowStatus] = useState<FollowStatus>(null)
  const [followLoading, setFollowLoading] = useState(false)
  const [followError, setFollowError] = useState<string | null>(null)

  // Profile stats
  const [stats, setStats] = useState<ProfileStats>({
    followers_count: 0,
    following_count: 0,
    groups_count: 0,
    mutual_groups_count: 0
  })
  const [statsLoaded, setStatsLoaded] = useState(false)

  // Poke state
  const [pokeState, setPokeState] = useState<{
    canPoke: boolean
    hoursRemaining?: number
    loading: boolean
    sending: boolean
    success: boolean
  }>({ canPoke: false, loading: true, sending: false, success: false })

  // Avatar menu and photo viewer state
  const [showAvatarMenu, setShowAvatarMenu] = useState(false)
  const [showPhotoViewer, setShowPhotoViewer] = useState(false)

  // Derived state
  const isFollowing = followStatus === 'explicit' || followStatus === 'implicit'
  const isImplicit = followStatus === 'implicit'

  // Check follow status and load stats when drawer opens
  useEffect(() => {
    if (!isOpen || !user) {
      setFollowStatus(null)
      setStatsLoaded(false)
      setStats({ followers_count: 0, following_count: 0, groups_count: 0, mutual_groups_count: 0 })
      setPokeState({ canPoke: false, loading: true, sending: false, success: false })
      return
    }

    const isOwnProfile = user.id === currentUserId

    // Load stats for any user (including own profile)
    const loadStats = async () => {
      try {
        const { data: statsData, error: statsError } = await supabase.rpc('get_profile_stats', {
          p_user_id: user.id
        })

        if (statsError) {
          console.error('Error loading stats:', statsError)
        } else if (statsData) {
          const statsRow = Array.isArray(statsData) ? statsData[0] : statsData
          if (statsRow) {
            setStats({
              followers_count: statsRow.followers_count ?? 0,
              following_count: statsRow.following_count ?? 0,
              groups_count: statsRow.groups_count ?? 0,
              mutual_groups_count: statsRow.mutual_groups_count ?? 0
            })
          }
        }
      } catch (err) {
        console.error('Failed to load stats:', err)
      }
      setStatsLoaded(true)
    }

    loadStats()

    // Only check follow status and poke status for other users
    if (isOwnProfile || !currentUserId) {
      setFollowStatus(null)
      setPokeState({ canPoke: false, loading: false, sending: false, success: false })
      return
    }

    const checkFollowStatus = async () => {
      try {
        const { data, error } = await supabase.rpc('get_follow_status', {
          p_target_id: user.id
        })
        if (error) throw error
        setFollowStatus(data as FollowStatus)
      } catch (err) {
        console.error('Failed to check follow status:', err)
        // Fallback to old is_following if get_follow_status doesn't exist yet
        try {
          const { data, error } = await supabase.rpc('is_following', {
            p_target_id: user.id
          })
          if (error) throw error
          setFollowStatus(data ? 'explicit' : 'none')
        } catch {
          setFollowStatus('none')
        }
      }
    }

    // Check poke status
    const checkPokeStatus = async () => {
      try {
        const { data, error } = await supabase.rpc('can_poke', { p_target_id: user.id })
        if (error) throw error
        setPokeState({
          canPoke: data?.can_poke ?? false,
          hoursRemaining: data?.hours_remaining,
          loading: false,
          sending: false,
          success: false,
        })
      } catch (err) {
        console.error('Failed to check poke status:', err)
        setPokeState({ canPoke: false, loading: false, sending: false, success: false })
      }
    }

    checkFollowStatus()
    checkPokeStatus()
  }, [isOpen, user, currentUserId])

  const handleFollowToggle = useCallback(async () => {
    if (!user || followLoading || followStatus === null) return

    const wasFollowing = isFollowing
    setFollowLoading(true)
    setFollowError(null)

    // Optimistic update
    setFollowStatus(wasFollowing ? 'none' : 'explicit')

    try {
      if (!wasFollowing) {
        const { data, error } = await supabase.rpc('follow_user', {
          p_following_id: user.id
        })
        if (error) throw error
        // Update to actual status returned (could be 'implicit' or 'explicit')
        setFollowStatus(data as FollowStatus || 'explicit')
      } else {
        const { error } = await supabase.rpc('unfollow_user', {
          p_following_id: user.id
        })
        if (error) throw error
        setFollowStatus('unfollowed')
      }
      // Notify parent of follow change
      onFollowChange?.(user.id, !wasFollowing)
    } catch (err) {
      // Revert optimistic update
      setFollowStatus(wasFollowing ? (isImplicit ? 'implicit' : 'explicit') : 'none')
      setFollowError(err instanceof Error ? err.message : 'Failed to update follow status')
      console.error('Failed to toggle follow:', err)
    } finally {
      setFollowLoading(false)
    }
  }, [user, followStatus, isFollowing, isImplicit, followLoading, onFollowChange])

  // Handle poke
  const handlePoke = useCallback(async () => {
    if (!user || !pokeState.canPoke || pokeState.sending) return

    setPokeState(prev => ({ ...prev, sending: true }))
    hapticTick()

    try {
      const { data, error } = await supabase.rpc('send_poke', { p_target_id: user.id })
      if (error) throw error

      if (data?.success) {
        setPokeState(prev => ({ ...prev, sending: false, success: true, canPoke: false }))
        // Reset success state after animation
        setTimeout(() => {
          setPokeState(prev => ({ ...prev, success: false }))
        }, 2000)
      } else {
        setPokeState(prev => ({
          ...prev,
          sending: false,
          canPoke: false,
          hoursRemaining: data?.hours_remaining,
        }))
      }
    } catch (err) {
      console.error('Failed to send poke:', err)
      setPokeState(prev => ({ ...prev, sending: false }))
    }
  }, [user, pokeState.canPoke, pokeState.sending])

  // Handle avatar tap
  const handleAvatarTap = useCallback(() => {
    if (!user) return

    // If user has active story, show menu
    if (hasActiveStory) {
      setShowAvatarMenu(true)
    } else if (user.avatarUrl) {
      // If no story but has avatar, open photo viewer directly
      setShowPhotoViewer(true)
    }
    // If no story and no avatar, do nothing
  }, [user, hasActiveStory])

  // Handle view story from menu
  const handleViewStory = useCallback(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[ProfileDrawer] View story clicked', { userId: user?.id, hasOnViewStory: !!onViewStory })
    }
    if (!user || !onViewStory) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[ProfileDrawer] Cannot view story - missing user or onViewStory handler')
      }
      return
    }
    setShowAvatarMenu(false)
    onClose()
    onViewStory(user.id)
  }, [user, onViewStory, onClose])

  // Handle view photo from menu
  const handleViewPhoto = useCallback(() => {
    setShowAvatarMenu(false)
    setShowPhotoViewer(true)
  }, [])

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
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-stone-900 rounded-t-2xl shadow-xl max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-200">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-stone-300 dark:bg-stone-600 rounded-full" />
        </div>

        {/* Content */}
        <div className="px-6 pb-8 pt-2">
          {/* Avatar and name */}
          <div className="flex flex-col items-center text-center mb-6">
            {/* Tappable avatar */}
            <button
              onClick={handleAvatarTap}
              className="relative mb-4 focus:outline-none"
              disabled={!user.avatarUrl && !hasActiveStory}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className={`w-24 h-24 rounded-full object-cover ring-4 ${
                    hasActiveStory
                      ? 'ring-gradient-to-tr from-amber-400 to-pink-500'
                      : 'ring-stone-100 dark:ring-stone-700'
                  }`}
                  style={hasActiveStory ? {
                    boxShadow: '0 0 0 3px #f59e0b, 0 0 0 4px #ec4899'
                  } : undefined}
                />
              ) : (
                <div className={`w-24 h-24 rounded-full ${user.color} flex items-center justify-center text-white text-3xl font-semibold ring-4 ring-stone-100 dark:ring-stone-700`}>
                  {user.initials}
                </div>
              )}
              {hasActiveStory && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gradient-to-tr from-amber-400 to-pink-500 rounded-full flex items-center justify-center">
                  <div className="w-4 h-4 bg-white dark:bg-stone-900 rounded-full" />
                </div>
              )}
            </button>
            <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-50">{user.displayName}</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">{user.email}</p>
            {isOwnProfile && (
              <span className="mt-1 text-xs bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 px-2 py-0.5 rounded-full">This is you</span>
            )}
          </div>

          {/* Bio */}
          {user.bio && (
            <div className="mb-6">
              <h3 className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-2">About</h3>
              <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">{user.bio}</p>
            </div>
          )}

          {/* Stats */}
          <div className={`grid ${isOwnProfile ? 'grid-cols-3' : 'grid-cols-4'} gap-1 mb-6 bg-stone-50 dark:bg-stone-800 rounded-xl p-3`}>
            <div className="flex flex-col items-center py-2">
              {statsLoaded ? (
                <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.followers_count}</span>
              ) : (
                <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              )}
              <span className="text-[10px] text-stone-500 dark:text-stone-400">Followers</span>
            </div>
            <div className="flex flex-col items-center py-2">
              {statsLoaded ? (
                <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.following_count}</span>
              ) : (
                <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              )}
              <span className="text-[10px] text-stone-500 dark:text-stone-400">Following</span>
            </div>
            <div className="flex flex-col items-center py-2">
              {statsLoaded ? (
                <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.groups_count}</span>
              ) : (
                <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              )}
              <span className="text-[10px] text-stone-500 dark:text-stone-400">Groups</span>
            </div>
            {!isOwnProfile && (
              <div className="flex flex-col items-center py-2">
                {statsLoaded ? (
                  <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.mutual_groups_count}</span>
                ) : (
                  <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
                )}
                <span className="text-[10px] text-stone-500 dark:text-stone-400">Mutual</span>
              </div>
            )}
          </div>

          {/* Follow/Unfollow button */}
          {!isOwnProfile && followStatus !== null && (
            <div className="mb-4">
              <button
                onClick={handleFollowToggle}
                disabled={followLoading}
                className={`w-full py-3 px-4 font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
                  isFollowing
                    ? 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                    : 'bg-indigo-500 text-white hover:bg-indigo-600'
                } disabled:opacity-50`}
              >
                {followLoading ? (
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                ) : isFollowing ? (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Following
                    {isImplicit && (
                      <span className="text-xs opacity-60 ml-1">• Auto</span>
                    )}
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Follow
                  </>
                )}
              </button>
              {followError && (
                <p className="mt-2 text-xs text-red-500 text-center">{followError}</p>
              )}
              {isFollowing && (
                <p className="mt-2 text-xs text-stone-400 dark:text-stone-500 text-center">
                  {isImplicit
                    ? 'Auto-following based on shared group activity'
                    : "You'll see their stories in your feed"}
                </p>
              )}
              {followStatus === 'unfollowed' && (
                <p className="mt-2 text-xs text-stone-400 dark:text-stone-500 text-center">
                  You won&apos;t see their stories
                </p>
              )}
            </div>
          )}

          {/* Action buttons row: Message + Poke */}
          {!isOwnProfile && (
            <div className="flex gap-3 mb-3">
              {/* Message button */}
              <button
                onClick={handleStartDM}
                disabled={startingDM}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium rounded-xl hover:from-indigo-600 hover:to-violet-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {startingDM ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="sr-only">Opening...</span>
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

              {/* Poke button */}
              <button
                onClick={handlePoke}
                disabled={!pokeState.canPoke || pokeState.sending || pokeState.loading}
                className={`py-3 px-5 font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
                  pokeState.success
                    ? 'bg-emerald-500 text-white'
                    : pokeState.canPoke
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500'
                } disabled:opacity-50`}
              >
                {pokeState.sending ? (
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                ) : pokeState.success ? (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Poked!
                  </>
                ) : (
                  <>
                    <span className="text-lg">👋</span>
                    Poke
                  </>
                )}
              </button>
            </div>
          )}

          {/* Poke rate limit info */}
          {!isOwnProfile && !pokeState.canPoke && !pokeState.loading && !pokeState.success && pokeState.hoursRemaining && (
            <p className="text-xs text-stone-400 dark:text-stone-500 text-center mb-3">
              Can poke again in {pokeState.hoursRemaining}h
            </p>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Avatar action menu (only shows if user has active story) */}
      {showAvatarMenu && (
        <AvatarActionMenu
          hasAvatar={!!user.avatarUrl}
          hasStory={hasActiveStory}
          onViewPhoto={handleViewPhoto}
          onViewStory={handleViewStory}
          onClose={() => setShowAvatarMenu(false)}
        />
      )}

      {/* Full screen photo viewer */}
      {showPhotoViewer && user.avatarUrl && (
        <FullScreenPhotoViewer
          imageUrl={user.avatarUrl}
          displayName={user.displayName}
          onClose={() => setShowPhotoViewer(false)}
        />
      )}
    </>
  )
}

// Avatar action menu component
function AvatarActionMenu({
  hasAvatar,
  hasStory,
  onViewPhoto,
  onViewStory,
  onClose,
}: {
  hasAvatar: boolean
  hasStory: boolean
  onViewPhoto: () => void
  onViewStory: () => void
  onClose: () => void
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[60]"
        onClick={onClose}
      />

      {/* Menu */}
      <div className="fixed inset-x-0 bottom-0 z-[61] animate-in slide-in-from-bottom duration-200">
        <div className="bg-white dark:bg-stone-900 rounded-t-2xl shadow-xl overflow-hidden pb-safe">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-stone-200 dark:bg-stone-700" />
          </div>

          <div className="px-4 pb-4 space-y-2">
            {/* View Profile Photo */}
            {hasAvatar && (
              <button
                onClick={onViewPhoto}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                </div>
                <span className="text-stone-900 dark:text-stone-50 font-medium">View profile photo</span>
              </button>
            )}

            {/* View Story */}
            {hasStory && (
              <button
                onClick={onViewStory}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
                  </svg>
                </div>
                <span className="text-stone-900 dark:text-stone-50 font-medium">View story</span>
              </button>
            )}
          </div>

          {/* Cancel button */}
          <div className="px-4 pb-4">
            <button
              onClick={onClose}
              className="w-full py-3 text-stone-500 dark:text-stone-400 font-medium text-center hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Full-screen photo viewer with pinch-to-zoom
function FullScreenPhotoViewer({
  imageUrl,
  displayName,
  onClose,
}: {
  imageUrl: string
  displayName: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastPinchDistRef = useRef<number | null>(null)
  const initialScaleRef = useRef(1)

  useEffect(() => {
    setMounted(true)
    // Lock body scroll
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  // Handle double-tap to zoom
  const handleDoubleTap = useCallback((clientX: number, clientY: number) => {
    if (scale > 1) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    } else {
      setScale(2.5)
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const centerX = rect.width / 2
        const centerY = rect.height / 2
        const offsetX = (centerX - clientX) * 1.5
        const offsetY = (centerY - clientY) * 1.5
        setPosition({ x: offsetX, y: offsetY })
      }
    }
  }, [scale])

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy)
      initialScaleRef.current = scale
    } else if (e.touches.length === 1) {
      const touch = e.touches[0]
      const now = Date.now()

      if (lastTouchRef.current) {
        const dt = now - lastTouchRef.current.time
        const dx = Math.abs(touch.clientX - lastTouchRef.current.x)
        const dy = Math.abs(touch.clientY - lastTouchRef.current.y)

        if (dt < 300 && dx < 30 && dy < 30) {
          handleDoubleTap(touch.clientX, touch.clientY)
          lastTouchRef.current = null
          return
        }
      }

      lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: now }

      if (scale > 1) {
        setIsDragging(true)
      }
    }
  }, [scale, handleDoubleTap])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const delta = dist / lastPinchDistRef.current
      const newScale = Math.min(Math.max(initialScaleRef.current * delta, 1), 5)
      setScale(newScale)

      if (newScale === 1) {
        setPosition({ x: 0, y: 0 })
      }
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      const touch = e.touches[0]
      if (lastTouchRef.current) {
        const dx = touch.clientX - lastTouchRef.current.x
        const dy = touch.clientY - lastTouchRef.current.y
        setPosition(prev => ({
          x: prev.x + dx,
          y: prev.y + dy,
        }))
        lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: lastTouchRef.current.time }
      }
    }
  }, [isDragging, scale])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    lastPinchDistRef.current = null
    setIsDragging(false)

    // Swipe down to close (only when not zoomed)
    if (e.changedTouches.length === 1 && lastTouchRef.current && scale === 1) {
      const touch = e.changedTouches[0]
      const dy = touch.clientY - lastTouchRef.current.y
      const dx = Math.abs(touch.clientX - lastTouchRef.current.x)

      if (dy > 100 && dx < 50) {
        onClose()
      }
    }
  }, [scale, onClose])

  // Tap to close when not zoomed
  const handleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (scale === 1) {
      onClose()
    }
  }, [scale, onClose])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    handleDoubleTap(e.clientX, e.clientY)
  }, [handleDoubleTap])

  if (!mounted) return null

  const content = (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-4 pt-safe z-10">
        <button
          onClick={onClose}
          className="p-2 text-white/80 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <p className="text-white font-medium">{displayName}</p>
        <div className="w-10" />
      </div>

      {/* Photo */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleTap}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="transition-transform duration-200"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transitionProperty: isDragging ? 'none' : 'transform',
          }}
        >
          <Image
            src={imageUrl}
            alt={displayName}
            width={800}
            height={800}
            className="max-w-full max-h-[80vh] object-contain select-none"
            draggable={false}
            priority
          />
        </div>
      </div>

      {/* Footer hint */}
      <div className="flex-shrink-0 py-4 pb-safe text-center">
        <p className="text-white/50 text-xs">
          {scale > 1 ? 'Double-tap to reset' : 'Tap to close • Double-tap to zoom'}
        </p>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
