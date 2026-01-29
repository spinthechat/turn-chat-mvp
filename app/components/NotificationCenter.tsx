'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Image from 'next/image'

type NotificationItem = {
  id: string
  type: string
  actor_user_id: string | null
  actor_email: string | null
  actor_display_name: string | null
  actor_avatar_url: string | null
  room_id: string | null
  room_name: string | null
  story_id: string | null
  message_id: string | null
  metadata: Record<string, any> | null
  created_at: string
  read_at: string | null
}

type FilterType = 'all' | 'social' | 'turns' | 'groups'

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'social', label: 'Social' },
  { value: 'turns', label: 'Turns' },
  { value: 'groups', label: 'Groups' },
]

// Generate consistent colors from string
const stringToColor = (str: string): string => {
  const colors = [
    'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 'bg-blue-500',
    'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

const getInitials = (email: string): string => {
  const name = email.split('@')[0]
  const cleaned = name.replace(/[0-9]/g, '')
  const parts = cleaned.split(/[._-]/).filter(p => p.length > 0)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return cleaned.toUpperCase() || '??'
}

const getDisplayName = (email: string, displayName: string | null): string => {
  if (displayName) return displayName
  const name = email.split('@')[0]
  return name
    .replace(/[._-]/g, ' ')
    .replace(/[0-9]/g, '')
    .trim()
    .split(' ')
    .filter(p => p.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ') || name
}

const formatRelativeTime = (date: string): string => {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays === 1) return '1d'
  if (diffDays < 7) return `${diffDays}d`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Notification type to icon/color mapping
const getNotificationIcon = (type: string): { icon: ReactNode; bgColor: string } => {
  switch (type) {
    case 'followed_you':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        ),
        bgColor: 'bg-indigo-500',
      }
    case 'unfollowed_you':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
          </svg>
        ),
        bgColor: 'bg-stone-400',
      }
    case 'your_turn':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-amber-500',
      }
    case 'nudged_you':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        ),
        bgColor: 'bg-orange-500',
      }
    case 'turn_skipped':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
          </svg>
        ),
        bgColor: 'bg-red-500',
      }
    case 'turn_completed':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-emerald-500',
      }
    case 'added_to_group':
    case 'group_invite':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        ),
        bgColor: 'bg-violet-500',
      }
    case 'removed_from_group':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
          </svg>
        ),
        bgColor: 'bg-red-400',
      }
    case 'story_reply':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        ),
        bgColor: 'bg-pink-500',
      }
    default:
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        ),
        bgColor: 'bg-stone-500',
      }
  }
}

// Get notification text based on type
const getNotificationText = (notification: NotificationItem): string => {
  const actorName = notification.actor_email
    ? getDisplayName(notification.actor_email, notification.actor_display_name)
    : 'Someone'

  switch (notification.type) {
    case 'followed_you':
      return `${actorName} started following you`
    case 'unfollowed_you':
      return `${actorName} unfollowed you`
    case 'your_turn':
      return `It's your turn${notification.room_name ? ` in ${notification.room_name}` : ''}`
    case 'nudged_you':
      return `${actorName} nudged you - it's your turn!`
    case 'turn_skipped':
      return `Your turn was skipped${notification.room_name ? ` in ${notification.room_name}` : ''}`
    case 'turn_completed':
      return `${actorName} completed their turn${notification.room_name ? ` in ${notification.room_name}` : ''}`
    case 'added_to_group':
      return `You were added to ${notification.room_name || 'a group'}`
    case 'group_invite':
      return `You were invited to join ${notification.room_name || 'a group'}`
    case 'removed_from_group':
      return `You were removed from ${notification.metadata?.room_name || notification.room_name || 'a group'}`
    case 'story_reply':
      return `${actorName} replied to your story`
    default:
      return 'You have a new notification'
  }
}

// Get secondary text (like prompt preview)
const getSecondaryText = (notification: NotificationItem): string | null => {
  if (notification.type === 'your_turn' && notification.metadata?.prompt_text) {
    const prompt = notification.metadata.prompt_text as string
    return prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt
  }
  if (notification.type === 'story_reply' && notification.metadata?.reply_preview) {
    return `"${notification.metadata.reply_preview}"`
  }
  return null
}

interface NotificationCenterProps {
  isOpen: boolean
  onClose: () => void
  onNavigateToRoom: (roomId: string) => void
  onNavigateToProfile: (userId: string) => void
  userId: string | null
}

