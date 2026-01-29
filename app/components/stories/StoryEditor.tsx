'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import {
  TextLayer,
  TextFont,
  TextSize,
  TextBackground,
  TextAlign,
  StoryOverlays,
  createTextLayer,
  TEXT_COLORS,
} from './types'

interface StoryEditorProps {
  imageUrl: string
  onComplete: (overlays: StoryOverlays) => void
  onBack: () => void
}

const MAX_TEXT_LAYERS = 6

// Font display names
const FONTS: { value: TextFont; label: string; className: string }[] = [
  { value: 'sans', label: 'Sans', className: 'font-sans' },
  { value: 'serif', label: 'Serif', className: 'font-serif' },
  { value: 'mono', label: 'Mono', className: 'font-mono' },
]

// Size presets
const SIZES: { value: TextSize; label: string; className: string }[] = [
  { value: 'sm', label: 'S', className: 'text-base' },
  { value: 'md', label: 'M', className: 'text-xl' },
  { value: 'lg', label: 'L', className: 'text-3xl' },
]

// Background styles
const BACKGROUNDS: { value: TextBackground; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'pill', label: 'Pill' },
  { value: 'solid', label: 'Box' },
]

// Alignment options
const ALIGNMENTS: { value: TextAlign; icon: React.ReactNode }[] = [
  {
    value: 'left',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h12M3 18h18" />
      </svg>
    ),
  },
  {
    value: 'center',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M6 12h12M3 18h18" />
      </svg>
    ),
  },
  {
    value: 'right',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 12h12M3 18h18" />
      </svg>
    ),
  },
]

