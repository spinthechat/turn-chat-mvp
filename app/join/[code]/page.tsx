'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'

export default function JoinPage() {
  const router = useRouter()
  const params = useParams<{ code: string }>()
  const code = params.code

  const [status, setStatus] = useState<'loading' | 'joining' | 'success' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)

  useEffect(() => {
    const joinRoom = async () => {
      // Check if user is logged in
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        // Redirect to login with return URL
        const returnUrl = encodeURIComponent(`/join/${code}`)
        router.push(`/login?redirect=${returnUrl}`)
        return
      }

      setStatus('joining')

      // Try to join via invite
      const { data, error } = await supabase.rpc('join_room_via_invite', {
        p_code: code,
      })

      if (error) {
        setStatus('error')
        setError(error.message)
      } else {
        setStatus('success')
        setRoomId(data as string)
        // Redirect to the room after a short delay
        setTimeout(() => {
          router.push(`/room/${data}`)
        }, 1500)
      }
    }

    joinRoom()
  }, [code, router])

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-2 border-stone-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-stone-900">Checking invite...</h1>
          </>
        )}

        {status === 'joining' && (
          <>
            <div className="w-12 h-12 border-2 border-stone-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-stone-900">Joining group...</h1>
            <p className="text-sm text-stone-500 mt-2">Please wait</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-stone-900">You're in!</h1>
            <p className="text-sm text-stone-500 mt-2">Redirecting to the group...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-stone-900">Couldn't join</h1>
            <p className="text-sm text-red-500 mt-2">{error}</p>
            <button
              onClick={() => router.push('/rooms')}
              className="mt-6 px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-800 transition-colors"
            >
              Go to your groups
            </button>
          </>
        )}
      </div>
    </div>
  )
}
