'use client'

export function LoadingState() {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center">
      <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mb-4" />
      <p className="text-stone-500 text-sm">Loading room...</p>
    </div>
  )
}
