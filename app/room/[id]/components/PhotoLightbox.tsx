'use client'

import { useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface PhotoLightboxProps {
  imageUrl: string
  onClose: () => void
}

export function PhotoLightbox({
  imageUrl,
  onClose,
}: PhotoLightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Prevent background scrolling when lightbox is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Close when clicking overlay (not the image)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose()
    }
  }

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
      style={{ touchAction: 'pinch-zoom' }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        aria-label="Close"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Image container with scroll/zoom support */}
      <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
        <img
          src={imageUrl}
          alt="Full size"
          className="max-w-full max-h-full object-contain select-none"
          style={{ touchAction: 'pinch-zoom' }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>,
    document.body
  )
}
