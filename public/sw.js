// Service Worker for Push Notifications
// Handles push events and notification clicks

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const data = event.data.json()

    const options = {
      body: data.body || "It's your turn!",
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'turn-notification',
      data: {
        roomId: data.roomId,
        url: data.url || `/room/${data.roomId}`,
      },
      // Vibrate pattern for mobile
      vibrate: [100, 50, 100],
      // Keep notification until user interacts
      requireInteraction: false,
    }

    event.waitUntil(
      self.registration.showNotification(data.title || 'Spin the Chat', options)
    )
  } catch (err) {
    console.error('Push event error:', err)
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open with the app
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Navigate existing window to the room
          client.navigate(urlToOpen)
          return client.focus()
        }
      }
      // No existing window, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

// Handle service worker activation
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})
