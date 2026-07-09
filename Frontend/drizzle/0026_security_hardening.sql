-- Security & ops hardening: revocable auditor links, revocable sessions, extra indexes.
CREATE TABLE IF NOT EXISTS auditor_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  email text,
  created_by text NOT NULL,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditor_links_tenant ON auditor_links (tenant_id);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti text PRIMARY KEY,
  user_id text,
  revoked_at timestamp DEFAULT now(),
  expires_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_payslips_tenant_period ON payslips (tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_photos_tenant ON photos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_ledger_tenant_emp ON employee_ledger (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_batch ON products (tenant_id, batch_id);
