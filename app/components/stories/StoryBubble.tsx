'use client'

import Image from 'next/image'
import { StoryUser, getDisplayNameFromEmail, getInitialsFromEmail, stringToColor } from './types'

interface StoryBubbleProps {
  user: StoryUser
  isOwnStory?: boolean
  onClick: () => void
}

export function StoryBubble({ user, isOwnStory, onClick }: StoryBubbleProps) {
  const displayName = user.display_name || getDisplayNameFromEmail(user.email)
  const initials = getInitialsFromEmail(user.email)
  const firstName = displayName.split(' ')[0]
  const truncatedName = firstName.length > 10 ? firstName.slice(0, 9) + '...' : firstName

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 w-[72px] flex-shrink-0"
    >
      {/* Avatar with ring */}
      <div className={`relative w-16 h-16 rounded-full p-[3px] ${
        user.has_unseen
          ? 'bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600'
          : 'bg-stone-300 dark:bg-stone-600'
      }`}>
        <div className="w-full h-full rounded-full bg-white dark:bg-stone-900 p-[2px]">
          {user.avatar_url ? (
            <Image
              src={user.avatar_url}
              alt={displayName}
              width={56}
              height={56}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <div className={`w-full h-full rounded-full ${stringToColor(user.email)} flex items-center justify-center text-white font-semibold text-lg`}>
              {initials}
            </div>
          )}
        </div>
      </div>

      {/* Name */}
      <span className={`text-xs font-medium truncate w-full text-center ${
        user.has_unseen
          ? 'text-stone-800 dark:text-stone-100'
          : 'text-stone-500 dark:text-stone-400'
      }`}>
        {isOwnStory ? 'Your story' : truncatedName}
      </span>
    </button>
  )
}

// Add Story button
interface AddStoryButtonProps {
  userAvatarUrl: string | null
  userEmail: string
  onClick: () => void
}

export function AddStoryButton({ userAvatarUrl, userEmail, onClick }: AddStoryButtonProps) {
  const initials = getInitialsFromEmail(userEmail)

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 w-[72px] flex-shrink-0"
    >
      {/* Avatar with + button */}
      <div className="relative w-16 h-16">
        <div className="w-full h-full rounded-full bg-stone-200 dark:bg-stone-700 p-[2px]">
          {userAvatarUrl ? (
            <Image
              src={userAvatarUrl}
              alt="Your story"
              width={56}
              height={56}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <div className={`w-full h-full rounded-full ${stringToColor(userEmail)} flex items-center justify-center text-white font-semibold text-lg`}>
              {initials}
            </div>
          )}
        </div>
        {/* Plus button */}
        <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-indigo-500 border-2 border-white dark:border-stone-900 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
      </div>

      {/* Label */}
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
        Add story
      </span>
    </button>
  )
}