export function StoryEditor({ imageUrl, onComplete, onBack }: StoryEditorProps) {
  const [textLayers, setTextLayers] = useState<TextLayer[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [dimOverlay, setDimOverlay] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState<{ x: number; y: number; layerId: string } | null>(null)

  // Undo/redo history
  const [history, setHistory] = useState<TextLayer[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef<{ x: number; y: number; layerX: number; layerY: number } | null>(null)

  const selectedLayer = textLayers.find((l) => l.id === selectedLayerId)

  // Save state to history
  const saveToHistory = useCallback((layers: TextLayer[]) => {
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(layers)
      // Keep only last 20 states
      if (newHistory.length > 20) newHistory.shift()
      return newHistory
    })
    setHistoryIndex((prev) => Math.min(prev + 1, 19))
  }, [historyIndex])

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setTextLayers(history[newIndex])
      setSelectedLayerId(null)
    }
  }, [historyIndex, history])

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      setTextLayers(history[newIndex])
    }
  }, [historyIndex, history])

  // Add new text layer
  const addTextLayer = useCallback(() => {
    if (textLayers.length >= MAX_TEXT_LAYERS) return

    const newLayer = createTextLayer({
      text: 'Tap to edit',
      y: 30 + textLayers.length * 10, // Stagger new layers
    })
    const newLayers = [...textLayers, newLayer]
    setTextLayers(newLayers)
    saveToHistory(newLayers)
    setSelectedLayerId(newLayer.id)
    setEditingLayerId(newLayer.id)
    setShowControls(true)

    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [textLayers, saveToHistory])

  // Update layer
  const updateLayer = useCallback((id: string, updates: Partial<TextLayer>) => {
    setTextLayers((prev) => {
      const newLayers = prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
      return newLayers
    })
  }, [])

  // Save layer changes to history
  const commitLayerChanges = useCallback(() => {
    saveToHistory(textLayers)
  }, [textLayers, saveToHistory])

  // Delete layer
  const deleteLayer = useCallback((id: string) => {
    const newLayers = textLayers.filter((l) => l.id !== id)
    setTextLayers(newLayers)
    saveToHistory(newLayers)
    setSelectedLayerId(null)
    setShowContextMenu(null)
  }, [textLayers, saveToHistory])

  // Duplicate layer
  const duplicateLayer = useCallback((id: string) => {
    const layer = textLayers.find((l) => l.id === id)
    if (!layer || textLayers.length >= MAX_TEXT_LAYERS) return

    const newLayer = createTextLayer({
      ...layer,
      id: crypto.randomUUID(),
      x: Math.min(layer.x + 5, 90),
      y: Math.min(layer.y + 5, 90),
    })
    const newLayers = [...textLayers, newLayer]
    setTextLayers(newLayers)
    saveToHistory(newLayers)
    setSelectedLayerId(newLayer.id)
    setShowContextMenu(null)
  }, [textLayers, saveToHistory])

  // Handle drag start
  const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent, layerId: string) => {
    const layer = textLayers.find((l) => l.id === layerId)
    if (!layer || editingLayerId === layerId) return

    isDragging.current = false
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    dragStart.current = {
      x: clientX,
      y: clientY,
      layerX: layer.x,
      layerY: layer.y,
    }

    setSelectedLayerId(layerId)
    setShowControls(true)

    // Long press detection
    longPressTimer.current = setTimeout(() => {
      if (!isDragging.current) {
        // Haptic feedback
        if ('vibrate' in navigator) navigator.vibrate(20)
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          setShowContextMenu({
            x: Math.min(clientX - rect.left, rect.width - 120),
            y: Math.min(clientY - rect.top, rect.height - 100),
            layerId,
          })
        }
      }
    }, 500)
  }, [textLayers, editingLayerId])

  // Handle drag move
  const handleDragMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!dragStart.current || !containerRef.current) return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const rect = containerRef.current.getBoundingClientRect()

    const deltaX = clientX - dragStart.current.x
    const deltaY = clientY - dragStart.current.y

    // Check if we've moved enough to count as dragging
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      isDragging.current = true
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }

    if (!isDragging.current) return

    // Convert to percentage
    const deltaXPercent = (deltaX / rect.width) * 100
    const deltaYPercent = (deltaY / rect.height) * 100

    const newX = Math.max(5, Math.min(95, dragStart.current.layerX + deltaXPercent))
    const newY = Math.max(5, Math.min(95, dragStart.current.layerY + deltaYPercent))

    if (selectedLayerId) {
      updateLayer(selectedLayerId, { x: newX, y: newY })
    }
  }, [selectedLayerId, updateLayer])

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    if (isDragging.current) {
      // Haptic tick on drop
      if ('vibrate' in navigator) navigator.vibrate(5)
      commitLayerChanges()
    }

    dragStart.current = null
    isDragging.current = false
  }, [commitLayerChanges])

  // Handle background tap
  const handleBackgroundTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedLayerId(null)
      setEditingLayerId(null)
      setShowControls(false)
      setShowContextMenu(null)
    }
  }, [])

  // Handle text input change
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (editingLayerId) {
      updateLayer(editingLayerId, { text: e.target.value })
    }
  }, [editingLayerId, updateLayer])

  // Handle text input blur
  const handleTextBlur = useCallback(() => {
    if (editingLayerId) {
      const layer = textLayers.find((l) => l.id === editingLayerId)
      if (layer && !layer.text.trim()) {
        deleteLayer(editingLayerId)
      } else {
        commitLayerChanges()
      }
    }
    setEditingLayerId(null)
  }, [editingLayerId, textLayers, deleteLayer, commitLayerChanges])

  // Handle text layer tap
  const handleLayerTap = useCallback((layerId: string) => {
    if (selectedLayerId === layerId && !isDragging.current) {
      setEditingLayerId(layerId)
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setSelectedLayerId(layerId)
      setShowControls(true)
    }
  }, [selectedLayerId])

  // Complete editing
  const handleComplete = useCallback(() => {
    // Blur any active input first to ensure text is committed
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    // Clear editing state
    setEditingLayerId(null)
    setSelectedLayerId(null)
    setShowControls(false)
    setShowContextMenu(null)

    // Filter out empty text layers and complete
    const validLayers = textLayers.filter((l) => l.text.trim())
    onComplete({
      textLayers: validLayers,
      dimOverlay,
    })
  }, [textLayers, dimOverlay, onComplete])

  // Get text style classes
  const getTextClasses = (layer: TextLayer) => {
    const font = FONTS.find((f) => f.value === layer.font)?.className || 'font-sans'
    const size = SIZES.find((s) => s.value === layer.size)?.className || 'text-xl'
    const align = `text-${layer.align}`
    return `${font} ${size} ${align}`
  }

  // Get background style
  const getBackgroundStyle = (layer: TextLayer): string => {
    switch (layer.background) {
      case 'pill':
        return 'bg-black/40 backdrop-blur-sm px-4 py-1.5 rounded-full'
      case 'solid':
        return 'bg-black/60 px-4 py-2 rounded-lg'
      default:
        return ''
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header - z-index ensures it's above canvas and context menu */}
      <div className="relative z-50 flex items-center justify-between px-4 py-4 pt-safe border-b border-white/10 bg-black">
        <button
          onClick={onBack}
          className="p-2 -ml-2 text-white touch-manipulation"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          {/* Undo/Redo */}
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className="p-2 text-white disabled:opacity-30 touch-manipulation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="p-2 text-white disabled:opacity-30 touch-manipulation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
            </svg>
          </button>
        </div>

        <button
          onClick={handleComplete}
          onTouchEnd={(e) => {
            // Prevent ghost click and ensure handler fires on touch devices
            e.preventDefault()
            handleComplete()
          }}
          className="px-4 py-1.5 bg-indigo-500 text-white text-sm font-semibold rounded-full touch-manipulation active:bg-indigo-600"
        >
          Done
        </button>
      </div>

      {/* Editor canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onClick={handleBackgroundTap}
        onTouchMove={handleDragMove}
        onMouseMove={handleDragMove}
        onTouchEnd={handleDragEnd}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        {/* Background image */}
        <Image
          src={imageUrl}
          alt="Story"
          fill
          className="object-contain"
          priority
        />

        {/* Dim overlay */}
        {dimOverlay && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none" />
        )}

        {/* Text layers */}
        {textLayers.map((layer) => (
          <div
            key={layer.id}
            className={`absolute cursor-move select-none ${
              selectedLayerId === layer.id ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-transparent rounded' : ''
            }`}
            style={{
              left: `${layer.x}%`,
              top: `${layer.y}%`,
              transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`,
            }}
            onTouchStart={(e) => handleDragStart(e, layer.id)}
            onMouseDown={(e) => handleDragStart(e, layer.id)}
            onClick={() => handleLayerTap(layer.id)}
          >
            <div
              className={`whitespace-nowrap ${getTextClasses(layer)} ${getBackgroundStyle(layer)}`}
              style={{
                color: layer.color,
                textShadow: layer.background === 'none' ? '0 2px 8px rgba(0,0,0,0.8)' : 'none',
              }}
            >
              {editingLayerId === layer.id ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={layer.text}
                  onChange={handleTextChange}
                  onBlur={handleTextBlur}
                  className="bg-transparent outline-none min-w-[100px] text-center"
                  style={{ color: layer.color }}
                  autoFocus
                />
              ) : (
                layer.text || 'Tap to edit'
              )}
            </div>
          </div>
        ))}

        {/* Context menu - z-40 to stay below header */}
        {showContextMenu && (
          <div
            className="absolute bg-stone-800 rounded-xl shadow-xl overflow-hidden z-40 animate-scale-in"
            style={{
              left: showContextMenu.x,
              top: showContextMenu.y,
            }}
          >
            <button
              onClick={() => {
                setEditingLayerId(showContextMenu.layerId)
                setShowContextMenu(null)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
              className="w-full px-4 py-3 text-left text-white text-sm hover:bg-white/10 flex items-center gap-3"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <button
              onClick={() => duplicateLayer(showContextMenu.layerId)}
              className="w-full px-4 py-3 text-left text-white text-sm hover:bg-white/10 flex items-center gap-3 border-t border-white/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Duplicate
            </button>
            <button
              onClick={() => deleteLayer(showContextMenu.layerId)}
              className="w-full px-4 py-3 text-left text-red-400 text-sm hover:bg-white/10 flex items-center gap-3 border-t border-white/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Bottom toolbar - z-index ensures it's above canvas */}
      <div className="relative z-50 border-t border-white/10 bg-black/80 backdrop-blur-xl pb-safe">
        {/* Style controls for selected layer */}
        {showControls && selectedLayer && (
          <div className="px-4 py-3 border-b border-white/10 space-y-3 animate-slide-up">
            {/* Font selection */}
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-12">Font</span>
              <div className="flex gap-1">
                {FONTS.map((font) => (
                  <button
                    key={font.value}
                    onClick={() => {
                      updateLayer(selectedLayer.id, { font: font.value })
                      commitLayerChanges()
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm ${font.className} ${
                      selectedLayer.font === font.value
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white'
                    }`}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Size selection */}
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-12">Size</span>
              <div className="flex gap-1">
                {SIZES.map((size) => (
                  <button
                    key={size.value}
                    onClick={() => {
                      updateLayer(selectedLayer.id, { size: size.value })
                      commitLayerChanges()
                    }}
                    className={`w-10 h-8 rounded-lg text-sm font-medium ${
                      selectedLayer.size === size.value
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white'
                    }`}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Color selection */}
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-12">Color</span>
              <div className="flex gap-1.5 overflow-x-auto">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      updateLayer(selectedLayer.id, { color })
                      commitLayerChanges()
                    }}
                    className={`w-7 h-7 rounded-full flex-shrink-0 ${
                      selectedLayer.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Background style */}
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-12">Style</span>
              <div className="flex gap-1">
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.value}
                    onClick={() => {
                      updateLayer(selectedLayer.id, { background: bg.value })
                      commitLayerChanges()
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs ${
                      selectedLayer.background === bg.value
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white'
                    }`}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Alignment */}
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs w-12">Align</span>
              <div className="flex gap-1">
                {ALIGNMENTS.map((align) => (
                  <button
                    key={align.value}
                    onClick={() => {
                      updateLayer(selectedLayer.id, { align: align.value })
                      commitLayerChanges()
                    }}
                    className={`p-2 rounded-lg ${
                      selectedLayer.align === align.value
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white'
                    }`}
                  >
                    {align.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main toolbar */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Add text button */}
            <button
              onClick={addTextLayer}
              disabled={textLayers.length >= MAX_TEXT_LAYERS}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Text
            </button>

            {/* Dim toggle */}
            <button
              onClick={() => setDimOverlay(!dimOverlay)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors touch-manipulation ${
                dimOverlay ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              Dim
            </button>
          </div>

          {/* Layer count */}
          <span className="text-white/40 text-xs">
            {textLayers.length}/{MAX_TEXT_LAYERS}
          </span>
        </div>
      </div>
    </div>
  )
}
