'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'

interface ProfilePhotoActionSheetProps {
  isOpen: boolean
  onClose: () => void
  user: {
    id: string
    email: string
    displayName: string
    avatarUrl: string | null
    initials: string
    color: string
  }
  currentUserId: string | null
  onViewStory?: (userId: string) => void
  hasActiveStory?: boolean
}

// Haptic feedback helper
function hapticTick() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(10)
  }
}

export function ProfilePhotoActionSheet({
  isOpen,
  onClose,
  user,
  currentUserId,
  onViewStory,
  hasActiveStory = false,
}: ProfilePhotoActionSheetProps) {
  const [showPhotoViewer, setShowPhotoViewer] = useState(false)
  const [pokeState, setPokeState] = useState<{
    canPoke: boolean
    hoursRemaining?: number
    loading: boolean
    sending: boolean
    success: boolean
  }>({
    canPoke: false,
    loading: true,
    sending: false,
    success: false,
  })

  const isOwnProfile = user.id === currentUserId
  const hasAvatar = !!user.avatarUrl

  // Check if can poke when sheet opens
  useEffect(() => {
    if (!isOpen || isOwnProfile || !currentUserId) {
      setPokeState({ canPoke: false, loading: false, sending: false, success: false })
      return
    }

    const checkCanPoke = async () => {
      try {
        const { data, error } = await supabase.rpc('can_poke', { p_target_id: user.id })
        if (error) throw error
        setPokeState({
          canPoke: data?.can_poke ?? false,
          hoursRemaining: data?.hours_remaining,
          loading: false,
          sending: false,
          success: false,
        })
      } catch (err) {
        console.error('Failed to check poke status:', err)
        setPokeState({ canPoke: false, loading: false, sending: false, success: false })
      }
    }

    checkCanPoke()
  }, [isOpen, user.id, currentUserId, isOwnProfile])

  // Handle poke action
  const handlePoke = useCallback(async () => {
    if (!pokeState.canPoke || pokeState.sending) return

    setPokeState(prev => ({ ...prev, sending: true }))
    hapticTick()

    try {
      const { data, error } = await supabase.rpc('send_poke', { p_target_id: user.id })
      if (error) throw error

      if (data?.success) {
        setPokeState(prev => ({ ...prev, sending: false, success: true, canPoke: false }))
        // Close after brief animation
        setTimeout(() => {
          onClose()
        }, 800)
      } else {
        setPokeState(prev => ({
          ...prev,
          sending: false,
          canPoke: false,
          hoursRemaining: data?.hours_remaining,
        }))
      }
    } catch (err) {
      console.error('Failed to send poke:', err)
      setPokeState(prev => ({ ...prev, sending: false }))
    }
  }, [pokeState.canPoke, pokeState.sending, user.id, onClose])

  // Handle view photo
  const handleViewPhoto = useCallback(() => {
    if (hasAvatar) {
      setShowPhotoViewer(true)
    }
  }, [hasAvatar])

  // Handle view story
  const handleViewStory = useCallback(() => {
    if (hasActiveStory && onViewStory) {
      onClose()
      onViewStory(user.id)
    }
  }, [hasActiveStory, onViewStory, user.id, onClose])

  if (!isOpen) return null

  // Full-screen photo viewer
  if (showPhotoViewer && hasAvatar) {
    return (
      <FullScreenPhotoViewer
        imageUrl={user.avatarUrl!}
        displayName={user.displayName}
        onClose={() => {
          setShowPhotoViewer(false)
          onClose()
        }}
      />
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[60] animate-fade-in"
        onClick={onClose}
      />

      {/* Action Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[61] animate-slide-up">
        <div className="bg-white dark:bg-stone-900 rounded-t-2xl shadow-xl overflow-hidden pb-safe">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-stone-200 dark:bg-stone-700" />
          </div>

          {/* User preview */}
          <div className="flex flex-col items-center py-4 px-6">
            {hasAvatar ? (
              <Image
                src={user.avatarUrl!}
                alt={user.displayName}
                width={80}
                height={80}
                className="w-20 h-20 rounded-full object-cover ring-4 ring-stone-100 dark:ring-stone-700"
              />
            ) : (
              <div className={`w-20 h-20 rounded-full ${user.color} flex items-center justify-center text-white text-2xl font-semibold ring-4 ring-stone-100 dark:ring-stone-700`}>
                {user.initials}
              </div>
            )}
            <p className="mt-3 text-lg font-semibold text-stone-900 dark:text-stone-50">{user.displayName}</p>
          </div>

          {/* Actions */}
          <div className="px-4 pb-4 space-y-2">
            {/* View Profile Photo - only if has avatar */}
            {hasAvatar && (
              <button
                onClick={handleViewPhoto}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                </div>
                <span className="text-stone-900 dark:text-stone-50 font-medium">View profile photo</span>
              </button>
            )}

            {/* View Story - only if has active story */}
            {hasActiveStory && (
              <button
                onClick={handleViewStory}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
                  </svg>
                </div>
                <span className="text-stone-900 dark:text-stone-50 font-medium">View story</span>
              </button>
            )}

            {/* Poke - only for other users */}
            {!isOwnProfile && (
              <button
                onClick={handlePoke}
                disabled={!pokeState.canPoke || pokeState.sending || pokeState.success || pokeState.loading}
                className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all ${
                  pokeState.success
                    ? 'bg-emerald-50 dark:bg-emerald-900/30'
                    : pokeState.canPoke
                      ? 'bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700'
                      : 'bg-stone-50 dark:bg-stone-800 opacity-50'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  pokeState.success
                    ? 'bg-emerald-100 dark:bg-emerald-900/50 animate-bounce'
                    : 'bg-amber-100 dark:bg-amber-900/50'
                }`}>
                  {pokeState.sending ? (
                    <div className="w-5 h-5 border-2 border-amber-600/30 border-t-amber-600 rounded-full animate-spin" />
                  ) : pokeState.success ? (
                    <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-xl">👋</span>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <span className={`font-medium ${
                    pokeState.success
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-stone-900 dark:text-stone-50'
                  }`}>
                    {pokeState.success ? 'Poke sent!' : 'Poke'}
                  </span>
                  {!pokeState.canPoke && !pokeState.loading && !pokeState.success && pokeState.hoursRemaining && (
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                      Available in {pokeState.hoursRemaining}h
                    </p>
                  )}
                </div>
              </button>
            )}
          </div>

          {/* Cancel button */}
          <div className="px-4 pb-4">
            <button
              onClick={onClose}
              className="w-full py-3 text-stone-500 dark:text-stone-400 font-medium text-center hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Full-screen photo viewer with pinch-to-zoom
function FullScreenPhotoViewer({
  imageUrl,
  displayName,
  onClose,
}: {
  imageUrl: string
  displayName: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastPinchDistRef = useRef<number | null>(null)
  const initialScaleRef = useRef(1)

  // Handle double-tap to zoom
  const handleDoubleTap = useCallback((clientX: number, clientY: number) => {
    if (scale > 1) {
      // Reset zoom
      setScale(1)
      setPosition({ x: 0, y: 0 })
    } else {
      // Zoom to 2.5x
      setScale(2.5)
      // Center on tap point (relative to center)
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const centerX = rect.width / 2
        const centerY = rect.height / 2
        const offsetX = (centerX - clientX) * 1.5
        const offsetY = (centerY - clientY) * 1.5
        setPosition({ x: offsetX, y: offsetY })
      }
    }
  }, [scale])

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy)
      initialScaleRef.current = scale
    } else if (e.touches.length === 1) {
      const touch = e.touches[0]
      const now = Date.now()

      // Check for double-tap
      if (lastTouchRef.current) {
        const dt = now - lastTouchRef.current.time
        const dx = Math.abs(touch.clientX - lastTouchRef.current.x)
        const dy = Math.abs(touch.clientY - lastTouchRef.current.y)

        if (dt < 300 && dx < 30 && dy < 30) {
          handleDoubleTap(touch.clientX, touch.clientY)
          lastTouchRef.current = null
          return
        }
      }

      lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: now }

      if (scale > 1) {
        setIsDragging(true)
      }
    }
  }, [scale, handleDoubleTap])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const delta = dist / lastPinchDistRef.current
      const newScale = Math.min(Math.max(initialScaleRef.current * delta, 1), 5)
      setScale(newScale)

      if (newScale === 1) {
        setPosition({ x: 0, y: 0 })
      }
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      // Pan when zoomed
      const touch = e.touches[0]
      if (lastTouchRef.current) {
        const dx = touch.clientX - lastTouchRef.current.x
        const dy = touch.clientY - lastTouchRef.current.y
        setPosition(prev => ({
          x: prev.x + dx,
          y: prev.y + dy,
        }))
        lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: lastTouchRef.current.time }
      }
    }
  }, [isDragging, scale])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    lastPinchDistRef.current = null
    setIsDragging(false)

    // Swipe down to close (only when not zoomed)
    if (e.changedTouches.length === 1 && lastTouchRef.current && scale === 1) {
      const touch = e.changedTouches[0]
      const dy = touch.clientY - lastTouchRef.current.y
      const dx = Math.abs(touch.clientX - lastTouchRef.current.x)

      if (dy > 100 && dx < 50) {
        onClose()
      }
    }
  }, [scale, onClose])

  // Mouse double-click for desktop
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    handleDoubleTap(e.clientX, e.clientY)
  }, [handleDoubleTap])

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-4 pt-safe z-10">
        <button
          onClick={onClose}
          className="p-2 text-white/80 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <p className="text-white font-medium">{displayName}</p>
        <div className="w-10" /> {/* Spacer */}
      </div>

      {/* Photo */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="transition-transform duration-200"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transitionProperty: isDragging ? 'none' : 'transform',
          }}
        >
          <Image
            src={imageUrl}
            alt={displayName}
            width={800}
            height={800}
            className="max-w-full max-h-[80vh] object-contain select-none"
            draggable={false}
            priority
          />
        </div>
      </div>

      {/* Footer hint */}
      <div className="flex-shrink-0 py-4 pb-safe text-center">
        <p className="text-white/50 text-xs">
          {scale > 1 ? 'Double-tap to reset' : 'Double-tap to zoom • Swipe down to close'}
        </p>
      </div>
    </div>
  )
}
