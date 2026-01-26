-- ============================================
-- Push Subscriptions Table
-- ============================================
-- Stores web push subscription data per user/device
-- One row per device (users can have multiple devices)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one subscription per endpoint per user
  UNIQUE(user_id, endpoint)
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own subscriptions
CREATE POLICY "Users can view own subscriptions"
  ON push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own subscriptions
CREATE POLICY "Users can insert own subscriptions"
  ON push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own subscriptions
CREATE POLICY "Users can delete own subscriptions"
  ON push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- RPC: Save push subscription (upsert)
-- ============================================
CREATE OR REPLACE FUNCTION save_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  sub_id UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (caller_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (user_id, endpoint)
  DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    created_at = NOW()
  RETURNING id INTO sub_id;

  RETURN sub_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Remove push subscription
-- ============================================
CREATE OR REPLACE FUNCTION remove_push_subscription(p_endpoint TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM push_subscriptions
  WHERE user_id = caller_id AND endpoint = p_endpoint;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Get subscriptions for a user (admin/server use)
-- ============================================
-- Note: This is called from server-side API routes
-- with service role key, not from client
CREATE OR REPLACE FUNCTION get_user_push_subscriptions(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
  FROM push_subscriptions ps
  WHERE ps.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
