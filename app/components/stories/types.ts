// Text layer types for story overlays
export type TextFont = 'sans' | 'serif' | 'mono'
export type TextSize = 'sm' | 'md' | 'lg'
export type TextBackground = 'none' | 'pill' | 'solid'
export type TextAlign = 'left' | 'center' | 'right'

export interface TextLayer {
  id: string
  text: string
  x: number // percentage 0-100
  y: number // percentage 0-100
  scale: number // 1 = 100%
  rotation: number // degrees
  font: TextFont
  size: TextSize
  color: string // hex color
  background: TextBackground
  align: TextAlign
}

export interface StoryOverlays {
  textLayers: TextLayer[]
  dimOverlay: boolean
  // Future: stickers, mentions, links
}

export interface Story {
  story_id: string
  story_user_id: string
  image_url: string
  created_at: string
  expires_at: string
  user_email: string
  user_display_name: string | null
  user_avatar_url: string | null
  is_viewed: boolean
  view_count: number
  overlays: StoryOverlays | null
}

export interface StoryUser {
  user_id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  stories: Story[]
  has_unseen: boolean
}

export interface StoryViewer {
  viewer_id: string
  viewer_email: string
  viewer_display_name: string | null
  viewer_avatar_url: string | null
  viewed_at: string
}

// Group stories by user for Instagram-style display
export function groupStoriesByUser(stories: Story[]): StoryUser[] {
  const userMap = new Map<string, StoryUser>()

  for (const story of stories) {
    const existing = userMap.get(story.story_user_id)
    if (existing) {
      existing.stories.push(story)
      if (!story.is_viewed) {
        existing.has_unseen = true
      }
    } else {
      userMap.set(story.story_user_id, {
        user_id: story.story_user_id,
        email: story.user_email,
        display_name: story.user_display_name,
        avatar_url: story.user_avatar_url,
        stories: [story],
        has_unseen: !story.is_viewed,
      })
    }
  }

  // Sort: users with unseen stories first
  return Array.from(userMap.values()).sort((a, b) => {
    if (a.has_unseen && !b.has_unseen) return -1
    if (!a.has_unseen && b.has_unseen) return 1
    return 0
  })
}

// Helper to get display name from email
export function getDisplayNameFromEmail(email: string): string {
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

// Helper to get initials from email
export function getInitialsFromEmail(email: string): string {
  const name = email.split('@')[0]
  const cleaned = name.replace(/[0-9]/g, '')
  const parts = cleaned.split(/[._-]/).filter(p => p.length > 0)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return cleaned.toUpperCase() || '??'
}

// Create a new text layer with defaults
export function createTextLayer(partial?: Partial<TextLayer>): TextLayer {
  return {
    id: crypto.randomUUID(),
    text: '',
    x: 50,
    y: 50,
    scale: 1,
    rotation: 0,
    font: 'sans',
    size: 'md',
    color: '#FFFFFF',
    background: 'none',
    align: 'center',
    ...partial,
  }
}

// Color palette for text
export const TEXT_COLORS = [
  '#FFFFFF', // White
  '#000000', // Black
  '#EF4444', // Red
  '#F97316', // Orange
  '#EAB308', // Yellow
  '#22C55E', // Green
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EC4899', // Pink
] as const

// Generate consistent colors from string
export function stringToColor(str: string): string {
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
