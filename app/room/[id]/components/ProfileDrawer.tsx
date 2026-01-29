'use client'

import { useState, useEffect, useCallback } from 'react'
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

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
  user: UserInfo | null
  currentUserId: string | null
  onStartDM: (userId: string) => Promise<void>
  onFollowChange?: (userId: string, isFollowing: boolean) => void
}

export function ProfileDrawer({
  isOpen,
  onClose,
  user,
  currentUserId,
  onStartDM,
  onFollowChange,
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

  // Derived state
  const isFollowing = followStatus === 'explicit' || followStatus === 'implicit'
  const isImplicit = followStatus === 'implicit'

  // Check follow status and load stats when drawer opens
  useEffect(() => {
    if (!isOpen || !user) {
      setFollowStatus(null)
      setStatsLoaded(false)
      setStats({ followers_count: 0, following_count: 0, groups_count: 0, mutual_groups_count: 0 })
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

    // Only check follow status for other users
    if (isOwnProfile || !currentUserId) {
      setFollowStatus(null)
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

    checkFollowStatus()
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
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-24 h-24 rounded-full object-cover ring-4 ring-stone-100 dark:ring-stone-700 mb-4"
              />
            ) : (
              <div className={`w-24 h-24 rounded-full ${user.color} flex items-center justify-center text-white text-3xl font-semibold ring-4 ring-stone-100 dark:ring-stone-700 mb-4`}>
                {user.initials}
              </div>
            )}
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
            className="w-full mt-3 py-2.5 px-4 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