export function NotificationCenter({
  isOpen,
  onClose,
  onNavigateToRoom,
  onNavigateToProfile,
  userId,
}: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const PAGE_SIZE = 50

  // Fetch notifications
  const fetchNotifications = useCallback(async (offset = 0, append = false) => {
    if (!userId) return

    try {
      if (offset === 0) setLoading(true)
      else setLoadingMore(true)

      const { data, error } = await supabase.rpc('get_notifications', {
        p_limit: PAGE_SIZE,
        p_offset: offset,
        p_filter: filter,
      })

      if (error) throw error

      const items = (data || []) as NotificationItem[]

      if (append) {
        setNotifications(prev => [...prev, ...items])
      } else {
        setNotifications(items)
      }

      setHasMore(items.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [userId, filter])

  // Initial fetch and filter change
  useEffect(() => {
    if (isOpen && userId) {
      fetchNotifications()
    }
  }, [isOpen, userId, filter, fetchNotifications])

  // Realtime subscription
  useEffect(() => {
    if (!isOpen || !userId) return

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          // Fetch the full notification with actor profile
          const { data } = await supabase.rpc('get_notifications', {
            p_limit: 1,
            p_offset: 0,
            p_filter: 'all',
          })

          if (data && data.length > 0) {
            const newNotif = data[0] as NotificationItem
            // Check if notification matches current filter
            if (filter === 'all' || matchesFilter(newNotif.type, filter)) {
              setNotifications(prev => [newNotif, ...prev])
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [isOpen, userId, filter])

  // Check if notification type matches filter
  const matchesFilter = (type: string, filterType: FilterType): boolean => {
    switch (filterType) {
      case 'social':
        return ['followed_you', 'unfollowed_you', 'story_reply', 'story_view_milestone'].includes(type)
      case 'turns':
        return ['your_turn', 'nudged_you', 'turn_skipped', 'turn_completed'].includes(type)
      case 'groups':
        return ['group_invite', 'added_to_group', 'removed_from_group'].includes(type)
      default:
        return true
    }
  }

  // Load more on scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || loadingMore || !hasMore) return

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNotifications(notifications.length, true)
    }
  }, [loadingMore, hasMore, notifications.length, fetchNotifications])

  // Mark single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await supabase.rpc('mark_notification_read', { p_notification_id: notificationId })
      setNotifications(prev =>
        prev.map(n => (n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n))
      )
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }, [])

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    setMarkingAllRead(true)
    try {
      await supabase.rpc('mark_all_notifications_read')
      setNotifications(prev =>
        prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
      )
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    } finally {
      setMarkingAllRead(false)
    }
  }, [])

  // Handle notification tap
  const handleNotificationTap = useCallback((notification: NotificationItem) => {
    // Mark as read
    if (!notification.read_at) {
      markAsRead(notification.id)
    }

    // Navigate based on type
    switch (notification.type) {
      case 'followed_you':
      case 'unfollowed_you':
        if (notification.actor_user_id) {
          onNavigateToProfile(notification.actor_user_id)
        }
        break
      case 'your_turn':
      case 'nudged_you':
      case 'turn_skipped':
      case 'turn_completed':
      case 'added_to_group':
      case 'group_invite':
        if (notification.room_id) {
          onNavigateToRoom(notification.room_id)
        }
        break
      case 'story_reply':
        if (notification.room_id) {
          onNavigateToRoom(notification.room_id)
        }
        break
      case 'removed_from_group':
        // Can't navigate to a group you were removed from
        break
    }

    onClose()
  }, [markAsRead, onNavigateToRoom, onNavigateToProfile, onClose])

  // Pull to refresh
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const PULL_THRESHOLD = 80

  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollRef.current?.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (scrollRef.current?.scrollTop !== 0 || isRefreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.5, PULL_THRESHOLD * 1.5))
    }
  }

  const handleTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true)
      await fetchNotifications()
      setIsRefreshing(false)
    }
    setPullDistance(0)
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-stone-900 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 bg-white/80 dark:bg-stone-900/80 backdrop-blur-xl border-b border-stone-100 dark:border-stone-800 safe-area-top">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-2 -ml-2 rounded-full text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-50 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <h1 className="text-xl font-bold text-stone-900 dark:text-stone-50">Notifications</h1>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                disabled={markingAllRead}
                className="text-sm text-indigo-500 hover:text-indigo-600 font-medium disabled:opacity-50"
              >
                {markingAllRead ? 'Marking...' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-1 -mx-1 px-1">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  filter === f.value
                    ? 'bg-stone-900 dark:bg-stone-50 text-white dark:text-stone-900'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain"
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        <div
          className="flex items-center justify-center overflow-hidden transition-all duration-200 ease-out"
          style={{
            height: isRefreshing ? 56 : pullDistance,
            opacity: isRefreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1),
          }}
        >
          <div
            className={`w-6 h-6 border-2 border-stone-300 dark:border-stone-600 border-t-stone-600 dark:border-t-stone-300 rounded-full ${
              isRefreshing ? 'animate-spin' : ''
            }`}
          />
        </div>

        {loading ? (
          // Skeleton loading
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-4">
                <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-stone-100 dark:bg-stone-800 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-stone-50 dark:bg-stone-800/50 rounded w-1/4 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-8">
            <div className="w-16 h-16 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-50 mb-1">No notifications</h3>
            <p className="text-sm text-stone-500 dark:text-stone-400 text-center">
              {filter === 'all'
                ? "You're all caught up!"
                : `No ${filter} notifications yet`}
            </p>
          </div>
        ) : (
          // Notification list
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {notifications.map(notification => {
              const { icon, bgColor } = getNotificationIcon(notification.type)
              const isUnread = !notification.read_at
              const secondaryText = getSecondaryText(notification)

              return (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationTap(notification)}
                  className={`w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50 ${
                    isUnread ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''
                  }`}
                >
                  {/* Avatar or icon */}
                  <div className="relative flex-shrink-0">
                    {notification.actor_avatar_url ? (
                      <Image
                        src={notification.actor_avatar_url}
                        alt=""
                        width={40}
                        height={40}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : notification.actor_email ? (
                      <div className={`w-10 h-10 rounded-full ${stringToColor(notification.actor_email)} flex items-center justify-center text-white text-sm font-medium`}>
                        {getInitials(notification.actor_email)}
                      </div>
                    ) : (
                      <div className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center text-white`}>
                        {icon}
                      </div>
                    )}
                    {/* Type badge overlay */}
                    {notification.actor_email && (
                      <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full ${bgColor} flex items-center justify-center text-white ring-2 ring-white dark:ring-stone-900`}>
                        <span className="scale-75">{icon}</span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isUnread ? 'text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-700 dark:text-stone-300'}`}>
                      {getNotificationText(notification)}
                    </p>
                    {secondaryText && (
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                        {secondaryText}
                      </p>
                    )}
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                      {formatRelativeTime(notification.created_at)}
                    </p>
                  </div>

                  {/* Unread indicator */}
                  {isUnread && (
                    <div className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0 mt-2" />
                  )}
                </button>
              )
            })}

            {/* Loading more indicator */}
            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <div className="w-5 h-5 border-2 border-stone-300 dark:border-stone-600 border-t-stone-600 dark:border-t-stone-300 rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Bell icon with badge for header
interface NotificationBellProps {
  unreadCount: number
  onClick: () => void
}

export function NotificationBell({ unreadCount, onClick }: NotificationBellProps) {
  return (
    <button
      onClick={onClick}
      className="relative p-2.5 rounded-full text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-50 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
      title="Notifications"
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 shadow-sm">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

// Hook to manage notification state globally
export function useNotifications(userId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0)

  // Fetch initial unread count
  useEffect(() => {
    if (!userId) {
      setUnreadCount(0)
      return
    }

    const fetchUnreadCount = async () => {
      try {
        const { data, error } = await supabase.rpc('get_unread_notification_count')
        if (error) throw error
        setUnreadCount(data || 0)
      } catch (err) {
        console.error('Failed to fetch unread count:', err)
      }
    }

    fetchUnreadCount()
  }, [userId])

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('notifications-count')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          setUnreadCount(prev => prev + 1)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // If read_at was set (marked as read), decrease count
          const newRecord = payload.new as { read_at: string | null }
          const oldRecord = payload.old as { read_at: string | null }
          if (newRecord.read_at && !oldRecord.read_at) {
            setUnreadCount(prev => Math.max(0, prev - 1))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const refreshCount = useCallback(async () => {
    if (!userId) return
    try {
      const { data, error } = await supabase.rpc('get_unread_notification_count')
      if (error) throw error
      setUnreadCount(data || 0)
    } catch (err) {
      console.error('Failed to refresh unread count:', err)
    }
  }, [userId])

  return { unreadCount, refreshCount }
}
