'use client'

import type { UserInfo } from '../types'

interface AvatarProps {
  user: UserInfo | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  showRing?: boolean
  showHostBadge?: boolean
  onClick?: () => void
}

export function Avatar({
  user,
  size = 'md',
  className = '',
  showRing = false,
  showHostBadge = false,
  onClick,
}: AvatarProps) {
  const sizeClasses = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm'
  }

  if (!user) {
    return (
      <div className={`${sizeClasses[size]} rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0 ${className}`}>
        <span className="text-stone-400">?</span>
      </div>
    )
  }

  const Wrapper = onClick ? 'button' : 'div'
  const wrapperProps = onClick ? { onClick, type: 'button' as const } : {}

  return (
    <Wrapper {...wrapperProps} className={`relative flex-shrink-0 ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${className}`}>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className={`${sizeClasses[size]} rounded-full object-cover ${showRing ? 'ring-2 ring-white shadow-md' : ''}`}
          title={user.email}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} rounded-full ${user.color} flex items-center justify-center text-white font-semibold ${showRing ? 'ring-2 ring-white shadow-md' : ''}`}
          title={user.email}
        >
          {user.initials}
        </div>
      )}
      {showHostBadge && user.isHost && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 rounded-full flex items-center justify-center ring-2 ring-white">
          <svg className="w-2 h-2 text-amber-900" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </div>
      )}
    </Wrapper>
  )
}
