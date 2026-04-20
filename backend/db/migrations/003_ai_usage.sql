-- Migration 003: AI usage tracking
-- Tracks per-call token consumption and cost per business for AI model calls.

CREATE TABLE IF NOT EXISTS ai_usage (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    operation   TEXT NOT NULL,
    input_tokens  INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cost_usd    NUMERIC(12, 8) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_business_id ON ai_usage(business_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at  ON ai_usage(created_at DESC);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Businesses can read own ai_usage"
    ON ai_usage FOR SELECT
    USING (business_id IN (
        SELECT id FROM businesses WHERE id = auth.uid()
    ));
