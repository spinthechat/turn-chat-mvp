// Color and message grouping utilities

import type { Msg, MessageGroupPosition } from '../types'

// Generate consistent colors from user ID
export const stringToColors = (str: string): { bg: string; text: string } => {
  const colorPairs = [
    { bg: 'bg-red-500', text: 'text-red-600' },
    { bg: 'bg-orange-500', text: 'text-orange-600' },
    { bg: 'bg-amber-500', text: 'text-amber-600' },
    { bg: 'bg-yellow-500', text: 'text-yellow-600' },
    { bg: 'bg-lime-500', text: 'text-lime-600' },
    { bg: 'bg-green-500', text: 'text-green-600' },
    { bg: 'bg-emerald-500', text: 'text-emerald-600' },
    { bg: 'bg-teal-500', text: 'text-teal-600' },
    { bg: 'bg-cyan-500', text: 'text-cyan-600' },
    { bg: 'bg-sky-500', text: 'text-sky-600' },
    { bg: 'bg-blue-500', text: 'text-blue-600' },
    { bg: 'bg-indigo-500', text: 'text-indigo-600' },
    { bg: 'bg-violet-500', text: 'text-violet-600' },
    { bg: 'bg-purple-500', text: 'text-purple-600' },
    { bg: 'bg-fuchsia-500', text: 'text-fuchsia-600' },
    { bg: 'bg-pink-500', text: 'text-pink-600' },
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colorPairs[Math.abs(hash) % colorPairs.length]
}

// Calculate message group position based on surrounding messages
// Groups messages from the same user that are consecutive (no system messages or other users in between)
// Time gap of > 5 minutes also breaks a group
export const getMessageGroupPosition = (
  messages: Msg[],
  index: number
): MessageGroupPosition => {
  const current = messages[index]
  const prev = index > 0 ? messages[index - 1] : null
  const next = index < messages.length - 1 ? messages[index + 1] : null

  // System messages are always standalone
  if (current.type === 'system') return 'single'

  const TIME_GAP_MS = 5 * 60 * 1000 // 5 minutes

  const isSameGroup = (a: Msg | null, b: Msg | null): boolean => {
    if (!a || !b) return false
    // Different user or no user
    if (a.user_id !== b.user_id || !a.user_id) return false
    // System messages break groups
    if (a.type === 'system' || b.type === 'system') return false
    // Time gap check
    const timeDiff = Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    if (timeDiff > TIME_GAP_MS) return false
    return true
  }

  const hasPrevInGroup = isSameGroup(prev, current)
  const hasNextInGroup = isSameGroup(current, next)

  if (!hasPrevInGroup && !hasNextInGroup) return 'single'
  if (!hasPrevInGroup && hasNextInGroup) return 'first'
  if (hasPrevInGroup && hasNextInGroup) return 'middle'
  return 'last' // hasPrevInGroup && !hasNextInGroup
}
