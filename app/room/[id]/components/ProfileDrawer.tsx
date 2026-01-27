'use client'

import { useState } from 'react'
import type { UserInfo } from '../types'

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
  user: UserInfo | null
  currentUserId: string | null
  onStartDM: (userId: string) => Promise<void>
}

export function ProfileDrawer({
  isOpen,
  onClose,
  user,
  currentUserId,
  onStartDM,
}: ProfileDrawerProps) {
  const [startingDM, setStartingDM] = useState(false)

  if (!isOpen || !user) return null

  const isOwnProfile = user.id === currentUserId

  const handleStartDM = async () => {
    if (isOwnProfile || startingDM) return
    setStartingDM(true)
    try {
      await onStartDM(user.id)
      onClose()
    } catch (error) {
      console.error('Failed to start DM:', error)
    } finally {
      setStartingDM(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-stone-900 rounded-t-2xl shadow-xl max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-200">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-stone-300 dark:bg-stone-600 rounded-full" />
        </div>

        {/* Content */}
        <div className="px-6 pb-8 pt-2">
          {/* Avatar and name */}
          <div className="flex flex-col items-center text-center mb-6">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-24 h-24 rounded-full object-cover ring-4 ring-stone-100 dark:ring-stone-700 mb-4"
              />
            ) : (
              <div className={`w-24 h-24 rounded-full ${user.color} flex items-center justify-center text-white text-3xl font-semibold ring-4 ring-stone-100 dark:ring-stone-700 mb-4`}>
                {user.initials}
              </div>
            )}
            <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-50">{user.displayName}</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">{user.email}</p>
            {isOwnProfile && (
              <span className="mt-1 text-xs bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 px-2 py-0.5 rounded-full">This is you</span>
            )}
          </div>

          {/* Bio */}
          {user.bio && (
            <div className="mb-6">
              <h3 className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-2">About</h3>
              <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">{user.bio}</p>
            </div>
          )}

          {/* Message button */}
          {!isOwnProfile && (
            <button
              onClick={handleStartDM}
              disabled={startingDM}
              className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium rounded-xl hover:from-indigo-600 hover:to-violet-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {startingDM ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Opening chat...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Message
                </>
              )}
            </button>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full mt-3 py-2.5 px-4 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
