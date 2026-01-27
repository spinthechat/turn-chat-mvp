'use client'

interface MembersButtonProps {
  memberCount: number
  onlineCount: number
  onClick: () => void
}

export function MembersButton({
  memberCount,
  onlineCount,
  onClick
}: MembersButtonProps) {
  const hasOnline = onlineCount > 0

  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100/80 hover:bg-slate-200/80 transition-all duration-200 active:scale-95"
      title={`${memberCount} members${hasOnline ? `, ${onlineCount} online` : ''}`}
    >
      {/* Users icon */}
      <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>

      {/* Member count badge */}
      <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] flex items-center justify-center bg-slate-700 text-white text-[10px] font-semibold rounded-full px-1.5 shadow-sm">
        {memberCount}
      </span>

      {/* Online indicator dot */}
      {hasOnline && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full ring-2 ring-white shadow-sm" />
      )}
    </button>
  )
}
