-- Atheon D1 Schema - Canonical ERP Data Tables
-- These tables store synced/canonical data from connected ERP systems
-- Used for cross-system analytics, knowledge graph, and Catalyst operations

-- Canonical Customers / Business Partners
CREATE TABLE IF NOT EXISTS erp_customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  name TEXT NOT NULL,
  trading_name TEXT,
  registration_number TEXT,
  vat_number TEXT,
  customer_group TEXT,
  credit_limit REAL DEFAULT 0,
  credit_balance REAL DEFAULT 0,
  payment_terms TEXT DEFAULT 'Net 30',
  currency TEXT DEFAULT 'ZAR',
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'ZA',
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Suppliers / Vendors
CREATE TABLE IF NOT EXISTS erp_suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  name TEXT NOT NULL,
  trading_name TEXT,
  registration_number TEXT,
  vat_number TEXT,
  supplier_group TEXT,
  payment_terms TEXT DEFAULT 'Net 30',
  currency TEXT DEFAULT 'ZAR',
  address_line1 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'ZA',
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_branch_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  risk_score REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Products / Materials / Inventory Items
CREATE TABLE IF NOT EXISTS erp_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  product_group TEXT,
  uom TEXT DEFAULT 'EA',
  cost_price REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  vat_rate REAL DEFAULT 15,
  stock_on_hand REAL DEFAULT 0,
  reorder_level REAL DEFAULT 0,
  reorder_quantity REAL DEFAULT 0,
  warehouse TEXT,
  weight_kg REAL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Sales Invoices
CREATE TABLE IF NOT EXISTS erp_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  invoice_number TEXT NOT NULL,
  customer_id TEXT REFERENCES erp_customers(id),
  customer_name TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  vat_amount REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  amount_due REAL DEFAULT 0,
  currency TEXT DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'draft',
  payment_status TEXT DEFAULT 'unpaid',
  reference TEXT,
  notes TEXT,
  line_items TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Purchase Orders
CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  po_number TEXT NOT NULL,
  supplier_id TEXT REFERENCES erp_suppliers(id),
  supplier_name TEXT,
  order_date TEXT NOT NULL,
  delivery_date TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  vat_amount REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'draft',
  delivery_status TEXT DEFAULT 'pending',
  reference TEXT,
  line_items TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical General Ledger Accounts (Chart of Accounts)
CREATE TABLE IF NOT EXISTS erp_gl_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_class TEXT,
  parent_account TEXT,
  currency TEXT DEFAULT 'ZAR',
  balance REAL DEFAULT 0,
  ytd_debit REAL DEFAULT 0,
  ytd_credit REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical GL Journal Entries
CREATE TABLE IF NOT EXISTS erp_journal_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  journal_number TEXT NOT NULL,
  journal_date TEXT NOT NULL,
  description TEXT,
  total_debit REAL NOT NULL DEFAULT 0,
  total_credit REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'posted',
  posted_by TEXT,
  lines TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Employees
CREATE TABLE IF NOT EXISTS erp_employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  id_number TEXT,
  department TEXT,
  position TEXT,
  cost_centre TEXT,
  hire_date TEXT,
  termination_date TEXT,
  employment_type TEXT DEFAULT 'permanent',
  salary_frequency TEXT DEFAULT 'monthly',
  gross_salary REAL DEFAULT 0,
  tax_number TEXT,
  bank_name TEXT,
  bank_account TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Bank Transactions
CREATE TABLE IF NOT EXISTS erp_bank_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'manual',
  bank_account TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  description TEXT,
  reference TEXT,
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  reconciled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Canonical Tax Returns / VAT
CREATE TABLE IF NOT EXISTS erp_tax_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_system TEXT NOT NULL DEFAULT 'manual',
  tax_period TEXT NOT NULL,
  tax_type TEXT NOT NULL DEFAULT 'VAT',
  output_vat REAL DEFAULT 0,
  input_vat REAL DEFAULT 0,
  net_vat REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for canonical ERP tables
CREATE INDEX IF NOT EXISTS idx_erp_customers_tenant ON erp_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_suppliers_tenant ON erp_suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_products_tenant ON erp_products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_products_sku ON erp_products(tenant_id, sku);
CREATE INDEX IF NOT EXISTS idx_erp_invoices_tenant ON erp_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_invoices_customer ON erp_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_invoices_status ON erp_invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_po_tenant ON erp_purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_po_supplier ON erp_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_gl_tenant ON erp_gl_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_tenant ON erp_journal_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_employees_tenant ON erp_employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_bank_tenant ON erp_bank_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erp_tax_tenant ON erp_tax_entries(tenant_id);
