'use client'

import Image from 'next/image'
import { useMemo } from 'react'

export interface GroupMember {
  id: string
  displayName: string
  initials: string
  color: string
  avatarUrl: string | null
}

interface GroupAvatarMosaicProps {
  members: GroupMember[]
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

// Size in pixels for next/image
const sizePixels = {
  sm: 44,
  md: 56,
  lg: 64,
}

// Generate consistent colors from string (same as elsewhere in app)
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

export function GroupAvatarMosaic({
  members,
  size = 'md',
  className = '',
}: GroupAvatarMosaicProps) {
  const sizeConfig = {
    sm: { container: 'w-11 h-11', tile: 'text-[8px]', gap: 'gap-[1px]' },
    md: { container: 'w-14 h-14', tile: 'text-[9px]', gap: 'gap-[1.5px]' },
    lg: { container: 'w-16 h-16', tile: 'text-[10px]', gap: 'gap-[2px]' },
  }

  const config = sizeConfig[size]

  // Take first 4 members for the mosaic
  const displayMembers = useMemo(() => members.slice(0, 4), [members])
  const count = displayMembers.length

  const px = sizePixels[size]

  // Render a single tile (avatar or initials)
  const renderTile = (member: GroupMember, tileClass: string) => {
    if (member.avatarUrl) {
      return (
        <div key={member.id} className={`${tileClass} relative`}>
          <Image
            src={member.avatarUrl}
            alt={member.displayName}
            fill
            sizes={`${Math.ceil(px / 2)}px`}
            className="object-cover"
          />
        </div>
      )
    }
    return (
      <div
        key={member.id}
        className={`${tileClass} ${member.color || stringToColor(member.id)} flex items-center justify-center text-white font-semibold ${config.tile}`}
      >
        {member.initials}
      </div>
    )
  }

  // Fallback for no members
  if (count === 0) {
    return (
      <div className={`${config.container} rounded-full bg-gradient-to-br from-stone-100 to-stone-200 dark:from-stone-700 dark:to-stone-800 flex items-center justify-center flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50 ${className}`}>
        <svg className="w-6 h-6 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      </div>
    )
  }

  // 1 member - single full avatar
  if (count === 1) {
    const member = displayMembers[0]
    if (member.avatarUrl) {
      return (
        <Image
          src={member.avatarUrl}
          alt={member.displayName}
          width={px}
          height={px}
          className={`${config.container} rounded-full object-cover flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50 ${className}`}
        />
      )
    }
    return (
      <div className={`${config.container} rounded-full ${member.color || stringToColor(member.id)} flex items-center justify-center text-white font-semibold flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50 text-base ${className}`}>
        {member.initials}
      </div>
    )
  }

  // 2 members - split vertically (side by side)
  if (count === 2) {
    return (
      <div className={`${config.container} rounded-full overflow-hidden flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50 flex ${config.gap} bg-white dark:bg-stone-800 ${className}`}>
        {renderTile(displayMembers[0], 'w-1/2 h-full rounded-l-full')}
        {renderTile(displayMembers[1], 'w-1/2 h-full rounded-r-full')}
      </div>
    )
  }

  // 3 members - 2 on top, 1 centered on bottom
  if (count === 3) {
    return (
      <div className={`${config.container} rounded-full overflow-hidden flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50 flex flex-col ${config.gap} bg-white dark:bg-stone-800 ${className}`}>
        <div className={`flex h-1/2 ${config.gap}`}>
          {renderTile(displayMembers[0], 'w-1/2 h-full rounded-tl-full')}
          {renderTile(displayMembers[1], 'w-1/2 h-full rounded-tr-full')}
        </div>
        <div className="h-1/2 flex justify-center">
          {renderTile(displayMembers[2], 'w-1/2 h-full rounded-b-full')}
        </div>
      </div>
    )
  }

  // 4+ members - 2x2 grid
  return (
    <div className={`${config.container} rounded-full overflow-hidden flex-shrink-0 ring-1 ring-stone-200/50 dark:ring-stone-600/50 grid grid-cols-2 grid-rows-2 ${config.gap} bg-white dark:bg-stone-800 ${className}`}>
      {renderTile(displayMembers[0], 'w-full h-full rounded-tl-full')}
      {renderTile(displayMembers[1], 'w-full h-full rounded-tr-full')}
      {renderTile(displayMembers[2], 'w-full h-full rounded-bl-full')}
      {renderTile(displayMembers[3], 'w-full h-full rounded-br-full')}
    </div>
  )
}
