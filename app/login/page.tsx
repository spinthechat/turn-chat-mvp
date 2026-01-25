'use client'

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

const MIN_PASSWORD_LENGTH = 6

function LoginForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirect = searchParams.get('redirect') || '/rooms'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)

  // Map Supabase errors to friendly messages
  const getFriendlyError = (message: string): string => {
    const lower = message.toLowerCase()
    if (lower.includes('invalid login credentials')) {
      return 'Invalid email or password'
    }
    if (lower.includes('email not confirmed')) {
      return 'Please confirm your email address first'
    }
    if (lower.includes('user already registered')) {
      return 'An account with this email already exists'
    }
    if (lower.includes('password') && lower.includes('at least')) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }
    if (lower.includes('invalid email')) {
      return 'Please enter a valid email address'
    }
    // Return original if no match (for debugging)
    return message
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNeedsConfirmation(false)

    // Basic validation
    if (!email.trim()) {
      setError('Please enter your email')
      return
    }
    if (!password) {
      setError('Please enter your password')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }

    setLoading(true)

    // Try to sign in first
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (!signInError && signInData.session) {
      // Sign in successful - redirect
      router.push(redirect)
      return
    }

    // If sign in failed, try to sign up (user might be new)
    // Only attempt signup if the error suggests user doesn't exist
    const signInMsg = signInError?.message?.toLowerCase() || ''
    const shouldTrySignup = signInMsg.includes('invalid login credentials') ||
                           signInMsg.includes('invalid email or password') ||
                           signInMsg.includes('user not found')

    if (shouldTrySignup) {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })

      if (signUpError) {
        setLoading(false)
        setError(getFriendlyError(signUpError.message))
        return
      }

      // Check if email confirmation is required
      if (signUpData.user && !signUpData.session) {
        // User created but needs to confirm email
        setLoading(false)
        setNeedsConfirmation(true)
        return
      }

      if (signUpData.session) {
        // Sign up successful and auto-confirmed - redirect
        router.push(redirect)
        return
      }
    }

    // If we get here, show the original sign-in error
    setLoading(false)
    setError(getFriendlyError(signInError?.message || 'Something went wrong'))
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/25">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-stone-900">Turn Chat</h1>
        <p className="text-sm text-stone-500 mt-1">Take turns answering prompts with friends</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm">
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm ring-1 ring-stone-100 p-6 space-y-5"
        >
          {needsConfirmation ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="font-semibold text-stone-900">Check your email</h2>
              <p className="text-sm text-stone-500 mt-1">
                Account created! Please confirm your email at{' '}
                <span className="font-medium text-stone-700">{email}</span>
                {' '}then come back to log in.
              </p>
              <button
                type="button"
                onClick={() => {
                  setNeedsConfirmation(false)
                  setPassword('')
                }}
                className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Back to login
              </button>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2 className="font-semibold text-stone-900">Sign in or create account</h2>
                <p className="text-sm text-stone-500 mt-1">Enter your email and password</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-sm font-medium text-stone-700">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-medium text-stone-700">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full bg-stone-50 border-0 rounded-xl px-4 py-3 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim() || !password}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Please wait...
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-stone-400 mt-6">
          New here? Just enter your email and a password to create an account.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
