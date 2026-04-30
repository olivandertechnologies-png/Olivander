-- Migration 010: First-customer workspace records
-- Persistent manual/demo-ready records for the first tradie build:
-- jobs, inbox cards, and admin action cards.

CREATE TABLE IF NOT EXISTS workspace_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  customer TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  job_type TEXT NOT NULL DEFAULT 'Manual job',
  status TEXT NOT NULL DEFAULT 'new_lead',
  value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  scheduled_for TEXT,
  next_action TEXT,
  quote_sent_days_ago INTEGER,
  invoice JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  customer TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_email_id TEXT,
  source_thread_id TEXT,
  category TEXT NOT NULL DEFAULT 'Needs reply',
  received_at TEXT,
  job_type TEXT,
  address TEXT,
  body TEXT NOT NULL,
  interpretation TEXT,
  draft TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  plus_only_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspace_messages ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE workspace_messages ADD COLUMN IF NOT EXISTS source_email_id TEXT;
ALTER TABLE workspace_messages ADD COLUMN IF NOT EXISTS source_thread_id TEXT;

CREATE TABLE IF NOT EXISTS workspace_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  type TEXT NOT NULL DEFAULT 'reply',
  title TEXT NOT NULL,
  customer TEXT,
  email TEXT,
  source_message_id TEXT,
  job_id TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  reason TEXT,
  detail TEXT,
  draft TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  plus_only BOOLEAN NOT NULL DEFAULT FALSE,
  locked_reason TEXT,
  value NUMERIC(12, 2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_workspace_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_jobs_updated_at ON workspace_jobs;
CREATE TRIGGER trg_workspace_jobs_updated_at
  BEFORE UPDATE ON workspace_jobs
  FOR EACH ROW EXECUTE FUNCTION update_workspace_updated_at();

DROP TRIGGER IF EXISTS trg_workspace_messages_updated_at ON workspace_messages;
CREATE TRIGGER trg_workspace_messages_updated_at
  BEFORE UPDATE ON workspace_messages
  FOR EACH ROW EXECUTE FUNCTION update_workspace_updated_at();

DROP TRIGGER IF EXISTS trg_workspace_actions_updated_at ON workspace_actions;
CREATE TRIGGER trg_workspace_actions_updated_at
  BEFORE UPDATE ON workspace_actions
  FOR EACH ROW EXECUTE FUNCTION update_workspace_updated_at();

ALTER TABLE workspace_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_workspace_jobs" ON workspace_jobs;
DROP POLICY IF EXISTS "own_workspace_messages" ON workspace_messages;
DROP POLICY IF EXISTS "own_workspace_actions" ON workspace_actions;

CREATE POLICY "own_workspace_jobs" ON workspace_jobs
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE POLICY "own_workspace_messages" ON workspace_messages
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE POLICY "own_workspace_actions" ON workspace_actions
  FOR ALL USING (business_id::text = auth.uid()::text);

CREATE INDEX IF NOT EXISTS idx_workspace_jobs_business_status ON workspace_jobs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_jobs_updated ON workspace_jobs(business_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_business_status ON workspace_messages(business_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_messages_updated ON workspace_messages(business_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_messages_source_email
  ON workspace_messages(business_id, source_email_id)
  WHERE source_email_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_actions_business_status ON workspace_actions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_actions_updated ON workspace_actions(business_id, updated_at DESC);
