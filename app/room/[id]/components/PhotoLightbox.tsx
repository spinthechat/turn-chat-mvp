'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface PhotoLightboxProps {
  imageUrl: string
  onClose: () => void
}

interface Point {
  x: number
  y: number
}

interface Transform {
  scale: number
  x: number
  y: number
}

export function PhotoLightbox({
  imageUrl,
  onClose,
}: PhotoLightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Transform state
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const [isAnimating, setIsAnimating] = useState(false)

  // Gesture tracking refs (avoid re-renders during gesture)
  const gestureState = useRef({
    // Touch tracking
    touches: new Map<number, Point>(),
    lastTouchCount: 0,

    // Pinch zoom
    initialPinchDistance: 0,
    initialScale: 1,
    pinchCenter: { x: 0, y: 0 },

    // Pan
    isPanning: false,
    panStart: { x: 0, y: 0 },
    transformStart: { x: 0, y: 0 },

    // Swipe to close
    swipeStartY: 0,
    swipeCurrentY: 0,
    isSwipingToClose: false,

    // Double tap
    lastTapTime: 0,
    lastTapPosition: { x: 0, y: 0 },

    // Velocity for inertia
    lastMoveTime: 0,
    velocity: { x: 0, y: 0 },
    lastPosition: { x: 0, y: 0 },

    // Prevent conflicts
    gestureType: null as 'pinch' | 'pan' | 'swipe' | null,
  })

  const MIN_SCALE = 1
  const MAX_SCALE = 4
  const DOUBLE_TAP_DELAY = 300
  const DOUBLE_TAP_DISTANCE = 30
  const SWIPE_CLOSE_THRESHOLD = 100
  const SWIPE_VELOCITY_THRESHOLD = 0.5

  // Clamp value between min and max
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

  // Get distance between two touch points
  const getDistance = (p1: Point, p2: Point) => {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Get center point between two touch points
  const getCenter = (p1: Point, p2: Point): Point => ({
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  })

  // Constrain transform to keep image within reasonable bounds
  const constrainTransform = useCallback((t: Transform): Transform => {
    const container = containerRef.current
    const image = imageRef.current
    if (!container || !image) return t

    const containerRect = container.getBoundingClientRect()
    const scale = clamp(t.scale, MIN_SCALE, MAX_SCALE)

    // Calculate image dimensions at current scale
    const imageWidth = image.naturalWidth
    const imageHeight = image.naturalHeight
    const containerWidth = containerRect.width
    const containerHeight = containerRect.height

    // Fit image to container (same as object-contain)
    const fitScale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
    const displayWidth = imageWidth * fitScale * scale
    const displayHeight = imageHeight * fitScale * scale

    // Calculate max pan distance
    const maxPanX = Math.max(0, (displayWidth - containerWidth) / 2)
    const maxPanY = Math.max(0, (displayHeight - containerHeight) / 2)

    return {
      scale,
      x: clamp(t.x, -maxPanX, maxPanX),
      y: clamp(t.y, -maxPanY, maxPanY),
    }
  }, [])

  // Reset transform with animation
  const resetTransform = useCallback((animate = true) => {
    if (animate) {
      setIsAnimating(true)
      setTimeout(() => setIsAnimating(false), 300)
    }
    setTransform({ scale: 1, x: 0, y: 0 })
  }, [])

  // Handle double tap zoom
  const handleDoubleTap = useCallback((point: Point) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const centerX = point.x - rect.left - rect.width / 2
    const centerY = point.y - rect.top - rect.height / 2

    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 300)

    if (transform.scale > 1.1) {
      // Zoom out to 1x
      setTransform({ scale: 1, x: 0, y: 0 })
    } else {
      // Zoom in to 2x, centered on tap point
      const newScale = 2
      setTransform({
        scale: newScale,
        x: -centerX * (newScale - 1),
        y: -centerY * (newScale - 1),
      })
    }
  }, [transform.scale])

  // Apply inertia after pan gesture
  const applyInertia = useCallback(() => {
    const { velocity } = gestureState.current
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)

    if (speed < 50) return // Not enough momentum

    const friction = 0.95
    const minSpeed = 10

    let vx = velocity.x
    let vy = velocity.y
    let currentTransform = { ...transform }

    const animate = () => {
      vx *= friction
      vy *= friction

      currentTransform = constrainTransform({
        ...currentTransform,
        x: currentTransform.x + vx * 0.016, // ~60fps
        y: currentTransform.y + vy * 0.016,
      })

      setTransform(currentTransform)

      if (Math.sqrt(vx * vx + vy * vy) > minSpeed) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [transform, constrainTransform])

  // Touch start handler
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const state = gestureState.current

    // Track all touches
    Array.from(e.touches).forEach(touch => {
      state.touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    })

    const touchCount = state.touches.size
    state.lastTouchCount = touchCount

    if (touchCount === 1) {
      const touch = e.touches[0]
      const point = { x: touch.clientX, y: touch.clientY }

      // Check for double tap
      const now = Date.now()
      const timeDiff = now - state.lastTapTime
      const distance = getDistance(point, state.lastTapPosition)

      if (timeDiff < DOUBLE_TAP_DELAY && distance < DOUBLE_TAP_DISTANCE) {
        e.preventDefault()
        handleDoubleTap(point)
        state.lastTapTime = 0 // Reset to prevent triple tap
        return
      }

      state.lastTapTime = now
      state.lastTapPosition = point

      // Start pan or swipe detection
      state.panStart = point
      state.transformStart = { x: transform.x, y: transform.y }
      state.swipeStartY = touch.clientY
      state.lastPosition = point
      state.lastMoveTime = now
      state.velocity = { x: 0, y: 0 }
      state.gestureType = null

    } else if (touchCount === 2) {
      // Start pinch zoom
      e.preventDefault()
      const [t1, t2] = Array.from(state.touches.values())
      state.initialPinchDistance = getDistance(t1, t2)
      state.initialScale = transform.scale
      state.pinchCenter = getCenter(t1, t2)
      state.gestureType = 'pinch'
      state.isPanning = false
      state.isSwipingToClose = false
    }
  }, [transform, handleDoubleTap])

  // Touch move handler
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const state = gestureState.current

    // Update tracked touches
    Array.from(e.changedTouches).forEach(touch => {
      state.touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    })

    const touchCount = state.touches.size

    if (touchCount === 2 && state.gestureType !== 'swipe') {
      // Pinch zoom
      e.preventDefault()
      const [t1, t2] = Array.from(state.touches.values())
      const currentDistance = getDistance(t1, t2)
      const currentCenter = getCenter(t1, t2)

      if (state.initialPinchDistance > 0) {
        const scaleDelta = currentDistance / state.initialPinchDistance
        const newScale = clamp(state.initialScale * scaleDelta, MIN_SCALE * 0.5, MAX_SCALE * 1.5)

        // Calculate pan offset to zoom around pinch center
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          const centerX = state.pinchCenter.x - rect.left - rect.width / 2
          const centerY = state.pinchCenter.y - rect.top - rect.height / 2

          // Adjust transform to keep pinch center stationary
          const scaleFactor = newScale / state.initialScale
          const newX = state.transformStart.x * scaleFactor + centerX * (1 - scaleFactor)
          const newY = state.transformStart.y * scaleFactor + centerY * (1 - scaleFactor)

          // Also apply pan from center movement
          const panX = currentCenter.x - state.pinchCenter.x
          const panY = currentCenter.y - state.pinchCenter.y

          setTransform({
            scale: newScale,
            x: newX + panX,
            y: newY + panY,
          })
        }
      }

      state.gestureType = 'pinch'

    } else if (touchCount === 1) {
      const touch = e.touches[0]
      const point = { x: touch.clientX, y: touch.clientY }
      const deltaX = point.x - state.panStart.x
      const deltaY = point.y - state.panStart.y
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      // Calculate velocity for inertia
      const now = Date.now()
      const dt = now - state.lastMoveTime
      if (dt > 0) {
        state.velocity = {
          x: (point.x - state.lastPosition.x) / dt * 1000,
          y: (point.y - state.lastPosition.y) / dt * 1000,
        }
      }
      state.lastPosition = point
      state.lastMoveTime = now

      // Determine gesture type if not yet determined
      if (!state.gestureType && (absX > 10 || absY > 10)) {
        if (transform.scale > 1.05) {
          // If zoomed in, prefer pan
          state.gestureType = 'pan'
          state.isPanning = true
        } else if (absY > absX && deltaY > 0) {
          // If not zoomed, swipe down = close
          state.gestureType = 'swipe'
          state.isSwipingToClose = true
        } else {
          // Otherwise it's a pan (but won't do much at scale 1)
          state.gestureType = 'pan'
          state.isPanning = true
        }
      }

      if (state.gestureType === 'pan') {
        e.preventDefault()
        const newTransform = constrainTransform({
          ...transform,
          x: state.transformStart.x + deltaX,
          y: state.transformStart.y + deltaY,
        })
        setTransform(newTransform)
      } else if (state.gestureType === 'swipe') {
        e.preventDefault()
        state.swipeCurrentY = touch.clientY
        // Apply visual feedback for swipe-to-close
        const swipeProgress = Math.max(0, deltaY)
        setTransform(t => ({
          ...t,
          y: swipeProgress * 0.5,
          scale: Math.max(0.8, 1 - swipeProgress / 1000),
        }))
      }
    }
  }, [transform, constrainTransform])

  // Touch end handler
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const state = gestureState.current

    // Remove ended touches
    Array.from(e.changedTouches).forEach(touch => {
      state.touches.delete(touch.identifier)
    })

    const remainingTouches = state.touches.size

    // Handle gesture completion
    if (state.gestureType === 'pinch' && remainingTouches < 2) {
      // Snap scale to bounds
      setIsAnimating(true)
      setTimeout(() => setIsAnimating(false), 200)
      setTransform(t => constrainTransform(t))
      state.gestureType = null
    }

    if (state.gestureType === 'swipe' && remainingTouches === 0) {
      const swipeDistance = state.swipeCurrentY - state.swipeStartY
      const velocity = state.velocity.y

      if (swipeDistance > SWIPE_CLOSE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD * 1000) {
        // Close with animation
        setIsAnimating(true)
        setTransform({ scale: 0.8, x: 0, y: window.innerHeight })
        setTimeout(onClose, 200)
      } else {
        // Snap back
        setIsAnimating(true)
        setTimeout(() => setIsAnimating(false), 200)
        setTransform({ scale: 1, x: 0, y: 0 })
      }
      state.gestureType = null
      state.isSwipingToClose = false
    }

    if (state.gestureType === 'pan' && remainingTouches === 0) {
      // Apply inertia if moving fast enough
      if (transform.scale > 1.05) {
        applyInertia()
      }
      // Snap to bounds
      setIsAnimating(true)
      setTimeout(() => setIsAnimating(false), 200)
      setTransform(t => constrainTransform(t))
      state.gestureType = null
      state.isPanning = false
    }

    // Reset if all touches ended
    if (remainingTouches === 0) {
      state.initialPinchDistance = 0
      state.lastTouchCount = 0
    }
  }, [transform, constrainTransform, onClose, applyInertia])

  // Prevent background scrolling when lightbox is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    const originalPosition = document.body.style.position
    const originalTop = document.body.style.top
    const scrollY = window.scrollY

    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    return () => {
      document.body.style.overflow = originalOverflow
      document.body.style.position = originalPosition
      document.body.style.top = originalTop
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

  // Handle ESC key and click outside to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (transform.scale > 1.05) {
          resetTransform()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, transform.scale, resetTransform])

  // Handle click on overlay (close if not zoomed and not interacting)
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current && transform.scale <= 1.05) {
      onClose()
    }
  }, [onClose, transform.scale])

  // Double click for desktop
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    handleDoubleTap({ x: e.clientX, y: e.clientY })
  }, [handleDoubleTap])

  // Compute background opacity based on swipe progress
  const bgOpacity = transform.scale < 1 ? transform.scale : 0.9

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        backgroundColor: `rgba(0, 0, 0, ${bgOpacity})`,
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        aria-label="Close"
        style={{ opacity: transform.scale <= 1.05 ? 1 : 0.5 }}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Image container */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Full size"
          className="max-w-full max-h-full object-contain select-none pointer-events-none"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: isAnimating ? 'transform 0.2s ease-out' : 'none',
            willChange: 'transform',
          }}
          draggable={false}
        />
      </div>

      {/* Zoom indicator */}
      {transform.scale > 1.05 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
          {Math.round(transform.scale * 100)}%
        </div>
      )}
    </div>,
    document.body
  )
}
