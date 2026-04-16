-- Olivander MVP Schema
-- Run this in Supabase SQL editor to set up the database

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Businesses (main tenant/business entity)
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

-- Approvals (email drafts pending approval)
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

-- Memory (key-value store for business context)
CREATE TABLE IF NOT EXISTS memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity log (audit trail)
CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  type TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth state (temporary states for OAuth flow)
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
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- oauth_states remains unrestricted (no RLS needed for temporary state)

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "own_approvals" ON approvals;
DROP POLICY IF EXISTS "own_memory" ON memory;
DROP POLICY IF EXISTS "own_activity" ON activity;

-- RLS Policies: restrict access to business's own data
CREATE POLICY "own_approvals" ON approvals
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE POLICY "own_memory" ON memory
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE POLICY "own_activity" ON activity
  FOR ALL USING (business_id::text = auth.uid()::text);

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE businesses IS 'Core business/tenant entities with OAuth token storage';
COMMENT ON TABLE approvals IS 'Email drafts and tasks pending owner approval (Tier 3 - owner approval required)';
COMMENT ON TABLE memory IS 'Key-value store for business context, tone, pricing, and operational details';
COMMENT ON TABLE activity IS 'Audit log of all business actions and email processing events';
COMMENT ON TABLE oauth_states IS 'Temporary OAuth state tokens during Google authentication flow';
