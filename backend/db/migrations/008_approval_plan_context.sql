-- 008: add execution_plan and retrieved_context provenance columns to approvals
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS execution_plan JSONB,
  ADD COLUMN IF NOT EXISTS retrieved_context JSONB;
