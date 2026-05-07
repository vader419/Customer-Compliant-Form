-- ============================================================
--  Cospharm QA Portal — Supabase Database Setup
--  Run this entire script in Supabase → SQL Editor → New Query
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'qa_staff',  -- 'qa_staff' | 'admin'
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── COMPLAINTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
  id                        BIGSERIAL PRIMARY KEY,
  ref                       TEXT UNIQUE NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'open',  -- open | in_progress | closed

  -- Reporter
  institution               TEXT,
  contact_person            TEXT,
  designation               TEXT,
  contact_phone             TEXT,
  contact_email             TEXT,
  date_received             DATE,
  complaint_methods         TEXT[]  DEFAULT '{}',

  -- Product
  generic_name              TEXT,
  trade_name                TEXT,
  dosage_form               TEXT,
  strength                  TEXT,
  pack_size                 TEXT,
  manufacturer              TEXT,
  batch_no                  TEXT,
  expiry_date               DATE,
  invoice_no                TEXT,
  quantity_received         INTEGER,
  quantity_affected         INTEGER,
  date_received_by_customer DATE,
  storage_conditions        TEXT,

  -- Complaint detail
  complaint_types           TEXT[]  DEFAULT '{}',
  description               TEXT,
  entire_batch_affected     TEXT,
  patient_harm              TEXT,
  product_used_on_patients  TEXT,
  product_quarantined       TEXT,
  pct_affected              NUMERIC,

  -- QA Internal
  qa_category               TEXT,   -- Minor | Major | Critical
  qa_batch_status           TEXT,
  qa_investigation_required TEXT,
  qa_supplier_notified      TEXT,
  qa_nmrc_required          TEXT,
  feedback_sent_to_client   TEXT,
  qa_root_cause             TEXT,
  qa_capa                   TEXT,
  qa_decisions              TEXT[]  DEFAULT '{}',
  qa_pharmacist             TEXT,
  internal_notes            TEXT,

  -- Timestamps
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

-- ── AUDIT ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit (
  id           BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT REFERENCES complaints(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  detail       TEXT,
  user_id      BIGINT,
  user_name    TEXT DEFAULT 'System',
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEXES for performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_complaints_status     ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_category   ON complaints(qa_category);
CREATE INDEX IF NOT EXISTS idx_audit_complaint_id    ON audit(complaint_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp       ON audit(timestamp DESC);

-- ── ROW LEVEL SECURITY (RLS) ─────────────────────────────────
-- Enable RLS so data is only accessible via the anon key (your app)
ALTER TABLE users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit      ENABLE ROW LEVEL SECURITY;

-- Allow all operations from the anon key (the portal handles its own auth)
CREATE POLICY "allow_all_users"      ON users      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_complaints" ON complaints FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_audit"      ON audit      FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── DONE ─────────────────────────────────────────────────────
-- After running this script, go back to your portal and log in.
-- The first login will auto-create the default admin accounts.
