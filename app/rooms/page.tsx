'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

type Room = {
  id: string
  name: string
  created_at: string
  created_by: string
}

export default function RoomsPage() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newRoomName, setNewRoomName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState('')

  const canCreate = useMemo(() => newRoomName.trim().length > 0, [newRoomName])
  const canJoin = useMemo(() => joinRoomId.trim().length > 0, [joinRoomId])

  const refreshRooms = async (uid: string) => {
    setError(null)
    const { data: memberships, error: memErr } = await supabase
      .from('room_members')
      .select('room_id, rooms ( id, name, created_at, created_by )')
      .eq('user_id', uid)

    if (memErr) {
      setError(memErr.message)
      return
    }

    const mapped =
      memberships
        ?.map((m: any) => m.rooms)
        .filter(Boolean)
        .sort((a: Room, b: Room) => (a.created_at < b.created_at ? 1 : -1)) ?? []

    setRooms(mapped)
  }

  useEffect(() => {
    const load = async () => {
      setError(null)
      setLoading(true)

      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user) {
        router.push('/login')
        return
      }

      setUserId(user.id)
      setEmail(user.email ?? null)

      await refreshRooms(user.id)
      setLoading(false)
    }

    load()
  }, [router])

  const createRoom = async () => {
    setError(null)
    const name = newRoomName.trim()
    if (!name) return

    const { data: roomId, error: rpcErr } = await supabase.rpc('create_room', {
      p_name: name,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      return
    }

    setNewRoomName('')
    if (userId) await refreshRooms(userId)
    router.push(`/room/${roomId}`)
  }

  const joinRoom = async () => {
    setError(null)
    if (!userId) return

    const roomId = joinRoomId.trim()
    if (!roomId) return

    const { error: memErr } = await supabase
      .from('room_members')
      .insert({ room_id: roomId, user_id: userId, role: 'member' })

    if (memErr) {
      setError(memErr.message)
      return
    }

    setJoinRoomId('')
    await refreshRooms(userId)
    router.push(`/room/${roomId}`)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Rooms</h1>
            <p className="text-sm text-gray-600">Logged in as {email}</p>
          </div>
          <button onClick={signOut} className="px-4 py-2 bg-white rounded shadow">
            Sign out
          </button>
        </div>

        {error && (
          <div className="bg-white border border-red-200 text-red-700 p-3 rounded">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl shadow space-y-3">
            <h2 className="font-semibold">Create a room</h2>
            <input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name"
              className="w-full border rounded px-3 py-2"
            />
            <button
              onClick={createRoom}
              disabled={!canCreate}
              className="w-full bg-black text-white py-2 rounded disabled:opacity-50"
            >
              Create & enter
            </button>
          </div>

          <div className="bg-white p-4 rounded-xl shadow space-y-3">
            <h2 className="font-semibold">Join a room</h2>
            <input
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              placeholder="Paste Room ID (UUID)"
              className="w-full border rounded px-3 py-2"
            />
            <button
              onClick={joinRoom}
              disabled={!canJoin}
              className="w-full bg-black text-white py-2 rounded disabled:opacity-50"
            >
              Join & enter
            </button>
            <p className="text-xs text-gray-500">
              Tip: after you create a room, you can share its ID with friends.
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow">
          <h2 className="font-semibold mb-3">Your rooms</h2>

          {loading ? (
            <p className="text-sm text-gray-600">Loading…</p>
          ) : rooms.length === 0 ? (
            <p className="text-sm text-gray-600">No rooms yet. Create one!</p>
          ) : (
            <ul className="space-y-2">
              {rooms.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 border rounded p-3"
                >
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-gray-500 break-all">{r.id}</div>
                  </div>
                  <button
                    onClick={() => router.push(`/room/${r.id}`)}
                    className="px-3 py-2 bg-gray-100 rounded"
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
