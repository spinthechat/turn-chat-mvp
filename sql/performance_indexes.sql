-- ============================================
-- Performance Indexes for Fast Room Load
-- ============================================

-- 1. Messages: Fast fetch by room_id, ordered by created_at desc (for pagination)
CREATE INDEX IF NOT EXISTS messages_room_created_desc_idx
  ON messages (room_id, created_at DESC);

-- 2. Room members: Fast lookup by room_id
CREATE INDEX IF NOT EXISTS room_members_room_idx
  ON room_members (room_id);

-- 3. Room members: Fast lookup by user_id (for user's rooms list)
CREATE INDEX IF NOT EXISTS room_members_user_idx
  ON room_members (user_id);

-- 4. Message reactions: Fast fetch by message_id
CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON message_reactions (message_id);

-- 5. Turn sessions: Fast lookup by room_id + is_active
CREATE INDEX IF NOT EXISTS turn_sessions_room_active_idx
  ON turn_sessions (room_id) WHERE is_active = true;

-- 6. Profiles: Primary key already indexed, but add for IN queries
-- (No additional index needed - id is primary key)

-- 7. Message seen: Composite index for efficient batch lookups
CREATE INDEX IF NOT EXISTS message_seen_batch_idx
  ON message_seen (message_id, user_id);

-- 8. Nudges: Index for turn-based lookups
CREATE INDEX IF NOT EXISTS nudges_room_turn_idx
  ON nudges (room_id, turn_index);
