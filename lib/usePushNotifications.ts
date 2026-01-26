'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'

// VAPID public key - set this in your environment
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

interface PushNotificationState {
  permission: PermissionState
  isSubscribed: boolean
  isLoading: boolean
  isPWAInstalled: boolean
  isSupported: boolean
  error: string | null
}

// Convert VAPID key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

// Check if running as installed PWA
function checkIsPWAInstalled(): boolean {
  if (typeof window === 'undefined') return false

  // Check display-mode media query
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches

  // iOS Safari specific check
  const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true

  return isStandalone || isIOSStandalone
}

// Check if push notifications are supported
function checkIsSupported(): boolean {
  if (typeof window === 'undefined') return false

  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    permission: 'prompt',
    isSubscribed: false,
    isLoading: true,
    isPWAInstalled: false,
    isSupported: false,
    error: null,
  })

  // Check current state on mount
  useEffect(() => {
    const checkState = async () => {
      const isSupported = checkIsSupported()
      const isPWAInstalled = checkIsPWAInstalled()

      if (!isSupported) {
        setState({
          permission: 'unsupported',
          isSubscribed: false,
          isLoading: false,
          isPWAInstalled,
          isSupported: false,
          error: null,
        })
        return
      }

      // Get current permission
      const permission = Notification.permission as PermissionState

      // Check if already subscribed
      let isSubscribed = false
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        if (registration) {
          const subscription = await registration.pushManager.getSubscription()
          isSubscribed = !!subscription
        }
      } catch (err) {
        console.error('Error checking subscription:', err)
      }

      setState({
        permission,
        isSubscribed,
        isLoading: false,
        isPWAInstalled,
        isSupported: true,
        error: null,
      })
    }

    checkState()
  }, [])

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: 'Push notifications not supported' }))
      return false
    }

    if (!VAPID_PUBLIC_KEY) {
      setState((prev) => ({ ...prev, error: 'VAPID key not configured' }))
      return false
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      // Request permission (must be triggered by user interaction)
      const permission = await Notification.requestPermission()

      if (permission !== 'granted') {
        setState((prev) => ({
          ...prev,
          permission: permission as PermissionState,
          isLoading: false,
        }))
        return false
      }

      // Register service worker
      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      // Subscribe to push
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      })

      // Extract keys
      const subscriptionJson = subscription.toJSON()
      const keys = subscriptionJson.keys as { p256dh: string; auth: string }

      // Save to Supabase
      const { error: saveError } = await supabase.rpc('save_push_subscription', {
        p_endpoint: subscription.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_user_agent: navigator.userAgent,
      })

      if (saveError) {
        throw new Error(saveError.message)
      }

      setState((prev) => ({
        ...prev,
        permission: 'granted',
        isSubscribed: true,
        isLoading: false,
      }))

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe'
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }))
      return false
    }
  }, [state.isSupported])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          // Remove from Supabase
          await supabase.rpc('remove_push_subscription', {
            p_endpoint: subscription.endpoint,
          })

          // Unsubscribe from push manager
          await subscription.unsubscribe()
        }
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
      }))

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unsubscribe'
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }))
      return false
    }
  }, [])

  return {
    ...state,
    subscribe,
    unsubscribe,
  }
}
