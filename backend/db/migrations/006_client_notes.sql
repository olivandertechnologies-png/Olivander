-- Migration 006: Client notes table
-- Allows business owners to add freeform notes against a contact email address.

CREATE TABLE IF NOT EXISTS client_notes (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id  UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
    contact_email TEXT NOT NULL,
    note         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_notes_business_email
    ON client_notes (business_id, contact_email);

ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Businesses can manage own client notes"
    ON client_notes FOR ALL
    TO service_role USING (true) WITH CHECK (true);
