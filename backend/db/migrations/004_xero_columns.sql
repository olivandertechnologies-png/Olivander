-- Phase 5: Xero integration — add token storage columns to businesses table.
-- Run once against Supabase:
--   paste into the Supabase SQL editor and execute.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS xero_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS xero_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS xero_token_expiry  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS xero_tenant_id     TEXT;
