'use client'

import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

interface EmojiPickerPortalProps {
  anchorRef: React.RefObject<HTMLElement | null>
  emojis: readonly string[]
  onSelect: (emoji: string) => void
  onClose: () => void
}

export function EmojiPickerPortal({
  anchorRef,
  emojis,
  onSelect,
  onClose,
}: EmojiPickerPortalProps) {
  const pickerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!mounted) return

    const calculatePosition = () => {
      const anchor = anchorRef.current
      const picker = pickerRef.current
      if (!anchor || !picker) return

      const anchorRect = anchor.getBoundingClientRect()
      const pickerRect = picker.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const padding = 12

      const pickerWidth = pickerRect.width
      const pickerHeight = pickerRect.height

      const spaceAbove = anchorRect.top - padding
      const spaceBelow = viewportHeight - anchorRect.bottom - padding

      let top: number
      if (spaceAbove >= pickerHeight) {
        top = anchorRect.top - pickerHeight - 8
      } else if (spaceBelow >= pickerHeight) {
        top = anchorRect.bottom + 8
      } else {
        top = Math.max(padding, (viewportHeight - pickerHeight) / 2)
      }

      let left = anchorRect.left + anchorRect.width / 2 - pickerWidth / 2
      left = Math.max(padding, Math.min(viewportWidth - pickerWidth - padding, left))
      top = Math.max(padding, Math.min(viewportHeight - pickerHeight - padding, top))

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const picker = pickerRef.current
      if (picker && !picker.contains(e.target as Node)) {
        onClose()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      ref={pickerRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
      className="bg-white rounded-xl shadow-lg ring-1 ring-stone-200 p-2 flex gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {emojis.map(emoji => (
        <button
          key={emoji}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(emoji)
          }}
          className="w-10 h-10 flex items-center justify-center hover:bg-stone-100 rounded-lg text-xl active:scale-110 transition-transform"
        >
          {emoji}
        </button>
      ))}
    </div>,
    document.body
  )
}
