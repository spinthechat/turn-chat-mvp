'use client'

import { useEffect, useMemo, useState, useCallback, memo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GroupAvatarMosaic, type GroupMember } from '@/app/components/GroupAvatarMosaic'

// Prompt mode options
const PROMPT_MODES = [
  { value: 'fun', label: 'Fun', description: 'Light, playful questions' },
  { value: 'family', label: 'Family', description: 'Warm prompts for families' },
  { value: 'deep', label: 'Deep', description: 'Reflective conversations' },
  { value: 'flirty', label: 'Flirty', description: 'Bold, playful prompts' },
  { value: 'couple', label: 'Couple', description: 'For partners to connect' },
] as const

type PromptMode = typeof PROMPT_MODES[number]['value']

type ChatItem = {
  id: string
  name: string
  type: 'dm' | 'group'
  last_message_at: string | null
  last_message_content: string | null
  last_message_type: string | null
  last_message_user_id: string | null
  member_count: number
  unread_count: number
  other_member?: {
    id: string
    email: string
    displayName: string
    initials: string
    color: string
    avatarUrl: string | null
  }
  // For group chats - up to 4 members for mosaic avatar
  group_members?: GroupMember[]
}

type Profile = {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

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

const getDisplayName = (email: string): string => {
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

const formatTime = (date: string | null): string => {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Skeleton loading component
function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="w-14 h-14 rounded-full bg-stone-100 animate-pulse" />
      <div className="flex-1 space-y-2.5">
        <div className="h-4 bg-stone-100 rounded-full w-32 animate-pulse" />
        <div className="h-3.5 bg-stone-50 rounded-full w-48 animate-pulse" />
      </div>
      <div className="h-3 bg-stone-50 rounded-full w-10 animate-pulse" />
    </div>
  )
}

// Modal component
function Modal({
  isOpen,
  onClose,
  title,
  children
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden transform transition-all">
        <div className="flex items-center justify-between px-6 py-5 border-b border-stone-100">
          <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// Chat avatar component
function ChatAvatar({ chat, size = 'md' }: { chat: ChatItem; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-11 h-11 text-sm',
    md: 'w-14 h-14 text-base',
    lg: 'w-16 h-16 text-lg'
  }

  if (chat.type === 'dm' && chat.other_member) {
    if (chat.other_member.avatarUrl) {
      return (
        <img
          src={chat.other_member.avatarUrl}
          alt={chat.other_member.displayName}
          className={`${sizeClasses[size]} rounded-full object-cover flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50`}
        />
      )
    }
    return (
      <div className={`${sizeClasses[size]} rounded-full ${chat.other_member.color} flex items-center justify-center text-white font-medium flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50`}>
        {chat.other_member.initials}
      </div>
    )
  }

  // Group avatar - use mosaic if we have members
  if (chat.group_members && chat.group_members.length > 0) {
    return <GroupAvatarMosaic members={chat.group_members} size={size} />
  }

  // Fallback group avatar
  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-stone-100 to-stone-200 dark:from-stone-700 dark:to-stone-800 flex items-center justify-center flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50`}>
      <svg className="w-7 h-7 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    </div>
  )
}

// Room list item component - memoized to prevent re-renders
const RoomListItem = memo(function RoomListItem({
  chat,
  profiles,
  currentUserId,
}: {
  chat: ChatItem
  profiles: Map<string, Profile>
  currentUserId: string | null
}) {
  const hasUnread = chat.unread_count > 0

  const displayName = useMemo(() => {
    if (chat.type === 'dm' && chat.other_member) {
      return chat.other_member.displayName
    }
    return chat.name
  }, [chat])

  const lastMessagePreview = useMemo(() => {
    if (!chat.last_message_content) return 'No messages yet'

    let preview = chat.last_message_content

    // Handle photo turn JSON
    if (chat.last_message_type === 'turn_response') {
      try {
        const parsed = JSON.parse(preview)
        if (parsed.kind === 'photo_turn') {
          preview = 'Sent a photo'
        }
      } catch {
        if (preview.startsWith('Reply to "')) {
          const parts = preview.split('\n\n')
          if (parts.length > 1) {
            preview = parts.slice(1).join(' ')
          }
        }
      }
    } else if (chat.last_message_type === 'image') {
      preview = 'Sent a photo'
    }

    // Truncate
    if (preview.length > 45) {
      preview = preview.slice(0, 45) + '...'
    }

    // Add sender context
    if (chat.last_message_user_id && chat.last_message_user_id !== currentUserId) {
      const sender = profiles.get(chat.last_message_user_id)
      if (sender && chat.type === 'group') {
        const senderName = sender.display_name?.split(' ')[0] || getDisplayName(sender.email).split(' ')[0]
        preview = `${senderName}: ${preview}`
      }
    } else if (chat.last_message_user_id === currentUserId) {
      preview = `You: ${preview}`
    }

    return preview
  }, [chat, currentUserId, profiles])

  return (
    <Link
      href={`/room/${chat.id}`}
      prefetch={true}
      className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors duration-100
        ${hasUnread ? 'bg-stone-50/50' : 'bg-white'}
        hover:bg-stone-50 active:bg-stone-100`}
    >
      <ChatAvatar chat={chat} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`truncate text-[15px] ${hasUnread ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'}`}>
            {displayName}
          </span>
          <span className={`text-xs flex-shrink-0 tabular-nums ${hasUnread ? 'text-stone-900 font-medium' : 'text-stone-400'}`}>
            {formatTime(chat.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 mt-1">
          <span className={`text-[14px] truncate ${hasUnread ? 'text-stone-600' : 'text-stone-400'}`}>
            {lastMessagePreview}
          </span>
          {hasUnread && (
            <span className="min-w-[22px] h-[22px] flex items-center justify-center bg-stone-900 text-white text-[11px] font-semibold rounded-full px-1.5 flex-shrink-0">
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
          {!hasUnread && chat.type === 'group' && (
            <span className="text-[11px] text-stone-300 flex-shrink-0">
              {chat.member_count}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
})

// Empty state component
function EmptyState({ onNewChat, onNewGroup }: { onNewChat: () => void; onNewGroup: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
      <div className="w-20 h-20 rounded-full bg-stone-100 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-stone-900 mb-2">No conversations yet</h3>
      <p className="text-stone-500 text-center mb-8 max-w-xs">
        Start a chat with someone or create a group to get going.
      </p>
      <div className="flex gap-3">
        <button
          onClick={onNewChat}
          className="px-5 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-full hover:bg-stone-800 transition-colors"
        >
          New Chat
        </button>
        <button
          onClick={onNewGroup}
          className="px-5 py-2.5 bg-stone-100 text-stone-700 text-sm font-medium rounded-full hover:bg-stone-200 transition-colors"
        >
          New Group
        </button>
      </div>
    </div>
  )
}

export default function ChatsPage() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userProfile, setUserProfile] = useState<Profile | null>(null)
  const [chats, setChats] = useState<ChatItem[]>([])
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal states
  const [showNewDM, setShowNewDM] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [dmEmail, setDmEmail] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupEmails, setGroupEmails] = useState('')
  const [groupPromptMode, setGroupPromptMode] = useState<PromptMode | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadChats = useCallback(async (uid: string) => {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, email, display_name, avatar_url')

    const profileMap = new Map<string, Profile>()
    if (profilesData) {
      for (const p of profilesData) {
        profileMap.set(p.id, p)
      }
    }
    setProfiles(profileMap)

    const { data: roomsData, error: roomsErr } = await supabase.rpc('get_rooms_with_unread')

    if (roomsErr) {
      console.error('Error fetching rooms:', roomsErr)
      setError(roomsErr.message)
      return
    }

    const chatItems: ChatItem[] = []

    for (const room of roomsData ?? []) {
      let otherMember = undefined
      let groupMembers: GroupMember[] | undefined = undefined

      // Fetch members for this room
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', room.room_id)
        .limit(5) // Fetch up to 5 to have 4 after excluding current user

      if (room.room_type === 'dm') {
        if (members) {
          const otherUserId = members.find((m: any) => m.user_id !== uid)?.user_id
          if (otherUserId) {
            const otherProfile = profileMap.get(otherUserId)
            if (otherProfile) {
              const name = otherProfile.display_name || getDisplayName(otherProfile.email)
              otherMember = {
                id: otherUserId,
                email: otherProfile.email,
                displayName: name,
                initials: otherProfile.display_name
                  ? otherProfile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                  : getInitials(otherProfile.email),
                color: stringToColor(otherUserId),
                avatarUrl: otherProfile.avatar_url
              }
            }
          }
        }
      } else {
        // Group chat - build mosaic members (exclude current user, take up to 4)
        if (members) {
          groupMembers = members
            .filter((m: any) => m.user_id !== uid)
            .slice(0, 4)
            .map((m: any) => {
              const profile = profileMap.get(m.user_id)
              const displayName = profile?.display_name || (profile?.email ? getDisplayName(profile.email) : 'Unknown')
              return {
                id: m.user_id,
                displayName,
                initials: profile?.display_name
                  ? profile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                  : (profile?.email ? getInitials(profile.email) : '??'),
                color: stringToColor(m.user_id),
                avatarUrl: profile?.avatar_url || null
              }
            })

          // If we filtered out everyone (user is alone), show their own avatar
          if (groupMembers.length === 0 && members.length > 0) {
            const myProfile = profileMap.get(uid)
            if (myProfile) {
              groupMembers = [{
                id: uid,
                displayName: myProfile.display_name || getDisplayName(myProfile.email),
                initials: myProfile.display_name
                  ? myProfile.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                  : getInitials(myProfile.email),
                color: stringToColor(uid),
                avatarUrl: myProfile.avatar_url || null
              }]
            }
          }
        }
      }

      chatItems.push({
        id: room.room_id,
        name: room.room_name,
        type: room.room_type || 'group',
        last_message_at: room.last_message_at,
        last_message_content: room.last_message_content,
        last_message_type: room.last_message_type,
        last_message_user_id: room.last_message_user_id,
        member_count: Number(room.member_count),
        unread_count: Number(room.unread_count),
        other_member: otherMember,
        group_members: groupMembers
      })
    }

    setChats(chatItems)
  }, [])

  useEffect(() => {
    let channel: any = null

    const init = async () => {
      setLoading(true)
      setError(null)

      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user) {
        router.push('/login')
        return
      }

      setUserId(user.id)
      setUserEmail(user.email ?? null)

      const { data: myProfile } = await supabase
        .from('profiles')
        .select('id, email, display_name, avatar_url')
        .eq('id', user.id)
        .single()

      if (myProfile) {
        setUserProfile(myProfile as Profile)
      }

      await loadChats(user.id)
      setLoading(false)

      channel = supabase
        .channel('inbox-updates')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          () => {
            if (user.id) loadChats(user.id)
          }
        )
        .subscribe()
    }

    init()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [router, loadChats])

  const createDM = async () => {
    if (!dmEmail.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      const { data: roomId, error: err } = await supabase.rpc('create_dm_by_email', {
        p_email: dmEmail.trim()
      })

      if (err) throw err

      setShowNewDM(false)
      setDmEmail('')
      router.push(`/room/${roomId}`)
    } catch (e: any) {
      setError(e.message || 'Failed to create chat')
    } finally {
      setSubmitting(false)
    }
  }

  const createGroup = async () => {
    if (!groupName.trim() || !groupPromptMode) return
    setSubmitting(true)
    setError(null)

    try {
      const emails = groupEmails
        .split(/[,\n]/)
        .map(e => e.trim())
        .filter(e => e.length > 0)

      const { data: roomId, error: err } = await supabase.rpc('create_group_with_members', {
        p_name: groupName.trim(),
        p_member_emails: emails,
        p_prompt_mode: groupPromptMode
      })

      if (err) throw err

      setShowNewGroup(false)
      setGroupName('')
      setGroupEmails('')
      setGroupPromptMode(null)
      router.push(`/room/${roomId}`)
    } catch (e: any) {
      setError(e.message || 'Failed to create group')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-stone-100">
        <div className="max-w-2xl mx-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Chats</h1>
            </div>
            <div className="flex items-center gap-1">
              {/* New chat button */}
              <button
                onClick={() => setShowNewDM(true)}
                className="p-2.5 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                title="New chat"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </button>
              {/* Profile button */}
              <button
                onClick={() => router.push('/profile')}
                className="ml-1"
                title="Profile"
              >
                {userProfile?.avatar_url ? (
                  <img
                    src={userProfile.avatar_url}
                    alt="Profile"
                    className="w-9 h-9 rounded-full object-cover ring-2 ring-stone-100 hover:ring-stone-200 transition-all"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 text-sm font-medium hover:bg-stone-200 transition-colors">
                    {userProfile?.display_name
                      ? userProfile.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                      : getInitials(userEmail || '')}
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="max-w-2xl mx-auto w-full px-5 pt-4">
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-full transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {loading ? (
            // Skeleton loading
            <div className="divide-y divide-stone-50">
              {[...Array(6)].map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : chats.length === 0 ? (
            <EmptyState
              onNewChat={() => setShowNewDM(true)}
              onNewGroup={() => setShowNewGroup(true)}
            />
          ) : (
            <div className="divide-y divide-stone-100/50">
              {chats.map((chat) => (
                <RoomListItem
                  key={chat.id}
                  chat={chat}
                  profiles={profiles}
                  currentUserId={userId}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating action button for new group */}
      {!loading && chats.length > 0 && (
        <div className="fixed bottom-6 right-6">
          <button
            onClick={() => setShowNewGroup(true)}
            className="w-14 h-14 bg-stone-900 text-white rounded-full shadow-lg hover:bg-stone-800 active:scale-95 transition-all flex items-center justify-center"
            title="New group"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
      )}

      {/* New DM Modal */}
      <Modal isOpen={showNewDM} onClose={() => setShowNewDM(false)} title="New Chat">
        <div className="space-y-5">
          <p className="text-sm text-stone-500">
            Enter an email address to start a conversation.
          </p>
          <input
            value={dmEmail}
            onChange={(e) => setDmEmail(e.target.value)}
            placeholder="friend@example.com"
            type="email"
            autoFocus
            className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3.5 text-[15px] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            onKeyDown={(e) => {
              if (e.key === 'Enter') createDM()
            }}
          />
          <button
            onClick={createDM}
            disabled={!dmEmail.trim() || submitting}
            className="w-full bg-stone-900 text-white py-3.5 rounded-xl text-[15px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-800"
          >
            {submitting ? 'Starting...' : 'Start Chat'}
          </button>
        </div>
      </Modal>

      {/* New Group Modal */}
      <Modal
        isOpen={showNewGroup}
        onClose={() => { setShowNewGroup(false); setGroupName(''); setGroupEmails(''); setGroupPromptMode(null) }}
        title="New Group"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Group Name</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Weekend Squad"
              autoFocus
              className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3.5 text-[15px] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Vibe</label>
            <div className="grid grid-cols-2 gap-2">
              {PROMPT_MODES.map(mode => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setGroupPromptMode(mode.value)}
                  className={`px-4 py-3 rounded-xl text-sm text-left transition-all ${
                    groupPromptMode === mode.value
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <div className="font-medium">{mode.label}</div>
                  <div className={`text-xs mt-0.5 ${groupPromptMode === mode.value ? 'text-stone-300' : 'text-stone-400'}`}>
                    {mode.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Members <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={groupEmails}
              onChange={(e) => setGroupEmails(e.target.value)}
              placeholder="friend1@email.com, friend2@email.com"
              rows={2}
              className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3.5 text-[15px] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 resize-none"
            />
          </div>

          <button
            onClick={createGroup}
            disabled={!groupName.trim() || !groupPromptMode || submitting}
            className="w-full bg-stone-900 text-white py-3.5 rounded-xl text-[15px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-800"
          >
            {submitting ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
