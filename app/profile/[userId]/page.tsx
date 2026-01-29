'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

// Types
type FollowStatus = 'explicit' | 'implicit' | 'none' | 'unfollowed' | null

type ProfileData = {
  id: string
  email: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  flashbox_youtube_id: string | null
}

type ProfileStats = {
  followers_count: number
  following_count: number
  groups_count: number
  mutual_groups_count: number
}

type ProfilePhoto = {
  id: string
  url: string
  position: number
}

type UserListItem = {
  user_id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  mutual_groups_count: number
  follow_status: 'explicit' | 'implicit' | 'none' | 'unfollowed'
}

type GroupListItem = {
  room_id: string
  room_name: string
  member_count: number
}

type ListType = 'followers' | 'following' | 'groups' | 'mutual_groups' | null

// Haptic feedback helper
function hapticTick() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(10)
  }
}

// Format last active time
function formatLastActive(lastSeenAt: string | null): string | null {
  if (!lastSeenAt) return null

  const lastSeen = new Date(lastSeenAt)
  const now = new Date()
  const diffMs = now.getTime() - lastSeen.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 2) return 'Active now'
  if (diffMins < 60) return `Active ${diffMins}m ago`
  if (diffHours < 24) return `Active ${diffHours}h ago`
  if (diffDays === 1) return 'Active yesterday'
  if (diffDays < 7) return `Active ${diffDays} days ago`
  return null
}

// Helper functions
function getInitials(email: string, name?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
    return parts[0].toUpperCase()
  }
  const emailName = email.split('@')[0]
  const cleaned = emailName.replace(/[0-9]/g, '')
  const parts = cleaned.split(/[._-]/).filter(p => p.length > 0)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return cleaned.toUpperCase() || '??'
}

