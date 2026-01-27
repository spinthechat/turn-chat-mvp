// Formatting utility functions

export const formatTimeRemaining = (targetDate: Date): string => {
  const now = new Date()
  const diff = targetDate.getTime() - now.getTime()
  if (diff <= 0) return 'now'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export const formatTime = (date: string): string => {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export const getInitials = (email: string): string => {
  const name = email.split('@')[0]
  const cleaned = name.replace(/[0-9]/g, '')
  const parts = cleaned.split(/[._-]/).filter(p => p.length > 0)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return cleaned.toUpperCase() || '??'
}

export const getDisplayName = (email: string): string => {
  const name = email.split('@')[0]
  const formatted = name
    .replace(/[._-]/g, ' ')
    .replace(/[0-9]/g, '')
    .trim()
    .split(' ')
    .filter(p => p.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
  return formatted || name
}
