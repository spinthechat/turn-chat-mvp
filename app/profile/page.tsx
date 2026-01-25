'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

type Profile = {
  id: string
  email: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
}

export default function ProfilePage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const loadProfile = async () => {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        router.push('/login')
        return
      }

      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single()

      if (error) {
        console.error('Error loading profile:', error)
        setMessage({ type: 'error', text: 'Failed to load profile' })
      } else if (profileData) {
        setProfile(profileData as Profile)
        setDisplayName(profileData.display_name || '')
        setBio(profileData.bio || '')
        setAvatarUrl(profileData.avatar_url || null)
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !profile) return

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please select an image file' })
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Image must be less than 5MB' })
      return
    }

    setUploading(true)
    setMessage(null)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `avatars/${profile.id}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(fileName)

      const newAvatarUrl = urlData.publicUrl + '?t=' + Date.now()

      const { error: updateError } = await supabase.rpc('update_profile', {
        p_avatar_url: newAvatarUrl
      })

      if (updateError) throw updateError

      setAvatarUrl(newAvatarUrl)
      setMessage({ type: 'success', text: 'Photo updated!' })
    } catch (error: any) {
      console.error('Upload error:', error)
      setMessage({ type: 'error', text: error.message || 'Failed to upload photo' })
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!profile) return

    setSaving(true)
    setMessage(null)

    try {
      const { error } = await supabase.rpc('update_profile', {
        p_display_name: displayName.trim() || null,
        p_bio: bio.trim() || null
      })

      if (error) throw error

      setMessage({ type: 'success', text: 'Profile saved!' })
    } catch (error: any) {
      console.error('Save error:', error)
      setMessage({ type: 'error', text: error.message || 'Failed to save profile' })
    } finally {
      setSaving(false)
    }
  }

  const getInitials = (email: string, name?: string | null): string => {
    if (name) {
      const parts = name.trim().split(/\s+/)
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
      if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
      return parts[0].toUpperCase()
    }
    const emailName = email.split('@')[0]
    const cleaned = emailName.replace(/[0-9]/g, '')
    const parts = cleaned.split(/[._-]/).filter(p => p.length > 0)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
    return cleaned.toUpperCase() || '??'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200/50">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => router.push('/rooms')}
            className="p-2 -ml-2 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-stone-900">Edit Profile</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Message */}
        {message && (
          <div className={`mb-6 px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-100 text-emerald-600'
              : 'bg-red-50 border border-red-100 text-red-600'
          }`}>
            {message.type === 'success' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {message.text}
          </div>
        )}

        {/* Avatar */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative group">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Profile"
                className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-2xl font-semibold ring-4 ring-white shadow-lg">
                {getInitials(profile?.email || '', displayName)}
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              {uploading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>
          <p className="mt-2 text-sm text-stone-500">Tap to change photo</p>
        </div>

        {/* Form */}
        <div className="space-y-6">
          {/* Email (read-only) */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Email</label>
            <input
              type="text"
              value={profile?.email || ''}
              disabled
              className="w-full px-4 py-3 bg-stone-100 border border-stone-200 rounded-xl text-stone-500 cursor-not-allowed"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              maxLength={50}
              className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
            />
            <p className="mt-1 text-xs text-stone-400">{displayName.length}/50</p>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell others a bit about yourself"
              maxLength={160}
              rows={3}
              className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow resize-none"
            />
            <p className="mt-1 text-xs text-stone-400">{bio.length}/160</p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 px-4 bg-stone-900 text-white font-medium rounded-xl hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>

        {/* Sign Out */}
        <div className="mt-12 pt-6 border-t border-stone-200">
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              router.push('/login')
            }}
            className="w-full py-3 px-4 text-red-600 font-medium rounded-xl hover:bg-red-50 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
