'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
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

type ListType = 'followers' | 'following' | 'groups' | 'mutual' | null

type UserListItem = {
  user_id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  mutual_groups_count: number
  follow_status: FollowStatus
}

type GroupListItem = {
  room_id: string
  room_name: string
  member_count: number
}

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
  user: UserInfo | null
  currentUserId: string | null
  onStartDM: (userId: string) => Promise<void>
  onFollowChange?: (userId: string, isFollowing: boolean) => void
}

// Helper to get initials from name or email
function getInitials(displayName: string | null, email: string): string {
  if (displayName) {
    const parts = displayName.trim().split(' ')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return displayName.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

// Helper to get color from string
function stringToColor(str: string): string {
  const colors = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function ProfileDrawer({
  isOpen,
  onClose,
  user,
  currentUserId,
  onStartDM,
  onFollowChange,
}: ProfileDrawerProps) {
  const router = useRouter()
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

  // List view state
  const [listView, setListView] = useState<ListType>(null)
  const [listLoading, setListLoading] = useState(false)
  const [userList, setUserList] = useState<UserListItem[]>([])
  const [groupList, setGroupList] = useState<GroupListItem[]>([])

  // For nested profile viewing
  const [nestedProfileUser, setNestedProfileUser] = useState<UserInfo | null>(null)

  // Unfollow action sheet
  const [unfollowTarget, setUnfollowTarget] = useState<UserListItem | null>(null)

  // Track follow loading for individual users in lists
  const [listFollowLoading, setListFollowLoading] = useState<Set<string>>(new Set())

  // Pull to refresh
  const listRef = useRef<HTMLDivElement>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Derived state
  const isFollowing = followStatus === 'explicit' || followStatus === 'implicit'
  const isImplicit = followStatus === 'implicit'

  // Check follow status and load stats when drawer opens
  useEffect(() => {
    if (!isOpen || !user) {
      setFollowStatus(null)
      setStatsLoaded(false)
      setStats({ followers_count: 0, following_count: 0, groups_count: 0, mutual_groups_count: 0 })
      setListView(null)
      setUserList([])
      setGroupList([])
      setNestedProfileUser(null)
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

  // Load list data when listView changes
  const loadListData = useCallback(async (type: ListType) => {
    if (!type || !user) return

    setListLoading(true)

    try {
      if (type === 'followers') {
        const { data, error } = await supabase.rpc('get_followers_list', {
          p_user_id: user.id,
          p_limit: 50,
          p_offset: 0
        })
        if (error) throw error
        setUserList(data || [])
      } else if (type === 'following') {
        const { data, error } = await supabase.rpc('get_following_list', {
          p_user_id: user.id,
          p_limit: 50,
          p_offset: 0
        })
        if (error) throw error
        setUserList(data || [])
      } else if (type === 'mutual') {
        const { data, error } = await supabase.rpc('get_mutual_groups_list', {
          p_user_id: user.id,
          p_limit: 50,
          p_offset: 0
        })
        if (error) throw error
        setGroupList(data || [])
      } else if (type === 'groups') {
        // For own profile, show all groups. For others, show mutual only (privacy)
        const isOwnProfile = user.id === currentUserId
        if (isOwnProfile) {
          const { data, error } = await supabase.rpc('get_user_groups_list', {
            p_limit: 50,
            p_offset: 0
          })
          if (error) throw error
          setGroupList(data || [])
        } else {
          // For other users, fall back to mutual groups for privacy
          const { data, error } = await supabase.rpc('get_mutual_groups_list', {
            p_user_id: user.id,
            p_limit: 50,
            p_offset: 0
          })
          if (error) throw error
          setGroupList(data || [])
        }
      }
    } catch (err) {
      console.error(`Failed to load ${type} list:`, err)
    } finally {
      setListLoading(false)
    }
  }, [user, currentUserId])

  useEffect(() => {
    if (listView) {
      loadListData(listView)
    }
  }, [listView, loadListData])

  const handleRefresh = useCallback(async () => {
    if (!listView || refreshing) return
    setRefreshing(true)
    await loadListData(listView)
    setRefreshing(false)
  }, [listView, refreshing, loadListData])

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

  // Handle follow/unfollow in user lists
  const handleListFollow = useCallback(async (targetUser: UserListItem) => {
    if (listFollowLoading.has(targetUser.user_id)) return

    const isCurrentlyFollowing = targetUser.follow_status === 'explicit' || targetUser.follow_status === 'implicit'

    // Add to loading set
    setListFollowLoading(prev => new Set(prev).add(targetUser.user_id))

    // Optimistic update
    setUserList(prev => prev.map(u =>
      u.user_id === targetUser.user_id
        ? { ...u, follow_status: isCurrentlyFollowing ? 'unfollowed' : 'explicit' } as UserListItem
        : u
    ))

    try {
      if (!isCurrentlyFollowing) {
        const { data, error } = await supabase.rpc('follow_user', {
          p_following_id: targetUser.user_id
        })
        if (error) throw error
        // Update to actual status
        setUserList(prev => prev.map(u =>
          u.user_id === targetUser.user_id
            ? { ...u, follow_status: (data as FollowStatus) || 'explicit' }
            : u
        ))
      } else {
        const { error } = await supabase.rpc('unfollow_user', {
          p_following_id: targetUser.user_id
        })
        if (error) throw error
        setUserList(prev => prev.map(u =>
          u.user_id === targetUser.user_id
            ? { ...u, follow_status: 'unfollowed' as FollowStatus }
            : u
        ))
      }
      onFollowChange?.(targetUser.user_id, !isCurrentlyFollowing)
    } catch (err) {
      // Revert optimistic update
      setUserList(prev => prev.map(u =>
        u.user_id === targetUser.user_id
          ? { ...u, follow_status: targetUser.follow_status }
          : u
      ))
      console.error('Failed to toggle follow:', err)
    } finally {
      setListFollowLoading(prev => {
        const next = new Set(prev)
        next.delete(targetUser.user_id)
        return next
      })
      setUnfollowTarget(null)
    }
  }, [listFollowLoading, onFollowChange])

  // Open user profile in list
  const handleOpenUserProfile = useCallback((listUser: UserListItem) => {
    const displayName = listUser.display_name || listUser.email.split('@')[0]
    setNestedProfileUser({
      id: listUser.user_id,
      email: listUser.email,
      displayName,
      initials: getInitials(listUser.display_name, listUser.email),
      color: stringToColor(listUser.user_id),
      textColor: 'text-white',
      isHost: false,
      avatarUrl: listUser.avatar_url,
      bio: null
    })
  }, [])

  // Navigate to group
  const handleNavigateToGroup = useCallback((roomId: string) => {
    onClose()
    router.push(`/room/${roomId}`)
  }, [onClose, router])

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

  const handleStatClick = (type: ListType) => {
    if (!statsLoaded) return
    // For groups on other profiles, show mutual instead
    if (type === 'groups' && !isOwnProfile) {
      setListView('mutual')
    } else {
      setListView(type)
    }
  }

  // Render list title
  const getListTitle = () => {
    switch (listView) {
      case 'followers': return 'Followers'
      case 'following': return 'Following'
      case 'groups': return 'Groups'
      case 'mutual': return 'Mutual Groups'
      default: return ''
    }
  }

  // User list row component
  const UserRow = ({ listUser }: { listUser: UserListItem }) => {
    const displayName = listUser.display_name || listUser.email.split('@')[0]
    const initials = getInitials(listUser.display_name, listUser.email)
    const color = stringToColor(listUser.user_id)
    const isUserFollowing = listUser.follow_status === 'explicit' || listUser.follow_status === 'implicit'
    const isMe = listUser.user_id === currentUserId
    const isLoading = listFollowLoading.has(listUser.user_id)

    return (
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors cursor-pointer"
        onClick={() => handleOpenUserProfile(listUser)}
      >
        {/* Avatar */}
        {listUser.avatar_url ? (
          <img
            src={listUser.avatar_url}
            alt={displayName}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className={`w-12 h-12 rounded-full ${color} flex items-center justify-center text-white font-semibold flex-shrink-0`}>
            {initials}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-stone-900 dark:text-stone-50 truncate">{displayName}</p>
          {listUser.mutual_groups_count > 0 && !isMe && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {listUser.mutual_groups_count} mutual group{listUser.mutual_groups_count !== 1 ? 's' : ''}
            </p>
          )}
          {isMe && (
            <p className="text-xs text-stone-400 dark:text-stone-500">You</p>
          )}
        </div>

        {/* Follow button (not for self) */}
        {!isMe && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isUserFollowing) {
                setUnfollowTarget(listUser)
              } else {
                handleListFollow(listUser)
              }
            }}
            disabled={isLoading}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
              isUserFollowing
                ? 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                : 'bg-indigo-500 text-white hover:bg-indigo-600'
            } disabled:opacity-50`}
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : isUserFollowing ? (
              'Following'
            ) : (
              'Follow'
            )}
          </button>
        )}
      </div>
    )
  }

  // Group list row component
  const GroupRow = ({ group }: { group: GroupListItem }) => {
    return (
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors cursor-pointer"
        onClick={() => handleNavigateToGroup(group.room_id)}
      >
        {/* Group avatar */}
        <div className={`w-12 h-12 rounded-full ${stringToColor(group.room_id)} flex items-center justify-center text-white font-semibold flex-shrink-0`}>
          {group.room_name?.slice(0, 2).toUpperCase() || 'GR'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-stone-900 dark:text-stone-50 truncate">{group.room_name || 'Group'}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {group.member_count} member{group.member_count !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Arrow */}
        <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    )
  }

  // Render list content
  const renderListContent = () => {
    const isUserList = listView === 'followers' || listView === 'following'
    const list = isUserList ? userList : groupList

    if (listLoading) {
      return (
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-stone-200 dark:bg-stone-700 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-stone-200 dark:bg-stone-700 rounded animate-pulse w-32" />
                <div className="h-3 bg-stone-200 dark:bg-stone-700 rounded animate-pulse w-20" />
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-16 h-16 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mb-4">
            {isUserList ? (
              <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            )}
          </div>
          <p className="text-stone-500 dark:text-stone-400 text-sm text-center">
            {listView === 'followers' && 'No followers yet'}
            {listView === 'following' && 'Not following anyone yet'}
            {listView === 'groups' && 'No groups yet'}
            {listView === 'mutual' && 'No mutual groups'}
          </p>
        </div>
      )
    }

    return (
      <div ref={listRef} className="divide-y divide-stone-100 dark:divide-stone-800">
        {refreshing && (
          <div className="flex justify-center py-3">
            <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}
        {isUserList
          ? (userList as UserListItem[]).map((listUser) => (
              <UserRow key={listUser.user_id} listUser={listUser} />
            ))
          : (groupList as GroupListItem[]).map((group) => (
              <GroupRow key={group.room_id} group={group} />
            ))
        }
      </div>
    )
  }

  // Render nested profile (recursive)
  if (nestedProfileUser) {
    return (
      <ProfileDrawer
        isOpen={true}
        onClose={() => setNestedProfileUser(null)}
        user={nestedProfileUser}
        currentUserId={currentUserId}
        onStartDM={onStartDM}
        onFollowChange={onFollowChange}
      />
    )
  }

  // Render list view
  if (listView) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity"
          onClick={() => setListView(null)}
        />

        {/* List drawer */}
        <div className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-stone-900 rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-stone-100 dark:border-stone-800">
            <button
              onClick={() => setListView(null)}
              className="p-1 -ml-1 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-50">{getListTitle()}</h2>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1 -mr-1 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 disabled:opacity-50"
            >
              <svg className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {renderListContent()}
          </div>
        </div>

        {/* Unfollow action sheet */}
        {unfollowTarget && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-[60]"
              onClick={() => setUnfollowTarget(null)}
            />
            <div className="fixed inset-x-4 bottom-4 z-[70] bg-white dark:bg-stone-800 rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom duration-200">
              <div className="p-4 text-center border-b border-stone-100 dark:border-stone-700">
                <p className="font-medium text-stone-900 dark:text-stone-50">
                  {unfollowTarget.display_name || unfollowTarget.email.split('@')[0]}
                </p>
              </div>
              <button
                onClick={() => handleListFollow(unfollowTarget)}
                className="w-full py-4 text-red-500 font-medium text-center hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
              >
                Unfollow
              </button>
              <button
                onClick={() => setUnfollowTarget(null)}
                className="w-full py-4 text-stone-500 dark:text-stone-400 font-medium text-center border-t border-stone-100 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </>
    )
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
        <div className="px-6 pb-8 pt-2 overflow-y-auto">
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

          {/* Interactive Stats */}
          <div className={`grid ${isOwnProfile ? 'grid-cols-3' : 'grid-cols-4'} gap-1 mb-6 bg-stone-50 dark:bg-stone-800 rounded-xl p-1`}>
            <button
              onClick={() => handleStatClick('followers')}
              disabled={!statsLoaded}
              className="flex flex-col items-center py-3 rounded-lg hover:bg-white dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {statsLoaded ? (
                <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.followers_count}</span>
              ) : (
                <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              )}
              <span className="text-[10px] text-stone-500 dark:text-stone-400">Followers</span>
            </button>
            <button
              onClick={() => handleStatClick('following')}
              disabled={!statsLoaded}
              className="flex flex-col items-center py-3 rounded-lg hover:bg-white dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {statsLoaded ? (
                <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.following_count}</span>
              ) : (
                <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              )}
              <span className="text-[10px] text-stone-500 dark:text-stone-400">Following</span>
            </button>
            <button
              onClick={() => handleStatClick('groups')}
              disabled={!statsLoaded}
              className="flex flex-col items-center py-3 rounded-lg hover:bg-white dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {statsLoaded ? (
                <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.groups_count}</span>
              ) : (
                <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              )}
              <span className="text-[10px] text-stone-500 dark:text-stone-400">Groups</span>
            </button>
            {!isOwnProfile && (
              <button
                onClick={() => handleStatClick('mutual')}
                disabled={!statsLoaded}
                className="flex flex-col items-center py-3 rounded-lg hover:bg-white dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
              >
                {statsLoaded ? (
                  <span className="text-lg font-bold text-stone-900 dark:text-stone-50">{stats.mutual_groups_count}</span>
                ) : (
                  <div className="h-6 w-6 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
                )}
                <span className="text-[10px] text-stone-500 dark:text-stone-400">Mutual</span>
              </button>
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
