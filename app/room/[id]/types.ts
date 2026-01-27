// Shared types for room components

export type Msg = {
  id: string
  room_id: string
  user_id: string | null
  type: 'chat' | 'turn_response' | 'system' | 'image'
  content: string
  created_at: string
  reply_to_message_id: string | null
}

export type Reaction = {
  id: string
  message_id: string
  user_id: string
  emoji: string
}

export type TurnSession = {
  room_id: string
  prompt_text: string
  current_prompt_type: 'text' | 'photo'
  turn_order: string[]
  current_turn_index: number
  current_turn_user_id: string | null
  turn_instance_id: string | null
  is_active: boolean
  waiting_until: string | null
}

export type UserInfo = {
  id: string
  email: string
  displayName: string
  initials: string
  color: string
  textColor: string
  isHost: boolean
  avatarUrl: string | null
  bio: string | null
}

export type RoomMember = {
  user_id: string
  role: 'host' | 'member'
  prompt_interval_minutes: number
}

export type RoomInfo = {
  id: string
  name: string
  type: 'dm' | 'group'
  prompt_interval_minutes: number
  last_active_at: string | null
  prompt_mode: 'fun' | 'family' | 'deep' | 'flirty' | 'couple'
}

export type MessageGroupPosition = 'single' | 'first' | 'middle' | 'last'

// Constants
export const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '😢'] as const

export const FREQUENCY_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once a day' },
] as const

export const PROMPT_MODES = [
  { value: 'fun', label: 'Fun', description: 'Lighthearted prompts for friends' },
  { value: 'family', label: 'Family', description: 'Warm prompts for family groups' },
  { value: 'deep', label: 'Deep', description: 'More reflective questions. Answer at your own depth.' },
  { value: 'flirty', label: 'Flirty', description: 'Playful, bold prompts (not explicit).' },
  { value: 'couple', label: 'Couple', description: 'Designed for partners — reflective, connective prompts.' },
] as const
