'use client'

interface PhotoActionSheetProps {
  isOpen: boolean
  onClose: () => void
  onTakePhoto: () => void
  onChooseLibrary: () => void
}

export function PhotoActionSheet({
  isOpen,
  onClose,
  onTakePhoto,
  onChooseLibrary,
}: PhotoActionSheetProps) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Action Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 pb-safe animate-in slide-in-from-bottom duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Photo options"
      >
        <div className="mx-3 mb-3 space-y-2">
          {/* Options card */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-xl">
            <button
              onClick={() => {
                onClose()
                // Small delay to let sheet close before triggering input
                setTimeout(onTakePhoto, 100)
              }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors border-b border-stone-100"
            >
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="text-base font-medium text-stone-900">Take Photo</span>
            </button>
            <button
              onClick={() => {
                onClose()
                setTimeout(onChooseLibrary, 100)
              }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-base font-medium text-stone-900">Choose from Library</span>
            </button>
          </div>

          {/* Cancel button */}
          <button
            onClick={onClose}
            className="w-full py-4 bg-white rounded-2xl text-base font-semibold text-indigo-600 hover:bg-stone-50 active:bg-stone-100 transition-colors shadow-xl"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
