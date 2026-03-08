-- Migration 0004: Hybrid Deployments (Managed Deployment Portal)
CREATE TABLE IF NOT EXISTS managed_deployments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  deployment_type TEXT NOT NULL DEFAULT 'hybrid', -- 'hybrid' | 'on-premise'
  status TEXT NOT NULL DEFAULT 'pending',         -- 'pending' | 'provisioning' | 'active' | 'degraded' | 'offline' | 'suspended'
  licence_key TEXT UNIQUE NOT NULL,
  licence_expires_at TEXT,
  agent_version TEXT,
  api_version TEXT,
  customer_api_url TEXT,                          -- The customer's on-prem API base URL
  region TEXT NOT NULL DEFAULT 'af-south-1',
  last_heartbeat TEXT,
  health_score REAL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',              -- JSON: { ollamaModel, maxUsers, features, ... }
  resource_usage TEXT NOT NULL DEFAULT '{}',      -- JSON: { cpuPct, memMb, diskGb, activeUsers }
  error_log TEXT NOT NULL DEFAULT '[]',           -- JSON array of last 20 errors
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_managed_deployments_tenant ON managed_deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_managed_deployments_licence ON managed_deployments(licence_key);
