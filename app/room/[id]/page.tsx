'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'

type Msg = {
  id: string
  room_id: string
  user_id: string | null
  type: 'chat' | 'turn_response' | 'system'
  content: string
  created_at: string
}

type TurnSession = {
  room_id: string
  prompt_text: string
  turn_order: string[]
  current_turn_index: number
  is_active: boolean
}

export default function RoomPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const roomId = params.id

  const [userId, setUserId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)

  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [turnSession, setTurnSession] = useState<TurnSession | null>(null)
  const [turnText, setTurnText] = useState('')

  const bottomRef = useRef<HTMLDivElement | null>(null)

  const canSend = useMemo(() => text.trim().length > 0, [text])
  const isMyTurn = useMemo(() => {
    if (!turnSession || !turnSession.is_active || !userId) return false
    const current = turnSession.turn_order?.[turnSession.current_turn_index]
    return current === userId
  }, [turnSession, userId])

  useEffect(() => {
    let msgChannel: any = null
    let sessChannel: any = null

    const boot = async () => {
      setError(null)

      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        router.push('/login')
        return
      }

      const uid = authData.user.id
      setUserId(uid)

      // role (host?)
      const { data: meMember, error: meErr } = await supabase
        .from('room_members')
        .select('role')
        .eq('room_id', roomId)
        .eq('user_id', uid)
        .maybeSingle()

      if (meErr) {
        setError(meErr.message)
      } else {
        setIsHost(meMember?.role === 'host')
      }

      // load current session
      const { data: sess, error: sessErr } = await supabase
        .from('turn_sessions')
        .select('*')
        .eq('room_id', roomId)
        .maybeSingle()

      if (sessErr) {
        // not fatal
        console.warn('turn_sessions load error', sessErr.message)
      } else {
        const s = sess as any
        if (s && s.is_active) setTurnSession(s as TurnSession)
        else setTurnSession(null)
      }

      // load messages
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(200)

      if (error) {
        setError(error.message)
        return
      }
      setMessages((data ?? []) as Msg[])

      // realtime: messages inserts
      msgChannel = supabase
        .channel(`room:${roomId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
          (payload) => {
            const newMsg = payload.new as Msg
            setMessages((prev) => [...prev, newMsg])
          }
        )
        .subscribe()

      // realtime: turn session changes
      sessChannel = supabase
        .channel(`session:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'turn_sessions', filter: `room_id=eq.${roomId}` },
          (payload) => {
            const row = payload.new as any
            if (row && row.is_active) setTurnSession(row as TurnSession)
            else setTurnSession(null)
          }
        )
        .subscribe()
    }

    boot()

    return () => {
      if (msgChannel) supabase.removeChannel(msgChannel)
      if (sessChannel) supabase.removeChannel(sessChannel)
    }
  }, [roomId, router])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length])

  const sendChat = async () => {
    if (!userId) return
    setError(null)

    const content = text.trim()
    if (!content) return

    const { error } = await supabase.from('messages').insert({
      room_id: roomId,
      user_id: userId,
      type: 'chat',
      content,
    })

    if (error) setError(error.message)
    else setText('')
  }

  const startSession = async () => {
    setError(null)
    const { error } = await supabase.rpc('start_session', { p_room_id: roomId })
    if (error) setError(error.message)
  }

  const endSession = async () => {
    setError(null)
    const { error } = await supabase.rpc('end_session', { p_room_id: roomId })
    if (error) setError(error.message)
  }

  const submitTurn = async () => {
    if (!turnText.trim()) return
    setError(null)

    const { error } = await supabase.rpc('submit_turn', {
      p_room_id: roomId,
      p_content: turnText.trim(),
    })

    if (error) setError(error.message)
    else setTurnText('')
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="bg-white border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/rooms')} className="px-3 py-2 bg-gray-100 rounded">
            Back
          </button>

          <div>
            <div className="font-semibold">Room</div>
            <div className="text-xs text-gray-500 break-all">{roomId}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-3xl w-full mx-auto mt-4 bg-white border border-red-200 text-red-700 p-3 rounded">
          {error}
        </div>
      )}

      {/* Turn panel */}
      <div className="bg-white border-b">
        <div className="max-w-3xl mx-auto p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">Turn Mode</div>
              <div className="text-sm text-gray-600">
                {turnSession ? 'Session active' : 'No active session'}
              </div>
            </div>

            {isHost && (
              <div className="flex gap-2">
                {!turnSession ? (
                  <button onClick={startSession} className="px-3 py-2 bg-black text-white rounded">
                    Start
                  </button>
                ) : (
                  <button onClick={endSession} className="px-3 py-2 bg-gray-200 rounded">
                    End
                  </button>
                )}
              </div>
            )}
          </div>

          {turnSession && (
            <div className="rounded-xl border p-3 bg-gray-50 space-y-2">

              <div className="text-sm text-gray-700">
                <span className="font-medium">Current player:</span>{' '}
                {turnSession.turn_order?.[turnSession.current_turn_index]?.slice(0, 6) ?? '—'}
                {isMyTurn ? <span className="ml-2 font-semibold">(Your turn)</span> : null}
              </div>


{isMyTurn && (
  <div className="space-y-2 pt-2">
    <div className="text-sm bg-blue-50 border border-blue-200 rounded p-2">
      <span className="font-medium">Your prompt:</span>{' '}
      Respond creatively — your prompt will be revealed after you submit.
    </div>

    <div className="flex gap-2">
      <input
        value={turnText}
        onChange={(e) => setTurnText(e.target.value)}
        placeholder="Your turn response…"
        className="flex-1 border rounded px-3 py-2"
      />
      <button
        onClick={submitTurn}
        className="px-4 py-2 bg-blue-600 text-white rounded"
      >
        Submit
      </button>
    </div>
  </div>
)}

            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {messages.map((m) => {
            const isMe = userId && m.user_id === userId
            const label =
              m.type === 'chat' ? 'Chat' : m.type === 'turn_response' ? 'Turn' : 'System'

            const who =
              m.type === 'system'
                ? '—'
                : isMe
                ? 'Me'
                : m.user_id
                ? m.user_id.slice(0, 6)
                : '—'

            return (
              <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-[80%] rounded-2xl px-4 py-3 shadow-sm',


m.type === 'system'
  ? 'bg-gray-200 text-gray-800'
  : m.type === 'turn_response'
  ? (isMe
      ? 'bg-blue-600 text-white'
      : 'bg-blue-50 text-gray-900 border border-blue-200')
  : (isMe
      ? 'bg-black text-white'
      : 'bg-white text-gray-900 border'),
                  ].join(' ')}
                >
                  <div className="text-[11px] opacity-70 mb-1 flex items-center justify-between gap-3">
                    <span>
                      {label} · {who}
                    </span>
                    <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                </div>
              </div>
            )
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Chat input */}
      <div className="border-t bg-white p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message…"
            className="flex-1 border rounded px-3 py-2"
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendChat()
            }}
          />
          <button
            onClick={sendChat}
            disabled={!canSend}
            className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
