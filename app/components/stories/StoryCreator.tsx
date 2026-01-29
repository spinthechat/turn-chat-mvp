'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import { StoryEditor } from './StoryEditor'
import { StoryOverlays } from './types'

interface StoryCreatorProps {
  isOpen: boolean
  onClose: () => void
  onStoryCreated: () => void
  userId: string
}

type Step = 'select' | 'preview' | 'edit' | 'uploading'

export function StoryCreator({ isOpen, onClose, onStoryCreated, userId }: StoryCreatorProps) {
  const [step, setStep] = useState<Step>('select')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [overlays, setOverlays] = useState<StoryOverlays | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB')
      return
    }

    setError(null)
    setSelectedFile(file)

    // Create preview URL
    const reader = new FileReader()
    reader.onload = (event) => {
      setSelectedImage(event.target?.result as string)
      setStep('preview')
    }
    reader.readAsDataURL(file)

    // Reset input
    e.target.value = ''
  }, [])

  // Handle editor completion
  const handleEditorComplete = useCallback((editorOverlays: StoryOverlays) => {
    setOverlays(editorOverlays)
    handleUpload(editorOverlays)
  }, [])

  const handleUpload = async (storyOverlays?: StoryOverlays) => {
    if (!selectedFile || !userId) return

    setStep('uploading')
    setError(null)

    try {
      // Generate unique filename
      const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${userId}/${Date.now()}.${fileExt}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('stories')
        .upload(fileName, selectedFile, {
          contentType: selectedFile.type,
          cacheControl: '3600',
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('stories')
        .getPublicUrl(fileName)

      // Create story record with overlays
      const finalOverlays = storyOverlays || overlays
      const hasOverlays = finalOverlays && (finalOverlays.textLayers.length > 0 || finalOverlays.dimOverlay)

      const { error: insertError } = await supabase
        .from('stories')
        .insert({
          user_id: userId,
          image_url: urlData.publicUrl,
          overlays: hasOverlays ? finalOverlays : null,
        })

      if (insertError) throw insertError

      // Success
      onStoryCreated()
      handleClose()
    } catch (err) {
      console.error('Failed to upload story:', err)
      setError('Failed to upload story. Please try again.')
      setStep('edit')
    }
  }

  const handleClose = () => {
    setStep('select')
    setSelectedImage(null)
    setSelectedFile(null)
    setOverlays(null)
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  // Show editor as full-screen overlay
  if (step === 'edit' && selectedImage) {
    return (
      <StoryEditor
        imageUrl={selectedImage}
        onComplete={handleEditorComplete}
        onBack={() => setStep('preview')}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 pt-safe border-b border-white/10">
        <button
          onClick={step === 'preview' ? () => setStep('select') : handleClose}
          className="p-2 -ml-2 text-white"
        >
          {step === 'preview' ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>

        <h2 className="text-white font-semibold text-lg">
          {step === 'select' ? 'Add Story' : step === 'preview' ? 'Preview' : 'Posting...'}
        </h2>

        {step === 'preview' ? (
          <button
            onClick={() => setStep('edit')}
            className="px-4 py-1.5 bg-indigo-500 text-white text-sm font-semibold rounded-full"
          >
            Next
          </button>
        ) : (
          <div className="w-16" /> // Spacer
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {step === 'select' && (
          <div className="w-full max-w-sm px-6 space-y-4">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-full py-4 px-6 bg-white/10 hover:bg-white/20 rounded-2xl flex items-center gap-4 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-white font-medium">Take Photo</p>
                <p className="text-white/50 text-sm">Use your camera</p>
              </div>
            </button>

            <button
              onClick={() => libraryInputRef.current?.click()}
              className="w-full py-4 px-6 bg-white/10 hover:bg-white/20 rounded-2xl flex items-center gap-4 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-white font-medium">Choose from Library</p>
                <p className="text-white/50 text-sm">Select an existing photo</p>
              </div>
            </button>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
          </div>
        )}

        {step === 'preview' && selectedImage && (
          <div className="relative w-full h-full">
            <Image
              src={selectedImage}
              alt="Preview"
              fill
              className="object-contain"
            />
            {error && (
              <div className="absolute bottom-8 left-4 right-4 bg-red-500/90 text-white text-sm px-4 py-3 rounded-xl text-center">
                {error}
              </div>
            )}
          </div>
        )}

        {step === 'uploading' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-3 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-white/70">Posting your story...</p>
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  )
}
