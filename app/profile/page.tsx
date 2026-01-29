'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type Profile = {
  id: string
  email: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  flashbox_youtube_url: string | null
  flashbox_youtube_id: string | null
}

type ProfilePhoto = {
  id: string
  url: string
  storage_path: string
  position: number
  created_at: string
}

type ProfileStats = {
  followers_count: number
  following_count: number
  groups_count: number
  mutual_groups_count: number
}

type UserListItem = {
  user_id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  mutual_groups_count: number
  follow_status: 'explicit' | 'implicit' | 'none' | 'unfollowed'
}

type GroupListItem = {
  room_id: string
  room_name: string
  member_count: number
}

type ListType = 'followers' | 'following' | 'groups' | 'mutual_groups' | null

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

  // Stats - default to zeros so UI always renders
  const [stats, setStats] = useState<ProfileStats>({
    followers_count: 0,
    following_count: 0,
    groups_count: 0,
    mutual_groups_count: 0
  })
  const [statsLoaded, setStatsLoaded] = useState(false)

  // List modal
  const [activeList, setActiveList] = useState<ListType>(null)
  const [listData, setListData] = useState<UserListItem[] | GroupListItem[]>([])
  const [listLoading, setListLoading] = useState(false)

  // Follow action states
  const [followingInProgress, setFollowingInProgress] = useState<Set<string>>(new Set())

  // Photo gallery
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<ProfilePhoto[]>([])
  const [photosLoading, setPhotosLoading] = useState(true)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null)
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null)

  // Flashbox (YouTube)
  const [flashboxUrl, setFlashboxUrl] = useState('')
  const [flashboxVideoId, setFlashboxVideoId] = useState<string | null>(null)
  const [flashboxSaving, setFlashboxSaving] = useState(false)
  const [flashboxEditing, setFlashboxEditing] = useState(false)

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
        setFlashboxUrl(profileData.flashbox_youtube_url || '')
        setFlashboxVideoId(profileData.flashbox_youtube_id || null)
      }

      // Load profile photos
      try {
        const { data: photosData, error: photosError } = await supabase.rpc('get_profile_photos', {
          p_user_id: authData.user.id
        })
        if (photosError) {
          console.error('Error loading photos:', photosError)
        } else {
          setPhotos(photosData || [])
        }
      } catch (err) {
        console.error('Failed to load photos:', err)
      }
      setPhotosLoading(false)

      // Load stats
      try {
        const { data: statsData, error: statsError } = await supabase.rpc('get_profile_stats', {
          p_user_id: authData.user.id
        })

        if (statsError) {
          console.error('Error loading stats:', statsError)
        } else if (statsData) {
          // RPC returns array for TABLE return type
          const statsRow = Array.isArray(statsData) ? statsData[0] : statsData
          if (statsRow) {
            setStats({
              followers_count: statsRow.followers_count ?? 0,
              following_count: statsRow.following_count ?? 0,
              groups_count: statsRow.groups_count ?? 0,
              mutual_groups_count: statsRow.mutual_groups_count ?? 0
            })
          }
        }
      } catch (err) {
        console.error('Failed to load stats:', err)
      }
      setStatsLoaded(true)

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
    } catch (error: unknown) {
      console.error('Upload error:', error)
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to upload photo' })
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
    } catch (error: unknown) {
      console.error('Save error:', error)
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to save profile' })
    } finally {
      setSaving(false)
    }
  }

  // Photo Gallery handlers
  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !profile) return

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please select an image file' })
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Image must be less than 10MB' })
      return
    }

    if (photos.length >= 16) {
      setMessage({ type: 'error', text: 'Maximum 16 photos allowed' })
      return
    }

    setUploadingPhoto(true)
    setMessage(null)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `gallery/${profile.id}/${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file)

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(fileName)

      const photoUrl = urlData.publicUrl

      // Add to database
      const { data: addResult, error: addError } = await supabase.rpc('add_profile_photo', {
        p_url: photoUrl,
        p_storage_path: fileName
      })

      if (addError) throw addError

      if (!addResult.success) {
        throw new Error(addResult.error || 'Failed to add photo')
      }

      // Add to local state
      setPhotos(prev => [...prev, {
        id: addResult.photo_id,
        url: photoUrl,
        storage_path: fileName,
        position: addResult.position,
        created_at: new Date().toISOString()
      }])

      setMessage({ type: 'success', text: 'Photo added!' })
    } catch (error: unknown) {
      console.error('Gallery upload error:', error)
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to upload photo' })
    } finally {
      setUploadingPhoto(false)
      // Reset input
      if (galleryInputRef.current) {
        galleryInputRef.current.value = ''
      }
    }
  }

  const handleDeletePhoto = async (photoId: string) => {
    if (deletingPhotoId) return

    setDeletingPhotoId(photoId)

    try {
      const { data: result, error } = await supabase.rpc('delete_profile_photo', {
        p_photo_id: photoId
      })

      if (error) throw error

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete photo')
      }

      // Delete from storage
      if (result.storage_path) {
        await supabase.storage.from('media').remove([result.storage_path])
      }

      // Remove from local state
      setPhotos(prev => prev.filter(p => p.id !== photoId))
      setPhotoViewerIndex(null)
      setMessage({ type: 'success', text: 'Photo deleted' })
    } catch (error: unknown) {
      console.error('Delete photo error:', error)
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to delete photo' })
    } finally {
      setDeletingPhotoId(null)
    }
  }

  // Flashbox handlers
  const handleFlashboxSave = async () => {
    if (!profile) return

    setFlashboxSaving(true)
    setMessage(null)

    try {
      const { data: result, error } = await supabase.rpc('update_flashbox_youtube', {
        p_youtube_url: flashboxUrl.trim() || null
      })

      if (error) throw error

      if (!result.success) {
        throw new Error(result.error || 'Invalid YouTube URL')
      }

      setFlashboxVideoId(result.video_id)
      setFlashboxEditing(false)
      setMessage({ type: 'success', text: flashboxUrl.trim() ? 'Flashbox updated!' : 'Flashbox cleared' })
    } catch (error: unknown) {
      console.error('Flashbox save error:', error)
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to update flashbox' })
    } finally {
      setFlashboxSaving(false)
    }
  }

  const openList = async (type: ListType) => {
    if (!profile || !type) return

    setActiveList(type)
    setListLoading(true)
    setListData([])

    try {
      let data
      if (type === 'followers') {
        const result = await supabase.rpc('get_followers_list', { p_user_id: profile.id })
        data = result.data
      } else if (type === 'following') {
        const result = await supabase.rpc('get_following_list', { p_user_id: profile.id })
        data = result.data
      } else if (type === 'groups') {
        const result = await supabase.rpc('get_user_groups_list', {})
        data = result.data
      } else if (type === 'mutual_groups') {
        // For own profile, this doesn't make sense
        data = []
      }
      setListData(data || [])
    } catch (err) {
      console.error('Failed to load list:', err)
    } finally {
      setListLoading(false)
    }
  }

  const handleFollowToggle = useCallback(async (userId: string, currentStatus: string) => {
    if (followingInProgress.has(userId)) return

    setFollowingInProgress(prev => new Set(prev).add(userId))

    const isCurrentlyFollowing = currentStatus === 'explicit' || currentStatus === 'implicit'

    // Optimistic update
    setListData(prev =>
      (prev as UserListItem[]).map(item =>
        item.user_id === userId
          ? { ...item, follow_status: isCurrentlyFollowing ? 'unfollowed' : 'explicit' as UserListItem['follow_status'] }
          : item
      )
    )

    try {
      if (isCurrentlyFollowing) {
        await supabase.rpc('unfollow_user', { p_following_id: userId })
      } else {
        await supabase.rpc('follow_user', { p_following_id: userId })
      }
    } catch (err) {
      console.error('Follow toggle failed:', err)
      // Revert optimistic update
      setListData(prev =>
        (prev as UserListItem[]).map(item =>
          item.user_id === userId
            ? { ...item, follow_status: currentStatus as UserListItem['follow_status'] }
            : item
        )
      )
    } finally {
      setFollowingInProgress(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }, [followingInProgress])

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

  const getDisplayName = (email: string, name?: string | null): string => {
    if (name) return name
    const emailName = email.split('@')[0]
    return emailName
      .replace(/[._-]/g, ' ')
      .replace(/[0-9]/g, '')
      .trim()
      .split(' ')
      .filter(p => p.length > 0)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ') || emailName
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-stone-200 dark:border-stone-700 border-t-stone-600 dark:border-t-stone-300 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-900">
      {/* Header */}
      <header className="bg-white dark:bg-stone-800 border-b border-stone-200/50 dark:border-stone-700/50">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => router.push('/rooms')}
            className="p-2 -ml-2 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-50">Profile</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        {/* Message */}
        {message && (
          <div className={`mb-6 px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400'
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

        {/* Avatar and Name */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative group">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Profile"
                className="w-24 h-24 rounded-full object-cover ring-4 ring-white dark:ring-stone-800 shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-2xl font-semibold ring-4 ring-white dark:ring-stone-800 shadow-lg">
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
          <h2 className="mt-3 text-xl font-semibold text-stone-900 dark:text-stone-50">
            {displayName || getDisplayName(profile?.email || '')}
          </h2>
          <p className="text-sm text-stone-500 dark:text-stone-400">{profile?.email}</p>
        </div>

        {/* Stats - always rendered, shows 0 if no data */}
        <div className="grid grid-cols-3 gap-2 mb-8 bg-white dark:bg-stone-800 rounded-2xl p-4 border border-stone-200/50 dark:border-stone-700/50">
          <button
            onClick={() => openList('followers')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.followers_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Followers</span>
          </button>
          <button
            onClick={() => openList('following')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.following_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Following</span>
          </button>
          <button
            onClick={() => openList('groups')}
            disabled={!statsLoaded}
            className="flex flex-col items-center py-2 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {statsLoaded ? (
              <span className="text-xl font-bold text-stone-900 dark:text-stone-50">{stats.groups_count}</span>
            ) : (
              <div className="h-7 w-8 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">Groups</span>
          </button>
        </div>

        {/* Photo Gallery */}
        <div className="bg-white dark:bg-stone-800 rounded-2xl p-5 border border-stone-200/50 dark:border-stone-700/50 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              Photos {photos.length > 0 && `(${photos.length}/16)`}
            </h3>
            {photos.length < 16 && (
              <button
                onClick={() => galleryInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="text-sm font-medium text-indigo-500 hover:text-indigo-600 disabled:opacity-50 flex items-center gap-1"
              >
                {uploadingPhoto ? (
                  <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                )}
                Add
              </button>
            )}
          </div>

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handleGalleryUpload}
            className="hidden"
          />

          {photosLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="aspect-square bg-stone-100 dark:bg-stone-700 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <button
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="w-full py-8 border-2 border-dashed border-stone-200 dark:border-stone-700 rounded-xl text-stone-400 dark:text-stone-500 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-500 transition-colors flex flex-col items-center gap-2"
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <span className="text-sm">Add your first photo</span>
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, index) => (
                <button
                  key={photo.id}
                  onClick={() => setPhotoViewerIndex(index)}
                  className="aspect-square rounded-xl overflow-hidden bg-stone-100 dark:bg-stone-700 hover:opacity-90 transition-opacity"
                >
                  <img
                    src={photo.url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
              {photos.length < 16 && (
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="aspect-square rounded-xl border-2 border-dashed border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-500 transition-colors flex items-center justify-center"
                >
                  {uploadingPhoto ? (
                    <div className="w-6 h-6 border-2 border-stone-300 dark:border-stone-600 border-t-indigo-500 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Flashbox (YouTube) */}
        <div className="bg-white dark:bg-stone-800 rounded-2xl p-5 border border-stone-200/50 dark:border-stone-700/50 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              Flashbox
            </h3>
            {flashboxVideoId && !flashboxEditing && (
              <button
                onClick={() => setFlashboxEditing(true)}
                className="text-sm font-medium text-indigo-500 hover:text-indigo-600"
              >
                Edit
              </button>
            )}
          </div>

          {flashboxVideoId && !flashboxEditing ? (
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${flashboxVideoId}`}
                title="Flashbox video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Add a YouTube video to showcase on your profile
              </p>
              <input
                type="url"
                value={flashboxUrl}
                onChange={(e) => setFlashboxUrl(e.target.value)}
                placeholder="Paste YouTube URL..."
                className="w-full px-4 py-3 bg-stone-50 dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-xl text-stone-900 dark:text-stone-50 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleFlashboxSave}
                  disabled={flashboxSaving}
                  className="flex-1 py-2.5 px-4 bg-indigo-500 text-white text-sm font-medium rounded-xl hover:bg-indigo-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {flashboxSaving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Save'
                  )}
                </button>
                {flashboxEditing && (
                  <button
                    onClick={() => {
                      setFlashboxEditing(false)
                      setFlashboxUrl(profile?.flashbox_youtube_url || '')
                    }}
                    className="py-2.5 px-4 text-stone-500 dark:text-stone-400 text-sm font-medium rounded-xl hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Edit Form */}
        <div className="bg-white dark:bg-stone-800 rounded-2xl p-5 border border-stone-200/50 dark:border-stone-700/50 space-y-5">
          <h3 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">Edit Profile</h3>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              maxLength={50}
              className="w-full px-4 py-3 bg-stone-50 dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-xl text-stone-900 dark:text-stone-50 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
            />
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{displayName.length}/50</p>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell others about yourself"
              maxLength={160}
              rows={3}
              className="w-full px-4 py-3 bg-stone-50 dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-xl text-stone-900 dark:text-stone-50 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow resize-none"
            />
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{bio.length}/160</p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 px-4 bg-stone-900 dark:bg-stone-50 text-white dark:text-stone-900 font-medium rounded-xl hover:bg-stone-800 dark:hover:bg-stone-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 dark:border-stone-900/30 border-t-white dark:border-t-stone-900 rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>

        {/* Sign Out */}
        <div className="mt-8 pt-6 border-t border-stone-200 dark:border-stone-700">
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              router.push('/login')
            }}
            className="w-full py-3 px-4 text-red-600 dark:text-red-400 font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* List Modal */}
      {activeList && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-stone-900 flex flex-col">
          {/* Modal Header */}
          <header className="border-b border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800">
            <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
              <button
                onClick={() => setActiveList(null)}
                className="p-2 -ml-2 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-50 capitalize">
                {activeList === 'mutual_groups' ? 'Mutual Groups' : activeList}
              </h1>
            </div>
          </header>

          {/* Modal Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-lg mx-auto">
              {listLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-stone-200 dark:border-stone-700 border-t-stone-600 dark:border-t-stone-300 rounded-full animate-spin" />
                </div>
              ) : listData.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                    <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                    </svg>
                  </div>
                  <p className="text-stone-500 dark:text-stone-400">
                    {activeList === 'followers' && 'No followers yet'}
                    {activeList === 'following' && 'Not following anyone yet'}
                    {activeList === 'groups' && 'Not in any groups yet'}
                    {activeList === 'mutual_groups' && 'No mutual groups'}
                  </p>
                </div>
              ) : (activeList === 'groups' || activeList === 'mutual_groups') ? (
                // Groups list
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {(listData as GroupListItem[]).map((group) => (
                    <button
                      key={group.room_id}
                      onClick={() => router.push(`/room/${group.room_id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
                    >
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-semibold">
                        {group.room_name?.[0]?.toUpperCase() || 'G'}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-stone-900 dark:text-stone-50 truncate">
                          {group.room_name || 'Unnamed Group'}
                        </p>
                        <p className="text-sm text-stone-500 dark:text-stone-400">
                          {group.member_count} members
                        </p>
                      </div>
                      <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              ) : (
                // Users list (followers/following)
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {(listData as UserListItem[]).map((user) => {
                    const isFollowing = user.follow_status === 'explicit' || user.follow_status === 'implicit'
                    const inProgress = followingInProgress.has(user.user_id)

                    return (
                      <div
                        key={user.user_id}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        {user.avatar_url ? (
                          <Image
                            src={user.avatar_url}
                            alt=""
                            width={48}
                            height={48}
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-semibold">
                            {getInitials(user.email, user.display_name)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-stone-900 dark:text-stone-50 truncate">
                            {getDisplayName(user.email, user.display_name)}
                          </p>
                          {user.mutual_groups_count > 0 && (
                            <p className="text-sm text-stone-500 dark:text-stone-400">
                              {user.mutual_groups_count} mutual group{user.mutual_groups_count !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleFollowToggle(user.user_id, user.follow_status)}
                          disabled={inProgress}
                          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                            isFollowing
                              ? 'bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600'
                              : 'bg-indigo-500 text-white hover:bg-indigo-600'
                          } disabled:opacity-50`}
                        >
                          {inProgress ? (
                            <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          ) : isFollowing ? (
                            'Following'
                          ) : (
                            'Follow'
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo Viewer Modal */}
      {photoViewerIndex !== null && photos[photoViewerIndex] && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Header */}
          <header className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent">
            <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
              <button
                onClick={() => setPhotoViewerIndex(null)}
                className="p-2 -ml-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <span className="text-white/80 text-sm font-medium">
                {photoViewerIndex + 1} / {photos.length}
              </span>
              <button
                onClick={() => handleDeletePhoto(photos[photoViewerIndex].id)}
                disabled={deletingPhotoId === photos[photoViewerIndex].id}
                className="p-2 -mr-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {deletingPhotoId === photos[photoViewerIndex].id ? (
                  <div className="w-6 h-6 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                ) : (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          </header>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center p-4">
            <img
              src={photos[photoViewerIndex].url}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          </div>

          {/* Navigation */}
          {photos.length > 1 && (
            <>
              {photoViewerIndex > 0 && (
                <button
                  onClick={() => setPhotoViewerIndex(photoViewerIndex - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {photoViewerIndex < photos.length - 1 && (
                <button
                  onClick={() => setPhotoViewerIndex(photoViewerIndex + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </>
          )}

          {/* Thumbnails */}
          {photos.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent pb-6 pt-12">
              <div className="flex justify-center gap-2 px-4 overflow-x-auto">
                {photos.map((photo, index) => (
                  <button
                    key={photo.id}
                    onClick={() => setPhotoViewerIndex(index)}
                    className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 transition-all ${
                      index === photoViewerIndex
                        ? 'ring-2 ring-white scale-110'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={photo.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
