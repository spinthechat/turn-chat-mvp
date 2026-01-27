'use client'

import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

interface MessageSelectionOverlayProps {
  anchorRef: React.RefObject<HTMLElement | null>
  emojis: readonly string[]
  onReact: (emoji: string) => void
  onReply: () => void
  onCopy?: () => void
  onClose: () => void
  canCopy: boolean
}

export function MessageSelectionOverlay({
  anchorRef,
  emojis,
  onReact,
  onReply,
  onCopy,
  onClose,
  canCopy,
}: MessageSelectionOverlayProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  // Calculate menu position
  useLayoutEffect(() => {
    if (!mounted) return

    const calculatePosition = () => {
      const anchor = anchorRef.current
      const menu = menuRef.current
      if (!anchor || !menu) return

      const anchorRect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const padding = 12

      const menuWidth = menuRect.width
      const menuHeight = menuRect.height

      // Prefer above, fall back to below, then center
      const spaceAbove = anchorRect.top - padding
      const spaceBelow = viewportHeight - anchorRect.bottom - padding

      let top: number
      if (spaceAbove >= menuHeight) {
        top = anchorRect.top - menuHeight - 8
      } else if (spaceBelow >= menuHeight) {
        top = anchorRect.bottom + 8
      } else {
        top = Math.max(padding, (viewportHeight - menuHeight) / 2)
      }

      // Center horizontally on anchor, clamp to viewport
      let left = anchorRect.left + anchorRect.width / 2 - menuWidth / 2
      left = Math.max(padding, Math.min(viewportWidth - menuWidth - padding, left))
      top = Math.max(padding, Math.min(viewportHeight - menuHeight - padding, top))

      setPosition({ top, left })
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', calculatePosition)
    }

    return () => {
      window.removeEventListener('resize', calculatePosition)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', calculatePosition)
      }
    }
  }, [mounted, anchorRef])

  // Handle Esc key and prevent scroll while open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // Prevent scrolling on the body while overlay is open
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.overflow = 'hidden'

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore scroll position
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.overflow = ''
      window.scrollTo(0, scrollY)
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <>
      {/* Backdrop overlay with blur */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
        style={{ zIndex: 9998 }}
        onClick={onClose}
        onTouchEnd={(e) => { e.preventDefault(); onClose() }}
      />

      {/* Context menu - modern design */}
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          zIndex: 10000,
        }}
        className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-slate-200/50 overflow-hidden min-w-[240px] animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Emoji reaction bar */}
        <div className="flex justify-center gap-1.5 p-3 border-b border-slate-100/80 bg-slate-50/50">
          {emojis.map(emoji => (
            <button
              key={emoji}
              onClick={() => { onReact(emoji); onClose() }}
              aria-label={`React with ${emoji}`}
              className="w-12 h-12 flex items-center justify-center hover:bg-white rounded-xl text-2xl active:scale-110 transition-all shadow-sm bg-white/80 ring-1 ring-slate-100"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Action menu */}
        <div className="py-1.5">
          <button
            onClick={() => { onReply(); onClose() }}
            aria-label="Reply"
            className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Reply
          </button>

          {canCopy && (
            <button
              onClick={() => { onCopy?.(); onClose() }}
              aria-label="Copy text"
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy text
            </button>
          )}

          <button
            onClick={onClose}
            aria-label="Cancel"
            className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
