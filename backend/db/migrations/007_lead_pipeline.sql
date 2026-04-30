-- Migration 007: Lead Pipeline
-- Lightweight pipeline derived from email classifications.
-- Tracks leads from first enquiry through to won/lost.
-- PRD v6.0 Section 8.5 — MVP addition.

CREATE TABLE IF NOT EXISTS lead_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Contact info
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,

  -- Pipeline state
  stage TEXT NOT NULL DEFAULT 'new_enquiry',
  -- Allowed stages: new_enquiry | contacted | quote_sent | quote_accepted | won | lost

  -- Context
  source TEXT NOT NULL DEFAULT 'email',
  -- Allowed sources: email | manual | research

  enquiry_type TEXT,      -- e.g. 'booking_request', 'service_enquiry'
  notes TEXT,

  -- References
  thread_id TEXT,         -- Gmail thread ID if sourced from email
  approval_id UUID,       -- linked approval card
  quote_id UUID,          -- linked quote approval if one was generated

  -- Timing
  last_contact_at TIMESTAMPTZ,
  follow_up_due_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION update_lead_pipeline_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lead_pipeline_updated_at
  BEFORE UPDATE ON lead_pipeline
  FOR EACH ROW EXECUTE FUNCTION update_lead_pipeline_updated_at();

-- RLS: each business sees only its own leads
ALTER TABLE lead_pipeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_pipeline_tenant_isolation" ON lead_pipeline
  USING (business_id::text = current_setting('app.business_id', true));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_business ON lead_pipeline(business_id);
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_stage ON lead_pipeline(business_id, stage);
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_created ON lead_pipeline(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_follow_up ON lead_pipeline(follow_up_due_at)
  WHERE follow_up_due_at IS NOT NULL AND stage NOT IN ('won', 'lost');
