-- Migration 005: Job queue for background tasks and follow-up sequences
-- Run against Supabase SQL editor

CREATE TABLE IF NOT EXISTS job_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the poller: pending jobs due to run
CREATE INDEX IF NOT EXISTS idx_job_queue_poller
    ON job_queue (status, run_at)
    WHERE status = 'pending';

-- Index for per-business job lookups
CREATE INDEX IF NOT EXISTS idx_job_queue_business
    ON job_queue (business_id, job_type, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_job_queue_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_job_queue_updated_at
    BEFORE UPDATE ON job_queue
    FOR EACH ROW EXECUTE FUNCTION update_job_queue_updated_at();

-- Enable Row Level Security (same pattern as other tables)
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (backend uses service key)
CREATE POLICY "Service role can manage all jobs"
    ON job_queue FOR ALL
    TO service_role USING (true) WITH CHECK (true);
