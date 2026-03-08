-- Migration 0005: Pre-Assessment Tool
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  prospect_name TEXT NOT NULL,
  prospect_industry TEXT NOT NULL,
  erp_connection_id TEXT REFERENCES erp_connections(id),
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'running' | 'complete' | 'failed'
  config TEXT NOT NULL DEFAULT '{}',            -- AssessmentConfig JSON
  data_snapshot TEXT NOT NULL DEFAULT '{}',     -- Raw volume data collected from ERP
  results TEXT NOT NULL DEFAULT '{}',           -- Scored catalyst results
  business_report_key TEXT,                     -- R2 / MinIO key for business PDF
  technical_report_key TEXT,                    -- R2 / MinIO key for technical PDF
  excel_model_key TEXT,                         -- R2 / MinIO key for Excel model
  created_by TEXT NOT NULL,                     -- user id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_assessments_tenant ON assessments(tenant_id);
