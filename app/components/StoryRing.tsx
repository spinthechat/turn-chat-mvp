'use client'

interface StoryRingProps {
  active: boolean
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  className?: string
}

/**
 * StoryRing - Wraps an avatar with an Instagram-style gradient ring
 * when the user has an active story.
 *
 * The ring is rendered as padding around the child avatar, so it doesn't
 * affect the avatar's internal sizing.
 */
export function StoryRing({
  active,
  size = 'md',
  children,
  className = '',
}: StoryRingProps) {
  // Ring padding varies by size to maintain proportions
  const ringConfig = {
    sm: 'p-[2px]',
    md: 'p-[2.5px]',
    lg: 'p-[3px]',
  }

  if (!active) {
    // No ring - just render children as-is
    return <>{children}</>
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-500 ${ringConfig[size]} flex-shrink-0 ${className}`}
    >
      {/* Inner white/dark ring for contrast */}
      <div className="rounded-full bg-white dark:bg-stone-900 p-[2px]">
        {children}
      </div>
    </div>
  )
}
