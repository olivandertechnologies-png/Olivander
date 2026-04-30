-- 009: enforce uniqueness on (business_id, key) in the memory table
-- Required for atomic upserts — prevents duplicate rows under concurrent writes.
-- Uses a unique index (same effect as a UNIQUE constraint, supports IF NOT EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS memory_business_key_unique
  ON memory (business_id, key);