function getDisplayName(email: string, name?: string | null): string {
  if (name) return name
  const emailName = email.split('@')[0]
  return emailName
    .replace(/[._-]/g, ' ')
    .replace(/[0-9]/g, '')
    .trim()
    .split(' ')
    .filter(p => p.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ') || emailName
}

export default function UserProfilePage() {
  const router = useRouter()
  const params = useParams()
  const targetUserId = params.userId as string

  // Loading and auth states
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [isOwnProfile, setIsOwnProfile] = useState(false)

  // Profile stats
  const [stats, setStats] = useState<ProfileStats>({
    followers_count: 0,
    following_count: 0,
    groups_count: 0,
    mutual_groups_count: 0
  })
  const [statsLoaded, setStatsLoaded] = useState(false)

  // Follow state
  const [followStatus, setFollowStatus] = useState<FollowStatus>(null)
  const [followLoading, setFollowLoading] = useState(false)
  const [followError, setFollowError] = useState<string | null>(null)

  // Poke state
  const [pokeState, setPokeState] = useState<{
    canPoke: boolean
    hoursRemaining?: number
    loading: boolean
    sending: boolean
    success: boolean
  }>({ canPoke: false, loading: true, sending: false, success: false })

  // Last seen
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)

  // Gallery photos
  const [galleryPhotos, setGalleryPhotos] = useState<ProfilePhoto[]>([])
  const [galleryLoading, setGalleryLoading] = useState(true)
  const [galleryViewerIndex, setGalleryViewerIndex] = useState<number | null>(null)

  // Flashbox YouTube
  const [flashboxVideoId, setFlashboxVideoId] = useState<string | null>(null)

  // Avatar viewer
  const [showPhotoViewer, setShowPhotoViewer] = useState(false)

  // List modal state
  const [activeList, setActiveList] = useState<ListType>(null)
  const [listData, setListData] = useState<UserListItem[] | GroupListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [followingInProgress, setFollowingInProgress] = useState<Set<string>>(new Set())

  // DM state
  const [startingDM, setStartingDM] = useState(false)

  // Derived state
  const isFollowing = followStatus === 'explicit' || followStatus === 'implicit'
  const isImplicit = followStatus === 'implicit'

  // Load profile data
  useEffect(() => {
    const loadProfile = async () => {
      // Get current user
      const { data: authData } = await supabase.auth.getUser()
      const uid = authData.user?.id ?? null
      setCurrentUserId(uid)

      if (uid === targetUserId) {
        // Redirect to own profile page
        router.replace('/profile')
        return
      }

      setIsOwnProfile(false)

      // Fetch target user's profile
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('id, email, display_name, bio, avatar_url, flashbox_youtube_id')
        .eq('id', targetUserId)
        .single()

      if (error || !profileData) {
        console.error('Error loading profile:', error)
        setLoading(false)
        return
      }

      setProfile(profileData)
      setFlashboxVideoId(profileData.flashbox_youtube_id)
      setLoading(false)

      // Load stats
      try {
        const { data: statsData, error: statsError } = await supabase.rpc('get_profile_stats', {
          p_user_id: targetUserId
        })
        if (!statsError && statsData) {
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

      // Load gallery photos
      try {
        const { data: photosData, error: photosError } = await supabase.rpc('get_profile_photos', {
          p_user_id: targetUserId
        })
        if (!photosError) {
          setGalleryPhotos(photosData || [])
        }
      } catch (err) {
        console.error('Failed to load gallery:', err)
      }
      setGalleryLoading(false)

      // Load last seen
      try {
        const { data, error } = await supabase.rpc('get_last_seen', {
          p_user_id: targetUserId
        })
        if (!error && data) {
          setLastSeenAt(data)
        }
      } catch (err) {
        console.error('Failed to load last seen:', err)
      }

      // Load follow status (only if logged in)
      if (uid) {
        try {
          const { data, error } = await supabase.rpc('get_follow_status', {
            p_target_id: targetUserId
          })
          if (!error) {
            setFollowStatus(data as FollowStatus)
          }
        } catch (err) {
          console.error('Failed to check follow status:', err)
          setFollowStatus('none')
        }

        // Check poke status
        try {
          const { data, error } = await supabase.rpc('can_poke', { p_target_id: targetUserId })
          if (!error) {
            setPokeState({
              canPoke: data?.can_poke ?? false,
              hoursRemaining: data?.hours_remaining,
              loading: false,
              sending: false,
              success: false,
            })
          }
        } catch (err) {
          console.error('Failed to check poke status:', err)
          setPokeState({ canPoke: false, loading: false, sending: false, success: false })
        }
      }
    }

    loadProfile()
  }, [targetUserId, router])

  // Handle follow toggle
  const handleFollowToggle = useCallback(async () => {
    if (!profile || followLoading || followStatus === null) return

    const wasFollowing = isFollowing
    setFollowLoading(true)
    setFollowError(null)
    setFollowStatus(wasFollowing ? 'none' : 'explicit')

    try {
      if (!wasFollowing) {
        const { data, error } = await supabase.rpc('follow_user', {
          p_following_id: profile.id
        })
        if (error) throw error
        setFollowStatus(data as FollowStatus || 'explicit')
      } else {
        const { error } = await supabase.rpc('unfollow_user', {
          p_following_id: profile.id
        })
        if (error) throw error
        setFollowStatus('unfollowed')
      }
    } catch (err) {
      setFollowStatus(wasFollowing ? (isImplicit ? 'implicit' : 'explicit') : 'none')
      setFollowError(err instanceof Error ? err.message : 'Failed to update follow status')
      console.error('Failed to toggle follow:', err)
    } finally {
      setFollowLoading(false)
    }
  }, [profile, followStatus, isFollowing, isImplicit, followLoading])

  // Handle poke
  const handlePoke = useCallback(async () => {
    if (!profile || !pokeState.canPoke || pokeState.sending) return

    setPokeState(prev => ({ ...prev, sending: true }))
    hapticTick()

    try {
      const { data, error } = await supabase.rpc('send_poke', { p_target_id: profile.id })
      if (error) throw error

      if (data?.success) {
        setPokeState(prev => ({ ...prev, sending: false, success: true, canPoke: false }))
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
  }, [profile, pokeState.canPoke, pokeState.sending])

  // Handle start DM
  const handleStartDM = async () => {
    if (!profile || !currentUserId || startingDM) return
    setStartingDM(true)
    try {
      const { data: dmRoomId, error } = await supabase.rpc('get_or_create_dm', {
        p_other_user_id: profile.id
      })
      if (error) throw error
      router.push(`/room/${dmRoomId}`)
    } catch (error) {
      console.error('Failed to start DM:', error)
    } finally {
      setStartingDM(false)
    }
  }

  // Open list modal
  const openList = useCallback(async (type: ListType) => {
    if (!profile || !type) return

    setActiveList(type)
    setListLoading(true)
    setListData([])

    try {
      let data
      if (type === 'followers') {
        const result = await supabase.rpc('get_followers_list', { p_user_id: profile.id })
        data = result.data
      } else if (type === 'following') {
        const result = await supabase.rpc('get_following_list', { p_user_id: profile.id })
        data = result.data
      } else if (type === 'groups') {
        const result = await supabase.rpc('get_user_groups_list', {})
        data = result.data
      } else if (type === 'mutual_groups' && currentUserId) {
        const result = await supabase.rpc('get_mutual_groups_list', { p_other_user_id: profile.id })
        data = result.data
      }
      setListData(data || [])
    } catch (err) {
      console.error('Failed to load list:', err)
    } finally {
      setListLoading(false)
    }
  }, [profile, currentUserId])

  // Handle follow toggle in list
  const handleListFollowToggle = useCallback(async (userId: string, currentStatus: string) => {
    if (followingInProgress.has(userId)) return

    setFollowingInProgress(prev => new Set(prev).add(userId))

    const isCurrentlyFollowing = currentStatus === 'explicit' || currentStatus === 'implicit'

    setListData(prev =>
      (prev as UserListItem[]).map(item =>
        item.user_id === userId
          ? { ...item, follow_status: isCurrentlyFollowing ? 'unfollowed' : 'explicit' as UserListItem['follow_status'] }
          : item
      )
    )

    try {
      if (isCurrentlyFollowing) {
        await supabase.rpc('unfollow_user', { p_following_id: userId })
      } else {
        await supabase.rpc('follow_user', { p_following_id: userId })
      }
    } catch (err) {
      console.error('Follow toggle failed:', err)
      setListData(prev =>
        (prev as UserListItem[]).map(item =>
          item.user_id === userId
            ? { ...item, follow_status: currentStatus as UserListItem['follow_status'] }
            : item
        )
      )
    } finally {
      setFollowingInProgress(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }, [followingInProgress])

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-stone-200 dark:border-stone-700 border-t-stone-600 dark:border-t-stone-300 rounded-full animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-900 flex flex-col items-center justify-center p-4">
        <div className="text-4xl mb-4">404</div>
        <p className="text-stone-500 dark:text-stone-400 mb-6">User not found</p>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 bg-stone-900 dark:bg-stone-50 text-white dark:text-stone-900 rounded-xl font-medium"
        >
          Go Back
        </button>
      </div>
    )
  }

  const displayName = getDisplayName(profile.email, profile.display_name)
  const initials = getInitials(profile.email, profile.display_name)

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-stone-800 border-b border-stone-200/50 dark:border-stone-700/50">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-50">Profile</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        {/* Avatar and name */}
        <div className="flex flex-col items-center text-center mb-6">
          <button
            onClick={() => profile.avatar_url && setShowPhotoViewer(true)}
            disabled={!profile.avatar_url}
            className="relative mb-4 focus:outline-none"
          >
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={displayName}
                className="w-28 h-28 rounded-full object-cover ring-4 ring-stone-100 dark:ring-stone-700 shadow-lg"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-3xl font-semibold ring-4 ring-stone-100 dark:ring-stone-700 shadow-lg">
                {initials}
              </div>
            )}
          </button>
          <h2 className="text-2xl font-semibold text-stone-900 dark:text-stone-50">{displayName}</h2>
          <p className="text-sm text-stone-500 dark:text-stone-400">{profile.email}</p>
          {/* Last active status */}
          {formatLastActive(lastSeenAt) && (
            <p className={`text-xs mt-1 ${
              formatLastActive(lastSeenAt) === 'Active now'
                ? 'text-emerald-500 dark:text-emerald-400'
                : 'text-stone-400 dark:text-stone-500'
            }`}>
              {formatLastActive(lastSeenAt)}
            </p>
          )}
        </div>

        {/* Bio */}
        {profile.bio && (
          <div className="mb-6 bg-white dark:bg-stone-800 rounded-2xl p-4 border border-stone-200/50 dark:border-stone-700/50">
            <h3 className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-2">About</h3>
            <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">{profile.bio}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-6 bg-white dark:bg-stone-800 rounded-2xl p-4 border border-stone-200/50 dark:border-stone-700/50">
          <button
            onClick={() => openList('followers')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.followers_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Followers</span>
          </button>
          <button
            onClick={() => openList('following')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.following_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Following</span>
          </button>
          <button
            onClick={() => openList('groups')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.groups_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Groups</span>
          </button>
          <button
            onClick={() => openList('mutual_groups')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.mutual_groups_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Mutual</span>
          </button>
        </div>

        {/* Photo Gallery */}
        {(galleryPhotos.length > 0 || galleryLoading) && (
          <div className="bg-white dark:bg-stone-800 rounded-2xl p-4 border border-stone-200/50 dark:border-stone-700/50 mb-6">
            <h3 className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-3">
              Photos {galleryPhotos.length > 0 && `(${galleryPhotos.length})`}
            </h3>
            {galleryLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="aspect-square bg-stone-100 dark:bg-stone-700 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {galleryPhotos.slice(0, 6).map((photo, index) => (
                  <button
                    key={photo.id}
                    onClick={() => setGalleryViewerIndex(index)}
                    className="aspect-square rounded-lg overflow-hidden bg-stone-100 dark:bg-stone-700 hover:opacity-90 transition-opacity"
                  >
                    <img
                      src={photo.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
                {galleryPhotos.length > 6 && (
                  <button
                    onClick={() => setGalleryViewerIndex(6)}
                    className="aspect-square rounded-lg overflow-hidden bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-stone-500 dark:text-stone-400 font-medium text-sm"
                  >
                    +{galleryPhotos.length - 6}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Flashbox YouTube */}
        {flashboxVideoId && (
          <div className="bg-white dark:bg-stone-800 rounded-2xl p-4 border border-stone-200/50 dark:border-stone-700/50 mb-6">
            <h3 className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-3">Flashbox</h3>
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${flashboxVideoId}`}
                title="Flashbox video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        {currentUserId && (
          <div className="space-y-3">
            {/* Follow/Unfollow button */}
            {followStatus !== null && (
              <div>
                <button
                  onClick={handleFollowToggle}
                  disabled={followLoading}
                  className={`w-full py-3.5 px-4 font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
                    isFollowing
                      ? 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                      : 'bg-indigo-500 text-white hover:bg-indigo-600'
                  } disabled:opacity-50`}
                >
                  {followLoading ? (
                    <div className="w-5 h-5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  ) : isFollowing ? (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Following
                      {isImplicit && <span className="text-xs opacity-60 ml-1">• Auto</span>}
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
              </div>
            )}

            {/* Message + Poke row */}
            <div className="flex gap-3">
              <button
                onClick={handleStartDM}
                disabled={startingDM}
                className="flex-1 py-3.5 px-4 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium rounded-xl hover:from-indigo-600 hover:to-violet-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {startingDM ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Message
                  </>
                )}
              </button>

              <button
                onClick={handlePoke}
                disabled={!pokeState.canPoke || pokeState.sending || pokeState.loading}
                className={`py-3.5 px-6 font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
                  pokeState.success
                    ? 'bg-emerald-500 text-white'
                    : pokeState.canPoke
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500'
                } disabled:opacity-50`}
              >
                {pokeState.sending ? (
                  <div className="w-5 h-5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                ) : pokeState.success ? (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Poked!
                  </>
                ) : (
                  <span className="text-lg">👋</span>
                )}
              </button>
            </div>

            {/* Poke rate limit info */}
            {!pokeState.canPoke && !pokeState.loading && !pokeState.success && pokeState.hoursRemaining && (
              <p className="text-xs text-stone-400 dark:text-stone-500 text-center">
                Can poke again in {pokeState.hoursRemaining}h
              </p>
            )}
          </div>
        )}
      </div>

      {/* Avatar photo viewer */}
      {showPhotoViewer && profile.avatar_url && (
        <PhotoViewer
          imageUrl={profile.avatar_url}
          displayName={displayName}
          onClose={() => setShowPhotoViewer(false)}
        />
      )}

      {/* Gallery viewer */}
      {galleryViewerIndex !== null && galleryPhotos[galleryViewerIndex] && (
        <GalleryViewer
          photos={galleryPhotos}
          initialIndex={galleryViewerIndex}
          onClose={() => setGalleryViewerIndex(null)}
        />
      )}

      {/* List Modal */}
      {activeList && (
        <ListModal
          type={activeList}
          data={listData}
          loading={listLoading}
          followingInProgress={followingInProgress}
          onFollowToggle={handleListFollowToggle}
          onClose={() => setActiveList(null)}
          onNavigateToProfile={(userId) => {
            setActiveList(null)
            router.push(`/profile/${userId}`)
          }}
        />
      )}
    </div>
  )
}

// Photo Viewer component
function PhotoViewer({
  imageUrl,
  displayName,
  onClose,
}: {
  imageUrl: string
  displayName: string
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 z-10">
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
      </header>
      <div className="flex-1 flex items-center justify-center p-4" onClick={onClose}>
        <Image
          src={imageUrl}
          alt={displayName}
          width={800}
          height={800}
          className="max-w-full max-h-[80vh] object-contain"
          priority
        />
      </div>
    </div>,
    document.body
  )
}

// Gallery Viewer component
function GalleryViewer({
  photos,
  initialIndex,
  onClose,
}: {
  photos: ProfilePhoto[]
  initialIndex: number
  onClose: () => void
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [mounted, setMounted] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setMounted(true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const goNext = useCallback(() => {
    setCurrentIndex(prev => Math.min(prev + 1, photos.length - 1))
  }, [photos.length])

  const goPrev = useCallback(() => {
    setCurrentIndex(prev => Math.max(prev - 1, 0))
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y

    if (Math.abs(dx) > 50 && Math.abs(dy) < 100) {
      if (dx < 0 && currentIndex < photos.length - 1) goNext()
      else if (dx > 0 && currentIndex > 0) goPrev()
    } else if (dy > 100 && Math.abs(dx) < 50) {
      onClose()
    }
    touchStartRef.current = null
  }, [currentIndex, photos.length, goNext, goPrev, onClose])

  if (!mounted) return null

  const currentPhoto = photos[currentIndex]
  if (!currentPhoto) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      <header className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent">
        <div className="px-4 h-14 flex items-center justify-between">
          <button onClick={onClose} className="p-2 -ml-2 text-white/80 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="text-white/80 text-sm font-medium">{currentIndex + 1} / {photos.length}</span>
          <div className="w-10" />
        </div>
      </header>

      <div
        className="flex-1 flex items-center justify-center p-4"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <img src={currentPhoto.url} alt="" className="max-w-full max-h-full object-contain" />
      </div>

      {photos.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 text-white/80 hover:bg-black/60"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {currentIndex < photos.length - 1 && (
            <button
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 text-white/80 hover:bg-black/60"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </>
      )}

      {photos.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent pb-6 pt-12">
          <div className="flex justify-center gap-2 px-4 overflow-x-auto">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                onClick={() => setCurrentIndex(index)}
                className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 transition-all ${
                  index === currentIndex ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src={photo.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// List Modal component
function ListModal({
  type,
  data,
  loading,
  followingInProgress,
  onFollowToggle,
  onClose,
  onNavigateToProfile,
}: {
  type: ListType
  data: UserListItem[] | GroupListItem[]
  loading: boolean
  followingInProgress: Set<string>
  onFollowToggle: (userId: string, currentStatus: string) => void
  onClose: () => void
  onNavigateToProfile: (userId: string) => void
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  if (!mounted) return null

  const isGroupList = type === 'groups' || type === 'mutual_groups'

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-white dark:bg-stone-900 flex flex-col">
      <header className="border-b border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-50 capitalize">
            {type === 'mutual_groups' ? 'Mutual Groups' : type}
          </h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-stone-200 dark:border-stone-700 border-t-stone-600 dark:border-t-stone-300 rounded-full animate-spin" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-16 px-4">
              <p className="text-stone-500 dark:text-stone-400">
                {type === 'followers' && 'No followers yet'}
                {type === 'following' && 'Not following anyone yet'}
                {type === 'groups' && 'Not in any groups yet'}
                {type === 'mutual_groups' && 'No mutual groups'}
              </p>
            </div>
          ) : isGroupList ? (
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {(data as GroupListItem[]).map((group) => (
                <div key={group.room_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-semibold">
                    {group.room_name?.[0]?.toUpperCase() || 'G'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-stone-900 dark:text-stone-50 truncate">{group.room_name || 'Unnamed Group'}</p>
                    <p className="text-sm text-stone-500 dark:text-stone-400">{group.member_count} members</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {(data as UserListItem[]).map((user) => {
                const isFollowing = user.follow_status === 'explicit' || user.follow_status === 'implicit'
                const inProgress = followingInProgress.has(user.user_id)

                return (
                  <div key={user.user_id} className="flex items-center gap-3 px-4 py-3">
                    <button onClick={() => onNavigateToProfile(user.user_id)}>
                      {user.avatar_url ? (
                        <Image src={user.avatar_url} alt="" width={48} height={48} className="w-12 h-12 rounded-full object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-semibold">
                          {getInitials(user.email, user.display_name)}
                        </div>
                      )}
                    </button>
                    <button onClick={() => onNavigateToProfile(user.user_id)} className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-stone-900 dark:text-stone-50 truncate">
                        {getDisplayName(user.email, user.display_name)}
                      </p>
                      {user.mutual_groups_count > 0 && (
                        <p className="text-sm text-stone-500 dark:text-stone-400">
                          {user.mutual_groups_count} mutual group{user.mutual_groups_count !== 1 ? 's' : ''}
                        </p>
                      )}
                    </button>
                    <button
                      onClick={() => onFollowToggle(user.user_id, user.follow_status)}
                      disabled={inProgress}
                      className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        isFollowing
                          ? 'bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                          : 'bg-indigo-500 text-white'
                      } disabled:opacity-50`}
                    >
                      {inProgress ? (
                        <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      ) : isFollowing ? 'Following' : 'Follow'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
