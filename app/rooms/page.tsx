'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

type ChatItem = {
  id: string
  name: string
  type: 'dm' | 'group'
  last_message_at: string | null
  last_message_content: string | null
  last_message_user_id: string | null
  member_count: number
  other_member?: {
    id: string
    email: string
    displayName: string
    initials: string
    color: string
    avatarUrl: string | null
  }
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
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' })
  } else {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="font-semibold text-stone-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// Chat avatar component
function ChatAvatar({
  chat,
  size = 'md'
}: {
  chat: ChatItem
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses = {
    sm: 'w-10 h-10 text-sm',
    md: 'w-12 h-12 text-base',
    lg: 'w-14 h-14 text-lg'
  }

  if (chat.type === 'dm' && chat.other_member) {
    if (chat.other_member.avatarUrl) {
      return (
        <img
          src={chat.other_member.avatarUrl}
          alt={chat.other_member.displayName}
          className={`${sizeClasses[size]} rounded-full object-cover flex-shrink-0`}
        />
      )
    }
    return (
      <div className={`${sizeClasses[size]} rounded-full ${chat.other_member.color} flex items-center justify-center text-white font-semibold flex-shrink-0`}>
        {chat.other_member.initials}
      </div>
    )
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    </div>
  )
}

// Chat list item
function ChatListItem({
  chat,
  profiles,
  currentUserId,
  onClick
}: {
  chat: ChatItem
  profiles: Map<string, Profile>
  currentUserId: string | null
  onClick: () => void
}) {
  const displayName = useMemo(() => {
    if (chat.type === 'dm' && chat.other_member) {
      return chat.other_member.displayName
    }
    return chat.name
  }, [chat])

  const lastMessagePreview = useMemo(() => {
    if (!chat.last_message_content) return 'No messages yet'

    let preview = chat.last_message_content
    if (preview.startsWith('Reply to "')) {
      // It's a turn response, show just the response part
      const parts = preview.split('\n\n')
      if (parts.length > 1) {
        preview = parts.slice(1).join(' ')
      }
    }

    // Truncate if too long
    if (preview.length > 50) {
      preview = preview.slice(0, 50) + '...'
    }

    // Add sender name if it's from someone else
    if (chat.last_message_user_id && chat.last_message_user_id !== currentUserId) {
      const sender = profiles.get(chat.last_message_user_id)
      if (sender) {
        const senderName = getDisplayName(sender.email).split(' ')[0]
        preview = `${senderName}: ${preview}`
      }
    } else if (chat.last_message_user_id === currentUserId) {
      preview = `You: ${preview}`
    }

    return preview
  }, [chat, currentUserId, profiles])

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 cursor-pointer transition-colors"
    >
      <ChatAvatar chat={chat} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-stone-900 truncate">{displayName}</span>
          <span className="text-xs text-stone-400 flex-shrink-0">
            {formatTime(chat.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-sm text-stone-500 truncate">{lastMessagePreview}</span>
          {chat.type === 'group' && (
            <span className="text-[10px] text-stone-400 flex-shrink-0 bg-stone-100 px-1.5 py-0.5 rounded">
              {chat.member_count}
            </span>
          )}
        </div>
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
  const [submitting, setSubmitting] = useState(false)

  const loadChats = useCallback(async (uid: string) => {
    // Fetch all profiles first
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

    // Fetch rooms with memberships
    const { data: memberships, error: memErr } = await supabase
      .from('room_members')
      .select(`
        room_id,
        rooms (
          id,
          name,
          type,
          last_message_at,
          created_at
        )
      `)
      .eq('user_id', uid)

    if (memErr) {
      setError(memErr.message)
      return
    }

    // Get last messages for each room
    const roomIds = memberships?.map((m: any) => m.room_id).filter(Boolean) ?? []

    let lastMessages: any[] = []
    if (roomIds.length > 0) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('room_id, content, user_id, created_at')
        .in('room_id', roomIds)
        .order('created_at', { ascending: false })

      // Group by room_id and take first (latest) for each
      const msgByRoom = new Map<string, any>()
      for (const msg of msgs ?? []) {
        if (!msgByRoom.has(msg.room_id)) {
          msgByRoom.set(msg.room_id, msg)
        }
      }
      lastMessages = Array.from(msgByRoom.values())
    }

    // Get member counts and other DM member
    const chatItems: ChatItem[] = []

    for (const membership of memberships ?? []) {
      const room = (membership as any).rooms
      if (!room) continue

      // Get members of this room
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', room.id)

      const memberCount = members?.length ?? 0

      // For DMs, find the other member
      let otherMember = undefined
      if (room.type === 'dm' && members) {
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
                ? otherProfile.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                : getInitials(otherProfile.email),
              color: stringToColor(otherUserId),
              avatarUrl: otherProfile.avatar_url
            }
          }
        }
      }

      const lastMsg = lastMessages.find(m => m.room_id === room.id)

      chatItems.push({
        id: room.id,
        name: room.name,
        type: room.type || 'group',
        last_message_at: lastMsg?.created_at ?? room.last_message_at ?? room.created_at,
        last_message_content: lastMsg?.content ?? null,
        last_message_user_id: lastMsg?.user_id ?? null,
        member_count: memberCount,
        other_member: otherMember
      })
    }

    // Sort by last_message_at descending
    chatItems.sort((a, b) => {
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return bTime - aTime
    })

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

      // Fetch user's own profile
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

      // Subscribe to new messages for realtime inbox updates
      channel = supabase
        .channel('inbox-updates')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          () => {
            // Reload chats when any message is inserted
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
    if (!groupName.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      const emails = groupEmails
        .split(/[,\n]/)
        .map(e => e.trim())
        .filter(e => e.length > 0)

      const { data: roomId, error: err } = await supabase.rpc('create_group_with_members', {
        p_name: groupName.trim(),
        p_member_emails: emails
      })

      if (err) throw err

      setShowNewGroup(false)
      setGroupName('')
      setGroupEmails('')
      router.push(`/room/${roomId}`)
    } catch (e: any) {
      setError(e.message || 'Failed to create group')
    } finally {
      setSubmitting(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-500 to-violet-500 text-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Chats</h1>
              <p className="text-white/70 text-sm">
                {userProfile?.display_name || userEmail}
              </p>
            </div>
            <button
              onClick={() => router.push('/profile')}
              className="relative group"
              title="Edit profile"
            >
              {userProfile?.avatar_url ? (
                <img
                  src={userProfile.avatar_url}
                  alt="Profile"
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-white/30 group-hover:ring-white/60 transition-all"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold ring-2 ring-white/30 group-hover:ring-white/60 transition-all">
                  {userProfile?.display_name
                    ? userProfile.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                    : getInitials(userEmail || '')}
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-sm">
                <svg className="w-3 h-3 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
            </button>
          </div>
        </div>
      </header>

      {/* Action buttons */}
      <div className="bg-stone-50 border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex gap-2">
          <button
            onClick={() => setShowNewDM(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-white rounded-xl px-4 py-3 text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50 transition-colors"
          >
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            New Chat
          </button>
          <button
            onClick={() => setShowNewGroup(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-white rounded-xl px-4 py-3 text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50 transition-colors"
          >
            <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            New Group
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {loading ? (
            <div className="py-16 text-center">
              <div className="w-8 h-8 border-2 border-stone-200 border-t-indigo-500 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-stone-400 mt-3">Loading chats...</p>
            </div>
          ) : chats.length === 0 ? (
            <div className="py-16 text-center px-4">
              <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="font-medium text-stone-900 mb-1">No chats yet</h3>
              <p className="text-sm text-stone-500">Start a new chat or create a group to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {chats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  profiles={profiles}
                  currentUserId={userId}
                  onClick={() => router.push(`/room/${chat.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New DM Modal */}
      <Modal isOpen={showNewDM} onClose={() => setShowNewDM(false)} title="New Chat">
        <div className="space-y-4">
          <p className="text-sm text-stone-500">
            Enter the email address of the person you want to chat with.
          </p>
          <input
            value={dmEmail}
            onChange={(e) => setDmEmail(e.target.value)}
            placeholder="friend@example.com"
            type="email"
            className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            onKeyDown={(e) => {
              if (e.key === 'Enter') createDM()
            }}
          />
          <button
            onClick={createDM}
            disabled={!dmEmail.trim() || submitting}
            className="w-full bg-gradient-to-r from-indigo-500 to-violet-500 text-white py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:from-indigo-600 hover:to-violet-600"
          >
            {submitting ? 'Creating...' : 'Start Chat'}
          </button>
        </div>
      </Modal>

      {/* New Group Modal */}
      <Modal isOpen={showNewGroup} onClose={() => setShowNewGroup(false)} title="New Group">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Group Name</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="My Awesome Group"
              className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Add Members (optional)
            </label>
            <textarea
              value={groupEmails}
              onChange={(e) => setGroupEmails(e.target.value)}
              placeholder="Enter emails, separated by commas or new lines"
              rows={3}
              className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            />
            <p className="text-xs text-stone-400 mt-1">
              You can also add members later from within the group.
            </p>
          </div>
          <button
            onClick={createGroup}
            disabled={!groupName.trim() || submitting}
            className="w-full bg-gradient-to-r from-indigo-500 to-violet-500 text-white py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:from-indigo-600 hover:to-violet-600"
          >
            {submitting ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
