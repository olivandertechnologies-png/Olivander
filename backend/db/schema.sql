-- Olivander MVP Schema
-- Core database setup for email approval workflow

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

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
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
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
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  type TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_approvals_business_status ON approvals(business_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_business_key ON memory(business_id, key);
CREATE INDEX IF NOT EXISTS idx_activity_business_created ON activity(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_businesses_email ON businesses(email);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

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
