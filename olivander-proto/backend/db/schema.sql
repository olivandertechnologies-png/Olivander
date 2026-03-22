CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  business_name TEXT,
  contact_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  onboarded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id),
  status TEXT DEFAULT 'pending',
  type TEXT NOT NULL,
  tier INTEGER DEFAULT 3,
  who TEXT,
  what TEXT,
  why TEXT,
  when_ts TIMESTAMPTZ,
  original_email_id TEXT,
  draft_content TEXT,
  edited_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id),
  description TEXT NOT NULL,
  type TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_approvals" ON approvals;
DROP POLICY IF EXISTS "own_memory" ON memory;
DROP POLICY IF EXISTS "own_activity" ON activity;

CREATE POLICY "own_approvals" ON approvals
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE POLICY "own_memory" ON memory
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE POLICY "own_activity" ON activity
  FOR ALL USING (business_id::text = auth.uid()::text);
