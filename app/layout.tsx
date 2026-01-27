import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
})

// Icon version for cache-busting (increment when icons change)
const ICON_VERSION = 3

export const metadata: Metadata = {
  title: 'Spin the Chat',
  description: 'A group chat with turn-based prompts',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SpinChat',
  },
  icons: {
    icon: [
      { url: `/icons/icon-192.png?v=${ICON_VERSION}`, sizes: '192x192', type: 'image/png' },
      { url: `/icons/icon-512.png?v=${ICON_VERSION}`, sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: `/icons/icon-192.png?v=${ICON_VERSION}`, sizes: '192x192', type: 'image/png' },
    ],
    other: [
      // Maskable icon for Android adaptive icons
      { rel: 'icon', url: `/icons/maskable-192.png?v=${ICON_VERSION}`, sizes: '192x192', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#2c4a7c',
}

// Script to prevent flash of wrong theme on load
// This runs before React hydration to set the correct class
const themeScript = `
  (function() {
    try {
      var stored = localStorage.getItem('theme-preference');
      var theme = stored || 'system';
      var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {}
  })();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Explicit apple-touch-icon for iOS Safari (some versions ignore metadata) */}
        <link rel="apple-touch-icon" sizes="192x192" href={`/icons/icon-192.png?v=${ICON_VERSION}`} />
        {/* Explicit maskable icon hint for Android */}
        <link rel="icon" sizes="192x192" href={`/icons/maskable-192.png?v=${ICON_VERSION}`} />
      </head>
      <body className={`${inter.variable} ${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  )
}
