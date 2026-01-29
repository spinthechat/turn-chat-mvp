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

// Size configurations
const sizeConfig = {
  sm: {
    container: 'w-11 h-11',
    tile: 'text-[8px]',
    gap: 'gap-[1px]',
    // Fan layout
    fanContainer: 44,
    fanAvatar: 28,
    fanOffset: 7,
    fanText: 'text-[9px]',
    fanRing: 'ring-[1.5px]',
  },
  md: {
    container: 'w-14 h-14',
    tile: 'text-[9px]',
    gap: 'gap-[1.5px]',
    fanContainer: 56,
    fanAvatar: 34,
    fanOffset: 9,
    fanText: 'text-[10px]',
    fanRing: 'ring-2',
  },
  lg: {
    container: 'w-16 h-16',
    tile: 'text-[10px]',
    gap: 'gap-[2px]',
    fanContainer: 64,
    fanAvatar: 40,
    fanOffset: 10,
    fanText: 'text-[11px]',
    fanRing: 'ring-2',
  },
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

// Single fanned avatar
function FannedAvatar({
  member,
  size,
  position,
  config,
}: {
  member: GroupMember
  size: 'sm' | 'md' | 'lg'
  position: 'left' | 'center' | 'right'
  config: typeof sizeConfig.md
}) {
  const avatarSize = config.fanAvatar
  const offset = config.fanOffset

  // Position transforms
  const transforms = {
    left: {
      transform: 'rotate(-8deg)',
      left: 0,
      top: offset,
      zIndex: 1,
    },
    center: {
      transform: 'rotate(0deg)',
      left: '50%',
      marginLeft: -avatarSize / 2,
      top: 0,
      zIndex: 3,
    },
    right: {
      transform: 'rotate(8deg)',
      right: 0,
      top: offset,
      zIndex: 2,
    },
  }

  const style = transforms[position]

  const content = member.avatarUrl ? (
    <Image
      src={member.avatarUrl}
      alt={member.displayName}
      width={avatarSize}
      height={avatarSize}
      className="rounded-full object-cover"
      style={{ width: avatarSize, height: avatarSize }}
    />
  ) : (
    <div
      className={`rounded-full ${member.color || stringToColor(member.id)} flex items-center justify-center text-white font-semibold ${config.fanText}`}
      style={{ width: avatarSize, height: avatarSize }}
    >
      {member.initials}
    </div>
  )

  return (
    <div
      className={`absolute ${config.fanRing} ring-white dark:ring-stone-900 rounded-full shadow-sm`}
      style={{
        width: avatarSize,
        height: avatarSize,
        ...style,
      }}
    >
      {content}
    </div>
  )
}

export function GroupAvatarMosaic({
  members,
  size = 'md',
  className = '',
}: GroupAvatarMosaicProps) {
  const config = sizeConfig[size]

  // Take first 4 members for display
  const displayMembers = useMemo(() => members.slice(0, 4), [members])
  const count = displayMembers.length

  const px = config.fanContainer

  // Render a single tile (for 2-3 member layouts)
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

  // 3+ members - fanned overlapping layout (like a hand of cards)
  // This covers groups with 4+ total members (3+ other members shown)
  const fanMembers = displayMembers.slice(0, 3)

  return (
    <div
      className={`relative flex-shrink-0 ${className}`}
      style={{
        width: config.fanContainer,
        height: config.fanContainer,
      }}
    >
      {/* Left avatar - rotated -8deg, behind */}
      <FannedAvatar
        member={fanMembers[0]}
        size={size}
        position="left"
        config={config}
      />
      {/* Right avatar - rotated +8deg, middle layer */}
      {fanMembers.length > 2 && (
        <FannedAvatar
          member={fanMembers[2]}
          size={size}
          position="right"
          config={config}
        />
      )}
      {/* Center avatar - on top */}
      {fanMembers.length > 1 && (
        <FannedAvatar
          member={fanMembers[1]}
          size={size}
          position="center"
          config={config}
        />
      )}
    </div>
  )
}
