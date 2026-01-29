'use client'

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Story, StoryUser, groupStoriesByUser } from './types'
import { StoryBubble, AddStoryButton } from './StoryBubble'
import { StoryViewer } from './StoryViewer'
import { StoryCreator } from './StoryCreator'
import { supabase } from '@/lib/supabaseClient'

interface StoriesRowProps {
  currentUserId: string
  userAvatarUrl: string | null
  userEmail: string
}

export interface StoriesRowRef {
  refresh: () => Promise<void>
}

export const StoriesRow = forwardRef<StoriesRowRef, StoriesRowProps>(function StoriesRow(
  { currentUserId, userAvatarUrl, userEmail },
  ref
) {
  const [stories, setStories] = useState<Story[]>([])
  const [storyUsers, setStoryUsers] = useState<StoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showViewer, setShowViewer] = useState(false)
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0)
  const [showCreator, setShowCreator] = useState(false)

  // Fetch stories
  const fetchStories = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_stories_feed', {
        for_user_id: currentUserId,
      })

      if (error) throw error

      setStories(data || [])
      setStoryUsers(groupStoriesByUser(data || []))
    } catch (err) {
      console.error('Failed to fetch stories:', err)
    } finally {
      setLoading(false)
    }
  }, [currentUserId])

  // Expose refresh function to parent
  useImperativeHandle(ref, () => ({
    refresh: fetchStories
  }), [fetchStories])

  useEffect(() => {
    fetchStories()
  }, [fetchStories])

  // Handle story viewed - update local state
  const handleStoryViewed = useCallback((storyId: string) => {
    setStories(prev => prev.map(s =>
      s.story_id === storyId ? { ...s, is_viewed: true } : s
    ))
    setStoryUsers(prev => {
      return prev.map(user => ({
        ...user,
        stories: user.stories.map(s =>
          s.story_id === storyId ? { ...s, is_viewed: true } : s
        ),
        has_unseen: user.stories.some(s =>
          s.story_id !== storyId && !s.is_viewed
        ),
      }))
    })
  }, [])

  // Handle story created - refresh stories
  const handleStoryCreated = useCallback(() => {
    fetchStories()
  }, [fetchStories])

  // Open story viewer for a specific user
  const openStoryViewer = (userIndex: number) => {
    setViewerInitialIndex(userIndex)
    setShowViewer(true)
  }

  // Find current user's stories
  const ownStoryUser = storyUsers.find(u => u.user_id === currentUserId)
  const otherUsers = storyUsers.filter(u => u.user_id !== currentUserId)

  // Don't render if no stories and not loading
  // But always show if there are stories or for the add button
  if (loading) {
    return (
      <div className="px-4 py-3">
        <div className="flex gap-3 overflow-x-auto scrollbar-hide">
          {/* Skeleton loading */}
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 w-[72px] flex-shrink-0 animate-pulse">
              <div className="w-16 h-16 rounded-full bg-stone-200 dark:bg-stone-700" />
              <div className="w-12 h-3 rounded bg-stone-200 dark:bg-stone-700" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
          {/* Add story button (or own story if exists) */}
          {ownStoryUser ? (
            <StoryBubble
              user={ownStoryUser}
              isOwnStory
              onClick={() => {
                const idx = storyUsers.findIndex(u => u.user_id === currentUserId)
                openStoryViewer(idx)
              }}
            />
          ) : (
            <AddStoryButton
              userAvatarUrl={userAvatarUrl}
              userEmail={userEmail}
              onClick={() => setShowCreator(true)}
            />
          )}

          {/* Other users' stories */}
          {otherUsers.map((user) => {
            const idx = storyUsers.findIndex(u => u.user_id === user.user_id)
            return (
              <StoryBubble
                key={user.user_id}
                user={user}
                onClick={() => openStoryViewer(idx)}
              />
            )
          })}

          {/* If user has own story, show add button at the end */}
          {ownStoryUser && (
            <button
              onClick={() => setShowCreator(true)}
              className="flex flex-col items-center gap-1.5 w-[72px] flex-shrink-0"
            >
              <div className="w-16 h-16 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                <svg className="w-7 h-7 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Add</span>
            </button>
          )}
        </div>
      </div>

      {/* Story Viewer Modal */}
      {showViewer && storyUsers.length > 0 && (
        <StoryViewer
          users={storyUsers}
          initialUserIndex={viewerInitialIndex}
          currentUserId={currentUserId}
          onClose={() => setShowViewer(false)}
          onStoryViewed={handleStoryViewed}
        />
      )}

      {/* Story Creator Modal */}
      <StoryCreator
        isOpen={showCreator}
        onClose={() => setShowCreator(false)}
        onStoryCreated={handleStoryCreated}
        userId={currentUserId}
      />
    </>
  )
})
