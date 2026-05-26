/**
 * VantaX Demo Data Seeder
 * Creates a realistic SAP S/4HANA demo environment with:
 * - Real ERP data (invoices, POs, suppliers, customers, products, bank transactions, GL entries)
 * - Configured sub-catalysts with data sources and field mappings
 * - SAP connector in erp_connections
 * - Deliberate discrepancies for realistic reconciliation results
 *
 * RESTRICTED: VantaX (Pty) Ltd demo environment only
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext, AppBindings } from '../types';
import {
  VANTAX_TENANT_TABLES,
  cleanupVantaxTenant,
  materialiseDemoBilling,
} from '../services/vantax-demo';
import {
  generateValueReportPDF,
  DEFAULT_VALUE_ASSESSMENT_CONFIG,
} from '../services/value-assessment-engine';

const seed = new Hono<AppBindings>();
seed.use('/*', cors());

async function getVantaXTenantId(c: { get: (key: string) => unknown; env: { DB: D1Database } }): Promise<string | null> {
  const auth = c.get('auth') as AuthContext | undefined;
  const allowedRoles = ['superadmin', 'support_admin', 'admin', 'executive'];
  if (!auth || !allowedRoles.includes(auth.role)) {
    return null;
  }
  const row = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE slug = 'vantax'"
  ).first() as { id: string } | null;
  return row?.id || null;
}

// South African supplier names (realistic SAP vendor master)
const SA_SUPPLIERS = [
  { name: 'Sasol Chemical Industries', vat: '4120456789', terms: 'Net 30', group: 'chemicals', city: 'Sasolburg', province: 'Free State' },
  { name: 'Tsebo Solutions Group', vat: '4230567890', terms: 'Net 45', group: 'facilities', city: 'Sandton', province: 'Gauteng' },
  { name: 'Barloworld Logistics', vat: '4340678901', terms: 'Net 30', group: 'logistics', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Bidvest Industrial', vat: '4450789012', terms: 'Net 60', group: 'industrial', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Grindrod Shipping', vat: '4560890123', terms: 'Net 30', group: 'shipping', city: 'Durban', province: 'KwaZulu-Natal' },
  { name: 'Nampak Packaging', vat: '4670901234', terms: 'Net 45', group: 'packaging', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Mpact Operations', vat: '4781012345', terms: 'Net 30', group: 'packaging', city: 'Pinetown', province: 'KwaZulu-Natal' },
  { name: 'ArcelorMittal SA', vat: '4891123456', terms: 'Net 60', group: 'steel', city: 'Vanderbijlpark', province: 'Gauteng' },
  { name: 'AECI Mining Explosives', vat: '4901234567', terms: 'Net 30', group: 'mining', city: 'Modderfontein', province: 'Gauteng' },
  { name: 'Omnia Holdings', vat: '4011345678', terms: 'Net 45', group: 'agriculture', city: 'Bryanston', province: 'Gauteng' },
  { name: 'Raubex Construction', vat: '4121456789', terms: 'Net 30', group: 'construction', city: 'Bloemfontein', province: 'Free State' },
  { name: 'Murray and Roberts', vat: '4231567890', terms: 'Net 60', group: 'construction', city: 'Bedfordview', province: 'Gauteng' },
  { name: 'Afrimat Limited', vat: '4341678901', terms: 'Net 30', group: 'mining', city: 'Worcester', province: 'Western Cape' },
  { name: 'DCD Group', vat: '4451789012', terms: 'Net 45', group: 'engineering', city: 'Vereeniging', province: 'Gauteng' },
  { name: 'enX Group', vat: '4561890123', terms: 'Net 30', group: 'industrial', city: 'Boksburg', province: 'Gauteng' },
];

const SA_CUSTOMERS = [
  { name: 'Pick n Pay Stores', reg: '1968/004855/06', group: 'retail', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Woolworths Holdings', reg: '1929/001986/06', group: 'retail', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Shoprite Holdings', reg: '1936/007721/06', group: 'retail', city: 'Brackenfell', province: 'Western Cape' },
  { name: 'Clicks Group', reg: '1996/000645/06', group: 'pharmacy', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Discovery Health', reg: '1999/007789/06', group: 'insurance', city: 'Sandton', province: 'Gauteng' },
  { name: 'Old Mutual Ltd', reg: '1845/002001/06', group: 'financial', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Naspers Group', reg: '1925/001431/06', group: 'media', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Sasol Energy', reg: '1979/003231/06', group: 'energy', city: 'Sasolburg', province: 'Free State' },
  { name: 'MTN Group', reg: '1994/009283/06', group: 'telecoms', city: 'Fairland', province: 'Gauteng' },
  { name: 'Vodacom Business', reg: '1993/003367/06', group: 'telecoms', city: 'Midrand', province: 'Gauteng' },
  { name: 'Standard Bank Corp', reg: '1969/017128/06', group: 'banking', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'FirstRand Limited', reg: '1966/010753/06', group: 'banking', city: 'Sandton', province: 'Gauteng' },
  { name: 'Transnet SOC Ltd', reg: '1990/000900/30', group: 'logistics', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Eskom Holdings', reg: '2002/015527/06', group: 'energy', city: 'Megawatt Park', province: 'Gauteng' },
  { name: 'City of Johannesburg', reg: '2000/002013/06', group: 'government', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Capitec Bank', reg: '1999/025903/06', group: 'banking', city: 'Stellenbosch', province: 'Western Cape' },
  { name: 'Nedbank Group', reg: '1966/010630/06', group: 'banking', city: 'Sandton', province: 'Gauteng' },
  { name: 'Sanlam Limited', reg: '1959/001562/06', group: 'financial', city: 'Bellville', province: 'Western Cape' },
  { name: 'Life Healthcare', reg: '2003/002733/06', group: 'healthcare', city: 'Rosebank', province: 'Gauteng' },
  { name: 'Netcare Limited', reg: '1996/015813/06', group: 'healthcare', city: 'Sandton', province: 'Gauteng' },
];

const SA_PRODUCTS = [
  { sku: 'SAP-RM-001', name: 'Polyethylene Resin (25kg)', cat: 'Raw Materials', cost: 1250.00, sell: 1625.00, stock: 450, reorder: 100, uom: 'BAG' },
  { sku: 'SAP-RM-002', name: 'Industrial Solvent (200L)', cat: 'Raw Materials', cost: 3800.00, sell: 4940.00, stock: 120, reorder: 30, uom: 'DRM' },
  { sku: 'SAP-RM-003', name: 'Carbon Steel Plate (6mm)', cat: 'Raw Materials', cost: 8500.00, sell: 11050.00, stock: 85, reorder: 20, uom: 'TON' },
  { sku: 'SAP-RM-004', name: 'Copper Wire (2.5mm, 100m)', cat: 'Raw Materials', cost: 2400.00, sell: 3360.00, stock: 200, reorder: 40, uom: 'COI' },
  { sku: 'SAP-RM-005', name: 'Aluminium Sheet (3mm)', cat: 'Raw Materials', cost: 6200.00, sell: 8060.00, stock: 65, reorder: 15, uom: 'TON' },
  { sku: 'SAP-FG-001', name: 'Industrial Lubricant (20L)', cat: 'Finished Goods', cost: 450.00, sell: 720.00, stock: 800, reorder: 200, uom: 'PCK' },
  { sku: 'SAP-FG-002', name: 'Mining Drill Bit (48mm)', cat: 'Finished Goods', cost: 2200.00, sell: 3520.00, stock: 340, reorder: 50, uom: 'EA' },
  { sku: 'SAP-FG-003', name: 'Safety Valve Assembly', cat: 'Finished Goods', cost: 15600.00, sell: 24960.00, stock: 45, reorder: 10, uom: 'EA' },
  { sku: 'SAP-FG-004', name: 'Transformer Oil (210L)', cat: 'Finished Goods', cost: 5800.00, sell: 8120.00, stock: 90, reorder: 20, uom: 'DRM' },
  { sku: 'SAP-SP-001', name: 'Conveyor Belt (10m)', cat: 'Spare Parts', cost: 4200.00, sell: 5880.00, stock: 25, reorder: 5, uom: 'ROL' },
  { sku: 'SAP-SP-002', name: 'Hydraulic Pump HX-400', cat: 'Spare Parts', cost: 28000.00, sell: 36400.00, stock: 12, reorder: 3, uom: 'EA' },
  { sku: 'SAP-SP-003', name: 'Electric Motor 75kW', cat: 'Spare Parts', cost: 42000.00, sell: 54600.00, stock: 8, reorder: 2, uom: 'EA' },
  { sku: 'SAP-PM-001', name: 'Packaging Film (500m)', cat: 'Packaging', cost: 680.00, sell: 884.00, stock: 1200, reorder: 300, uom: 'ROL' },
  { sku: 'SAP-PM-002', name: 'Corrugated Box (600x400)', cat: 'Packaging', cost: 18.50, sell: 27.75, stock: 5000, reorder: 1000, uom: 'EA' },
  { sku: 'SAP-CH-001', name: 'Sulfuric Acid (1000L)', cat: 'Chemicals', cost: 5200.00, sell: 7280.00, stock: 40, reorder: 10, uom: 'IBC' },
  { sku: 'SAP-CH-002', name: 'Caustic Soda Flake (25kg)', cat: 'Chemicals', cost: 890.00, sell: 1246.00, stock: 200, reorder: 50, uom: 'BAG' },
  { sku: 'SAP-EQ-001', name: 'PPE Safety Kit', cat: 'Equipment', cost: 350.00, sell: 525.00, stock: 600, reorder: 150, uom: 'KIT' },
  { sku: 'SAP-EQ-002', name: 'Fire Extinguisher (9kg)', cat: 'Equipment', cost: 780.00, sell: 1170.00, stock: 180, reorder: 30, uom: 'EA' },
];

// GL account chart of accounts (SAP FI)
const GL_ACCOUNTS = [
  { code: '1000', name: 'Cash and Cash Equivalents', type: 'asset', cls: 'current_asset', balance: 2450000 },
  { code: '1100', name: 'Trade Receivables', type: 'asset', cls: 'current_asset', balance: 3820000 },
  { code: '1200', name: 'Inventory - Raw Materials', type: 'asset', cls: 'current_asset', balance: 1680000 },
  { code: '1210', name: 'Inventory - Finished Goods', type: 'asset', cls: 'current_asset', balance: 2150000 },
  { code: '1300', name: 'Prepaid Expenses', type: 'asset', cls: 'current_asset', balance: 340000 },
  { code: '1500', name: 'Property Plant and Equipment', type: 'asset', cls: 'non_current_asset', balance: 12500000 },
  { code: '1510', name: 'Accumulated Depreciation', type: 'asset', cls: 'non_current_asset', balance: -4200000 },
  { code: '2000', name: 'Trade Payables', type: 'liability', cls: 'current_liability', balance: 2890000 },
  { code: '2100', name: 'VAT Output', type: 'liability', cls: 'current_liability', balance: 520000 },
  { code: '2200', name: 'VAT Input', type: 'asset', cls: 'current_asset', balance: 380000 },
  { code: '2300', name: 'PAYE Payable', type: 'liability', cls: 'current_liability', balance: 185000 },
  { code: '2400', name: 'Accrued Expenses', type: 'liability', cls: 'current_liability', balance: 450000 },
  { code: '3000', name: 'Share Capital', type: 'equity', cls: 'equity', balance: 5000000 },
  { code: '3100', name: 'Retained Earnings', type: 'equity', cls: 'equity', balance: 8200000 },
  { code: '4000', name: 'Revenue - Product Sales', type: 'revenue', cls: 'income', balance: 18500000 },
  { code: '4100', name: 'Revenue - Services', type: 'revenue', cls: 'income', balance: 4200000 },
  { code: '5000', name: 'Cost of Sales', type: 'expense', cls: 'expense', balance: 11800000 },
  { code: '5100', name: 'Employee Costs', type: 'expense', cls: 'expense', balance: 5600000 },
  { code: '5200', name: 'Operating Expenses', type: 'expense', cls: 'expense', balance: 2100000 },
  { code: '5300', name: 'Depreciation', type: 'expense', cls: 'expense', balance: 840000 },
];

// Re-export under the old name so consumers inside this file (the seed
// step that whitelists table names before COUNT(*)) keep working.
const ALLOWED_TABLES = VANTAX_TENANT_TABLES;

/**
 * POST /api/v1/seed-vantax
 * Complete cleanup and reseed of VantaX demo environment with realistic SAP data.
 * Creates SAP connector, populates all ERP tables, configures sub-catalysts with
 * data_sources and field_mappings for real reconciliation execution.
 */
seed.post('/seed-vantax', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ error: 'Access denied', message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment' }, 403);
  }

  try {
    const now = new Date().toISOString();
    console.log('[VantaX Seeder] Starting seed for tenant:', tenantId);

    // Collect all INSERT/UPDATE statements into one batch to fit D1's per-request CPU budget.
    // Flushed at the end of each major STEP block via flushSeed().
    const seedBatch: D1PreparedStatement[] = [];
    const flushSeed = async (label: string) => {
      if (seedBatch.length === 0) return;
      const chunkSize = 50;
      const total = seedBatch.length;
      while (seedBatch.length > 0) {
        const chunk = seedBatch.splice(0, chunkSize);
        await c.env.DB.batch(chunk);
      }
      console.log(`[VantaX Seeder] Flushed ${total} statements (${label})`);
    };

    // STEP 1: Cleanup ALL old data for this tenant
    // Shared with /reset — full tenant wipe in dependency-safe order.
    const { count: cleanupCount, tables: cleanupTablesCount } =
      await cleanupVantaxTenant(c.env.DB, tenantId);
    console.log(`[VantaX Seeder] Cleaned ${cleanupCount} old records`);

    // STEP 2: Create SAP S/4HANA Connector in erp_connections
    const sapAdapterId = 'sap-s4hana';
    try {
      seedBatch.push(c.env.DB.prepare(
        `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
         VALUES (?, 'SAP S/4HANA', 'sap', '2023', 'OData', 'available', ?, ?)`
      ).bind(
        sapAdapterId,
        JSON.stringify(['sync', 'read', 'write', 'reconcile']),
        JSON.stringify(['oauth2', 'basic', 'api_key']),
      ));
    } catch { /* adapter may already exist */ }

    const connectionId = crypto.randomUUID();
    seedBatch.push(c.env.DB.prepare(
      `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, last_sync, sync_frequency, records_synced, connected_at)
       VALUES (?, ?, ?, 'SAP S/4HANA Production', 'connected', ?, ?, 'hourly', 2847, ?)`
    ).bind(
      connectionId, tenantId, sapAdapterId,
      JSON.stringify({
        host: 'sap-prod.vantax.co.za',
        client: '100',
        system_id: 'PRD',
        instance_number: '00',
        auth_type: 'oauth2',
        odata_version: 'v4',
        modules: ['FI', 'CO', 'MM', 'SD', 'PP', 'QM'],
      }),
      now, now,
    ));

    // STEP 3: Seed SAP Suppliers (Vendor Master)
    // Deliberate data quality issues for validation:
    // - Suppliers 0-7: complete records (bank details, contact, VAT)
    // - Suppliers 8-10: missing bank details
    // - Suppliers 11-12: missing VAT number
    // - Suppliers 13-14: missing contact info
    const supplierIds: string[] = [];
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const s = SA_SUPPLIERS[i];
      const id = crypto.randomUUID();
      supplierIds.push(id);
      const hasBankDetails = i < 8;
      const hasVat = i < 11 || i > 12;
      const hasContact = i < 13;
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_suppliers (id, tenant_id, external_id, source_system, name, supplier_group, vat_number, payment_terms, currency, city, province, country, contact_name, contact_email, bank_name, bank_account, status, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, 'ZAR', ?, ?, 'ZA', ?, ?, ?, ?, 'active', ?)`
      ).bind(
        id, tenantId, `SAP-V${(10000 + i).toString()}`,
        s.name, s.group,
        hasVat ? s.vat : null,
        s.terms,
        s.city, s.province,
        hasContact ? 'Accounts Dept' : null,
        hasContact ? `accounts@${s.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za` : null,
        hasBankDetails ? 'First National Bank' : null,
        hasBankDetails ? `62-${(10000 + i * 37).toString()}-${(4521 + i * 13).toString()}` : null,
        now,
      ));
    }

    // STEP 4: Seed SAP Customers (Customer Master)
    // Deliberate data quality issues for validation:
    // - Customers 0-11: normal (credit balance within limits)
    // - Customers 12-14: credit balance EXCEEDS credit limit (over-exposed)
    // - Customers 15-17: no credit limit set (0)
    // - Customers 18-19: missing registration number
    const customerIds: string[] = [];
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const cu = SA_CUSTOMERS[i];
      const id = crypto.randomUUID();
      customerIds.push(id);
      let creditLimit = (500000 + Math.floor(i * 150000 + 50000));
      let outstanding = Math.floor(creditLimit * (0.15 + (i % 5) * 0.1));
      const hasRegNum = i < 18;
      const hasContact = i < 17;

      if (i >= 12 && i <= 14) {
        // Over-exposed: credit balance exceeds limit
        outstanding = Math.floor(creditLimit * (1.15 + (i - 12) * 0.12));
      } else if (i >= 15 && i <= 17) {
        // No credit limit set
        creditLimit = 0;
        outstanding = Math.floor(250000 * (0.3 + i * 0.05));
      }

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_customers (id, tenant_id, external_id, source_system, name, registration_number, customer_group, credit_limit, credit_balance, payment_terms, currency, city, province, country, contact_name, contact_email, status, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, 'Net 30', 'ZAR', ?, ?, 'ZA', ?, ?, 'active', ?)`
      ).bind(
        id, tenantId, `SAP-C${(20000 + i).toString()}`,
        cu.name,
        hasRegNum ? cu.reg : null,
        cu.group, creditLimit, outstanding,
        cu.city, cu.province,
        hasContact ? 'Procurement' : null,
        hasContact ? `procurement@${cu.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za` : null,
        now,
      ));
    }

    // STEP 5: Seed SAP Products (Material Master) — system inventory
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, external_id, source_system, sku, name, category, product_group, uom, cost_price, selling_price, vat_rate, stock_on_hand, reorder_level, reorder_quantity, warehouse, is_active, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?, 'JHB-MAIN', 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-M${(30000 + i).toString()}`,
        p.sku, p.name, p.cat, p.cat, p.uom, p.cost, p.sell, p.stock, p.reorder, Math.floor(p.reorder * 1.5),
        now,
      ));
    }

    // STEP 5b: Seed Physical Count records (PHYSICAL_COUNT source_system)
    // These simulate warehouse physical count with deliberate stock variances:
    // - Products 0-9: exact match (good warehouse discipline)
    // - Products 10-13: -8% to -22% shortage (shrinkage / theft / damage)
    // - Products 14-17: +5% to +15% surplus (receiving errors / miscounts)
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      let physicalStock: number;
      if (i < 10) {
        // Exact match with SAP system
        physicalStock = p.stock;
      } else if (i < 14) {
        // Shortage: shrinkage detected
        const shrinkagePct = 0.08 + (i - 10) * 0.047;  // 8%, 12.7%, 17.4%, 22.1%
        physicalStock = Math.floor(p.stock * (1 - shrinkagePct));
      } else {
        // Surplus: receiving errors
        const surplusPct = 0.05 + (i - 14) * 0.033;  // 5%, 8.3%, 11.6%, 14.9%
        physicalStock = Math.floor(p.stock * (1 + surplusPct));
      }
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, external_id, source_system, sku, name, category, product_group, uom, cost_price, selling_price, vat_rate, stock_on_hand, reorder_level, reorder_quantity, warehouse, is_active, synced_at)
         VALUES (?, ?, ?, 'PHYSICAL_COUNT', ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?, 'JHB-MAIN', 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `PHY-M${(30000 + i).toString()}`,
        p.sku, p.name, p.cat, p.cat, p.uom, p.cost, p.sell, physicalStock, p.reorder, Math.floor(p.reorder * 1.5),
        now,
      ));
    }

    // STEP 6: Seed SAP Invoices (80 invoices: mix of paid, posted, pending, overdue)
    const invoiceRefs: string[] = [];
    const invoiceAmounts: number[] = [];
    for (let i = 1; i <= 80; i++) {
      const invNum = `SAP-INV-${(100000 + i).toString()}`;
      invoiceRefs.push(invNum);
      const suppIdx = i % SA_SUPPLIERS.length;
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const invDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const dueDate = new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0];

      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;
      invoiceAmounts.push(total);

      const statusMap = ['posted', 'posted', 'posted', 'paid', 'paid', 'paid', 'pending', 'overdue', 'posted'];
      const status = statusMap[i % statusMap.length];
      const amountPaid = status === 'paid' ? total : status === 'pending' ? 0 : (status === 'overdue' ? Math.round(total * 0.3 * 100) / 100 : 0);

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, external_id, source_system, invoice_number, customer_id, customer_name, invoice_date, due_date, subtotal, vat_amount, total, amount_paid, amount_due, status, payment_status, reference, notes, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-FI-${(100000 + i).toString()}`,
        invNum, supplierIds[suppIdx], SA_SUPPLIERS[suppIdx].name,
        invDate, dueDate, subtotal, vat, total,
        amountPaid, Math.round((total - amountPaid) * 100) / 100,
        status, status === 'paid' ? 'paid' : 'unpaid',
        `PO-${(50000 + i).toString()}`,
        `SAP Document ${(100000 + i).toString()} - ${SA_SUPPLIERS[suppIdx].name}`,
        now,
      ));
    }

    // STEP 6b: Seed AR Posting records (SAP-AR source_system)
    // These simulate the FI-AR module postings with deliberate differences vs SD invoices:
    // - Invoices 1-55: exact match (clean posting)
    // - Invoices 56-65: amount variance 2-8% (rounding, forex, partial payments posted differently)
    // - Invoices 66-72: different status (posted vs paid mismatch)
    // - Invoices 73-80: no AR posting (missing from AR module — unmatched)
    for (let i = 1; i <= 72; i++) {
      const invNum = `SAP-INV-${(100000 + i).toString()}`;
      const suppIdx = i % SA_SUPPLIERS.length;
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const invDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const dueDate = new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0];

      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      let arTotal = Math.round((subtotal + vat) * 100) / 100;

      const statusMap = ['posted', 'posted', 'posted', 'paid', 'paid', 'paid', 'pending', 'overdue', 'posted'];
      let arStatus = statusMap[i % statusMap.length];

      if (i >= 56 && i <= 65) {
        // Amount variance: 2-8% difference in AR posting
        const variancePct = 0.02 + ((i - 56) * 0.007);
        const direction = i % 2 === 0 ? 1 : -1;
        arTotal = Math.round(arTotal * (1 + variancePct * direction) * 100) / 100;
      } else if (i >= 66 && i <= 72) {
        // Status mismatch: AR shows different status
        arStatus = arStatus === 'paid' ? 'posted' : 'paid';
      }

      const amountPaid = arStatus === 'paid' ? arTotal : arStatus === 'pending' ? 0 : (arStatus === 'overdue' ? Math.round(arTotal * 0.3 * 100) / 100 : 0);

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, external_id, source_system, invoice_number, customer_id, customer_name, invoice_date, due_date, subtotal, vat_amount, total, amount_paid, amount_due, status, payment_status, reference, notes, synced_at)
         VALUES (?, ?, ?, 'SAP-AR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-AR-${(100000 + i).toString()}`,
        invNum, supplierIds[suppIdx], SA_SUPPLIERS[suppIdx].name,
        invDate, dueDate,
        Math.round(arTotal / 1.15 * 100) / 100,
        Math.round((arTotal - arTotal / 1.15) * 100) / 100,
        arTotal,
        amountPaid, Math.round((arTotal - amountPaid) * 100) / 100,
        arStatus, arStatus === 'paid' ? 'paid' : 'unpaid',
        `PO-${(50000 + i).toString()}`,
        `SAP-AR Posting ${(100000 + i).toString()} - ${SA_SUPPLIERS[suppIdx].name}`,
        now,
      ));
    }

    // STEP 7: Seed SAP Purchase Orders (80 POs)
    // POs 1-65: exact amount match with invoices (clean reconciliation)
    // POs 66-72: price variance 3-7% (discrepancy detection)
    // POs 73-80: no matching invoice (unmatched PO detection)
    for (let i = 1; i <= 80; i++) {
      const poNum = `PO-${(50000 + i).toString()}`;
      const suppIdx = i % SA_SUPPLIERS.length;
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const orderDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const deliveryDate = new Date(Date.now() - (daysAgo - 14) * 86400000).toISOString().split('T')[0];

      let total: number;
      if (i <= 65) {
        // Exact match with invoice amount
        total = invoiceAmounts[i - 1];
      } else if (i <= 72) {
        // Price variance 3-7%
        const variancePct = 0.03 + ((i * 13) % 5) * 0.01;
        const direction = i % 2 === 0 ? 1 : -1;
        total = Math.round(invoiceAmounts[i - 1] * (1 + variancePct * direction) * 100) / 100;
      } else {
        // Unmatched POs (no corresponding invoice)
        total = Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      }

      const subtotal = Math.round(total / 1.15 * 100) / 100;
      const vatAmt = Math.round((total - subtotal) * 100) / 100;
      const deliveryStatuses = ['received', 'received', 'received', 'received', 'partial', 'pending'];
      const poStatuses = ['approved', 'approved', 'approved', 'approved', 'approved', 'pending'];

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_purchase_orders (id, tenant_id, external_id, source_system, po_number, supplier_id, supplier_name, order_date, delivery_date, subtotal, vat_amount, total, status, delivery_status, reference, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-MM-${(50000 + i).toString()}`,
        poNum, supplierIds[suppIdx], SA_SUPPLIERS[suppIdx].name,
        orderDate, deliveryDate, subtotal, vatAmt, total,
        poStatuses[i % poStatuses.length],
        deliveryStatuses[i % deliveryStatuses.length],
        i <= 72 ? (invoiceRefs[i - 1] || null) : null,
        now,
      ));
    }

    // STEP 8: Seed Bank Transactions (80 transactions)
    // 1-55: match paid invoices (reconciled)
    // 56-65: bank charges/fees (unreconciled)
    // 66-80: unreconciled EFT payments
    for (let i = 1; i <= 80; i++) {
      const daysAgo = 1 + Math.floor((i * 29) % 60);
      const txDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];

      let debit = 0;
      let credit = 0;
      let ref = '';
      let desc = '';
      let reconciled = 0;

      if (i <= 55) {
        credit = invoiceAmounts[i - 1];
        ref = invoiceRefs[i - 1];
        desc = `Payment: ${ref} - ${SA_SUPPLIERS[i % SA_SUPPLIERS.length].name}`;
        reconciled = 1;
      } else if (i <= 65) {
        const feeTypes = ['Monthly service fee', 'SWIFT charge', 'Card processing fee', 'Cash handling fee', 'Statement fee', 'EFT batch fee', 'Cheque processing', 'Interest charge', 'Insurance debit', 'Merchant fee'];
        debit = Math.round((150 + (i * 317.23) % 3500) * 100) / 100;
        ref = `BNK-FEE-${(90000 + i).toString()}`;
        desc = feeTypes[(i - 56) % feeTypes.length];
        reconciled = 0;
      } else {
        credit = Math.round((5000 + (i * 2187.49) % 40000) * 100) / 100;
        ref = `EFT-${(80000 + i).toString()}`;
        desc = `EFT Payment - ${SA_SUPPLIERS[(i + 3) % SA_SUPPLIERS.length].name}`;
        reconciled = 0;
      }

      const runningBalance = Math.round((2500000 - i * 8750 + (i % 7) * 15000) * 100) / 100;

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_bank_transactions (id, tenant_id, external_id, source_system, bank_account, transaction_date, description, reference, debit, credit, balance, reconciled, synced_at)
         VALUES (?, ?, ?, 'SAP', 'FNB-62-000-4521-01', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-BK-${(80000 + i).toString()}`,
        txDate, desc, ref, debit, credit, runningBalance, reconciled, now,
      ));
    }

    // STEP 9: Seed GL Accounts and Journal Entries (SAP FI)
    for (const gl of GL_ACCOUNTS) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_gl_accounts (id, tenant_id, external_id, source_system, account_code, account_name, account_type, account_class, currency, balance, is_active, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, 'ZAR', ?, 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-GL-${gl.code}`,
        gl.code, gl.name, gl.type, gl.cls, gl.balance, now,
      ));
    }

    const jeDescriptions = [
      'Supplier payment - Sasol Chemical Industries',
      'Customer receipt - Pick n Pay Stores',
      'Payroll processing - March 2026',
      'Inventory adjustment - warehouse count',
      'Depreciation - Property Plant and Equipment',
      'VAT return - period 03/2026',
      'Bank charges - FNB Corporate',
      'Accrual reversal - Q1 2026',
      'Intercompany transfer - Durban branch',
      'Provision for doubtful debts',
    ];
    for (let i = 1; i <= 40; i++) {
      const daysAgo = Math.floor((i * 23) % 30);
      const jDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const amount = Math.round((2000 + (i * 1847.63) % 80000) * 100) / 100;
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO erp_journal_entries (id, tenant_id, external_id, source_system, journal_number, journal_date, description, total_debit, total_credit, status, posted_by, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, 'posted', 'SAP-AUTO', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-JE-${(60000 + i).toString()}`,
        `JE-${(60000 + i).toString()}`, jDate,
        jeDescriptions[i % jeDescriptions.length],
        amount, amount, now,
      ));
    }

    // ── SAP NATIVE TABLE SEEDING ──
    // Populate actual SAP table structures so the LLM sees real SAP field names
    // and sub-catalysts process authentic SAP data.

    // SAP-SEED-1: LFA1 — Vendor Master General Data
    // Quality gaps: vendors 11-12 missing STCD1 (tax number), vendors 13-14 missing TELF1
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const s = SA_SUPPLIERS[i];
      const lifnr = (10000 + i).toString().padStart(10, '0');
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_lfa1 (id, tenant_id, LIFNR, LAND1, NAME1, NAME2, ORT01, PSTLZ, REGIO, STCD1, STCD2, TELF1, KTOKK, LOEVM, SPERR, SPERM)
         VALUES (?, ?, ?, 'ZA', ?, ?, ?, ?, ?, ?, ?, ?, 'KRED', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        s.name, s.group,
        s.city, s.city === 'Johannesburg' ? '2001' : s.city === 'Cape Town' ? '8001' : '0001',
        s.province,
        (i < 11 || i > 12) ? s.vat : null,  // missing tax number for 11-12
        (i < 11 || i > 12) ? `IT${s.vat}` : null,
        i < 13 ? `+27${(11 + i).toString()}${(1000000 + i * 12345).toString().slice(0, 7)}` : null,  // missing phone for 13-14
        null, null,  // LOEVM, SPERR
        i === 14 ? 'X' : null,  // payment block on last vendor
      ));
    }

    // SAP-SEED-2: LFB1 — Vendor Master Company Code Data
    // Quality gaps: vendors 8-10 missing AKONT (recon account), vendor 14 missing ZTERM
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const lifnr = (10000 + i).toString().padStart(10, '0');
      const zterms = ['ZB30', 'ZB45', 'ZB30', 'ZB60', 'ZB30', 'ZB45', 'ZB30', 'ZB60'];
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_lfb1 (id, tenant_id, LIFNR, BUKRS, AKONT, ZTERM, ZWELS, REPRF, HBKID)
         VALUES (?, ?, ?, '1000', ?, ?, 'CT', ?, 'FNB1')`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        (i >= 8 && i <= 10) ? null : '2000',  // missing recon account
        i === 14 ? null : zterms[i % zterms.length],  // missing payment terms
        i < 8 ? 'X' : null,  // double-invoice check
      ));
    }

    // SAP-SEED-3: KNA1 — Customer Master General Data
    // Quality gaps: customers 18-19 missing STCD1, customer 15-17 missing ORT01
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const cu = SA_CUSTOMERS[i];
      const kunnr = (20000 + i).toString().padStart(10, '0');
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_kna1 (id, tenant_id, KUNNR, LAND1, NAME1, NAME2, ORT01, PSTLZ, REGIO, STCD1, TELF1, KTOKD, LOEVM, SPERR)
         VALUES (?, ?, ?, 'ZA', ?, ?, ?, ?, ?, ?, ?, 'DEBI', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        cu.name, cu.group,
        (i >= 15 && i <= 17) ? null : cu.city,  // missing city
        cu.city === 'Cape Town' ? '8001' : cu.city === 'Sandton' ? '2196' : '0001',
        cu.province,
        i < 18 ? cu.reg : null,  // missing tax/reg number
        i < 17 ? `+27${(21 + i).toString()}${(2000000 + i * 54321).toString().slice(0, 7)}` : null,
        null, null,
      ));
    }

    // SAP-SEED-4: KNB1 — Customer Master Company Code Data
    // Quality gaps: customers 12-14 KLIMK exceeded, customers 15-17 KLIMK = 0
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const kunnr = (20000 + i).toString().padStart(10, '0');
      let klimk = 500000 + i * 150000 + 50000;
      if (i >= 15 && i <= 17) klimk = 0;

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_knb1 (id, tenant_id, KUNNR, BUKRS, AKONT, ZTERM, KLIMK, CTLPC)
         VALUES (?, ?, ?, '1000', '1100', 'ZB30', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        klimk,
        klimk > 0 ? 'A' : null,  // no credit control for zero-limit customers
      ));
    }

    // SAP-SEED-5: BKPF — Accounting Document Headers (80 vendor invoices)
    // Quality gaps: docs 73-80 missing XBLNR (external reference)
    const bkpfBelnrs: string[] = [];
    for (let i = 1; i <= 80; i++) {
      const belnr = (5100000000 + i).toString();
      bkpfBelnrs.push(belnr);
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const budat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const bldat = new Date(Date.now() - (daysAgo + 2) * 86400000).toISOString().split('T')[0];
      const monat = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(5, 7);

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_bkpf (id, tenant_id, BUKRS, BELNR, GJAHR, BLART, BUDAT, BLDAT, MONAT, CPUDT, XBLNR, BSTAT, WAERS, USNAM, TCODE, AWTYP, AWKEY)
         VALUES (?, ?, '1000', ?, '2026', ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'SAPUSER', 'FB60', 'BKPF', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        i <= 40 ? 'KR' : 'KG',  // KR=vendor invoice, KG=vendor credit
        budat, bldat, monat, budat,
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,  // missing XBLNR for 73-80
        i <= 65 ? '' : 'V',  // V = parked (not posted)
        belnr,
      ));
    }

    // SAP-SEED-6: BSEG — Accounting Document Line Items (2 lines per doc: vendor + expense)
    // Quality gaps: items 56-65 have DMBTR that differs from WRBTR (forex variance)
    for (let i = 1; i <= 80; i++) {
      const belnr = bkpfBelnrs[i - 1];
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;
      let dmbtr = total;
      if (i >= 56 && i <= 65) {
        // Forex variance: DMBTR differs from WRBTR by 2-8%
        const variancePct = 0.02 + ((i - 56) * 0.007);
        dmbtr = Math.round(total * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
      }

      // Line 1: Vendor posting (BSCHL 31 = vendor credit)
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_bseg (id, tenant_id, BUKRS, BELNR, GJAHR, BUZEI, BSCHL, KOART, KONTO, DMBTR, WRBTR, MWSKZ, MWSTS, SGTXT, LIFNR, EBELN, SHKZG, ZFBDT, ZBD1T)
         VALUES (?, ?, '1000', ?, '2026', '001', '31', 'K', ?, ?, ?, 'I2', ?, ?, ?, ?, 'H', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        lifnr, dmbtr, total, vat,
        `Invoice ${SA_SUPPLIERS[suppIdx].name}`,
        lifnr,
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,
        new Date(Date.now() - (3 + Math.floor((i * 37) % 90) - 30) * 86400000).toISOString().split('T')[0],
        30,
      ));

      // Line 2: Expense posting (BSCHL 40 = debit)
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_bseg (id, tenant_id, BUKRS, BELNR, GJAHR, BUZEI, BSCHL, KOART, KONTO, DMBTR, WRBTR, MWSKZ, MWSTS, SGTXT, SHKZG)
         VALUES (?, ?, '1000', ?, '2026', '002', '40', 'S', '5000', ?, ?, 'I2', 0, ?, 'S')`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        Math.round((dmbtr - vat) * 100) / 100, Math.round((total - vat) * 100) / 100,
        `Cost of Sales - ${SA_SUPPLIERS[suppIdx].name}`,
      ));
    }

    // SAP-SEED-7: BSIK — Vendor Open Items
    // Quality gaps: items 66-72 have wrong SHKZG (debit/credit indicator), 73-80 missing EBELN
    for (let i = 1; i <= 80; i++) {
      const belnr = bkpfBelnrs[i - 1];
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const budat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const statusMap = ['', '', '', 'C', 'C', 'C', '', '', ''];  // C = cleared
      const augbl = statusMap[i % statusMap.length] === 'C' ? belnr : null;
      const augdt = augbl ? new Date(Date.now() - (daysAgo - 15) * 86400000).toISOString().split('T')[0] : null;

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_bsik (id, tenant_id, BUKRS, LIFNR, AUGDT, AUGBL, GJAHR, BELNR, BUZEI, BUDAT, BLDAT, WAERS, SHKZG, DMBTR, WRBTR, SGTXT, ZFBDT, ZBD1T, EBELN)
         VALUES (?, ?, '1000', ?, ?, ?, '2026', ?, '001', ?, ?, 'ZAR', ?, ?, ?, ?, ?, 30, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        augdt, augbl, belnr,
        budat, budat,
        (i >= 66 && i <= 72) ? 'S' : 'H',  // wrong indicator for 66-72
        total, total,
        `Vendor invoice - ${SA_SUPPLIERS[suppIdx].name}`,
        new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0],
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,  // missing EBELN for 73-80
      ));
    }

    // SAP-SEED-8: EKKO — Purchase Order Headers (80 POs)
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const bedat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_ekko (id, tenant_id, EBELN, BUKRS, BSTYP, BSART, LOEKZ, STATU, AEDAT, ERNAM, LIFNR, EKGRP, WAERS, BEDAT, RLWRT, ZTERM)
         VALUES (?, ?, ?, '1000', 'F', 'NB', ?, ?, ?, 'SAPBUYER', ?, ?, 'ZAR', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        i > 75 ? 'L' : null,  // L = deletion flag on last 5
        i <= 65 ? 'B' : 'A',  // B = PO completed, A = active
        bedat, lifnr,
        `E${(100 + suppIdx % 10).toString()}`,
        bedat,
        invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100,
        ['ZB30', 'ZB45', 'ZB60'][i % 3],
      ));
    }

    // SAP-SEED-9: EKPO — Purchase Order Items (1-2 items per PO)
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.cost));
      const netpr = Math.round(total / qty * 100) / 100;

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_ekpo (id, tenant_id, EBELN, EBELP, MATNR, TXZ01, MENGE, MEINS, NETPR, PEINH, NETWR, MATKL, WERKS, LGORT, MWSKZ)
         VALUES (?, ?, ?, '00010', ?, ?, ?, ?, ?, 1, ?, ?, 'JHB1', '0001', 'I2')`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        p.sku, p.name, qty, p.uom, netpr, Math.round(netpr * qty * 100) / 100,
        p.cat,
      ));
    }

    // SAP-SEED-10: EKBE — PO History (Goods Receipt + Invoice Receipt)
    // Quality gaps: POs 66-72 have GR qty mismatch, POs 73-80 no IR entry
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.cost));
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const budat = new Date(Date.now() - (daysAgo - 7) * 86400000).toISOString().split('T')[0];

      // Goods Receipt (VGABE = '1')
      let grQty = qty;
      if (i >= 66 && i <= 72) {
        // GR qty mismatch: received 5-15% less than ordered
        grQty = Math.max(1, Math.floor(qty * (0.85 + (i - 66) * 0.015)));
      }

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_ekbe (id, tenant_id, EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BUZEI, BEWTP, MENGE, WRBTR, WAERS, BUDAT)
         VALUES (?, ?, ?, '00010', '0001', '1', '2026', ?, '001', 'E', ?, ?, 'ZAR', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        (5000000000 + i).toString(),
        grQty, Math.round(grQty * (total / qty) * 100) / 100, budat,
      ));

      // Invoice Receipt (VGABE = '2') — only for POs 1-72
      if (i <= 72) {
        let irAmt = total;
        if (i >= 66 && i <= 72) {
          // IR amount differs from PO by 3-7%
          const variancePct = 0.03 + ((i * 13) % 5) * 0.01;
          irAmt = Math.round(total * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
        }
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO sap_ekbe (id, tenant_id, EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BUZEI, BEWTP, MENGE, WRBTR, WAERS, BUDAT)
           VALUES (?, ?, ?, '00010', '0002', '2', '2026', ?, '001', 'Q', ?, ?, 'ZAR', ?)`
        ).bind(
          crypto.randomUUID(), tenantId, ebeln,
          bkpfBelnrs[i - 1],
          qty, irAmt, budat,
        ));
      }
    }

    // SAP-SEED-11: MARD — Material Warehouse Stock
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_mard (id, tenant_id, MATNR, WERKS, LGORT, LABST, INSME, SPEME, EINME, RETME, LFGJA, LFMON)
         VALUES (?, ?, ?, 'JHB1', '0001', ?, ?, ?, 0, 0, '2026', '03')`
      ).bind(
        crypto.randomUUID(), tenantId,
        p.sku, p.stock,
        i >= 10 && i < 14 ? Math.floor(p.stock * 0.05) : 0,  // quality inspection stock
        i >= 14 ? Math.floor(p.stock * 0.03) : 0,  // blocked stock
      ));
    }

    // SAP-SEED-12: ISEG — Physical Inventory Count (deliberate variances)
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      let physQty: number;
      if (i < 10) {
        physQty = p.stock;  // exact match
      } else if (i < 14) {
        const shrinkagePct = 0.08 + (i - 10) * 0.047;
        physQty = Math.floor(p.stock * (1 - shrinkagePct));  // shortage
      } else {
        const surplusPct = 0.05 + (i - 14) * 0.033;
        physQty = Math.floor(p.stock * (1 + surplusPct));  // surplus
      }

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_iseg (id, tenant_id, IBLNR, GJAHR, ZEESSION, MATNR, WERKS, LGORT, MENGE, MEINS, BUCHM, XNULL, XDIFF)
         VALUES (?, ?, ?, '2026', ?, ?, 'JHB1', '0001', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId,
        (4000000 + i).toString(),
        (i + 1).toString().padStart(4, '0'),
        p.sku, physQty, p.uom,
        physQty === p.stock ? physQty : 0,  // BUCHM = posted qty (0 if diff)
        physQty === 0 ? 'X' : null,  // XNULL = zero count flag
        physQty !== p.stock ? 'X' : null,  // XDIFF = difference flag
      ));
    }

    // SAP-SEED-13: VBAK — Sales Order Headers (80 sales orders)
    const vbakVbelns: string[] = [];
    for (let i = 1; i <= 80; i++) {
      const vbeln = (800000 + i).toString().padStart(10, '0');
      vbakVbelns.push(vbeln);
      const custIdx = i % SA_CUSTOMERS.length;
      const kunnr = (20000 + custIdx).toString().padStart(10, '0');
      const daysAgo = 5 + Math.floor((i * 31) % 90);
      const audat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_vbak (id, tenant_id, VBELN, AUART, VKORG, VTWEG, SPART, KUNNR, BSTNK, AUDAT, VDATU, NETWR, WAERK, VBTYP, ERNAM)
         VALUES (?, ?, ?, 'TA', '1000', '10', '00', ?, ?, ?, ?, ?, 'ZAR', 'C', 'SAPSALES')`
      ).bind(
        crypto.randomUUID(), tenantId, vbeln,
        kunnr,
        `CUST-PO-${(60000 + i).toString()}`,
        audat,
        new Date(Date.now() - (daysAgo - 14) * 86400000).toISOString().split('T')[0],
        total,
      ));
    }

    // SAP-SEED-14: VBAP — Sales Order Items
    for (let i = 1; i <= 80; i++) {
      const vbeln = vbakVbelns[i - 1];
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.sell));

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_vbap (id, tenant_id, VBELN, POSNR, MATNR, ARKTX, KWMENG, VRKME, NETPR, NETWR, WAERK, WERKS, MATKL)
         VALUES (?, ?, ?, '000010', ?, ?, ?, ?, ?, ?, 'ZAR', 'JHB1', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, vbeln,
        p.sku, p.name, qty, p.uom,
        Math.round(total / qty * 100) / 100, total,
        p.cat,
      ));
    }

    // SAP-SEED-15: VBRK — Billing Documents (only 72 of 80 orders billed)
    // Quality gaps: billing 56-65 have amount variance, 66-72 wrong RFBSK status, 73-80 not billed
    const vbrkVbelns: string[] = [];
    for (let i = 1; i <= 72; i++) {
      const billingVbeln = (9000000 + i).toString().padStart(10, '0');
      vbrkVbelns.push(billingVbeln);
      const custIdx = i % SA_CUSTOMERS.length;
      const kunnr = (20000 + custIdx).toString().padStart(10, '0');
      const daysAgo = 3 + Math.floor((i * 29) % 60);
      const fkdat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      let netwr = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;

      if (i >= 56 && i <= 65) {
        // Amount variance 2-8%
        const variancePct = 0.02 + ((i - 56) * 0.007);
        netwr = Math.round(netwr * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
      }

      const rfbsk = (i >= 66 && i <= 72) ? 'A' : 'C';  // A = not transferred, C = cleared

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_vbrk (id, tenant_id, VBELN, FKART, VKORG, KUNAG, KUNRG, FKDAT, RFBSK, NETWR, MWSBK, WAERK, BUKRS, XBLNR, ERNAM)
         VALUES (?, ?, ?, 'F2', '1000', ?, ?, ?, ?, ?, ?, 'ZAR', '1000', ?, 'SAPSALES')`
      ).bind(
        crypto.randomUUID(), tenantId, billingVbeln,
        kunnr, kunnr, fkdat, rfbsk,
        netwr, Math.round(netwr * 0.15 * 100) / 100,
        `INV-${(100000 + i).toString()}`,
      ));
    }

    // SAP-SEED-16: VBRP — Billing Document Items
    for (let i = 1; i <= 72; i++) {
      const billingVbeln = vbrkVbelns[i - 1];
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      let netwr = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      if (i >= 56 && i <= 65) {
        const variancePct = 0.02 + ((i - 56) * 0.007);
        netwr = Math.round(netwr * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
      }
      const qty = Math.max(1, Math.floor(netwr / p.sell));

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_vbrp (id, tenant_id, VBELN, POSNR, FKIMG, VRKME, NETWR, MWSBP, MATNR, ARKTX, AUBEL, AUPOS, WERKS)
         VALUES (?, ?, ?, '000010', ?, ?, ?, ?, ?, ?, ?, '000010', 'JHB1')`
      ).bind(
        crypto.randomUUID(), tenantId, billingVbeln,
        qty, p.uom, netwr, Math.round(netwr * 0.15 * 100) / 100,
        p.sku, p.name,
        vbakVbelns[i - 1],
      ));
    }

    // SAP-SEED-17: BSID — Customer Open Items
    // Quality gaps: items 12-14 over credit limit, items 66-72 overdue
    for (let i = 1; i <= 72; i++) {
      const custIdx = i % SA_CUSTOMERS.length;
      const kunnr = (20000 + custIdx).toString().padStart(10, '0');
      const belnr = (6100000000 + i).toString();
      const daysAgo = 3 + Math.floor((i * 29) % 60);
      const budat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      const statusMap = ['', '', '', 'C', 'C', 'C', '', '', ''];
      const augbl = statusMap[i % statusMap.length] === 'C' ? belnr : null;

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_bsid (id, tenant_id, BUKRS, KUNNR, AUGDT, AUGBL, GJAHR, BELNR, BUZEI, BUDAT, BLDAT, WAERS, SHKZG, DMBTR, WRBTR, SGTXT, ZFBDT, ZBD1T, XBLNR)
         VALUES (?, ?, '1000', ?, ?, ?, '2026', ?, '001', ?, ?, 'ZAR', 'S', ?, ?, ?, ?, 30, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        augbl ? new Date(Date.now() - (daysAgo - 15) * 86400000).toISOString().split('T')[0] : null,
        augbl, belnr,
        budat, budat,
        total, total,
        `Customer invoice - ${SA_CUSTOMERS[custIdx].name}`,
        new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0],
        `INV-${(100000 + i).toString()}`,
      ));
    }

    // SAP-SEED-18: FEBEP — Bank Statement Line Items
    // Quality gaps: items 56-65 bank charges (no matching FI doc), items 66-80 unmatched
    for (let i = 1; i <= 80; i++) {
      const daysAgo = 1 + Math.floor((i * 29) % 60);
      const valut = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      let kwbtr = 0;
      let vwezw = '';
      let xblnr = '';
      let sgtxt = '';

      if (i <= 55) {
        kwbtr = -(invoiceAmounts[i - 1] || 0);  // negative = outgoing payment
        vwezw = '0010';  // bank transfer
        // Use PO reference format so FEBEP.XBLNR matches BSIK.EBELN for bank reconciliation
        xblnr = `PO-${(50000 + i).toString()}`;
        sgtxt = `Payment: ${xblnr} - ${SA_SUPPLIERS[i % SA_SUPPLIERS.length].name}`;
      } else if (i <= 65) {
        kwbtr = Math.round((150 + (i * 317.23) % 3500) * 100) / 100;  // positive = bank charge
        vwezw = '0020';  // bank charge
        xblnr = `BNK-FEE-${(90000 + i).toString()}`;
        sgtxt = ['Monthly service fee', 'SWIFT charge', 'Card processing fee', 'Cash handling', 'Statement fee'][(i - 56) % 5];
      } else {
        kwbtr = -(Math.round((5000 + (i * 2187.49) % 40000) * 100) / 100);
        vwezw = '0010';
        xblnr = `EFT-${(80000 + i).toString()}`;
        sgtxt = `EFT Payment - ${SA_SUPPLIERS[(i + 3) % SA_SUPPLIERS.length].name}`;
      }

      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO sap_febep (id, tenant_id, BUKRS, HESSION, AESSION, VALUT, KWBTR, WRBTR, WAERS, VWEZW, XBLNR, SGTXT)
         VALUES (?, ?, '1000', ?, ?, ?, ?, ?, 'ZAR', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId,
        (7000000 + i).toString(),  // HESSION = bank statement number
        (i).toString().padStart(5, '0'),  // AESSION = line item
        valut, kwbtr, Math.abs(kwbtr),
        vwezw, xblnr, sgtxt,
      ));
    }

    console.log('[VantaX Seeder] SAP native tables seeded');

    // STEP 9b: Seed ERP companies so the frontend company switcher has at
    // least the primary entity to display. Without this row, /api/erp/companies
    // returns an empty list and the switcher renders blank on first login.
    seedBatch.push(c.env.DB.prepare(
      `INSERT OR REPLACE INTO erp_companies (id, tenant_id, external_id, source_system, code, name, legal_name, currency, country, fiscal_year_start, tax_id, is_primary, status, synced_at)
       VALUES (?, ?, ?, 'sap', ?, ?, ?, 'ZAR', 'ZA', '03-01', ?, 1, 'active', datetime('now'))`
    ).bind(
      `erp-co-${tenantId}-primary`, tenantId, 'VTX-1000',
      '1000', 'VantaX (Pty) Ltd', 'VantaX Manufacturing (Pty) Ltd', '4123456789'
    ));
    console.log('[VantaX Seeder] Seeded primary ERP company');

    // STEP 10: Create Catalyst Clusters with CONFIGURED sub-catalysts
    // Each sub-catalyst has data_sources and field_mappings for real execution

    // -- FINANCE CLUSTER --
    const financeClusterId = crypto.randomUUID();
    const financeSubCatalysts = [
      {
        name: 'GR/IR Reconciliation',
        enabled: true,
        description: 'Goods Receipt vs Invoice Receipt matching - SAP EKKO/EKPO vs EKBE (VGABE 1 vs 2)',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekbe_gr', label: 'SAP EKBE — Goods Receipts (VGABE=1)' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekbe_ir', label: 'SAP EKBE — Invoice Receipts (VGABE=2)' } },
        ],
        field_mappings: [
          { source_field: 'EBELN', target_field: 'EBELN', source_index: 0, target_index: 1, match_type: 'exact', label: 'PO Number (EKBE GR to EKBE IR)' },
          { source_field: 'WRBTR', target_field: 'WRBTR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'GR Amount vs IR Amount' },
        ],
        execution_config: { mode: 'reconciliation', parameters: { exception_discrepancy_threshold: 10, exception_match_rate_threshold: 50 } },
      },
      {
        name: 'AP Invoice Validation',
        enabled: true,
        description: 'Accounts Payable validation — SAP BKPF/BSEG vendor postings (KOART=K) completeness and accuracy',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_bseg_vendor', label: 'SAP BSEG — Vendor Line Items (KOART=K)' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Bank Reconciliation',
        enabled: true,
        description: 'Bank statement (FEBEP) vs SAP FI vendor payments (BSIK) — FNB Corporate',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_febep', label: 'SAP FEBEP — Bank Statement Items' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_bsik', label: 'SAP BSIK — Vendor Open Items' } },
        ],
        field_mappings: [
          { source_field: 'XBLNR', target_field: 'EBELN', source_index: 0, target_index: 1, match_type: 'contains', label: 'Bank Reference to PO Number' },
          { source_field: 'WRBTR', target_field: 'WRBTR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.50, label: 'Bank Amount vs Vendor Amount' },
        ],
        execution_config: { mode: 'reconciliation', parameters: { exception_discrepancy_threshold: 5 } },
      },
    ];

    seedBatch.push(c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Finance', 'finance', 'Financial reconciliation and controls - SAP FI/CO modules. GR/IR 3-way match, AP invoice validation, bank reconciliation against FNB Corporate.', 'active', 'supervised', 3, ?)
    `).bind(financeClusterId, tenantId, JSON.stringify(financeSubCatalysts)));

    // -- SUPPLY CHAIN CLUSTER --
    const supplyChainClusterId = crypto.randomUUID();
    const supplyChainSubCatalysts = [
      {
        name: 'Inventory Reconciliation',
        enabled: true,
        description: 'SAP MARD (system stock) vs ISEG (physical count) — warehouse JHB1/0001',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_mard', label: 'SAP MARD — Material Warehouse Stock' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_iseg', label: 'SAP ISEG — Physical Inventory Count' } },
        ],
        field_mappings: [
          { source_field: 'MATNR', target_field: 'MATNR', source_index: 0, target_index: 1, match_type: 'exact', label: 'Material Number (MARD to ISEG)' },
          { source_field: 'LABST', target_field: 'MENGE', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 1, label: 'System Stock vs Physical Count' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
      {
        name: 'PO-to-GR Matching',
        enabled: true,
        description: 'SAP EKPO (PO items) vs EKBE (GR history VGABE=1) — delivery verification',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekpo', label: 'SAP EKPO — Purchase Order Items' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekbe_gr', label: 'SAP EKBE — Goods Receipts (VGABE=1)' } },
        ],
        field_mappings: [
          { source_field: 'EBELN', target_field: 'EBELN', source_index: 0, target_index: 1, match_type: 'exact', label: 'PO Number (EKPO to EKBE)' },
          { source_field: 'NETWR', target_field: 'WRBTR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'PO Amount vs GR Amount' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
      {
        name: 'Supplier Validation',
        enabled: true,
        description: 'SAP LFA1/LFB1 vendor master data quality — STCD1, ZTERM, AKONT, SPERR checks',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_lfa1', label: 'SAP LFA1 — Vendor Master General' } },
        ],
        execution_config: { mode: 'validation' },
      },
    ];

    seedBatch.push(c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Supply Chain', 'operations', 'Supply chain management and procurement - SAP MM/SD. Inventory verification, PO-to-GR matching, vendor master validation.', 'active', 'supervised', 3, ?)
    `).bind(supplyChainClusterId, tenantId, JSON.stringify(supplyChainSubCatalysts)));

    // -- REVENUE CLUSTER --
    const revenueClusterId = crypto.randomUUID();
    const revenueSubCatalysts = [
      {
        name: 'Revenue Recognition',
        enabled: true,
        description: 'IFRS 15 revenue recognition — SAP VBRK/VBRP billing document validation',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_vbrk', label: 'SAP VBRK — Billing Document Headers' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Customer Receivables',
        enabled: true,
        description: 'SAP KNA1/KNB1 + BSID — customer credit monitoring, aging analysis, collection tracking',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_kna1', label: 'SAP KNA1 — Customer Master General' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Sales Order Matching',
        enabled: true,
        description: 'SAP VBAK/VBAP (sales orders) vs VBRK/VBRP (billing docs) — order-to-bill reconciliation',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_vbak', label: 'SAP VBAK — Sales Order Headers' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_vbrk', label: 'SAP VBRK — Billing Document Headers' } },
        ],
        field_mappings: [
          { source_field: 'VBELN', target_field: 'AUBEL', source_index: 0, target_index: 1, match_type: 'exact', label: 'Sales Order to Billing Reference' },
          { source_field: 'NETWR', target_field: 'NETWR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'Order Amount vs Billing Amount' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
    ];

    seedBatch.push(c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Revenue', 'revenue', 'Revenue cycle management - SAP SD/FI. IFRS 15 compliance, AR aging, sales order-to-invoice matching.', 'active', 'supervised', 3, ?)
    `).bind(revenueClusterId, tenantId, JSON.stringify(revenueSubCatalysts)));

    // STEP 11: Create Sub-Catalyst KPIs (aggregate tracking)
    const allSubCatalysts = [
      ...financeSubCatalysts.map(s => ({ ...s, clusterId: financeClusterId })),
      ...supplyChainSubCatalysts.map(s => ({ ...s, clusterId: supplyChainClusterId })),
      ...revenueSubCatalysts.map(s => ({ ...s, clusterId: revenueClusterId })),
    ];

    for (const sub of allSubCatalysts) {
      seedBatch.push(c.env.DB.prepare(`
        INSERT INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name, total_runs, successful_runs, success_rate, avg_confidence, status, threshold_success_green, threshold_success_amber, threshold_success_red)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'green', 90, 70, 50)
      `).bind(crypto.randomUUID(), tenantId, sub.clusterId, sub.name));
    }

    // STEP 12: Realistic health score with dimensions
    const healthDimensions = {
      financial: { score: 75, trend: 'improving', delta: 4.2 },
      operational: { score: 68, trend: 'stable', delta: 1.1 },
      compliance: { score: 82, trend: 'improving', delta: 6.5 },
      strategic: { score: 61, trend: 'declining', delta: -2.3 },
      supply_chain: { score: 58, trend: 'declining', delta: -4.8 },
      revenue: { score: 71, trend: 'improving', delta: 3.1 },
    };
    const overallHealthScore = Math.round(Object.values(healthDimensions).reduce((s, d) => s + d.score, 0) / Object.keys(healthDimensions).length);
    seedBatch.push(c.env.DB.prepare(`
      INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), tenantId, overallHealthScore, JSON.stringify(healthDimensions), now));

    // STEP 12b: Health score history for trend sparklines (6 months)
    const healthHistory = [
      { offset: -5, score: 48, dims: { financial: 45, operational: 42, compliance: 52, strategic: 55, supply_chain: 50, revenue: 44 } },
      { offset: -4, score: 54, dims: { financial: 52, operational: 48, compliance: 58, strategic: 60, supply_chain: 55, revenue: 51 } },
      { offset: -3, score: 59, dims: { financial: 58, operational: 55, compliance: 65, strategic: 63, supply_chain: 58, revenue: 56 } },
      { offset: -2, score: 63, dims: { financial: 65, operational: 60, compliance: 72, strategic: 64, supply_chain: 62, revenue: 60 } },
      { offset: -1, score: 67, dims: { financial: 70, operational: 65, compliance: 78, strategic: 63, supply_chain: 60, revenue: 66 } },
      { offset: 0, score: overallHealthScore, dims: Object.fromEntries(Object.entries(healthDimensions).map(([k, v]) => [k, v.score])) },
    ];
    for (const hh of healthHistory) {
      const d = new Date(); d.setMonth(d.getMonth() + hh.offset);
      const hhDims = Object.fromEntries(Object.entries(hh.dims).map(([k, v]) => [k, { score: v, trend: v > 60 ? 'improving' : 'stable', delta: Math.round((Math.random() * 6 - 2) * 10) / 10 }]));
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO health_score_history (id, tenant_id, overall_score, dimensions, catalyst_name, recorded_at) VALUES (?, ?, ?, ?, 'System Health Check', ?)`
      ).bind(crypto.randomUUID(), tenantId, hh.score, JSON.stringify(hhDims), d.toISOString()));
    }
    console.log('[VantaX Seeder] Seeded health score + 6 history records');

    // STEP 12c: Process Metrics with trend arrays
    const processMetricsData = [
      { name: 'AP Invoice Match Rate', value: 81.25, unit: '%', status: 'amber', domain: 'finance', category: 'reconciliation', thresholdGreen: 95, thresholdAmber: 80, thresholdRed: 60, trend: [76.5, 78.2, 79.1, 80.3, 81.25], sourceSystem: 'SAP FI' },
      { name: 'Bank Reconciliation Rate', value: 68.75, unit: '%', status: 'red', domain: 'finance', category: 'reconciliation', thresholdGreen: 95, thresholdAmber: 80, thresholdRed: 60, trend: [75.0, 73.2, 71.5, 70.1, 68.75], sourceSystem: 'SAP FI' },
      { name: 'Inventory Accuracy', value: 55.6, unit: '%', status: 'red', domain: 'supply_chain', category: 'inventory', thresholdGreen: 95, thresholdAmber: 80, thresholdRed: 60, trend: [60.0, 58.5, 57.2, 56.4, 55.6], sourceSystem: 'SAP MM' },
      { name: 'Sales Order Fulfillment', value: 89.3, unit: '%', status: 'amber', domain: 'revenue', category: 'order_management', thresholdGreen: 95, thresholdAmber: 85, thresholdRed: 70, trend: [85.0, 86.5, 87.8, 88.6, 89.3], sourceSystem: 'SAP SD' },
      { name: 'GR/IR Match Rate', value: 81.25, unit: '%', status: 'amber', domain: 'finance', category: 'reconciliation', thresholdGreen: 95, thresholdAmber: 80, thresholdRed: 60, trend: [78.5, 79.2, 80.1, 80.8, 81.25], sourceSystem: 'SAP MM' },
      { name: 'Production OEE', value: 72.5, unit: '%', status: 'red', domain: 'operational', category: 'production', thresholdGreen: 85, thresholdAmber: 75, thresholdRed: 60, trend: [74.1, 73.5, 73.0, 72.8, 72.5], sourceSystem: 'SAP PP' },
      { name: 'Revenue Recognition Compliance', value: 73.7, unit: '%', status: 'amber', domain: 'compliance', category: 'ifrs', thresholdGreen: 95, thresholdAmber: 70, thresholdRed: 50, trend: [68.0, 70.2, 71.5, 72.8, 73.7], sourceSystem: 'SAP FI' },
      { name: 'Supplier Lead Time', value: 14.2, unit: 'days', status: 'amber', domain: 'supply_chain', category: 'procurement', thresholdGreen: 10, thresholdAmber: 15, thresholdRed: 21, trend: [12.5, 13.1, 13.6, 13.9, 14.2], sourceSystem: 'SAP MM' },
      { name: 'Cash Conversion Cycle', value: 42, unit: 'days', status: 'green', domain: 'finance', category: 'treasury', thresholdGreen: 45, thresholdAmber: 60, thresholdRed: 90, trend: [48.0, 46.5, 45.0, 43.5, 42.0], sourceSystem: 'SAP FI' },
      { name: 'Customer Satisfaction Score', value: 78.5, unit: '%', status: 'amber', domain: 'revenue', category: 'customer', thresholdGreen: 85, thresholdAmber: 70, thresholdRed: 55, trend: [74.0, 75.5, 76.8, 77.6, 78.5], sourceSystem: 'CRM' },
    ];
    // Domain → cluster_id mapping so each SAP/CRM metric drilldown can surface
    // the matching cluster (Finance / Supply Chain / Revenue). Sub-catalyst
    // linkage is intentionally NOT inferred here — aggregate KPIs sit above
    // any one sub-catalyst. catalyst-engine metrics get their sub-catalyst
    // linkage via services/scheduled.ts::refreshProcessMining.
    const domainToCluster: Record<string, string> = {
      finance: financeClusterId,
      supply_chain: supplyChainClusterId,
      revenue: revenueClusterId,
    };
    const metricIds: string[] = [];
    for (const pm of processMetricsData) {
      const pmId = crypto.randomUUID();
      metricIds.push(pmId);
      const linkedCluster = domainToCluster[pm.domain] ?? null;
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, domain, category, threshold_green, threshold_amber, threshold_red, trend, source_system, cluster_id, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(pmId, tenantId, pm.name, pm.value, pm.unit, pm.status, pm.domain, pm.category, pm.thresholdGreen, pm.thresholdAmber, pm.thresholdRed, JSON.stringify(pm.trend), pm.sourceSystem, linkedCluster, now));
    }
    console.log(`[VantaX Seeder] Seeded ${processMetricsData.length} process metrics`);

    // STEP 12d: Process Metric History for "Metrics Over Time" chart
    for (let mi = 0; mi < Math.min(3, processMetricsData.length); mi++) {
      const pm = processMetricsData[mi];
      for (let mo = -5; mo <= 0; mo++) {
        const d = new Date(); d.setMonth(d.getMonth() + mo);
        const histVal = pm.trend[Math.max(0, mo + 5)] ?? pm.value;
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), tenantId, metricIds[mi], histVal, d.toISOString()));
      }
    }
    console.log('[VantaX Seeder] Seeded process metric history (18 records)');

    // STEP 12e: Risk Alerts
    const riskAlerts = [
      { title: 'Critical Inventory Shrinkage', description: 'Inventory accuracy at 55.6% — well below the 80% threshold. Physical count variances indicate potential theft, spoilage, or receiving errors across 4 warehouse locations.', severity: 'critical', category: 'operational', probability: 0.85, impactValue: 2450000, actions: ['Immediate cycle count of high-value items', 'Review warehouse access controls', 'Audit receiving processes'] },
      { title: 'Bank Reconciliation Backlog', description: 'Unreconciled bank transactions at 31.25% — 15 unmatched EFT payments and 10 unallocated bank fees. Risk of misstated cash position and delayed financial reporting.', severity: 'high', category: 'financial', probability: 0.72, impactValue: 890000, actions: ['Clear backlog of unmatched EFTs', 'Implement auto-matching rules for recurring payments', 'Review bank fee allocation process'] },
      { title: 'Revenue Recognition Non-Compliance', description: '26.3% of revenue not recognized in the correct period per IFRS 15. Timing differences between SD billing and FI revenue posting create compliance exposure.', severity: 'high', category: 'compliance', probability: 0.65, impactValue: 1200000, actions: ['Review SD-FI integration configuration', 'Audit revenue recognition cut-off procedures', 'Implement automated IFRS 15 checks'] },
      { title: 'Duplicate Payment Exposure', description: 'AP invoice validation detected potential duplicate payments totalling R180K. Weak duplicate detection in SAP invoice verification (MIRO) allows same-vendor invoices with minor reference variations.', severity: 'medium', category: 'financial', probability: 0.45, impactValue: 180000, actions: ['Enable SAP duplicate invoice check (OMR6)', 'Run retrospective duplicate payment analysis', 'Strengthen vendor invoice reference standards'] },
      { title: 'Load Shedding Production Impact', description: 'Stage 4 load shedding reducing production output by 15-20%. Generator switchover taking 15 minutes per event, with 3-4 events daily. OEE dropped to 72.5%.', severity: 'critical', category: 'operational', probability: 0.90, impactValue: 3500000, actions: ['Install automatic transfer switches', 'Increase diesel fuel reserves to 7-day buffer', 'Shift production schedules to off-peak windows'] },
      { title: 'Rand Depreciation Margin Pressure', description: 'ZAR past R19/USD creating 8-12% cost increase on imported raw materials. Current hedging covers only 40% of FX exposure. Gross margins under pressure.', severity: 'high', category: 'financial', probability: 0.80, impactValue: 2100000, actions: ['Increase FX hedge ratio to 70%', 'Renegotiate supplier contracts with ZAR escalation clauses', 'Identify local alternative suppliers'] },
      { title: 'Supplier Concentration Risk', description: '3 critical raw material suppliers account for 65% of procurement spend. Loss of any single supplier would halt production within 2 weeks.', severity: 'medium', category: 'strategic', probability: 0.30, impactValue: 5000000, actions: ['Diversify supplier base — qualify 2 additional suppliers per category', 'Increase safety stock for critical items', 'Negotiate dual-source agreements'] },
    ];
    for (const ra of riskAlerts) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, 'active', ?)`
      ).bind(crypto.randomUUID(), tenantId, ra.title, ra.description, ra.severity, ra.category, ra.probability, ra.impactValue, JSON.stringify(ra.actions), now));
    }
    console.log(`[VantaX Seeder] Seeded ${riskAlerts.length} risk alerts`);

    // STEP 12f: Anomalies
    const anomaliesData = [
      { metric: 'Inventory Accuracy', severity: 'critical', deviation: -24.4, expectedValue: 80, actualValue: 55.6, description: 'Inventory accuracy dropped significantly below threshold. 4 storage locations showing shrinkage patterns consistent with systematic receiving errors.' },
      { metric: 'Bank Reconciliation Rate', severity: 'high', deviation: -16.25, expectedValue: 85, actualValue: 68.75, description: 'Sharp decline in bank reconciliation rate over past 3 months. Unmatched EFT payments increasing — likely caused by new payment reference format from major customer.' },
      { metric: 'Production OEE', severity: 'high', deviation: -12.5, expectedValue: 85, actualValue: 72.5, description: 'OEE declining due to load shedding disruptions. Availability component dropped 18 points while performance and quality remain stable.' },
      { metric: 'Supplier Lead Time', severity: 'medium', deviation: 42.0, expectedValue: 10, actualValue: 14.2, description: 'Average supplier lead time increasing. Durban port congestion adding 3-5 days to import shipments. Domestic suppliers unaffected.' },
      { metric: 'Revenue Recognition Compliance', severity: 'medium', deviation: -21.3, expectedValue: 95, actualValue: 73.7, description: 'Revenue recognition timing gap widening. SD billing documents not synchronized with FI revenue posting. Month-end cut-off procedures need review.' },
    ];
    for (const an of anomaliesData) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO anomalies (id, tenant_id, metric, severity, deviation, expected_value, actual_value, hypothesis, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
      ).bind(crypto.randomUUID(), tenantId, an.metric, an.severity, an.deviation, an.expectedValue, an.actualValue, an.description, now));
    }
    console.log(`[VantaX Seeder] Seeded ${anomaliesData.length} anomalies`);

    // STEP 12g: Catalyst Actions
    // ────────────────────────────────────────────────────────────────────
    // Action queue is the operator's daily work surface (Pulse → Action Queue).
    // The panel only renders Approve/Reject buttons when status='pending_approval'
    // AND connection_id is set. Without both, the queue looks dead. We mix:
    //   - 8 pending_approval (the demo focus — operator approves on stage)
    //   - 4 completed/verified (track record visible in queue history)
    //   - 2 in_progress + 1 rejected (status diversity for filter UI)
    // Every row carries: connection_id, value_zar, action_type, idempotency_key,
    // source_finding_id, and output_data with mode + reasoning so the queue
    // panel light up with values, mode pills, and traceable drill-through.
    // ────────────────────────────────────────────────────────────────────
    const catalystActionsData: Array<{
      clusterId: string;
      catalystName: string;
      action: string;
      actionType: string;
      status: string;
      confidence: number;
      reasoning: string;
      valueZar: number;
      vendor: string | null;
      sourceFindingId: string | null;
      outputMode: 'live' | 'stub' | 'preview' | null;
      outputSummary: string | null;
    }> = [
      // ── PENDING APPROVAL (8) — the demo bread & butter ─────────────────
      {
        clusterId: financeClusterId, catalystName: 'GR/IR Reconciliation',
        action: 'Post GR/IR clearing entry for PO 4500-PO-10013 (Sasol Chemical Industries)',
        actionType: 'erp_post_clearing', status: 'pending_approval', confidence: 0.94,
        reasoning: 'PO-invoice pair matched on quantity + value within 0.3% tolerance. Vendor LIFNR 100013 historical conformance 97%. Safe to auto-post but threshold > R100k requires CFO sign-off.',
        valueZar: 184_500, vendor: 'Sasol Chemical Industries',
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will post FB05 clearing document; SAP impact: clears R 184,500 in GR/IR holding account 191100',
      },
      {
        clusterId: financeClusterId, catalystName: 'AP Invoice Validation',
        action: 'Block duplicate invoice INV-AECI-2026-0184 against existing INV-AECI-2026-0177',
        actionType: 'erp_block_duplicate', status: 'pending_approval', confidence: 0.91,
        reasoning: 'Vendor reference, amount (R 78,200), and invoice date all match within 0.5%. SAP MIRO duplicate-check window expired before second post. Recommend payment block code R + AP review.',
        valueZar: 78_200, vendor: 'AECI Mining Explosives',
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will apply payment block "R" on document 5100482918; AP team notified for review',
      },
      {
        clusterId: financeClusterId, catalystName: 'Bank Reconciliation',
        action: 'Auto-allocate 10 unmatched bank fees totalling R 24,840 to GL 477100 (Bank Charges)',
        actionType: 'erp_post_journal', status: 'pending_approval', confidence: 0.89,
        reasoning: 'Pattern signature "bank_fee_unallocated" matches 8 prior resolutions in this tenant (avg confidence 0.88). All 10 line items match the FNB monthly-fee pattern (description contains "FEE" or "CHARGE", amount < R 5,000).',
        valueZar: 24_840, vendor: null,
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will post FB50 journal: DR 477100 / CR 110100 R 24,840 across 10 line items',
      },
      {
        clusterId: supplyChainClusterId, catalystName: 'Inventory Reconciliation',
        action: 'Open 4 physical-count investigations at JHB-DC (category FG-104, value R 320,400)',
        actionType: 'workflow_open_investigation', status: 'pending_approval', confidence: 0.86,
        reasoning: 'Cycle-count variance of 21.7% concentrated in finished-goods FG-104. Either receiving error (4 items recently inbound) or shrinkage. Investigation workflow auto-creates 4 tasks assigned to warehouse manager + opens stock-take scope.',
        valueZar: 320_400, vendor: null,
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will create 4 SAP-ServiceDesk tickets + freeze inventory movement on affected SKUs until count complete',
      },
      {
        clusterId: revenueClusterId, catalystName: 'Sales Order Matching',
        action: 'Reverse + re-book R 1.42M of Q1 invoices misallocated to wrong accounting period (IFRS 15)',
        actionType: 'erp_period_reallocation', status: 'pending_approval', confidence: 0.83,
        reasoning: '12 invoices (Pick n Pay + Woolworths long-term service contracts) booked in Jan 2026 against milestone billing that contractually defers to Feb/Mar 2026. External auditor agreed treatment in 2026-Q1 review. This action reverses + re-books with correct period.',
        valueZar: 1_420_000, vendor: 'Pick n Pay + Woolworths',
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will reverse 12 SD billing docs + re-book in correct periods; external auditor notified',
      },
      {
        clusterId: financeClusterId, catalystName: 'AP Invoice Validation',
        action: 'Apply 2% early-payment discount on R 850k Sasol invoice (terms allow but missed cutoff)',
        actionType: 'erp_apply_discount', status: 'pending_approval', confidence: 0.78,
        reasoning: 'Vendor terms = Net 30 / 2% 10. Invoice dated 2026-05-18, paid 2026-05-26 (8 days). System missed discount because terms code mis-mapped. Recovery of R 17,000 by post-credit memo.',
        valueZar: 17_000, vendor: 'Sasol Chemical Industries',
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will post FB75 credit memo R 17,000 against vendor 100013; terms-code mapping flagged for fix',
      },
      {
        clusterId: financeClusterId, catalystName: 'GR/IR Reconciliation',
        action: 'Tighten PO-tolerance group for LIFNR 100027 from ±5% to ±1% (35 exceptions in 90 days)',
        actionType: 'config_update', status: 'pending_approval', confidence: 0.81,
        reasoning: 'Vendor 100027 (Bidvest Industrial) generated 35 GR/IR exceptions in the last 90 days, all clustered at ±2-4% price drift. Tolerance group change prevents auto-match and forces buyer review for any future PO with that drift.',
        valueZar: 0, vendor: 'Bidvest Industrial',
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will update vendor master tolerance group from B100 to B005 in SAP (transaction XK02)',
      },
      {
        clusterId: supplyChainClusterId, catalystName: 'Inventory Reconciliation',
        action: 'Trigger cycle-count for 18 high-value SKUs at JHB-DC (R 4.2M value-at-risk)',
        actionType: 'workflow_trigger_count', status: 'pending_approval', confidence: 0.92,
        reasoning: 'ABC-class A SKUs with > 30 days since last count + shrinkage pattern detected in adjacent category. Standard SOX practice. Auto-creates SAP MI04 count documents.',
        valueZar: 4_200_000, vendor: null,
        sourceFindingId: crypto.randomUUID(),
        outputMode: 'preview',
        outputSummary: 'Will create 18 SAP MI04 count documents; assigns to warehouse team for next-day execution',
      },
      // ── COMPLETED (3) — shows the queue’s recent activity ───────────────
      {
        clusterId: financeClusterId, catalystName: 'GR/IR Reconciliation',
        action: 'Auto-matched 45 of 55 GR/IR items with 87.2% confidence',
        actionType: 'erp_post_clearing', status: 'completed', confidence: 0.872,
        reasoning: 'High match rates on PO-invoice pairs with exact quantity and within 1% price tolerance.',
        valueZar: 2_840_000, vendor: null, sourceFindingId: null,
        outputMode: 'live',
        outputSummary: '45 FB05 clearing docs posted; total cleared R 2.84M; 10 items escalated for manual review',
      },
      {
        clusterId: financeClusterId, catalystName: 'Bank Reconciliation',
        action: 'Reconciled 55 of 80 bank transactions automatically',
        actionType: 'erp_match_bank', status: 'completed', confidence: 0.845,
        reasoning: 'EFT payments matched using reference and amount. 15 items require manual matching due to new reference format.',
        valueZar: 6_120_000, vendor: null, sourceFindingId: null,
        outputMode: 'live',
        outputSummary: '55 bank line items cleared in SAP FF67; 10 fees auto-allocated; 15 escalated for manual review',
      },
      {
        clusterId: revenueClusterId, catalystName: 'Sales Order Matching',
        action: 'Matched 55 of 80 billing documents to AR postings',
        actionType: 'erp_match_ar', status: 'completed', confidence: 0.82,
        reasoning: 'Primary match on document number and amount. 10 items show amount variances within tolerance.',
        valueZar: 4_680_000, vendor: null, sourceFindingId: null,
        outputMode: 'live',
        outputSummary: '55 SD-to-AR document links posted; 10 variances flagged for review; 7 status mismatches deferred',
      },
      // ── VERIFIED (1) — billing artefact ───────────────────────────────────
      {
        clusterId: financeClusterId, catalystName: 'AP Invoice Validation',
        action: 'Flagged + blocked 3 duplicate invoices (R 52,400 recovered)',
        actionType: 'erp_block_duplicate', status: 'verified', confidence: 0.96,
        reasoning: 'AP team confirmed 3 of 3 flagged items were genuine duplicates submitted by vendors after payment delay queries. Recovery realised.',
        valueZar: 52_400, vendor: null, sourceFindingId: null,
        outputMode: 'live',
        outputSummary: '3 payment blocks confirmed by AP lead; vendor education email sent; R 52,400 recovered',
      },
      // ── IN PROGRESS (2) ───────────────────────────────────────────────
      {
        clusterId: supplyChainClusterId, catalystName: 'Demand Forecasting',
        action: 'Generating Q3 demand forecast — Eskom load-shedding impact modelled',
        actionType: 'forecast_generate', status: 'in_progress', confidence: 0.74,
        reasoning: 'Seasonal patterns and order pipeline analysis suggest Q3 uptick. Load shedding impact factored in as 8% production constraint.',
        valueZar: 0, vendor: null, sourceFindingId: null,
        outputMode: null,
        outputSummary: null,
      },
      {
        clusterId: financeClusterId, catalystName: 'AP Invoice Validation',
        action: 'Processing R1.2M in pending invoice approvals (12 invoices)',
        actionType: 'erp_validate_batch', status: 'in_progress', confidence: 0.85,
        reasoning: 'Batch of 12 invoices from 3 major suppliers awaiting 3-way match verification.',
        valueZar: 1_200_000, vendor: null, sourceFindingId: null,
        outputMode: null,
        outputSummary: null,
      },
      // ── REJECTED (1) — shows the queue’s audit trail ────────────────────
      {
        clusterId: revenueClusterId, catalystName: 'Sales Order Matching',
        action: 'Proposed write-off of R 38,400 AR ageing > 180 days (Customer KNA1 200015)',
        actionType: 'erp_write_off', status: 'rejected', confidence: 0.62,
        reasoning: 'Confidence below 70% threshold for auto-execution. CFO opted to keep AR active pending legal review.',
        valueZar: 38_400, vendor: null, sourceFindingId: null,
        outputMode: null,
        outputSummary: null,
      },
    ];
    // Per-action created_at / completed_at offsets so that the Process
    // Mining sweep (services/scheduled.ts refreshProcessMining) computes
    // a non-zero avg_duration. Per WORLD_CLASS §A.3: the demo must
    // demonstrate process mining, which means the elapsed-time math
    // needs real numbers. Catalyst-specific durations: AP invoice
    // validation is fast (~25 min); GR/IR reconciliation is slow (~5h).
    const durationMinutesByCatalyst: Record<string, number> = {
      'GR/IR Reconciliation': 300,           // 5 hours — multi-pass matching
      'AP Invoice Validation': 25,            // fast — rules-based
      'Bank Reconciliation': 110,             // 2h — wait on EFT lookups
      'Inventory Reconciliation': 240,        // 4h — warehouse traversal
      'Sales Order Matching': 95,             // ~1.5h
      'Demand Forecasting': 480,              // 8h — long ML batch
    };
    await flushSeed('before-catalyst-actions');
    const catalystActionStmts = catalystActionsData.map((ca) => {
      const elapsedMin = durationMinutesByCatalyst[ca.catalystName] ?? 60;
      const startHoursAgo = Math.round((Math.random() * 168) + 1);
      const completedAt = (ca.status === 'completed' || ca.status === 'verified')
        ? `datetime('now', '-${startHoursAgo} hours', '+${elapsedMin} minutes')`
        : `NULL`;
      const outputData = (ca.outputMode || ca.outputSummary)
        ? JSON.stringify({ mode: ca.outputMode, summary: ca.outputSummary })
        : null;
      return c.env.DB.prepare(
        `INSERT INTO catalyst_actions (
          id, tenant_id, cluster_id, catalyst_name, action, status, confidence, reasoning,
          connection_id, action_type, value_zar, source_finding_id, idempotency_key, vendor, output_data,
          created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-${startHoursAgo} hours'), ${completedAt})`
      ).bind(
        crypto.randomUUID(), tenantId, ca.clusterId, ca.catalystName, ca.action,
        ca.status, ca.confidence, ca.reasoning,
        connectionId, ca.actionType, ca.valueZar, ca.sourceFindingId,
        crypto.randomUUID(), ca.vendor, outputData,
      );
    });
    await c.env.DB.batch(catalystActionStmts);
    console.log(`[VantaX Seeder] Seeded ${catalystActionsData.length} catalyst actions (batched)`);

    // STEP 12h: Agent Deployments (Control Plane)
    const agentDeployments = [
      { clusterId: financeClusterId, name: 'Finance Reconciliation Agent', agentType: 'reconciliation', status: 'running', version: '2.4.1', healthScore: 94, uptime: 99.7, tasksExecuted: 1245 },
      { clusterId: supplyChainClusterId, name: 'Supply Chain Monitor', agentType: 'monitoring', status: 'running', version: '2.4.1', healthScore: 88, uptime: 98.5, tasksExecuted: 892 },
      { clusterId: revenueClusterId, name: 'Revenue Cycle Agent', agentType: 'reconciliation', status: 'running', version: '2.4.1', healthScore: 91, uptime: 99.2, tasksExecuted: 678 },
      { clusterId: financeClusterId, name: 'AP Validation Agent', agentType: 'validation', status: 'running', version: '2.3.8', healthScore: 96, uptime: 99.9, tasksExecuted: 2034 },
      { clusterId: null, name: 'Radar Signal Collector', agentType: 'intelligence', status: 'running', version: '1.2.0', healthScore: 85, uptime: 97.8, tasksExecuted: 156 },
    ];
    for (const ad of agentDeployments) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO agent_deployments (id, tenant_id, cluster_id, name, agent_type, status, deployment_model, version, health_score, uptime, tasks_executed, config, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?, 'saas', ?, ?, ?, ?, '{}', ?)`
      ).bind(crypto.randomUUID(), tenantId, ad.clusterId, ad.name, ad.agentType, ad.status, ad.version, ad.healthScore, ad.uptime, ad.tasksExecuted, now));
    }
    console.log(`[VantaX Seeder] Seeded ${agentDeployments.length} agent deployments`);

    // Step 10: Create Executive Briefing
    seedBatch.push(c.env.DB.prepare(`
      INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at, health_delta, red_metric_count, anomaly_count, active_risk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), tenantId,
      'Daily Executive Briefing — ' + new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }),
      [
        'VantaX SAP operations show mixed performance heading into mid-2026. The Atheon Score moved from 65 to 69 over the past month, with three structural issues now actively under management.',
        '',
        'Top exposures: GR/IR exception rate is running at 14.8% against an 8% target — R 8.4M of unmatched receipts concentrated across three vendors (LIFNR 100013, 100027, 100089). At JHB-DC, a 21.7% cycle-count variance on finished goods category FG-104 points to either receiving errors or shrinkage, with a R 320k value exposure. Revenue recognition timing is the most urgent: 26.3% of Q1 2026 invoices were booked outside the correct period under IFRS 15, which is now under external-auditor review.',
        '',
        'Tailwinds: cumulative discrepancy recovery hit R 3.2M (ROI 5.5x against Atheon licence cost), the GR/IR automation pilot is approved with a projected 3.8-month payback, and the FX hedging programme has been accelerated to 50% coverage following the Rand breaching R19/USD. CFO and COO decisions on inventory audit budget and revenue recognition policy are needed within the next two weeks to keep the recovery trajectory intact.',
      ].join('\n'),
      JSON.stringify([
        { title: 'High GR/IR Discrepancy Rate', detail: '17% exceeds 10% threshold; R 8.4M exposure across LIFNR 100013, 100027, 100089', dimension: 'Financial', severity: 'high', owner: 'CFO' },
        { title: 'Inventory Shrinkage Detected', detail: '21.7% cycle-count variance at JHB-DC; concentrated in finished goods category FG-104', dimension: 'Operational', severity: 'high', owner: 'COO' },
        { title: 'Revenue Recognition Delay', detail: '26.3% of Q1 invoices booked in wrong period under IFRS 15; potential audit finding', dimension: 'Compliance', severity: 'critical', owner: 'CFO + External Auditor' },
        { title: 'Duplicate Payment Risk', detail: 'AP validation flagged 7 potential duplicates totalling R 320k pending review', dimension: 'Financial', severity: 'medium', owner: 'AP Manager' },
      ]),
      JSON.stringify([
        { title: 'Process Automation — GR/IR Self-Heal', detail: 'Automated 3-way match for vendors with conformance > 92% (12 of 47 active vendors)', estimated_savings: 2_500_000, currency: 'ZAR', timeframe: 'by Q3 2026', confidence: 0.78 },
        { title: 'System Integration — Bank-to-Book Auto-Reconciliation', detail: 'Direct MT940 → FF67 feed eliminates 18hrs/week of manual fee allocation', estimated_savings: 1_800_000, currency: 'ZAR', timeframe: 'by Q4 2026', confidence: 0.84 },
        { title: 'Vendor Master Cleanup', detail: 'Deduplicate 142 duplicate LIFNR records identified by AP Validation Agent', estimated_savings: 650_000, currency: 'ZAR', timeframe: 'by Q3 2026', confidence: 0.91 },
      ]),
      JSON.stringify([
        { kpi: 'Match Rate', current: 82.4, previous: 87.6, movement: '-5.2%', direction: 'down', period: 'vs last month', target: 92.0 },
        { kpi: 'Exception Rate', current: 14.8, previous: 11.7, movement: '+3.1%', direction: 'up', period: 'vs last month', target: 8.0 },
        { kpi: 'Avg Processing Time', current: 38, previous: 50, movement: '-12s', direction: 'down', period: 'vs last month', target: 30, unit: 'seconds' },
        { kpi: 'Recovered Discrepancies', current: 3_200_000, previous: 2_450_000, movement: '+R 750k', direction: 'up', period: 'vs last month', target: 4_000_000, unit: 'ZAR' },
        { kpi: 'Atheon Score', current: 73, previous: 69, movement: '+4', direction: 'up', period: 'vs last month', target: 85 },
      ]),
      JSON.stringify([
        { decision: 'Approve inventory audit budget', amount: 500_000, currency: 'ZAR', owner: 'COO', deadline: '2026-06-15', urgency: 'high', context: 'Required to investigate 21.7% shrinkage variance at JHB-DC' },
        { decision: 'Review revenue recognition policy with CFO', owner: 'CFO + Controller', deadline: '2026-06-30', urgency: 'critical', context: '26.3% of Q1 invoices misallocated; potential IFRS 15 restatement risk' },
        { decision: 'Prioritise GR/IR process improvement initiative', owner: 'CFO + AP Lead', deadline: '2026-07-15', urgency: 'high', context: 'R 8.4M exposure across top 3 vendors; automation candidate identified' },
        { decision: 'Activate FX hedging programme', owner: 'Treasurer', deadline: '2026-06-10', urgency: 'critical', context: 'Rand breached R19/USD; import cost exposure on R 24M of forward orders' },
      ]),
      now,
      -1.2,  // health_delta
      3,     // red_metric_count (Bank Recon, Inventory, OEE)
      5,     // anomaly_count
      7      // active_risk_count
    ));

    // ── STEP: Seed Apex Radar signals + impacts ──
    console.log('[VantaX Seeder] Seeding Apex Radar signals...');

    const radarSignals = [
      { source: 'SARB', type: 'regulatory', title: 'SARB Interest Rate Hike – 50bps', description: 'The South African Reserve Bank raised the repo rate by 50 basis points to combat inflation. This will increase borrowing costs across all credit facilities and may impact capital expenditure plans.', severity: 'high', relevance: 85 },
      { source: 'Reuters', type: 'market', title: 'Rand Weakens Past R19/USD', description: 'The South African Rand breached the R19/USD mark amid global risk-off sentiment and load-shedding concerns. Import costs for raw materials will increase significantly.', severity: 'critical', relevance: 92 },
      { source: 'BusinessDay', type: 'competitor', title: 'Competitor Acquires Local Distributor', description: 'Major competitor has acquired a key logistics partner in the Gauteng region, potentially disrupting our supply chain relationships and distribution network.', severity: 'medium', relevance: 70 },
      { source: 'DTIC', type: 'regulatory', title: 'New BBBEE Scorecard Requirements', description: 'Department of Trade, Industry and Competition published updated BBBEE scorecard requirements effective Q2 2026. Procurement scoring thresholds have been raised.', severity: 'high', relevance: 78 },
      { source: 'Eskom', type: 'economic', title: 'Stage 4 Load Shedding Extended', description: 'Eskom announced extended Stage 4 load shedding for the next 3 weeks due to unplanned breakdowns. Production capacity will be impacted by 15-20%.', severity: 'critical', relevance: 95 },
      { source: 'TechCrunch', type: 'technology', title: 'SAP S/4HANA Cloud Migration Wave', description: 'SAP announced accelerated migration timeline for S/4HANA Cloud. Current on-premise licences will require transition planning within 18 months.', severity: 'medium', relevance: 65 },
      { source: 'StatsSA', type: 'economic', title: 'Q1 GDP Contraction – 1.2%', description: 'Statistics South Africa reported a 1.2% GDP contraction in Q1 2026, driven by mining and manufacturing declines. Consumer spending is expected to slow.', severity: 'high', relevance: 80 },
      { source: 'SARS', type: 'regulatory', title: 'VAT Increase to 16%', description: 'South African Revenue Service confirmed the VAT increase from 15% to 16% effective July 2026. All pricing, invoicing and ERP tax configurations must be updated.', severity: 'critical', relevance: 90 },
      { source: 'Bloomberg', type: 'market', title: 'Iron Ore Price Surge +18%', description: 'Iron ore prices surged 18% on Chinese stimulus measures. Mining-adjacent supply chains will see cost pressure on steel and metal inputs.', severity: 'high', relevance: 75 },
      { source: 'CyberSec SA', type: 'technology', title: 'Ransomware Advisory – Manufacturing Sector', description: 'CSIRT-SA issued advisory on ransomware targeting South African manufacturing firms using unpatched SAP systems. Immediate patching recommended.', severity: 'critical', relevance: 88 },
    ];

    const signalIds: string[] = [];
    for (const sig of radarSignals) {
      const sigId = crypto.randomUUID();
      signalIds.push(sigId);
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO radar_signals (id, tenant_id, source, signal_type, title, description, url, raw_data, severity, relevance_score, status, detected_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?, ?, 'analysed', ?, ?)`
      ).bind(sigId, tenantId, sig.source, sig.type, sig.title, sig.description, sig.severity, sig.relevance, now, now));
    }

    // Seed signal impacts
    const impactData = [
      { sigIdx: 0, dimension: 'financial', direction: 'negative', magnitude: 72, metrics: ['Interest Coverage Ratio', 'Debt Service Cost'], actions: ['Review variable-rate facilities', 'Accelerate fixed-rate hedging'] },
      { sigIdx: 0, dimension: 'operational', direction: 'negative', magnitude: 45, metrics: ['CapEx Budget Utilisation'], actions: ['Defer non-critical capital projects'] },
      { sigIdx: 1, dimension: 'financial', direction: 'negative', magnitude: 88, metrics: ['Import Cost Index', 'Gross Margin'], actions: ['Activate FX hedging program', 'Renegotiate supplier contracts with ZAR escalation clauses'] },
      { sigIdx: 1, dimension: 'risk', direction: 'negative', magnitude: 75, metrics: ['Currency Risk Exposure'], actions: ['Increase ZAR cash reserves'] },
      { sigIdx: 2, dimension: 'strategic', direction: 'negative', magnitude: 55, metrics: ['Market Share', 'Distribution Coverage'], actions: ['Strengthen existing distributor relationships', 'Explore alternative logistics partners'] },
      { sigIdx: 3, dimension: 'compliance', direction: 'negative', magnitude: 60, metrics: ['BBBEE Score', 'Procurement Spend Compliance'], actions: ['Audit current BBBEE procurement spend', 'Identify additional qualifying suppliers'] },
      { sigIdx: 4, dimension: 'operational', direction: 'negative', magnitude: 90, metrics: ['Production Output', 'OEE', 'Energy Cost per Unit'], actions: ['Activate backup generator capacity', 'Shift production to off-peak hours', 'Review diesel fuel reserves'] },
      { sigIdx: 4, dimension: 'financial', direction: 'negative', magnitude: 68, metrics: ['Energy Cost Ratio', 'Unit Production Cost'], actions: ['Accelerate solar installation project'] },
      { sigIdx: 5, dimension: 'technology', direction: 'neutral', magnitude: 40, metrics: ['System Migration Readiness'], actions: ['Begin S/4HANA Cloud readiness assessment', 'Budget for migration project'] },
      // New signals (idx 6-9) impacts
      { sigIdx: 6, dimension: 'financial', direction: 'negative', magnitude: 65, metrics: ['Revenue Forecast', 'Consumer Demand Index'], actions: ['Revise Q2 revenue projections downward by 5-8%', 'Accelerate cost reduction initiatives'] },
      { sigIdx: 6, dimension: 'operational', direction: 'negative', magnitude: 50, metrics: ['Production Volume', 'Workforce Planning'], actions: ['Review hiring plans', 'Defer non-critical operational investments'] },
      { sigIdx: 7, dimension: 'financial', direction: 'negative', magnitude: 82, metrics: ['VAT Configuration', 'Pricing Accuracy', 'Invoice Compliance'], actions: ['Update all SAP tax codes by July 1', 'Retrain finance team on new VAT rules', 'Audit all pricing masters'] },
      { sigIdx: 7, dimension: 'compliance', direction: 'negative', magnitude: 78, metrics: ['Tax Compliance Rate', 'Invoice Accuracy'], actions: ['Schedule SAP tax configuration review', 'Test invoice output formats'] },
      { sigIdx: 7, dimension: 'operational', direction: 'negative', magnitude: 55, metrics: ['Order Processing Time', 'Customer Billing Cycle'], actions: ['Plan system downtime for VAT cutover', 'Prepare customer communication'] },
      { sigIdx: 8, dimension: 'financial', direction: 'negative', magnitude: 70, metrics: ['Raw Material Cost Index', 'Procurement Budget Variance'], actions: ['Lock in forward contracts for steel/iron inputs', 'Explore alternative suppliers'] },
      { sigIdx: 8, dimension: 'risk', direction: 'negative', magnitude: 58, metrics: ['Commodity Price Exposure', 'Supply Chain Cost Risk'], actions: ['Activate commodity hedging strategy', 'Review inventory buffer levels'] },
      { sigIdx: 9, dimension: 'technology', direction: 'negative', magnitude: 92, metrics: ['System Security Score', 'Patch Compliance Rate'], actions: ['Initiate emergency SAP security patching', 'Enable MFA on all SAP accounts'] },
      { sigIdx: 9, dimension: 'operational', direction: 'negative', magnitude: 85, metrics: ['Business Continuity Readiness', 'Backup Recovery Time'], actions: ['Test disaster recovery procedures', 'Verify offline backup integrity', 'Review cyber insurance coverage'] },
      { sigIdx: 9, dimension: 'financial', direction: 'negative', magnitude: 60, metrics: ['Cyber Insurance Premium', 'IT Security Budget'], actions: ['Budget for security infrastructure upgrade'] },
      { sigIdx: 0, dimension: 'strategic', direction: 'negative', magnitude: 38, metrics: ['Capital Allocation Efficiency'], actions: ['Reprioritize capital projects based on new interest rate environment'] },
    ];

    for (const imp of impactData) {
      const impId = crypto.randomUUID();
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO radar_signal_impacts (id, tenant_id, signal_id, dimension, impact_direction, impact_magnitude, affected_metrics, recommended_actions, llm_reasoning, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Analysis generated by Atheon Intelligence based on signal context and current health dimensions.', ?)`
      ).bind(impId, tenantId, signalIds[imp.sigIdx], imp.dimension, imp.direction, imp.magnitude, JSON.stringify(imp.metrics), JSON.stringify(imp.actions), now));
    }

    // Seed strategic context
    const ctxId = crypto.randomUUID();
    seedBatch.push(c.env.DB.prepare(
      `INSERT INTO radar_strategic_context (id, tenant_id, context_type, title, summary, factors, sentiment, confidence, source_signal_ids, valid_from, created_at)
       VALUES (?, ?, 'macro', 'Q2 2026 Strategic Context: Headwinds Intensifying', ?, ?, 'negative', 72, ?, ?, ?)`
    ).bind(
      ctxId, tenantId,
      'The South African operating environment faces significant headwinds in Q2 2026. A combination of monetary tightening (50bps repo rate increase), rand depreciation past R19/USD, and extended Stage 4 load shedding creates a challenging landscape for industrial operations. Import-dependent supply chains face margin compression, while energy-intensive production lines will see reduced output capacity. New BBBEE scorecard requirements add compliance complexity. On the positive side, the SAP S/4HANA Cloud transition, while requiring investment, presents an opportunity to modernise operations. Strategic focus should prioritise cost containment, FX risk management, and energy resilience.',
      JSON.stringify([
        { name: 'Interest Rate Environment', direction: 'negative', magnitude: 72 },
        { name: 'Currency Depreciation', direction: 'negative', magnitude: 88 },
        { name: 'Energy Supply (Load Shedding)', direction: 'negative', magnitude: 90 },
        { name: 'Regulatory Compliance (BBBEE)', direction: 'negative', magnitude: 60 },
        { name: 'Technology Modernisation', direction: 'positive', magnitude: 40 },
      ]),
      JSON.stringify(signalIds),
      now, now,
    ));

    console.log(`[VantaX Seeder] Seeded ${radarSignals.length} radar signals, ${impactData.length} impacts, 1 strategic context`);

    // ── STEP: Seed Pulse Diagnostics ──
    console.log('[VantaX Seeder] Seeding Pulse Diagnostics...');

    const diagMetrics = [
      { name: 'GR/IR Match Rate', value: 81.25, status: 'amber', category: 'reconciliation' },
      { name: 'Bank Reconciliation Rate', value: 68.75, status: 'red', category: 'reconciliation' },
      { name: 'Inventory Accuracy', value: 55.6, status: 'red', category: 'inventory' },
    ];

    for (const dm of diagMetrics) {
      const analysisId = crypto.randomUUID();
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO diagnostic_analyses (id, tenant_id, metric_id, metric_name, metric_value, metric_status, trigger_type, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'auto', 'completed', ?, ?)`
      ).bind(analysisId, tenantId, crypto.randomUUID(), dm.name, dm.value, dm.status, now, now));

      // L0-L3 causal chain for each
      const chains = [
        { level: 0, type: 'direct', title: `${dm.name} at ${dm.value}%`, desc: `Metric ${dm.name} is in ${dm.status} status at ${dm.value}%, below target thresholds.`, confidence: 95, priority: dm.status === 'red' ? 'critical' : 'high', effort: 'low' },
        { level: 1, type: 'direct', title: `Data quality issues in source systems`, desc: `Inconsistent data entry and delayed postings in SAP S/4HANA are causing reconciliation mismatches. Manual data entry errors account for approximately 15% of discrepancies.`, confidence: 80, priority: 'high', effort: 'medium' },
        { level: 2, type: 'contributing', title: `Process timing gaps between systems`, desc: `Cut-off timing differences between sub-systems create temporary reconciliation breaks. Month-end close procedures do not adequately address inter-system timing gaps.`, confidence: 70, priority: 'medium', effort: 'medium' },
        { level: 3, type: 'systemic', title: `Lack of real-time integration layer`, desc: `Batch processing architecture means reconciliation data is always stale by 4-8 hours. A real-time event-driven integration would eliminate most timing-related discrepancies.`, confidence: 60, priority: 'medium', effort: 'high' },
      ];

      for (const ch of chains) {
        const chainId = crypto.randomUUID();
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO diagnostic_causal_chains (id, tenant_id, analysis_id, level, cause_type, title, description, confidence, evidence, related_metrics, recommended_fix, fix_priority, fix_effort, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?)`
        ).bind(chainId, tenantId, analysisId, ch.level, ch.type, ch.title, ch.desc, ch.confidence, `Review and address: ${ch.title}`, ch.priority, ch.effort, now));
      }
    }

    console.log(`[VantaX Seeder] Seeded ${diagMetrics.length} diagnostic analyses with causal chains`);

    // ── STEP: Seed Catalyst Intelligence patterns ──
    console.log('[VantaX Seeder] Seeding Catalyst Intelligence patterns...');

    const patterns = [
      { type: 'recurring_failure', title: 'Recurring GR/IR Mismatch on Chemicals Suppliers', desc: 'Pattern detected: 4 out of 5 recent GR/IR reconciliation runs show mismatches exceeding 5% for chemical raw material suppliers (Sasol, Omnia, AECI). Root cause appears to be inconsistent unit-of-measure conversion between PO and goods receipt.', freq: 4, severity: 'high', clusters: ['Finance'], subs: ['GR/IR Reconciliation'] },
      { type: 'degradation_trend', title: 'Declining Bank Reconciliation Accuracy', desc: 'Bank reconciliation accuracy has declined from 85% to 69% over the last 6 runs. Unmatched EFT transactions are increasing, particularly for smaller supplier payments under R10,000. This correlates with the recent switch to batch payment processing.', freq: 6, severity: 'critical', clusters: ['Finance'], subs: ['Bank Reconciliation'] },
      { type: 'cross_catalyst_correlation', title: 'Inventory Discrepancy Correlates with PO Timing', desc: 'Inventory count variances are 3x higher for items with purchase orders processed in the last 48 hours. The goods receipt timing gap between warehouse scanning and SAP posting is creating a systematic bias in physical count reconciliation.', freq: 3, severity: 'medium', clusters: ['Supply Chain', 'Finance'], subs: ['Inventory Reconciliation', 'GR/IR Reconciliation'] },
      { type: 'temporal_pattern', title: 'Month-End Payment Spike Causes Reconciliation Backlog', desc: 'Payment processing volume increases 4x in the last 3 business days of each month, creating a reconciliation backlog that persists 5-7 days into the next month. Automated matching rules degrade from 85% to 62% during peak periods due to batch processing delays.', freq: 12, severity: 'high', clusters: ['Finance'], subs: ['Bank Reconciliation', 'AP Invoice Validation'] },
      { type: 'field_hotspot', title: 'Supplier VAT Number Mismatch Hotspot', desc: 'VAT number discrepancies concentrated in 3 supplier groups (chemicals, logistics, engineering) account for 67% of all invoice matching failures. Root cause traced to legacy vendor master data migration from SAP ECC to S/4HANA with incomplete field mapping.', freq: 8, severity: 'high', clusters: ['Finance', 'Supply Chain'], subs: ['AP Invoice Validation', 'GR/IR Reconciliation'] },
    ];

    for (const pat of patterns) {
      const patId = crypto.randomUUID();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO catalyst_patterns (id, tenant_id, pattern_type, title, description, frequency, first_seen, last_seen, affected_clusters, affected_sub_catalysts, severity, status, recommended_actions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '[]', ?)`
      ).bind(patId, tenantId, pat.type, pat.title, pat.desc, pat.freq, thirtyDaysAgo, now, JSON.stringify(pat.clusters), JSON.stringify(pat.subs), pat.severity, now));
    }

    console.log(`[VantaX Seeder] Seeded ${patterns.length} catalyst patterns`);

    // ── STEP: Seed V2 Competitors ──
    console.log('[VantaX Seeder] Seeding V2 competitors...');
    const competitors = [
      { name: 'NexaCorp SA', industry: 'industrial', website: 'https://nexacorp.co.za', strengths: ['Digital transformation', 'AI-driven analytics'], weaknesses: ['Limited SA footprint', 'High pricing'], marketShare: 15, threatLevel: 'high' },
      { name: 'Pinnacle Systems', industry: 'technology', website: 'https://pinnaclesys.co.za', strengths: ['SAP partnership', 'Strong consulting team'], weaknesses: ['Slow innovation', 'Legacy codebase'], marketShare: 12, threatLevel: 'medium' },
      { name: 'Meridian Group', industry: 'financial_services', website: 'https://meridiangrp.co.za', strengths: ['Deep finance expertise', 'BBBEE Level 1'], weaknesses: ['No tech platform', 'Manual processes'], marketShare: 8, threatLevel: 'low' },
      { name: 'Atlas Industrial', industry: 'manufacturing', website: 'https://atlasindustrial.co.za', strengths: ['Manufacturing domain', 'IoT integration'], weaknesses: ['No reconciliation capability', 'Small team'], marketShare: 5, threatLevel: 'medium' },
    ];
    for (const comp of competitors) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO competitors (id, tenant_id, name, industry, estimated_revenue, market_share, strengths, weaknesses, last_updated, signals_count)
         VALUES (?, ?, ?, ?, 'undisclosed', ?, ?, ?, ?, 0)`
      ).bind(crypto.randomUUID(), tenantId, comp.name, comp.industry, comp.marketShare, JSON.stringify(comp.strengths), JSON.stringify(comp.weaknesses), now));
    }
    console.log(`[VantaX Seeder] Seeded ${competitors.length} competitors`);

    // ── STEP: Seed V2 Market Benchmarks ──
    console.log('[VantaX Seeder] Seeding V2 market benchmarks...');
    const benchmarks = [
      { name: 'Revenue Growth', category: 'financial', value: 8.5, unit: '%', source: 'PwC SA Industry Report 2026', percentile: 65 },
      { name: 'Operating Margin', category: 'financial', value: 14.2, unit: '%', source: 'Deloitte SA Benchmarks', percentile: 58 },
      { name: 'Inventory Turnover', category: 'operational', value: 6.8, unit: 'turns', source: 'SAPICS SA Survey', percentile: 45 },
      { name: 'Cash Conversion Cycle', category: 'financial', value: 42, unit: 'days', source: 'SAICA Industry Metrics', percentile: 52 },
      { name: 'Employee Productivity', category: 'operational', value: 285000, unit: 'ZAR/employee', source: 'Stats SA Labour Report', percentile: 70 },
      { name: 'Digital Maturity Index', category: 'technology', value: 3.2, unit: '/5', source: 'McKinsey Digital SA', percentile: 40 },
    ];
    for (const bm of benchmarks) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO market_benchmarks (id, tenant_id, industry, metric_name, benchmark_value, benchmark_unit, source, measured_at)
         VALUES (?, ?, 'general', ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, bm.name, bm.value, bm.unit, bm.source, now));
    }
    console.log(`[VantaX Seeder] Seeded ${benchmarks.length} market benchmarks`);

    // ── STEP: Seed V2 Regulatory Events ──
    console.log('[VantaX Seeder] Seeding V2 regulatory events...');
    const regEvents = [
      { title: 'POPIA Compliance Audit', body: 'Information Regulator scheduled compliance audit for data processing activities. All personal information processing must be documented and consent records available.', authority: 'Information Regulator SA', effectiveDate: '2026-06-01', impact: 'high', category: 'data_privacy', status: 'upcoming' },
      { title: 'BBBEE Scorecard Renewal', body: 'Annual BBBEE verification due. New codes require minimum 40% procurement from qualifying enterprises. Current spend at 35% needs acceleration.', authority: 'DTIC', effectiveDate: '2026-09-30', impact: 'medium', category: 'compliance', status: 'upcoming' },
      { title: 'Carbon Tax Phase 2', body: 'National Treasury carbon tax Phase 2 implementation increases levy from R159 to R190 per tonne CO2e. Manufacturing facilities must update emission reporting.', authority: 'National Treasury', effectiveDate: '2026-01-01', impact: 'medium', category: 'environmental', status: 'active' },
    ];
    for (const re of regEvents) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO regulatory_events (id, tenant_id, title, description, effective_date, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, re.title, re.body, re.effectiveDate, re.status));
    }
    console.log(`[VantaX Seeder] Seeded ${regEvents.length} regulatory events`);

    // ── STEP: Seed V2 Root Cause Analyses with causal factors + prescriptions ──
    console.log('[VantaX Seeder] Seeding V2 root cause analyses...');
    const rcaData = [
      { metricName: 'AP Invoice Match Rate', metricValue: 81.25, status: 'amber', factors: [
        { level: 0, category: 'process', title: 'Invoice matching rate below target', description: 'AP match rate at 81.25% vs 95% target. 18.75% of invoices require manual intervention.', confidence: 95, linkedMetrics: ['AP Match Rate', 'Processing Time'] },
        { level: 1, category: 'data', title: 'PO price variance on raw materials', description: 'Fluctuating ZAR exchange rates cause PO prices to differ from invoice amounts by 2-5% for imported materials.', confidence: 82, linkedMetrics: ['FX Rate', 'PO Accuracy'] },
        { level: 2, category: 'system', title: 'Delayed GR posting in SAP', description: 'Goods receipt posting delayed by average 2.3 days due to warehouse staff not scanning on receipt.', confidence: 75, linkedMetrics: ['GR Posting Time', 'Warehouse Efficiency'] },
      ], prescriptions: [
        { title: 'Implement mobile GR scanning', description: 'Deploy SAP Fiori mobile app for warehouse goods receipt to eliminate posting delays.', priority: 'high', effort: 'medium', sapTransaction: 'MIGO', estimatedImpact: 12 },
        { title: 'Configure automatic FX tolerance', description: 'Set up automatic tolerance groups in SAP for FX-related price variances under 3%.', priority: 'medium', effort: 'low', sapTransaction: 'OBA3', estimatedImpact: 8 },
      ]},
      { metricName: 'Production OEE', metricValue: 72.5, status: 'red', factors: [
        { level: 0, category: 'operational', title: 'OEE below industry benchmark', description: 'Overall Equipment Effectiveness at 72.5% vs 85% industry standard. Availability is the primary drag factor.', confidence: 92, linkedMetrics: ['OEE', 'Availability', 'Performance'] },
        { level: 1, category: 'infrastructure', title: 'Load shedding impact on production', description: 'Stage 4 load shedding causing 4-6 hour daily production stoppages. Generator switchover takes 15 minutes per event.', confidence: 88, linkedMetrics: ['Downtime Hours', 'Energy Cost'] },
        { level: 2, category: 'process', title: 'Unplanned maintenance frequency', description: 'Reactive maintenance accounts for 35% of all maintenance activities vs 15% best practice target.', confidence: 70, linkedMetrics: ['MTBF', 'Maintenance Cost'] },
      ], prescriptions: [
        { title: 'Install automatic transfer switches', description: 'Replace manual generator switchover with automatic transfer switches to reduce switchover time to <30 seconds.', priority: 'critical', effort: 'high', sapTransaction: 'PM01', estimatedImpact: 18 },
        { title: 'Implement predictive maintenance', description: 'Deploy IoT sensors on critical equipment and configure SAP PM predictive maintenance workflows.', priority: 'high', effort: 'high', sapTransaction: 'IP10', estimatedImpact: 15 },
      ]},
      { metricName: 'Inventory Accuracy', metricValue: 55.6, status: 'red', factors: [
        { level: 0, category: 'data', title: 'Inventory count accuracy critically low', description: 'Physical count accuracy at 55.6% indicates systemic inventory management issues across multiple storage locations.', confidence: 95, linkedMetrics: ['Count Accuracy', 'Write-offs'] },
        { level: 1, category: 'process', title: 'Cycle count frequency insufficient', description: 'ABC cycle counting not implemented. Full physical counts done quarterly are insufficient for high-value items.', confidence: 78, linkedMetrics: ['Cycle Count Coverage', 'Adjustment Frequency'] },
      ], prescriptions: [
        { title: 'Implement ABC cycle counting', description: 'Configure SAP cycle counting with A-items counted weekly, B-items monthly, C-items quarterly.', priority: 'high', effort: 'medium', sapTransaction: 'MI21', estimatedImpact: 25 },
      ]},
      { metricName: 'Order Fulfillment Rate', metricValue: 89.3, status: 'amber', factors: [
        { level: 0, category: 'operational', title: 'Order fulfillment below target', description: 'OTIF rate at 89.3% vs 95% target. Late deliveries and partial shipments are primary contributors.', confidence: 90, linkedMetrics: ['OTIF', 'Lead Time'] },
        { level: 1, category: 'supply_chain', title: 'Supplier lead time variability', description: 'Key supplier lead times have increased 20% due to port congestion at Durban and global shipping delays.', confidence: 72, linkedMetrics: ['Supplier Lead Time', 'Stock-out Rate'] },
      ], prescriptions: [
        { title: 'Configure safety stock optimization', description: 'Use SAP MRP to set dynamic safety stock levels based on demand variability and lead time uncertainty.', priority: 'medium', effort: 'medium', sapTransaction: 'MD02', estimatedImpact: 10 },
      ]},
    ];

    for (const rca of rcaData) {
      const rcaId = crypto.randomUUID();
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO root_cause_analyses (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, impact_summary, status, generated_at)
         VALUES (?, ?, ?, ?, ?, '[]', 85, ?, 'active', ?)`
      ).bind(rcaId, tenantId, crypto.randomUUID(), rca.metricName, rca.status, `Metric value: ${rca.metricValue}`, now));

      for (const f of rca.factors) {
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO causal_factors (id, rca_id, tenant_id, layer, factor_type, title, description, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), rcaId, tenantId, `L${f.level}`, f.category, f.title, f.description, f.confidence, now));
      }

      for (const p of rca.prescriptions) {
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO diagnostic_prescriptions (id, rca_id, tenant_id, priority, title, description, expected_impact, effort_level, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        ).bind(crypto.randomUUID(), rcaId, tenantId, p.priority, p.title, p.description, `${p.estimatedImpact}% improvement`, p.effort, now));
      }
    }
    console.log(`[VantaX Seeder] Seeded ${rcaData.length} root cause analyses with factors and prescriptions`);

    // ── STEP: Seed V2 Catalyst Effectiveness ──
    console.log('[VantaX Seeder] Seeding V2 catalyst effectiveness...');
    const effectivenessData = [
      { subCatalystName: 'GR/IR Reconciliation', matchRate: 81.25, exceptionRate: 18.75, avgProcessingTime: 45, trend: [78.5, 79.2, 80.1, 80.8, 81.25], period: 'monthly' },
      { subCatalystName: 'Bank Reconciliation', matchRate: 68.75, exceptionRate: 31.25, avgProcessingTime: 62, trend: [75.0, 73.2, 71.5, 70.1, 68.75], period: 'monthly' },
      { subCatalystName: 'Inventory Reconciliation', matchRate: 55.6, exceptionRate: 44.4, avgProcessingTime: 38, trend: [60.0, 58.5, 57.2, 56.4, 55.6], period: 'monthly' },
      { subCatalystName: 'Sales Order Matching', matchRate: 68.75, exceptionRate: 31.25, avgProcessingTime: 52, trend: [65.0, 66.5, 67.8, 68.2, 68.75], period: 'monthly' },
      { subCatalystName: 'AP Invoice Validation', matchRate: 85.0, exceptionRate: 15.0, avgProcessingTime: 28, trend: [82.0, 83.1, 83.8, 84.5, 85.0], period: 'monthly' },
    ];
    for (const eff of effectivenessData) {
      // recovery_rate is the 0..1 fraction consumed by atheon-score and
      // executive-summary (both multiply by 100). matchRate is 0..100 so divide.
      const recoveryRate = eff.matchRate / 100;
      seedBatch.push(c.env.DB.prepare(
        `INSERT OR REPLACE INTO catalyst_effectiveness (id, tenant_id, cluster_id, sub_catalyst_name, period_start, period_end, runs_count, success_rate, avg_match_rate, avg_duration_ms, recovery_rate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, financeClusterId, eff.subCatalystName, new Date(Date.now() - 30*86400000).toISOString(), now, eff.matchRate, eff.matchRate, eff.avgProcessingTime * 1000, recoveryRate, now));
    }
    console.log(`[VantaX Seeder] Seeded ${effectivenessData.length} catalyst effectiveness records`);

    // ── STEP: Seed V2 Catalyst Dependencies ──
    console.log('[VantaX Seeder] Seeding V2 catalyst dependencies...');
    const deps = [
      { from: 'GR/IR Reconciliation', to: 'Inventory Reconciliation', type: 'data_flow', strength: 85, desc: 'GR/IR results feed into inventory valuation accuracy' },
      { from: 'Bank Reconciliation', to: 'AP Invoice Validation', type: 'sequential', strength: 70, desc: 'Bank clearing confirms AP payment completion' },
      { from: 'Sales Order Matching', to: 'Bank Reconciliation', type: 'data_flow', strength: 60, desc: 'SD billing documents create expected bank receipt entries' },
    ];
    for (const dep of deps) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO catalyst_dependencies (id, tenant_id, source_cluster_id, source_sub_catalyst, target_cluster_id, target_sub_catalyst, dependency_type, strength, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, financeClusterId, dep.from, financeClusterId, dep.to, dep.type, dep.strength, dep.desc));
    }
    console.log(`[VantaX Seeder] Seeded ${deps.length} catalyst dependencies`);

    // ── STEP: Seed V2 Catalyst Prescriptions ──
    console.log('[VantaX Seeder] Seeding V2 catalyst prescriptions...');
    const catalystPrescriptions = [
      { title: 'Automate GR scanning workflow', description: 'Implement barcode/RFID scanning at goods receipt to auto-post MIGO transactions, reducing manual entry errors by 80%.', priority: 'high', effort: 'medium', sapTransaction: 'MIGO', estimatedSavings: 850000, status: 'pending' },
      { title: 'Configure EFT auto-matching rules', description: 'Set up automatic bank statement matching rules in SAP for recurring EFT payments to reduce manual reconciliation by 60%.', priority: 'high', effort: 'low', sapTransaction: 'FF67', estimatedSavings: 420000, status: 'in_progress' },
      { title: 'Deploy cycle count program', description: 'Implement ABC-stratified cycle counting program using SAP MI21/MI04 transactions for continuous inventory accuracy improvement.', priority: 'critical', effort: 'high', sapTransaction: 'MI21', estimatedSavings: 1200000, status: 'pending' },
      { title: 'Implement tolerance groups for FX', description: 'Configure automatic posting of FX-related price differences below 3% threshold to reduce AP exception queue by 40%.', priority: 'medium', effort: 'low', sapTransaction: 'OBA3', estimatedSavings: 280000, status: 'approved' },
    ];
    for (const cp of catalystPrescriptions) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO catalyst_prescriptions (id, tenant_id, cluster_id, sub_catalyst_name, prescription_type, title, description, sap_transactions, expected_impact, effort_level, priority, status, created_at)
         VALUES (?, ?, ?, 'General', 'optimization', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, financeClusterId, cp.title, cp.description, JSON.stringify([cp.sapTransaction]), `R ${(cp.estimatedSavings / 1000).toFixed(0)}K savings`, cp.effort, cp.priority, cp.status, now));
    }
    console.log(`[VantaX Seeder] Seeded ${catalystPrescriptions.length} catalyst prescriptions`);

    // ── STEP: Seed Catalyst Runs + Items + Run Analytics ──
    // Five sub-catalyst types × six runs spread over 30 days = 30 runs total.
    // Each run gets a matching sub_catalyst_runs row (drill-through target),
    // ~10 sub_catalyst_run_items, and a catalyst_run_analytics row joined by
    // run_id. Reasoning + recommendations populated so the run-detail page
    // has substance.
    console.log('[VantaX Seeder] Seeding catalyst runs, items, and analytics (staggered over 30 days)...');
    const runArchetypes = [
      {
        clusterId: financeClusterId, subCatalystName: 'GR/IR Reconciliation',
        mode: 'reconciliation',
        baseItems: 55, baseAvgConf: 0.872, baseDurationMs: 45200,
        sourceTotalValue: 8_450_000,
        reasoning: 'Reconciled GR documents (MIGO) against invoice receipts (MIRO). 87% of items matched on 3-way agreement (PO + GR + IR amounts within 2% tolerance). 7 items raised as exceptions — 5 had GR qty < ordered qty (typical short-shipment), 2 had unit-price drift > tolerance. 2 items escalated for buyer review.',
        recommendations: [
          'Tighten PO-tolerance group for vendor LIFNR 100013 (consistent +3% price drift over last 4 runs)',
          'Investigate short-shipment pattern from logistics partner — 5 of 7 exceptions trace to same GR clerk shift',
          'Approve auto-post for items with confidence ≥0.85 (would cover 38 of the 45 matched items)',
        ],
        sapTransactions: ['MIGO', 'MIRO', 'MR11'],
        itemMaker: (i: number) => ({
          category: i < 3 ? 'GR_qty_mismatch' : 'matched',
          sourceRef: `4500-PO-${10000 + i}`, targetRef: `5100-IR-${20000 + i}`,
          sourceEntity: ['Sasol Limited','Bidvest Group','Pick n Pay','MTN Group'][i % 4],
          sourceAmount: 45000 + i * 1250, targetAmount: 45000 + i * 1250 + (i < 3 ? -2300 : 0),
          discrepancyAmount: i < 3 ? -2300 : 0,
          discrepancyReason: i < 3 ? 'Goods received quantity below PO quantity' : null,
        }),
      },
      {
        clusterId: financeClusterId, subCatalystName: 'AP Invoice Validation',
        mode: 'validation',
        baseItems: 40, baseAvgConf: 0.91, baseDurationMs: 28400,
        sourceTotalValue: 6_120_000,
        reasoning: 'Validated 40 AP invoices against PO + GR. 30 auto-approved (3-way match within tolerance, no duplicate signature, vendor in good standing). 4 raised: 3 duplicate-payment alerts (same vendor + amount + reference within 7 days), 1 vendor with expired BBBEE certificate. 1 escalated.',
        recommendations: [
          'Block vendor STCD1=8930012345 pending BBBEE re-cert (carbon tax / compliance impact)',
          'Send duplicate-detection alert to AP lead; 3 candidates require disposition before payment run',
          'Adjust auto-approve threshold from 0.90 → 0.85 to capture 4 more invoices per run',
        ],
        sapTransactions: ['FB60', 'FBL1N', 'F-44'],
        itemMaker: (i: number) => ({
          category: i === 2 || i === 5 ? 'duplicate_payment_risk' : 'matched',
          sourceRef: `INV-${30000 + i}`, targetRef: `4500-PO-${11000 + i}`,
          sourceEntity: ['Sasol Limited','Engen Petroleum','Discovery Health','Vodacom'][i % 4],
          sourceAmount: 28000 + i * 950, targetAmount: 28000 + i * 950,
          discrepancyAmount: 0,
          discrepancyReason: (i === 2 || i === 5) ? 'Possible duplicate: same vendor + amount within 7-day window' : null,
        }),
      },
      {
        clusterId: financeClusterId, subCatalystName: 'Bank Reconciliation',
        mode: 'reconciliation',
        baseItems: 80, baseAvgConf: 0.685, baseDurationMs: 62100,
        sourceTotalValue: 11_800_000,
        reasoning: 'Reconciled 80 bank statement lines (FEBEP) against open AP/AR items. 55 matched on reference + amount. 18 exceptions: 10 unmatched EFT receipts (no corresponding customer in BSID), 5 bank fees not yet posted to GL, 3 forex re-valuation differences > 2%. 4 escalated to treasury.',
        recommendations: [
          'Set up auto-matching rule for recurring EFT from "Pick n Pay Group Treasury" (8 of 10 unmatched receipts)',
          'Create journal-entry template for bank fees (expense GL 645100) to auto-clear monthly bank charges',
          'Apply FX-tolerance group to USD-denominated facility — 3 exceptions all < R12K but currently route to manual review',
        ],
        sapTransactions: ['FF67', 'F-03', 'FAGL_FC_VAL'],
        itemMaker: (i: number) => ({
          category: i % 7 === 0 ? 'unmatched_receipt' : i % 11 === 0 ? 'bank_fee_pending' : 'matched',
          sourceRef: `BS-2026-${40000 + i}`, targetRef: i % 7 === 0 ? null : `BSID-${50000 + i}`,
          sourceEntity: ['ABSA','Standard Bank','Nedbank','FNB'][i % 4],
          sourceAmount: 12000 + i * 480, targetAmount: i % 7 === 0 ? 0 : 12000 + i * 480,
          discrepancyAmount: i % 7 === 0 ? 12000 + i * 480 : 0,
          discrepancyReason: i % 7 === 0 ? 'Unmatched bank receipt — no open AR item' : null,
        }),
      },
      {
        clusterId: supplyChainClusterId, subCatalystName: 'Inventory Reconciliation',
        mode: 'reconciliation',
        baseItems: 45, baseAvgConf: 0.556, baseDurationMs: 38700,
        sourceTotalValue: 4_280_000,
        reasoning: 'Compared SAP MARD warehouse stock against ISEG physical count. Material variance detected on 15 of 45 SKUs — 10 shortages (combined R 2.45M shrinkage), 5 surpluses (likely receiving over-posting). Items 38-45 show systematic location-misposting between WH-01 and WH-02.',
        recommendations: [
          'Launch focused recount on the 10 short SKUs (combined value > R 2.4M)',
          'Audit WH-01 / WH-02 movement transfers — 5 surplus items all have transfer-in postings without matching transfer-out',
          'Tighten cycle count cadence on ABC-A items from quarterly → monthly (cost: ~16 person-hours/month)',
        ],
        sapTransactions: ['MI04', 'MI21', 'MMBE'],
        itemMaker: (i: number) => ({
          category: i < 4 ? 'shortage' : i < 7 ? 'surplus' : 'matched',
          sourceRef: `MAT-${60000 + i}`, targetRef: `COUNT-2026Q2-${i + 1}`,
          sourceEntity: 'WH-01 Cape Town',
          sourceAmount: 95000 + i * 2200, targetAmount: i < 4 ? (95000 + i * 2200) * 0.78 : i < 7 ? (95000 + i * 2200) * 1.06 : (95000 + i * 2200),
          discrepancyAmount: i < 4 ? -(95000 + i * 2200) * 0.22 : i < 7 ? (95000 + i * 2200) * 0.06 : 0,
          discrepancyReason: i < 4 ? 'Physical count below system quantity (potential shrinkage)' : i < 7 ? 'Physical count above system quantity (likely receiving over-post)' : null,
        }),
      },
      {
        clusterId: revenueClusterId, subCatalystName: 'Sales Order Matching',
        mode: 'reconciliation',
        baseItems: 32, baseAvgConf: 0.745, baseDurationMs: 52300,
        sourceTotalValue: 5_640_000,
        reasoning: 'Matched 32 sales orders (VBAK) to billing documents (VBRK) and customer receipts. 22 fully reconciled. 7 exceptions: 4 SO billed but not yet collected (within terms), 3 amount variances between SO line and bill doc > 2% (typically promotional discount applied post-creation). 2 escalated to controller.',
        recommendations: [
          'Confirm credit-note approval workflow on the 3 amount-variance items (R 142K aggregate)',
          'Customer "Pick n Pay" carries 4 of the 7 exceptions — pattern suggests their PO-amendment process is outpacing our SO updates',
          'Auto-route post-creation discounts through SD condition record VK11 to prevent VBAK/VBRK drift',
        ],
        sapTransactions: ['VA02', 'VF03', 'VK11'],
        itemMaker: (i: number) => ({
          category: i < 2 ? 'amount_variance' : i < 5 ? 'pending_collection' : 'matched',
          sourceRef: `SO-${70000 + i}`, targetRef: `VBRK-${80000 + i}`,
          sourceEntity: ['Pick n Pay','Shoprite','Clicks','Woolworths'][i % 4],
          sourceAmount: 86000 + i * 3100, targetAmount: i < 2 ? (86000 + i * 3100) * 0.97 : (86000 + i * 3100),
          discrepancyAmount: i < 2 ? -(86000 + i * 3100) * 0.03 : 0,
          discrepancyReason: i < 2 ? 'Bill doc amount lower than SO line — likely post-creation discount' : i < 5 ? 'Awaiting customer payment (within credit terms)' : null,
        }),
      },
    ];

    let totalRunsSeeded = 0;
    let totalItemsSeeded = 0;
    // Six runs per archetype at day offsets -25, -20, -15, -10, -5, 0.
    // Older runs have slightly lower match-rates so trend visualisation shows
    // the gradual improvement from baseline (48) → today (73) seen elsewhere.
    const dayOffsets = [-25, -20, -15, -10, -5, 0];
    for (const ra of runArchetypes) {
      for (let runIdx = 0; runIdx < dayOffsets.length; runIdx++) {
        const offset = dayOffsets[runIdx];
        const completedAt = new Date(Date.now() + offset * 86400000).toISOString();
        const startedAt = new Date(Date.now() + offset * 86400000 - ra.baseDurationMs).toISOString();
        // Older runs slightly worse (drift -3% per 5 days back)
        const ageFactor = 1 - (Math.abs(offset) / 25) * 0.06;
        const avgConf = Math.max(0.45, Math.min(0.99, ra.baseAvgConf * ageFactor));
        const totalItems = ra.baseItems + (runIdx * 2 - 5);  // small drift in volume
        const matched = Math.round(totalItems * avgConf);
        const exceptions = Math.max(1, Math.round(totalItems * (1 - avgConf) * 0.7));
        const escalated = Math.max(0, Math.round(exceptions * 0.3));
        const pending = totalItems - matched - exceptions - escalated;
        const autoApproved = Math.round(matched * 0.85);
        const durationMs = Math.round(ra.baseDurationMs * (1 + (Math.random() - 0.5) * 0.15));
        const minConf = Math.max(0.1, avgConf - 0.4);
        const maxConf = Math.min(0.99, avgConf + 0.08);

        const runId = crypto.randomUUID();
        const itemsInRun = Math.min(12, Math.max(5, Math.round(totalItems / 5)));

        // sub_catalyst_runs row first (FK target for items + analytics).
        // Totals on the run are derived from baseItems + the avgConf curve,
        // not summed from inserted items — keeps the seed deterministic for
        // demo screenshots without a follow-up UPDATE.
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, triggered_by, started_at, completed_at, duration_ms, data_sources_used, source_record_count, target_record_count, status, mode, matched, unmatched_source, unmatched_target, discrepancies, exceptions_raised, avg_confidence, min_confidence, max_confidence, reasoning, recommendations, total_source_value, total_matched_value, total_discrepancy_value, total_exception_value, items_total, sign_off_status, created_at)
           VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          runId, tenantId, ra.clusterId, ra.subCatalystName, runIdx + 1,
          startedAt, completedAt, durationMs,
          JSON.stringify(ra.sapTransactions), totalItems, totalItems,
          ra.mode, matched, totalItems - matched, 0, exceptions, exceptions,
          avgConf, minConf, maxConf,
          ra.reasoning, JSON.stringify(ra.recommendations),
          ra.sourceTotalValue, ra.sourceTotalValue * avgConf, ra.sourceTotalValue * 0.05, ra.sourceTotalValue * 0.02,
          itemsInRun,
          runIdx === dayOffsets.length - 1 ? 'open' : 'signed_off',
          completedAt,
        ));
        totalRunsSeeded += 1;

        // sub_catalyst_run_items — synthesise itemsInRun records mixing
        // matched / exception / discrepancy statuses so the detail table has
        // shape across multiple categories.
        for (let i = 0; i < itemsInRun; i++) {
          const itemConf = Math.max(0.1, Math.min(0.99, avgConf + (Math.random() - 0.5) * 0.3));
          const built = ra.itemMaker(i);
          const isException = built.category !== 'matched';
          seedBatch.push(c.env.DB.prepare(
            `INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, category, source_ref, source_date, source_entity, source_amount, source_currency, target_ref, target_date, target_entity, target_amount, target_currency, match_confidence, match_method, discrepancy_amount, discrepancy_reason, exception_type, exception_severity, review_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, ?, ?, ?, 'ZAR', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(), runId, tenantId, i + 1,
            isException ? 'exception' : 'matched',
            built.category,
            built.sourceRef, completedAt, built.sourceEntity, built.sourceAmount,
            built.targetRef, completedAt, built.sourceEntity, built.targetAmount,
            itemConf,
            isException ? 'fuzzy_match' : 'exact_match',
            built.discrepancyAmount, built.discrepancyReason,
            isException ? built.category : null,
            isException ? (Math.abs(built.discrepancyAmount || 0) > 50000 ? 'high' : 'medium') : null,
            'pending',
            completedAt,
          ));
          totalItemsSeeded += 1;
        }

        // catalyst_run_analytics row joined by run_id
        const dist: Record<string, number> = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
        if (avgConf > 0.8) { dist['80-100'] = Math.round(totalItems * 0.6); dist['60-80'] = Math.round(totalItems * 0.25); dist['40-60'] = Math.round(totalItems * 0.1); dist['20-40'] = Math.round(totalItems * 0.03); dist['0-20'] = Math.round(totalItems * 0.02); }
        else if (avgConf > 0.6) { dist['80-100'] = Math.round(totalItems * 0.3); dist['60-80'] = Math.round(totalItems * 0.35); dist['40-60'] = Math.round(totalItems * 0.2); dist['20-40'] = Math.round(totalItems * 0.1); dist['0-20'] = Math.round(totalItems * 0.05); }
        else { dist['80-100'] = Math.round(totalItems * 0.15); dist['60-80'] = Math.round(totalItems * 0.2); dist['40-60'] = Math.round(totalItems * 0.3); dist['20-40'] = Math.round(totalItems * 0.2); dist['0-20'] = Math.round(totalItems * 0.15); }

        const insights = [
          avgConf >= 0.8 ? `High overall confidence (${(avgConf * 100).toFixed(0)}%) — most items processed automatically.` : avgConf >= 0.6 ? `Moderate confidence (${(avgConf * 100).toFixed(0)}%) — review exception patterns for automation opportunities.` : `Low overall confidence (${(avgConf * 100).toFixed(0)}%) — consider reviewing data quality or mappings.`,
          `${Math.round((autoApproved / totalItems) * 100)}% auto-approved.`,
          escalated > 0 ? `${escalated} item(s) escalated for human review.` : 'No items escalated.',
        ];

        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO catalyst_run_analytics (id, tenant_id, cluster_id, sub_catalyst_name, run_id, started_at, completed_at, duration_ms, total_items, completed_items, exception_items, escalated_items, pending_items, auto_approved_items, avg_confidence, min_confidence, max_confidence, confidence_distribution, status, insights) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
        ).bind(
          crypto.randomUUID(), tenantId, ra.clusterId, ra.subCatalystName, runId,
          startedAt, completedAt, durationMs, totalItems, matched, exceptions, escalated, pending, autoApproved,
          avgConf, minConf, maxConf, JSON.stringify(dist), JSON.stringify(insights),
        ));
      }
    }
    console.log(`[VantaX Seeder] Seeded ${totalRunsSeeded} catalyst runs with ${totalItemsSeeded} items across 30 days`);

    // ── STEP: Seed §11.7 Atheon Score History ──
    console.log('[VantaX Seeder] Seeding §11 Atheon Score history...');
    const scoreMonths = [
      { offset: -5, score: 52 }, { offset: -4, score: 56 }, { offset: -3, score: 61 },
      { offset: -2, score: 65 }, { offset: -1, score: 69 }, { offset: 0, score: 73 },
    ];
    for (const sm of scoreMonths) {
      const d = new Date(); d.setMonth(d.getMonth() + sm.offset);
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO atheon_score_history (id, tenant_id, score, components, recorded_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, sm.score,
        JSON.stringify([
          { name: 'Health', weight: 30, score: sm.score + 5 },
          { name: 'ROI', weight: 20, score: sm.score - 3 },
          { name: 'Diagnostic Resolution', weight: 20, score: sm.score + 2 },
          { name: 'Strategic Awareness', weight: 15, score: sm.score - 1 },
          { name: 'Catalyst Effectiveness', weight: 15, score: sm.score + 1 },
        ]),
        d.toISOString()
      ));
    }
    console.log('[VantaX Seeder] Seeded 6 Atheon Score history records');

    // ── STEP: Seed §11.2 Baseline Snapshots ──
    console.log('[VantaX Seeder] Seeding §11 baseline snapshots...');
    const baselineDate = new Date(); baselineDate.setMonth(baselineDate.getMonth() - 5);
    seedBatch.push(c.env.DB.prepare(
      `INSERT INTO baseline_snapshots (id, tenant_id, snapshot_type, health_score, dimensions, metric_count_green, metric_count_amber, metric_count_red, total_discrepancy_value, total_process_conformance, avg_catalyst_success_rate, roi_at_snapshot, captured_at) VALUES (?, ?, 'day_zero', 48, ?, 3, 5, 4, 2450000, 62.5, 45.0, 0, ?)`
    ).bind(crypto.randomUUID(), tenantId,
      JSON.stringify({ finance: 45, operations: 52, compliance: 38, revenue: 55, supply_chain: 50 }),
      baselineDate.toISOString()
    ));
    seedBatch.push(c.env.DB.prepare(
      `INSERT INTO baseline_snapshots (id, tenant_id, snapshot_type, health_score, dimensions, metric_count_green, metric_count_amber, metric_count_red, total_discrepancy_value, total_process_conformance, avg_catalyst_success_rate, roi_at_snapshot, captured_at) VALUES (?, ?, 'manual', 73, ?, 7, 3, 2, 850000, 81.3, 72.0, 4850000, ?)`
    ).bind(crypto.randomUUID(), tenantId,
      JSON.stringify({ finance: 75, operations: 71, compliance: 68, revenue: 78, supply_chain: 73 }),
      now
    ));
    console.log('[VantaX Seeder] Seeded 2 baseline snapshots (day_zero + current)');

    // ── STEP: Seed §11.3 Health Targets ──
    console.log('[VantaX Seeder] Seeding §11 health targets...');
    const targetData = [
      { type: 'health_score', name: 'Overall Health to 85', value: 85, deadline: '+3m' },
      { type: 'metric_green_count', name: '10 Green Metrics', value: 10, deadline: '+2m' },
      { type: 'discrepancy_reduction', name: 'Discrepancy < R500k', value: 500000, deadline: '+4m' },
      { type: 'roi_multiple', name: 'ROI > 10x', value: 10, deadline: '+6m' },
    ];
    for (const t of targetData) {
      const dl = new Date(); dl.setMonth(dl.getMonth() + parseInt(t.deadline));
      seedBatch.push(c.env.DB.prepare(
        `INSERT OR REPLACE INTO health_targets (id, tenant_id, target_type, target_name, target_value, target_deadline, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`
      ).bind(crypto.randomUUID(), tenantId, t.type, t.name, t.value, dl.toISOString().split('T')[0]));
    }
    console.log('[VantaX Seeder] Seeded 4 health targets');

    // ── STEP: Seed §11.4 Anonymised Benchmarks ──
    console.log('[VantaX Seeder] Seeding §11 anonymised benchmarks...');
    const benchDimensions = ['finance', 'operations', 'compliance', 'revenue', 'supply_chain'];
    for (const dim of benchDimensions) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT OR REPLACE INTO anonymised_benchmarks (id, industry, dimension, period, tenant_count, avg_score, p25_score, p50_score, p75_score, min_score, max_score) VALUES (?, 'manufacturing', ?, '2026-Q1', 8, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), dim,
        55 + Math.round(Math.random() * 15),
        40 + Math.round(Math.random() * 10),
        52 + Math.round(Math.random() * 10),
        65 + Math.round(Math.random() * 10),
        25 + Math.round(Math.random() * 10),
        80 + Math.round(Math.random() * 15),
      ));
    }
    console.log('[VantaX Seeder] Seeded 5 anonymised benchmarks');

    // ── STEP: Seed §11.6 Resolution Patterns ──
    console.log('[VantaX Seeder] Seeding §11 resolution patterns...');
    const resPatterns = [
      { sig: 'invoice_mismatch_vendor_master', count: 12, days: 4.2, value: 185000, fixes: ['vendor_master_update', 'automated_matching_rule', 'tolerance_adjustment'] },
      { sig: 'bank_fee_unallocated', count: 8, days: 2.1, value: 45000, fixes: ['fee_category_mapping', 'auto_allocation_rule'] },
      { sig: 'inventory_shrinkage_warehouse', count: 6, days: 7.5, value: 320000, fixes: ['cycle_count_increase', 'access_control_review', 'cctv_monitoring'] },
      { sig: 'po_price_variance_commodity', count: 15, days: 3.8, value: 420000, fixes: ['contract_price_lock', 'hedging_strategy', 'supplier_negotiation'] },
      { sig: 'sales_order_credit_block', count: 9, days: 1.5, value: 95000, fixes: ['credit_limit_review', 'payment_terms_update'] },
    ];
    for (const rp of resPatterns) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT OR REPLACE INTO resolution_patterns (id, industry, pattern_signature, resolution_count, avg_resolution_days, avg_value_recovered, common_fix_types, last_updated) VALUES (?, 'manufacturing', ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), rp.sig, rp.count, rp.days, rp.value, JSON.stringify(rp.fixes), now));
    }
    console.log('[VantaX Seeder] Seeded 5 resolution patterns');

    // ── STEP: Seed V2 ROI Tracking ──
    // Must also seed `tenant_settings.licence_cost_annual` because
    // `calculateROI` (cron + /roi/export) reads the cost from there, not
    // from roi_tracking. Without it the cron overwrites this seeded row
    // with roi_multiple=0 the next time it fires, tanking the Atheon Score.
    console.log('[VantaX Seeder] Seeding V2 ROI tracking...');
    seedBatch.push(c.env.DB.prepare(
      `INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (?, ?, 'licence_cost_annual', '580000', ?)`
    ).bind(crypto.randomUUID(), tenantId, now));
    seedBatch.push(c.env.DB.prepare(
      `INSERT OR REPLACE INTO roi_tracking (id, tenant_id, period, total_discrepancy_value_identified, total_discrepancy_value_recovered, total_downstream_losses_prevented, total_person_hours_saved, licence_cost_annual, roi_multiple, calculated_at)
       VALUES (?, ?, 'Q1 2026', 4850000, 3200000, 1800000, 2400, 580000, 8.3, ?)`
    ).bind(crypto.randomUUID(), tenantId, now));
    console.log('[VantaX Seeder] Seeded ROI tracking record + tenant_settings.licence_cost_annual');

    // ── STEP: Seed Industry Playbook Seeds ──
    console.log('[VantaX Seeder] Seeding industry playbook seeds...');
    const industrySeeds = [
      // General
      { industry: 'general', type: 'signal', title: 'Interest Rate Change', description: 'Central bank rate adjustment impacting borrowing costs', severity: 'high', category: 'financial' },
      { industry: 'general', type: 'signal', title: 'Currency Fluctuation', description: 'Significant exchange rate movement affecting import/export costs', severity: 'high', category: 'financial' },
      { industry: 'general', type: 'signal', title: 'Regulatory Change', description: 'New regulation or policy change affecting business operations', severity: 'medium', category: 'compliance' },
      { industry: 'general', type: 'signal', title: 'Technology Disruption', description: 'Emerging technology that may impact current business model', severity: 'medium', category: 'technology' },
      // FMCG
      { industry: 'fmcg', type: 'signal', title: 'Consumer Sentiment Shift', description: 'Change in consumer spending patterns or preferences', severity: 'high', category: 'market' },
      { industry: 'fmcg', type: 'signal', title: 'Commodity Price Spike', description: 'Raw material cost increase affecting product margins', severity: 'critical', category: 'financial' },
      { industry: 'fmcg', type: 'signal', title: 'Retail Channel Disruption', description: 'Major retailer policy change or new channel emergence', severity: 'medium', category: 'market' },
      { industry: 'fmcg', type: 'signal', title: 'Food Safety Regulation', description: 'New food safety or labelling requirement', severity: 'high', category: 'compliance' },
      { industry: 'fmcg', type: 'benchmark', name: 'Shelf Availability Rate', value: 96.5, unit: '%', source: 'Nielsen SA Retail' },
      { industry: 'fmcg', type: 'benchmark', name: 'Distribution Coverage', value: 85.0, unit: '%', source: 'CGCSA Industry Report' },
      { industry: 'fmcg', type: 'benchmark', name: 'Demand Forecast Accuracy', value: 78.0, unit: '%', source: 'FMI SA Benchmarks' },
      { industry: 'fmcg', type: 'regulatory', title: 'Sugar Tax Adjustment', body: 'Health Promotion Levy rate adjustment for sugar-sweetened beverages', authority: 'SARS' },
      // Mining
      { industry: 'mining', type: 'signal', title: 'Commodity Price Movement', description: 'Significant change in key mineral commodity prices', severity: 'critical', category: 'financial' },
      { industry: 'mining', type: 'signal', title: 'Safety Incident Alert', description: 'Industry safety incident requiring operational review', severity: 'critical', category: 'operational' },
      { industry: 'mining', type: 'signal', title: 'Mining Charter Update', description: 'Amendment to Mining Charter or MPRDA regulations', severity: 'high', category: 'compliance' },
      { industry: 'mining', type: 'signal', title: 'Water Restriction Notice', description: 'Water use licence or restriction affecting mining operations', severity: 'high', category: 'environmental' },
      { industry: 'mining', type: 'benchmark', name: 'Lost Time Injury Rate', value: 0.5, unit: 'per Mhrs', source: 'Minerals Council SA' },
      { industry: 'mining', type: 'benchmark', name: 'Recovery Rate', value: 92.0, unit: '%', source: 'Chamber of Mines' },
      { industry: 'mining', type: 'regulatory', title: 'DMR Compliance Audit', body: 'Department of Mineral Resources scheduled compliance audit', authority: 'DMR' },
      { industry: 'mining', type: 'regulatory', title: 'Environmental Impact Assessment', body: 'EIA review for mining license renewal', authority: 'DFFE' },
      // Healthcare
      { industry: 'healthcare', type: 'signal', title: 'NHI Implementation Phase', description: 'National Health Insurance implementation milestone', severity: 'critical', category: 'regulatory' },
      { industry: 'healthcare', type: 'signal', title: 'Medical Aid Contribution Increase', description: 'Annual medical aid contribution rate adjustment', severity: 'medium', category: 'financial' },
      { industry: 'healthcare', type: 'benchmark', name: 'Bed Occupancy Rate', value: 75.0, unit: '%', source: 'CMS Annual Report' },
      { industry: 'healthcare', type: 'benchmark', name: 'Average Length of Stay', value: 3.2, unit: 'days', source: 'HASA Benchmarks' },
      { industry: 'healthcare', type: 'regulatory', title: 'SAHPRA Registration', body: 'Medical device or pharmaceutical registration requirement', authority: 'SAHPRA' },
      { industry: 'healthcare', type: 'regulatory', title: 'CMS PMB Update', body: 'Prescribed Minimum Benefits list update by Council for Medical Schemes', authority: 'CMS' },
      // Manufacturing
      { industry: 'manufacturing', type: 'signal', title: 'Load Shedding Stage Change', description: 'Eskom load shedding schedule change affecting production', severity: 'critical', category: 'operational' },
      { industry: 'manufacturing', type: 'signal', title: 'Steel/Material Price Change', description: 'Significant input material price movement', severity: 'high', category: 'financial' },
      { industry: 'manufacturing', type: 'benchmark', name: 'Overall Equipment Effectiveness', value: 85.0, unit: '%', source: 'SEIFSA Industry Report' },
      { industry: 'manufacturing', type: 'benchmark', name: 'Scrap Rate', value: 2.5, unit: '%', source: 'Manufacturing Circle SA' },
      { industry: 'manufacturing', type: 'regulatory', title: 'NRCS Product Compliance', body: 'National Regulator for Compulsory Specifications product compliance requirement', authority: 'NRCS' },
      { industry: 'manufacturing', type: 'regulatory', title: 'OHS Act Audit', body: 'Occupational Health and Safety compliance audit', authority: 'DoEL' },
    ];

    for (const seed of industrySeeds) {
      if (seed.type === 'signal') {
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO industry_radar_seeds (id, industry, category, title, summary, default_magnitude, default_direction, region)
           VALUES (?, ?, ?, ?, ?, 5, 'headwind', 'ZA')`
        ).bind(crypto.randomUUID(), seed.industry, seed.category || 'general', seed.title, seed.description || ''));
      } else if (seed.type === 'benchmark') {
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO industry_benchmark_seeds (id, industry, metric_name, benchmark_value, benchmark_unit, source, region)
           VALUES (?, ?, ?, ?, ?, ?, 'ZA')`
        ).bind(crypto.randomUUID(), seed.industry, (seed as Record<string, unknown>).name, (seed as Record<string, unknown>).value, (seed as Record<string, unknown>).unit, (seed as Record<string, unknown>).source));
      } else if (seed.type === 'regulatory') {
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO industry_regulatory_seeds (id, industry, title, description, jurisdiction)
           VALUES (?, ?, ?, ?, 'ZA')`
        ).bind(crypto.randomUUID(), seed.industry, seed.title, (seed as Record<string, unknown>).body || ''));
      }
    }
    console.log('[VantaX Seeder] Seeded industry playbook seeds');

    // ── Value Assessment Engine Seed Data ─────────────────────────────
    // Create a completed value assessment with realistic findings
    const vaAssessmentId = `va-demo-${tenantId.slice(0, 8)}`;

    // Clean up any existing value assessment data
    for (const vaTable of ['assessment_value_summary', 'assessment_process_timing', 'assessment_data_quality', 'assessment_findings', 'assessment_runs']) {
      try { seedBatch.push(c.env.DB.prepare(`DELETE FROM ${vaTable} WHERE tenant_id = ?`).bind(tenantId)); } catch { /* table may not exist */ }
    }
    try { seedBatch.push(c.env.DB.prepare(`DELETE FROM assessments WHERE tenant_id = ? AND id LIKE 'va-demo-%'`).bind(tenantId)); } catch { /* ignore */ }

    // Create the assessment record
    try {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, erp_connection_id, status, config, created_by, completed_at)
         VALUES (?, ?, 'VantaX (Pty) Ltd', 'technology', ?, 'complete', '{"mode":"full","outcomeFeePercent":20}', 'system', datetime('now'))`
      ).bind(vaAssessmentId, tenantId, connectionId));
    } catch { /* may exist */ }

    // Assessment runs (4 domains)
    const vaRunDomains = [
      { id: `va-run-fin-${tenantId.slice(0,6)}`, domain: 'finance', status: 'complete', findingsCount: 6, immediateValue: 342000, ongoingValue: 28500 },
      { id: `va-run-proc-${tenantId.slice(0,6)}`, domain: 'procurement', status: 'complete', findingsCount: 5, immediateValue: 215000, ongoingValue: 38000 },
      { id: `va-run-wf-${tenantId.slice(0,6)}`, domain: 'workforce', status: 'complete', findingsCount: 3, immediateValue: 78000, ongoingValue: 15500 },
      { id: `va-run-sc-${tenantId.slice(0,6)}`, domain: 'supply_chain', status: 'complete', findingsCount: 4, immediateValue: 145000, ongoingValue: 23000 },
    ];
    for (const run of vaRunDomains) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO assessment_runs (id, assessment_id, tenant_id, cluster_name, sub_catalyst_name, domain, status, source_record_count, discrepancies, total_source_value, total_discrepancy_value, findings, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'value_assessment', ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hour'))`
      ).bind(run.id, vaAssessmentId, tenantId, run.domain, run.domain, run.status, run.findingsCount, run.findingsCount, run.immediateValue + run.ongoingValue, run.immediateValue, JSON.stringify({ immediateValue: run.immediateValue, ongoingMonthlyValue: run.ongoingValue })));
    }

    // Assessment findings (18 specific, evidence-backed findings)
    const vaFindings = [
      // Finance findings
      { runId: vaRunDomains[0].id, type: 'discrepancy', severity: 'critical', title: 'Invoice #INV-2024-1847 — R47,200 payment terms mismatch', desc: 'SAP payment terms show Net-30 but bank settlement occurred at Net-67. The 37-day overshoot on this single transaction cost R47,200 in working capital.', affected: 1, impact: 47200, category: 'payment_terms', immediate: 47200, ongoing: 3900, domain: 'finance', evidence: { sample_records: [{ ref: 'Invoice #INV-2024-1847', source_value: 'Net-30 (SAP)', target_value: 'Settled Day 67', difference: 47200 }], pattern: 'Late payment on high-value invoices', first_occurrence: '2024-08-15', frequency: 'Monthly' }, rootCause: 'Manual AP approval queue with no escalation for overdue items.', prescription: 'Implement automated payment terms enforcement with escalation rules.' },
      { runId: vaRunDomains[0].id, type: 'data_quality', severity: 'critical', title: '23 overdue invoices worth R218,400 — no collection follow-up', desc: '23 invoices are past their due date with no systematic follow-up. Total outstanding: R218,400. Average days overdue: 42.', affected: 23, impact: 218400, category: 'data_issue', immediate: 65520, ongoing: 4368, domain: 'finance', evidence: { sample_records: [{ ref: 'INV-2024-0892', source_value: 'Due: 2024-06-15', target_value: 'Unpaid', difference: 34200 }, { ref: 'INV-2024-1103', source_value: 'Due: 2024-07-22', target_value: 'Unpaid', difference: 28700 }, { ref: 'INV-2024-1456', source_value: 'Due: 2024-08-01', target_value: 'Unpaid', difference: 19800 }], pattern: 'Overdue accounts receivable', first_occurrence: '2024-06-15', frequency: 'Ongoing' }, rootCause: 'No automated AR aging alerts. Manual collection process misses follow-ups.', prescription: 'Deploy automated AR collection catalyst with aging bucket escalation.' },
      { runId: vaRunDomains[0].id, type: 'discrepancy', severity: 'high', title: '8 potential duplicate payments totalling R89,600', desc: '8 instances of identical payment amounts processed on the same day to the same vendor. Potential duplicate payments worth R89,600.', affected: 8, impact: 89600, category: 'duplicate_payment', immediate: 89600, ongoing: 7467, domain: 'finance', evidence: { sample_records: [{ ref: 'PAY-2024-0445', source_value: 'R18,500 to Supplier A', target_value: 'R18,500 same day', difference: 18500 }, { ref: 'PAY-2024-0612', source_value: 'R15,200 to Supplier C', target_value: 'R15,200 same day', difference: 15200 }], pattern: 'Same amount, same vendor, same day', first_occurrence: '2024-05-20', frequency: 'Monthly' }, rootCause: 'No duplicate payment detection in AP workflow. Manual bank reconciliation misses these.', prescription: 'Enable real-time duplicate payment detection with vendor + amount + date matching.' },
      { runId: vaRunDomains[0].id, type: 'exception', severity: 'high', title: '14 GL journal entries without proper authorization', desc: '14 journal entries posted without the required dual authorization. Total value: R156,000. These entries bypass the segregation of duties control.', affected: 14, impact: 156000, category: 'compliance', immediate: 0, ongoing: 5000, domain: 'finance', evidence: { sample_records: [{ ref: 'JE-2024-0234', source_value: 'Posted by: user_a', target_value: 'Approved by: user_a (same)', difference: 42000 }, { ref: 'JE-2024-0567', source_value: 'Posted by: user_b', target_value: 'No approval', difference: 28000 }], pattern: 'Missing dual authorization', first_occurrence: '2024-04-10', frequency: 'Weekly' }, rootCause: 'SAP workflow rules allow posting without second approval for amounts under R50k.', prescription: 'Enforce dual authorization for all JE amounts above R10k.' },
      { runId: vaRunDomains[0].id, type: 'risk', severity: 'medium', title: '5 vendor master records with mismatched bank details', desc: '5 vendors have bank account details that differ between SAP master data and last payment instruction. Fraud risk indicator.', affected: 5, impact: 67000, category: 'fraud_risk', immediate: 0, ongoing: 2800, domain: 'finance', evidence: { sample_records: [{ ref: 'Vendor LFA1-V001', source_value: 'Bank: ABSA 1234', target_value: 'Payment to: FNB 5678', difference: 24500 }], pattern: 'Bank detail mismatch', first_occurrence: '2024-07-01', frequency: 'Quarterly' }, rootCause: 'Vendor bank detail changes not triggering verification workflow.', prescription: 'Implement vendor bank change verification with dual approval and confirmation letter.' },
      { runId: vaRunDomains[0].id, type: 'data_quality', severity: 'medium', title: 'R12,300 in unmatched bank transactions (15 records)', desc: '15 bank transactions worth R12,300 cannot be matched to any GL posting. These need manual investigation and reconciliation.', affected: 15, impact: 12300, category: 'reconciliation', immediate: 12300, ongoing: 1025, domain: 'finance', evidence: { sample_records: [{ ref: 'BNK-2024-0891', source_value: 'R4,200 credit', target_value: 'No GL match', difference: 4200 }, { ref: 'BNK-2024-0923', source_value: 'R2,800 debit', target_value: 'No GL match', difference: 2800 }], pattern: 'Unmatched bank transactions', first_occurrence: '2024-03-01', frequency: 'Monthly' }, rootCause: 'Automated bank reconciliation only matches exact amounts. Partial payments and fees remain unmatched.', prescription: 'Implement fuzzy matching with tolerance rules for bank fees and partial payments.' },
      // Procurement findings
      { runId: vaRunDomains[1].id, type: 'data_quality', severity: 'critical', title: '12 stale POs locking R345,000 in committed budget', desc: '12 purchase orders have been open for more than 90 days without goods receipt. This locks R345,000 in committed budget that may never be utilized.', affected: 12, impact: 345000, category: 'process_issue', immediate: 51750, ongoing: 8625, domain: 'procurement', evidence: { sample_records: [{ ref: 'PO #4500001234', source_value: 'Opened: 2024-03-15', target_value: 'Still open (180+ days)', difference: 67000 }, { ref: 'PO #4500001456', source_value: 'Opened: 2024-04-02', target_value: 'Still open (165 days)', difference: 52000 }], pattern: 'Stale POs with no goods receipt', first_occurrence: '2024-03-15', frequency: 'Accumulated' }, rootCause: 'No automated stale PO review process. Buyers do not close POs after project completion.', prescription: 'Implement automated PO lifecycle management with 60-day alerts and 90-day auto-close.' },
      { runId: vaRunDomains[1].id, type: 'discrepancy', severity: 'high', title: 'GR/IR price variances on 7 POs worth R28,400', desc: '7 purchase orders show goods receipt amounts that differ from invoice amounts. Total variance: R28,400. These indicate potential pricing errors or unauthorized changes.', affected: 7, impact: 28400, category: 'price_variance', immediate: 28400, ongoing: 4733, domain: 'procurement', evidence: { sample_records: [{ ref: 'PO #4500002345', source_value: 'GR: R45,200', target_value: 'IR: R49,800', difference: 4600 }, { ref: 'PO #4500002567', source_value: 'GR: R32,100', target_value: 'IR: R35,700', difference: 3600 }], pattern: 'GR/IR mismatch above 5% tolerance', first_occurrence: '2024-05-01', frequency: 'Monthly' }, rootCause: 'No automated 3-way match validation. Price changes between order and invoice not flagged.', prescription: 'Deploy automated 3-way match with configurable tolerance thresholds.' },
      { runId: vaRunDomains[1].id, type: 'exception', severity: 'high', title: '6 POs with inactive supplier codes — R89,000 at risk', desc: '6 active purchase orders reference suppliers marked as inactive in SAP master data. Combined value: R89,000.', affected: 6, impact: 89000, category: 'supplier_risk', immediate: 0, ongoing: 7417, domain: 'procurement', evidence: { sample_records: [{ ref: 'PO #4500003456 → V-INACTIVE-01', source_value: 'Supplier status: Blocked', target_value: 'PO status: Open', difference: 34000 }, { ref: 'PO #4500003567 → V-INACTIVE-03', source_value: 'Supplier status: Marked for deletion', target_value: 'PO status: Open', difference: 22000 }], pattern: 'Active PO referencing inactive vendor', first_occurrence: '2024-06-01', frequency: 'Quarterly' }, rootCause: 'Supplier deactivation process does not check for open POs. No link between vendor master and procurement.', prescription: 'Implement supplier lifecycle checks — block new POs for inactive vendors, flag existing open POs.' },
      { runId: vaRunDomains[1].id, type: 'data_quality', severity: 'medium', title: '4 duplicate PO numbers detected', desc: '4 PO numbers appear more than once in the system, indicating potential duplicate ordering or data entry errors.', affected: 4, impact: 18000, category: 'data_issue', immediate: 18000, ongoing: 1500, domain: 'procurement', evidence: { sample_records: [{ ref: 'PO #4500004567', source_value: '2 entries', target_value: 'Should be 1', difference: 8500 }], pattern: 'Duplicate PO numbers', first_occurrence: '2024-07-10', frequency: 'Occasional' }, rootCause: 'Manual PO creation allows duplicate numbers when SAP number range is exhausted.', prescription: 'Enforce unique PO number validation at creation time.' },
      { runId: vaRunDomains[1].id, type: 'process_delay', severity: 'medium', title: 'Average Procure-to-Pay cycle 18.3 days vs 12-day benchmark', desc: 'The P2P cycle is 52% slower than the industry benchmark. R134,600 in open POs would benefit from faster processing.', affected: 80, impact: 134600, category: 'process_issue', immediate: 20190, ongoing: 6730, domain: 'procurement', evidence: { sample_records: [{ ref: 'P2P cycle analysis', source_value: '18.3 days avg', target_value: '12 days benchmark', difference: 6.3 }], pattern: 'Slow procurement cycle', first_occurrence: '2024-01-01', frequency: 'Ongoing' }, rootCause: 'Manual approval routing with no SLA enforcement. Average approval wait: 4.2 days.', prescription: 'Implement automated approval routing with SLA escalation and parallel approvals.' },
      // Workforce findings
      { runId: vaRunDomains[2].id, type: 'data_quality', severity: 'high', title: '8 employees with missing department or cost centre', desc: '8 employee records have blank department or cost centre fields, preventing accurate labour cost allocation.', affected: 8, impact: 42000, category: 'data_issue', immediate: 42000, ongoing: 3500, domain: 'workforce', evidence: { sample_records: [{ ref: 'EMP-1045', source_value: 'Dept: (blank)', target_value: 'Cost Centre: (blank)', difference: 8500 }, { ref: 'EMP-1078', source_value: 'Dept: (blank)', target_value: 'Cost Centre: CC-4400', difference: 6200 }], pattern: 'Missing HR master data', first_occurrence: '2024-01-15', frequency: 'Ongoing' }, rootCause: 'Onboarding process does not enforce mandatory department and cost centre assignment.', prescription: 'Add mandatory field validation to employee onboarding workflow.' },
      { runId: vaRunDomains[2].id, type: 'exception', severity: 'medium', title: '3 salary outliers — payments 3x above department average', desc: '3 employees received payments more than 3 standard deviations above their department average. Could indicate overpayment or miscategorisation.', affected: 3, impact: 24000, category: 'payroll_anomaly', immediate: 24000, ongoing: 6000, domain: 'workforce', evidence: { sample_records: [{ ref: 'EMP-1023', source_value: 'Salary: R85,000', target_value: 'Dept avg: R28,000', difference: 57000 }], pattern: 'Salary outlier detection', first_occurrence: '2024-04-01', frequency: 'Monthly' }, rootCause: 'No automated salary band validation. New hires can be assigned to wrong pay grade.', prescription: 'Implement salary band validation against department and role benchmarks.' },
      { runId: vaRunDomains[2].id, type: 'risk', severity: 'medium', title: 'Termination processing delay — avg 8.5 days', desc: 'Average time from termination date to system access revocation is 8.5 days. 2 terminated employees still have active SAP access.', affected: 2, impact: 12000, category: 'security_risk', immediate: 12000, ongoing: 6000, domain: 'workforce', evidence: { sample_records: [{ ref: 'EMP-0987 (terminated)', source_value: 'Term date: 2024-08-15', target_value: 'SAP access: Active', difference: 0 }], pattern: 'Delayed access revocation', first_occurrence: '2024-08-15', frequency: 'Per termination' }, rootCause: 'IT access revocation is manual and disconnected from HR termination process.', prescription: 'Automate SAP access deprovisioning triggered by HR termination workflow.' },
      // Supply Chain findings
      { runId: vaRunDomains[3].id, type: 'discrepancy', severity: 'critical', title: 'Inventory variance: 4 items with shrinkage worth R67,800', desc: '4 products show system stock exceeding physical count. Total shrinkage value: R67,800. Indicates theft, damage, or counting errors.', affected: 4, impact: 67800, category: 'inventory_variance', immediate: 67800, ongoing: 5650, domain: 'supply_chain', evidence: { sample_records: [{ ref: 'MAT-PRD-007 (Wireless Router)', source_value: 'System: 150', target_value: 'Physical: 122', difference: 23800 }, { ref: 'MAT-PRD-012 (UPS Battery)', source_value: 'System: 85', target_value: 'Physical: 68', difference: 18700 }], pattern: 'System > Physical (shrinkage)', first_occurrence: '2024-06-30', frequency: 'Quarterly count' }, rootCause: 'Warehouse goods issue not posted in real-time. Cycle counts only quarterly.', prescription: 'Implement barcode-based real-time goods movement posting and monthly cycle counts for high-value items.' },
      { runId: vaRunDomains[3].id, type: 'data_quality', severity: 'high', title: '6 products with zero cost price in SAP', desc: '6 products have a cost price of R0.00 in SAP material master. This causes incorrect COGS calculations and margin reporting.', affected: 6, impact: 34000, category: 'data_issue', immediate: 34000, ongoing: 2833, domain: 'supply_chain', evidence: { sample_records: [{ ref: 'MAT-PRD-003', source_value: 'Cost: R0.00', target_value: 'Selling: R2,450', difference: 2450 }, { ref: 'MAT-PRD-009', source_value: 'Cost: R0.00', target_value: 'Selling: R890', difference: 890 }], pattern: 'Zero cost price in material master', first_occurrence: '2024-02-01', frequency: 'Ongoing' }, rootCause: 'Material master creation allows saving without cost price. No validation on financial fields.', prescription: 'Enforce mandatory cost price entry in material master creation workflow.' },
      { runId: vaRunDomains[3].id, type: 'process_delay', severity: 'high', title: 'Order-to-Cash cycle 28.5 days vs 21-day benchmark', desc: 'O2C cycle is 36% above industry benchmark. Delayed billing reduces cash flow by an estimated R45,000 per month.', affected: 72, impact: 45000, category: 'process_issue', immediate: 0, ongoing: 9000, domain: 'supply_chain', evidence: { sample_records: [{ ref: 'O2C cycle analysis', source_value: '28.5 days avg', target_value: '21 days benchmark', difference: 7.5 }], pattern: 'Slow order-to-cash cycle', first_occurrence: '2024-01-01', frequency: 'Ongoing' }, rootCause: 'Manual delivery confirmation and invoice creation. Average 5-day gap between delivery and billing.', prescription: 'Automate billing document creation triggered by goods issue posting.' },
      { runId: vaRunDomains[3].id, type: 'data_quality', severity: 'medium', title: '3 dead stock items worth R23,400 — no movement in 180+ days', desc: '3 inventory items have had zero movement for over 180 days. Carrying cost and potential write-off: R23,400.', affected: 3, impact: 23400, category: 'dead_stock', immediate: 23400, ongoing: 1950, domain: 'supply_chain', evidence: { sample_records: [{ ref: 'MAT-PRD-015', source_value: 'Last movement: 2024-01-20', target_value: 'Value: R12,600', difference: 12600 }], pattern: 'No movement > 180 days', first_occurrence: '2024-01-20', frequency: 'Review quarterly' }, rootCause: 'No slow-moving stock report or automated write-down trigger.', prescription: 'Implement monthly slow-moving stock report with automated write-down proposals after 120 days.' },
    ];

    for (const f of vaFindings) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO assessment_findings (id, assessment_id, run_id, tenant_id, finding_type, severity, title, description, affected_records, financial_impact, evidence, root_cause, prescription, category, immediate_value, ongoing_monthly_value, domain, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), vaAssessmentId, f.runId, tenantId, f.type, f.severity, f.title, f.desc, f.affected, f.impact, JSON.stringify(f.evidence), f.rootCause, f.prescription, f.category, f.immediate, f.ongoing, f.domain));
    }

    // Data Quality records (5 ERP tables)
    const vaDqRecords = [
      { table: 'erp_invoices', total: 152, complete: 138, pct: 90.8, fieldScores: { invoice_number: 100, customer_id: 98, amount_due: 100, due_date: 95, payment_status: 92, total: 100 }, refIssues: 3, dups: 2, orphans: 5, stale: 8, quality: 82 },
      { table: 'erp_purchase_orders', total: 80, complete: 68, pct: 85.0, fieldScores: { po_number: 100, supplier_id: 95, total: 100, order_date: 100, status: 88, delivery_date: 72 }, refIssues: 6, dups: 4, orphans: 2, stale: 12, quality: 74 },
      { table: 'erp_bank_transactions', total: 80, complete: 72, pct: 90.0, fieldScores: { transaction_id: 100, amount: 100, transaction_date: 100, description: 85, transaction_type: 92, reference: 78 }, refIssues: 0, dups: 8, orphans: 0, stale: 0, quality: 79 },
      { table: 'erp_employees', total: 45, complete: 37, pct: 82.2, fieldScores: { employee_id: 100, department: 82, cost_centre: 78, gross_salary: 100, status: 100, hire_date: 95 }, refIssues: 0, dups: 0, orphans: 0, stale: 3, quality: 76 },
      { table: 'erp_products', total: 36, complete: 30, pct: 83.3, fieldScores: { product_code: 100, product_name: 100, cost_price: 83, selling_price: 100, stock_on_hand: 94, category: 89 }, refIssues: 0, dups: 0, orphans: 0, stale: 3, quality: 78 },
    ];

    for (const dq of vaDqRecords) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO assessment_data_quality (id, assessment_id, tenant_id, table_name, total_records, complete_records, completeness_pct, field_scores, referential_issues, duplicate_records, orphan_records, stale_records, overall_quality_score, issues, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', datetime('now'))`
      ).bind(crypto.randomUUID(), vaAssessmentId, tenantId, dq.table, dq.total, dq.complete, dq.pct, JSON.stringify(dq.fieldScores), dq.refIssues, dq.dups, dq.orphans, dq.stale, dq.quality));
    }

    // Process Timing records (4 processes)
    const vaTimingRecords = [
      { process: 'Order-to-Cash', avg: 28.5, median: 26.0, p90: 42.0, benchmark: 21, bottleneck: 'Billing creation', bottleneckDays: 5.2, records: 72, exceeding: 28, impact: 45000 },
      { process: 'Procure-to-Pay', avg: 18.3, median: 16.0, p90: 28.0, benchmark: 12, bottleneck: 'Approval routing', bottleneckDays: 4.2, records: 80, exceeding: 35, impact: 134600 },
      { process: 'Invoice Approval', avg: 6.8, median: 5.0, p90: 14.0, benchmark: 3, bottleneck: 'Manager sign-off', bottleneckDays: 3.1, records: 152, exceeding: 67, impact: 28000 },
      { process: 'Month-End Close', avg: 12.0, median: 11.0, p90: 16.0, benchmark: 5, bottleneck: 'Intercompany reconciliation', bottleneckDays: 4.5, records: 12, exceeding: 12, impact: 35000 },
    ];

    for (const t of vaTimingRecords) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO assessment_process_timing (id, assessment_id, tenant_id, process_name, avg_cycle_time_days, median_cycle_time_days, p90_cycle_time_days, benchmark_cycle_time_days, bottleneck_step, bottleneck_avg_days, records_analysed, records_exceeding_benchmark, financial_impact_of_delay, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'))`
      ).bind(crypto.randomUUID(), vaAssessmentId, tenantId, t.process, t.avg, t.median, t.p90, t.benchmark, t.bottleneck, t.bottleneckDays, t.records, t.exceeding, t.impact));
    }

    // Value Summary (1 aggregate record)
    const totalImmediate = vaRunDomains.reduce((s, r) => s + r.immediateValue, 0); // 780,000
    const totalOngoingMonthly = vaRunDomains.reduce((s, r) => s + r.ongoingValue, 0); // 105,000
    const totalOngoingAnnual = totalOngoingMonthly * 12; // 1,260,000
    const outcomeFee = totalOngoingMonthly * 0.20; // R21,000/mo
    const paybackDays = Math.round((outcomeFee / ((totalImmediate / 365) + (totalOngoingMonthly / 30))) * 30); // ~42 days

    seedBatch.push(c.env.DB.prepare(
      `INSERT INTO assessment_value_summary (id, assessment_id, tenant_id, total_immediate_value, total_ongoing_monthly_value, total_ongoing_annual_value, total_data_quality_issues, total_process_delays, total_findings, total_critical_findings, outcome_based_monthly_fee, outcome_based_fee_pct, payback_days, value_by_domain, value_by_category, executive_narrative, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 20, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), vaAssessmentId, tenantId,
      totalImmediate, totalOngoingMonthly, totalOngoingAnnual,
      42, 4, vaFindings.length, vaFindings.filter(f => f.severity === 'critical').length,
      outcomeFee, paybackDays,
      JSON.stringify({
        finance: { immediate: 342000, ongoing: 28500, findings: 6 },
        procurement: { immediate: 215000, ongoing: 38000, findings: 5 },
        workforce: { immediate: 78000, ongoing: 15500, findings: 3 },
        supply_chain: { immediate: 145000, ongoing: 23000, findings: 4 },
      }),
      JSON.stringify({
        data_issue: { immediate: 245720, ongoing: 26401, findings: 7 },
        payment_terms: { immediate: 47200, ongoing: 3900, findings: 1 },
        duplicate_payment: { immediate: 89600, ongoing: 7467, findings: 1 },
        compliance: { immediate: 0, ongoing: 5000, findings: 1 },
        process_issue: { immediate: 71940, ongoing: 15355, findings: 3 },
        price_variance: { immediate: 28400, ongoing: 4733, findings: 1 },
        inventory_variance: { immediate: 67800, ongoing: 5650, findings: 1 },
        other: { immediate: 129340, ongoing: 36494, findings: 3 },
      }),
      `VantaX (Pty) Ltd's SAP S/4HANA environment contains 18 findings across 4 operational domains. The assessment identified R${(totalImmediate/1000).toFixed(0)}k in immediate recoverable value from data cleanup and process fixes, plus R${(totalOngoingMonthly/1000).toFixed(0)}k per month (R${(totalOngoingAnnual/1000).toFixed(0)}k annually) in ongoing value through continuous monitoring and prevention. Critical findings include R218k in uncollected overdue invoices, R89.6k in potential duplicate payments, and R67.8k in inventory shrinkage. At a 20% outcome-based fee, VantaX would pay R${(outcomeFee/1000).toFixed(0)}k/month — achieving full payback in approximately ${paybackDays} days. The 3-year projected value exceeds R4.5M.`,
    ));

    console.log('[VantaX Seeder] Seeded value assessment engine demo data');

    // ── STEP: Resolve a subset of RCAs + materialise shared-savings billing
    // The seed produces all RCAs as `status='active'` with no impact_value
    // and no verified catalyst_actions — meaning a clean billing query
    // returns zero. For a believable demo, we post-process two of the RCAs
    // into the billing-eligible state: resolved within the last 30 days,
    // impact_value on at least one causal factor, verified catalyst_action
    // linked via diagnostic_prescriptions.source_finding_id. Then we run
    // computeBillablePeriod to materialise billable_periods +
    // billable_line_items so the ROI dashboard / billing page shows
    // realistic numbers on day one.
    let billingDemo: {
      rcasResolved: number;
      actionsVerified: number;
      periodId: string | null;
      lineItems: number;
      atheonRevenue: number;
      currency: string;
      windowStart: string;
      windowEnd: string;
    } | null = null;
    // materialiseDemoBilling reads root_cause_analyses + diagnostic_prescriptions,
    // both of which were pushed to seedBatch around line 1765+ but won't actually
    // hit the DB until the next flushSeed() — which today is `before-users-read`
    // at line ~2665, *after* this step. Without an explicit flush here, materialise
    // sees an empty RCA table, returns {rcasResolved: 0, ...}, and the ROI
    // dashboard reads R 0 across the board.
    await flushSeed('before-materialise-billing');
    try {
      billingDemo = await materialiseDemoBilling(c.env.DB, tenantId);
      console.log('[VantaX Seeder] Billing demo materialised:', billingDemo);
    } catch (e) {
      console.error('[VantaX Seeder] Billing demo materialise failed:', e);
    }

    // ── STEP: Seed Apex Scenarios ──
    // What-if scenarios shown on /apex page; without seed the tab is empty.
    console.log('[VantaX Seeder] Seeding Apex scenarios...');
    const scenarioSeeds = [
      {
        title: 'What if Rand weakens to R20/USD?',
        description: 'Impact analysis of further ZAR depreciation on import-heavy SKUs and forward order book',
        inputQuery: 'Model the financial impact of ZAR weakening from R19 to R20/USD over the next quarter, focusing on raw material import costs and gross margin compression',
        variables: [
          { name: 'fx_rate_usd_zar', current: 19.0, hypothetical: 20.0, unit: 'ZAR/USD' },
          { name: 'import_dependent_revenue', value: 24_000_000, unit: 'ZAR' },
          { name: 'fx_hedge_coverage', value: 0.35, unit: 'fraction' },
        ],
        results: {
          recommendation: 'Increase FX hedging coverage from 35% to 70% before end of June 2026 and reprice import-linked SKUs by 4.2%',
          analysis_points: [
            'Unhedged import cost increase of R 1.8M over 90 days at R20/USD',
            'Gross margin compression of 220bps on top-5 import-linked SKUs',
            'Forward contracts at R19.30 mid-rate available for Q3 2026',
            'Repricing window closes when competitor X passes through cost increase (estimated 14 days)',
          ],
          npv_impact: -1_650_000,
          npv_currency: 'ZAR',
          confidence: 0.78,
          downside_case: { npv: -3_200_000, probability: 0.18 },
          upside_case: { npv: -650_000, probability: 0.32 },
        },
        status: 'complete',
        daysAgo: 3,
      },
      {
        title: 'What if we automate GR/IR for top-12 vendors?',
        description: 'ROI projection for automated 3-way match across high-conformance vendors',
        inputQuery: 'Project annualised savings, payback period, and risk profile from extending automated GR/IR matching to the 12 vendors with conformance > 92%',
        variables: [
          { name: 'vendors_in_scope', value: 12, unit: 'count' },
          { name: 'baseline_manual_hours_per_month', value: 180, unit: 'hours' },
          { name: 'automation_investment', value: 240_000, unit: 'ZAR' },
          { name: 'vendor_conformance_threshold', value: 0.92, unit: 'fraction' },
        ],
        results: {
          recommendation: 'Proceed with automation pilot covering 12 vendors; expected payback in 3.8 months with 6.2x ROI in year one',
          analysis_points: [
            'Annualised labour savings: R 1.48M (180 hrs/mo × R 685/hr fully-loaded)',
            'Discrepancy reduction: 42% fewer GR/IR exceptions expected based on conformance baseline',
            'Payback period: 3.8 months (investment R 240k vs savings R 123k/mo)',
            'Risk: 4 vendors require master-data cleanup before automation can safely match',
          ],
          npv_impact: 2_840_000,
          npv_currency: 'ZAR',
          confidence: 0.84,
          downside_case: { npv: 1_200_000, probability: 0.22 },
          upside_case: { npv: 4_100_000, probability: 0.28 },
        },
        status: 'complete',
        daysAgo: 8,
      },
      {
        title: 'What if SARB raises rates another 75bps?',
        description: 'Stress-test of debt service costs and working-capital facility utilisation',
        inputQuery: 'Calculate incremental annualised debt service cost and breach probability on existing covenants if SARB raises the repo rate by an additional 75 basis points',
        variables: [
          { name: 'rate_change_bps', value: 75, unit: 'basis_points' },
          { name: 'variable_rate_debt', value: 85_000_000, unit: 'ZAR' },
          { name: 'debt_service_coverage_ratio_current', value: 2.4, unit: 'ratio' },
          { name: 'covenant_threshold', value: 1.8, unit: 'ratio' },
        ],
        results: {
          recommendation: 'Convert R 35M of variable-rate debt to fixed before rate decision (probability of hike 62%); DSCR remains above covenant but margin narrows to 0.4x',
          analysis_points: [
            'Incremental annual interest cost: R 638k (75bps × R 85M variable debt)',
            'DSCR moves from 2.4 to 2.2 — still above 1.8 covenant but reduces margin of safety',
            'Fixed-rate swap available at R-JIBAR + 285bps (12-month forward)',
            'Capital allocation: defer R 12M of non-critical CapEx to preserve liquidity',
          ],
          npv_impact: -1_240_000,
          npv_currency: 'ZAR',
          confidence: 0.71,
          downside_case: { npv: -2_850_000, probability: 0.24 },
          upside_case: { npv: -420_000, probability: 0.30 },
        },
        status: 'complete',
        daysAgo: 12,
      },
      {
        title: 'What if Eskom load-shedding extends to Stage 6?',
        description: 'Production capacity and OEE impact under prolonged Stage 6 load-shedding',
        inputQuery: 'Project monthly production output, OEE deterioration, and diesel generator cost if Stage 6 load-shedding persists for 60 days',
        variables: [
          { name: 'loadshedding_stage', current: 4, hypothetical: 6, unit: 'stage' },
          { name: 'duration_days', value: 60, unit: 'days' },
          { name: 'production_capacity_baseline', value: 100, unit: 'percent' },
          { name: 'backup_genset_capacity', value: 65, unit: 'percent' },
        ],
        results: {
          recommendation: 'Activate Tier-2 contingency: dual-shift production, accelerate solar PV commissioning (currently scheduled Q4 2026), and pre-position 3 weeks of diesel inventory',
          analysis_points: [
            'Production output drop: 32% (from 100% to 68%) under Stage 6 without intervention',
            'Diesel cost surge: R 2.1M over 60 days at current generator runtime',
            'OEE deterioration: 71% → 58% on machine utilisation',
            'Solar PV acceleration saves R 720k/quarter but requires R 1.4M front-loaded CapEx',
          ],
          npv_impact: -3_450_000,
          npv_currency: 'ZAR',
          confidence: 0.82,
          downside_case: { npv: -5_800_000, probability: 0.28 },
          upside_case: { npv: -1_900_000, probability: 0.22 },
        },
        status: 'complete',
        daysAgo: 18,
      },
      {
        title: 'What if we expand JHB-DC capacity by 40%?',
        description: 'CapEx scenario for warehouse expansion to support FMCG retail channel growth',
        inputQuery: 'Evaluate the business case for expanding JHB-DC throughput capacity by 40% to support projected retail channel growth and reduce stockout risk',
        variables: [
          { name: 'capacity_expansion_percent', value: 40, unit: 'percent' },
          { name: 'capex_required', value: 18_500_000, unit: 'ZAR' },
          { name: 'projected_revenue_lift', value: 32_000_000, unit: 'ZAR' },
          { name: 'projected_margin', value: 0.18, unit: 'fraction' },
        ],
        results: {
          recommendation: 'Defer full expansion; pursue Phase 1 (R 6.5M, 18% capacity uplift) with optionality to expand to Phase 2 if Pick n Pay contract renewal confirms 2027 volume commitments',
          analysis_points: [
            'Phase 1 NPV: R 4.2M (R 6.5M CapEx, 18% capacity, 24-month payback)',
            'Full expansion NPV: R 6.8M but with R 12M downside if PnP volume commitments do not materialise',
            'Phase 1 preserves capital for FX-vulnerable working capital needs',
            'Real-option value of staged investment: R 1.6M (Black-Scholes valuation)',
          ],
          npv_impact: 4_200_000,
          npv_currency: 'ZAR',
          confidence: 0.69,
          downside_case: { npv: -2_400_000, probability: 0.26 },
          upside_case: { npv: 7_800_000, probability: 0.31 },
        },
        status: 'complete',
        daysAgo: 25,
      },
    ];
    for (const sc of scenarioSeeds) {
      const d = new Date(); d.setDate(d.getDate() - sc.daysAgo);
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, sc.title, sc.description, sc.inputQuery,
        JSON.stringify(sc.variables), JSON.stringify(sc.results), sc.status, d.toISOString()
      ));
    }
    console.log(`[VantaX Seeder] Seeded ${scenarioSeeds.length} Apex scenarios`);

    // ── STEP: Seed Strategic OKRs ──
    // Wave 2: strategic-management depth on Apex. Without seed the OKRs
    // tab is empty for new tenants. Computes the current quarter so
    // demos are always year-current.
    console.log('[VantaX Seeder] Seeding strategic OKRs...');
    const nowQ = new Date();
    const currentQuarter = `${nowQ.getFullYear()}-Q${Math.floor(nowQ.getMonth() / 3) + 1}`;
    const okrSeeds: Array<{
      title: string;
      description: string;
      owner: string;
      status: 'on_track' | 'at_risk' | 'off_track' | 'achieved';
      priority: 'p1' | 'p2' | 'normal';
      progress_pct: number;
      key_results: Array<{
        description: string;
        metric: string;
        target_value: number;
        current_value: number;
        unit: string;
        status: 'on_track' | 'at_risk' | 'off_track' | 'achieved';
      }>;
    }> = [
      {
        title: 'Recover R 5M in working capital through receivables discipline',
        description: 'Tighten AR collections cadence and reduce DSO to free cash for the Q4 inventory build-out.',
        owner: 'CFO',
        status: 'at_risk',
        priority: 'p1',
        progress_pct: 58,
        key_results: [
          { description: 'Reduce DSO from 52 to 38 days', metric: 'DSO', target_value: 38, current_value: 44, unit: 'days', status: 'at_risk' },
          { description: 'Cut invoices > 60 days from 124 to 30', metric: 'Aged invoices', target_value: 30, current_value: 62, unit: 'invoices', status: 'at_risk' },
          { description: 'Recover R 5M of overdue receivables', metric: 'Cash recovered', target_value: 5_000_000, current_value: 2_900_000, unit: 'ZAR', status: 'on_track' },
        ],
      },
      {
        title: 'Achieve clean external audit with zero material findings',
        description: 'Position the business for an unqualified Big-4 audit opinion. Auditor sign-off required by 30 September.',
        owner: 'CFO + Internal Audit',
        status: 'on_track',
        priority: 'p1',
        progress_pct: 72,
        key_results: [
          { description: 'Close all 14 internal audit findings', metric: 'Open findings', target_value: 0, current_value: 4, unit: 'findings', status: 'on_track' },
          { description: 'Reconcile GL → ERP source for top-25 accounts (>=99.9% match rate)', metric: 'Match rate', target_value: 99.9, current_value: 99.4, unit: '%', status: 'on_track' },
          { description: 'Refresh SOC 2 evidence pack quarterly', metric: 'Pack refreshes', target_value: 4, current_value: 3, unit: 'refreshes', status: 'on_track' },
        ],
      },
      {
        title: 'Lift Atheon Health score from 65 to 80',
        description: 'Move every dimension to green by end of quarter. Currently 7 green / 3 amber / 2 red.',
        owner: 'COO',
        status: 'on_track',
        priority: 'p1',
        progress_pct: 64,
        key_results: [
          { description: 'Atheon Score 65 → 80', metric: 'Atheon Score', target_value: 80, current_value: 73, unit: 'points', status: 'on_track' },
          { description: 'Zero red dimensions', metric: 'Red dimensions', target_value: 0, current_value: 1, unit: 'dimensions', status: 'at_risk' },
          { description: 'Anomaly resolution SLA < 4 hours median', metric: 'Median resolution', target_value: 4, current_value: 5.3, unit: 'hours', status: 'at_risk' },
        ],
      },
      {
        title: 'Activate 3 new ERP integrations by end of quarter',
        description: 'Expand the addressable market by certifying SAP S/4HANA Cloud, NetSuite, and Oracle Fusion adapters.',
        owner: 'CTO',
        status: 'at_risk',
        priority: 'p2',
        progress_pct: 45,
        key_results: [
          { description: 'SAP S/4HANA Cloud adapter — production-ready', metric: 'Cert status', target_value: 100, current_value: 80, unit: '% complete', status: 'on_track' },
          { description: 'NetSuite SuiteApp listing approved', metric: 'Listing status', target_value: 100, current_value: 40, unit: '% complete', status: 'at_risk' },
          { description: 'Oracle Fusion adapter — production-ready', metric: 'Cert status', target_value: 100, current_value: 15, unit: '% complete', status: 'off_track' },
        ],
      },
      {
        title: 'Drive shared-savings revenue to R 12M annualised run rate',
        description: 'Realise R 1M / month of billable savings across the customer base. Tied directly to the share-of-savings revenue model.',
        owner: 'CRO + CFO',
        status: 'on_track',
        priority: 'p1',
        progress_pct: 81,
        key_results: [
          { description: 'Realise R 12M ARR from shared-savings billing', metric: 'ARR', target_value: 12_000_000, current_value: 9_700_000, unit: 'ZAR', status: 'on_track' },
          { description: 'Maintain ≥ 95% traceable-savings audit pass rate', metric: 'Traceability', target_value: 95, current_value: 97, unit: '%', status: 'achieved' },
          { description: 'Onboard 8 new enterprise tenants', metric: 'Tenants', target_value: 8, current_value: 6, unit: 'tenants', status: 'on_track' },
        ],
      },
    ];

    let okrCount = 0;
    let krCount = 0;
    for (const obj of okrSeeds) {
      const objId = crypto.randomUUID();
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO strategic_objectives (id, tenant_id, title, description, owner, status, priority, quarter, progress_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        objId, tenantId, obj.title, obj.description, obj.owner,
        obj.status, obj.priority, currentQuarter, obj.progress_pct
      ));
      okrCount += 1;
      for (const kr of obj.key_results) {
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO strategic_key_results (id, tenant_id, objective_id, description, metric, target_value, current_value, unit, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), tenantId, objId, kr.description, kr.metric,
          kr.target_value, kr.current_value, kr.unit, kr.status
        ));
        krCount += 1;
      }
    }
    console.log(`[VantaX Seeder] Seeded ${okrCount} objectives + ${krCount} key results`);

    // ── STEP: Seed Initiative Portfolio ──
    // Wave 2: capital allocation rollup needs > 1 business unit so the
    // by-unit bar chart has shape. Mix of gates (discovery → done) and
    // RAG states so the portfolio strip + table both have signal.
    console.log('[VantaX Seeder] Seeding initiative portfolio...');
    const today = new Date();
    const daysFromNow = (days: number) => {
      const d = new Date(today); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
    };
    const initiativeSeeds: Array<{
      name: string;
      description: string;
      sponsor: string;
      owner: string;
      business_unit: string;
      gate: 'discovery' | 'build' | 'scale' | 'done' | 'killed';
      status: 'green' | 'amber' | 'red';
      planned_value_zar: number;
      actual_value_zar: number;
      budget_zar: number;
      spend_to_date_zar: number;
      start_offset_days: number;
      target_offset_days: number;
    }> = [
      {
        name: 'GR/IR Reconciliation Automation',
        description: 'Auto-match goods receipts to invoices for top-12 vendors using Atheon catalysts. Targets a 60% reduction in exception-handling effort.',
        sponsor: 'CFO',
        owner: 'AP Manager',
        business_unit: 'Finance',
        gate: 'scale',
        status: 'green',
        planned_value_zar: 4_500_000,
        actual_value_zar: 2_650_000,
        budget_zar: 240_000,
        spend_to_date_zar: 198_000,
        start_offset_days: -120,
        target_offset_days: 60,
      },
      {
        name: 'JHB-DC Inventory Accuracy Programme',
        description: 'Cycle-count cadence redesign + bin-location relabelling at Johannesburg DC. Closes the R 2.2M inventory variance flagged in the Q1 audit.',
        sponsor: 'COO',
        owner: 'DC Manager',
        business_unit: 'Operations',
        gate: 'build',
        status: 'amber',
        planned_value_zar: 2_200_000,
        actual_value_zar: 380_000,
        budget_zar: 410_000,
        spend_to_date_zar: 295_000,
        start_offset_days: -75,
        target_offset_days: 90,
      },
      {
        name: 'SAP S/4HANA Cloud Adapter Certification',
        description: 'Achieve SAP certification for the Atheon connector to unlock the S/4HANA Cloud enterprise tier addressable market.',
        sponsor: 'CTO',
        owner: 'Head of Integrations',
        business_unit: 'Product & Engineering',
        gate: 'build',
        status: 'green',
        planned_value_zar: 6_000_000,
        actual_value_zar: 0,
        budget_zar: 850_000,
        spend_to_date_zar: 690_000,
        start_offset_days: -160,
        target_offset_days: 45,
      },
      {
        name: 'NetSuite SuiteApp Listing',
        description: 'List Atheon on the NetSuite SuiteApp marketplace to capture the mid-market segment.',
        sponsor: 'CTO',
        owner: 'Integrations Lead',
        business_unit: 'Product & Engineering',
        gate: 'discovery',
        status: 'amber',
        planned_value_zar: 3_400_000,
        actual_value_zar: 0,
        budget_zar: 380_000,
        spend_to_date_zar: 145_000,
        start_offset_days: -45,
        target_offset_days: 120,
      },
      {
        name: 'Oracle Fusion Connector',
        description: 'Certify the Oracle Fusion adapter. Two enterprise prospects in the South African banking sector are contingent on this adapter.',
        sponsor: 'CTO',
        owner: 'Senior Integrations Engineer',
        business_unit: 'Product & Engineering',
        gate: 'discovery',
        status: 'red',
        planned_value_zar: 5_200_000,
        actual_value_zar: 0,
        budget_zar: 720_000,
        spend_to_date_zar: 110_000,
        start_offset_days: -30,
        target_offset_days: 150,
      },
      {
        name: 'AR Collections Cadence Redesign',
        description: 'Six-touch automated collections cadence with manager escalation. Targets DSO 52 → 38.',
        sponsor: 'CFO',
        owner: 'AR Manager',
        business_unit: 'Finance',
        gate: 'scale',
        status: 'amber',
        planned_value_zar: 5_000_000,
        actual_value_zar: 2_900_000,
        budget_zar: 180_000,
        spend_to_date_zar: 132_000,
        start_offset_days: -95,
        target_offset_days: 30,
      },
      {
        name: 'SOC 2 Type II Continuous Evidence',
        description: 'Always-on evidence collection so the SOC 2 audit becomes a one-click pack rather than a one-month scramble.',
        sponsor: 'CISO',
        owner: 'GRC Lead',
        business_unit: 'Security & Compliance',
        gate: 'done',
        status: 'green',
        planned_value_zar: 1_500_000,
        actual_value_zar: 1_500_000,
        budget_zar: 220_000,
        spend_to_date_zar: 215_000,
        start_offset_days: -210,
        target_offset_days: -15,
      },
      {
        name: 'FX Hedge Programme Expansion',
        description: 'Raise FX hedge coverage from 35% to 70% across forward order book. Mitigates ZAR weakening exposure flagged on Apex Radar.',
        sponsor: 'CFO',
        owner: 'Treasury Lead',
        business_unit: 'Finance',
        gate: 'build',
        status: 'green',
        planned_value_zar: 1_800_000,
        actual_value_zar: 420_000,
        budget_zar: 95_000,
        spend_to_date_zar: 64_000,
        start_offset_days: -55,
        target_offset_days: 90,
      },
      {
        name: 'Backup Generator Capacity Audit',
        description: 'Verify generator + UPS coverage for Stage 6 load-shedding scenarios at JHB and CPT sites.',
        sponsor: 'COO',
        owner: 'Facilities Lead',
        business_unit: 'Operations',
        gate: 'done',
        status: 'green',
        planned_value_zar: 800_000,
        actual_value_zar: 800_000,
        budget_zar: 145_000,
        spend_to_date_zar: 138_000,
        start_offset_days: -90,
        target_offset_days: -10,
      },
      {
        name: 'Voice-First Customer Portal',
        description: 'Explore a voice-first interface for customer-facing AR portal. Killed after user research showed low adoption signal.',
        sponsor: 'CPO',
        owner: 'Product Manager',
        business_unit: 'Product & Engineering',
        gate: 'killed',
        status: 'red',
        planned_value_zar: 2_000_000,
        actual_value_zar: 0,
        budget_zar: 320_000,
        spend_to_date_zar: 78_000,
        start_offset_days: -180,
        target_offset_days: -60,
      },
    ];

    for (const init of initiativeSeeds) {
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO strategic_initiatives (
          id, tenant_id, name, description, sponsor, owner, gate, status,
          planned_value_zar, actual_value_zar, spend_to_date_zar, budget_zar,
          start_date, target_completion_date, business_unit
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, init.name, init.description,
        init.sponsor, init.owner, init.gate, init.status,
        init.planned_value_zar, init.actual_value_zar,
        init.spend_to_date_zar, init.budget_zar,
        daysFromNow(init.start_offset_days),
        daysFromNow(init.target_offset_days),
        init.business_unit
      ));
    }
    console.log(`[VantaX Seeder] Seeded ${initiativeSeeds.length} portfolio initiatives`);

    // ── STEP: Seed Board Reports ──
    // Apex → Board Reports tab needs at least one of each report_type to render.
    console.log('[VantaX Seeder] Seeding board reports...');
    const boardReports = [
      {
        title: 'Monthly Board Report — April 2026',
        report_type: 'monthly',
        daysAgo: 26,
        content: {
          executive_summary: 'Operational momentum continues: Atheon Score rose from 65 to 69 in April. R 750k of additional discrepancy value recovered. Inventory variance at JHB-DC remains the largest open item.',
          highlights: [
            'Atheon Score: 65 → 69 (+4 points)',
            'Discrepancy recovered: R 2.45M cumulative (R 750k added in April)',
            'Process metrics: 7 green, 3 amber, 2 red (vs 4 green / 5 amber / 4 red at baseline)',
            'GR/IR exception rate dropped from 17% to 12.4%',
          ],
          key_decisions: [
            'Approved automation pilot for GR/IR top-12 vendors (R 240k CapEx)',
            'Deferred JHB-DC Phase 2 expansion pending Q4 contract renewals',
          ],
          risks_under_management: [
            'Rand weakening past R19/USD — FX hedging accelerated to 50% coverage',
            'Stage 4 load-shedding extension — backup capacity verified',
            'Revenue recognition timing — external auditor engaged for Q1 review',
          ],
          next_period_focus: [
            'Complete GR/IR automation rollout (target end June)',
            'Investigate JHB-DC shrinkage variance (audit budget R 500k approved)',
            'VAT 16% configuration changes (effective July 2026)',
          ],
          financial_highlights: {
            revenue_recovered_ytd: 3_200_000,
            atheon_cost_ytd: 580_000,
            roi_multiple: 5.5,
            currency: 'ZAR',
          },
        },
      },
      {
        title: 'Quarterly Board Report — Q1 2026',
        report_type: 'quarterly',
        daysAgo: 55,
        content: {
          executive_summary: 'Q1 2026 marked a step-change in operational visibility. Atheon Score rose 17 points (baseline 52 → 69 by quarter end). R 4.85M of discrepancy value identified, R 3.2M recovered. Three structural issues now have remediation plans with named owners.',
          highlights: [
            'Atheon Score trajectory: 52 → 56 → 61 → 65 → 69 (5-month trend)',
            'Discrepancy identified: R 4.85M total; R 3.2M recovered (66% recovery rate)',
            'Person-hours saved: 2,400 hours equivalent across Finance + Operations teams',
            'Risk count: 12 critical risks at baseline → 4 critical at quarter-end',
          ],
          key_decisions: [
            'Approved Atheon Phase 2 deployment (Supply Chain + Revenue clusters)',
            'Allocated R 500k inventory audit budget',
            'Engaged external auditor for IFRS 15 revenue recognition review',
            'Activated FX hedging programme covering 50% of import exposure',
          ],
          risks_under_management: [
            'IFRS 15 revenue recognition — external review in progress, expected resolution June 2026',
            'GR/IR exception rate — declining trend (17% → 12.4%); automation pilot underway',
            'Inventory shrinkage 21.7% at JHB-DC — audit budgeted, investigation begins Q2',
          ],
          next_period_focus: [
            'Q2 2026 priorities: VAT 16% changeover, GR/IR automation rollout, JHB-DC audit',
            'Target Atheon Score: 80 by end of Q2 (+11 points from current)',
            'Target recovered value: R 5.5M cumulative by end of Q2',
          ],
          financial_highlights: {
            revenue_recovered_q1: 3_200_000,
            downstream_losses_prevented: 1_800_000,
            atheon_cost_q1: 580_000,
            roi_multiple: 8.3,
            currency: 'ZAR',
          },
        },
      },
      {
        title: 'Ad-Hoc Board Brief — Rand at R19/USD',
        report_type: 'adhoc',
        daysAgo: 8,
        content: {
          executive_summary: 'The Rand has breached R19/USD amid global risk-off sentiment. Atheon Apex projects R 1.65M NPV impact at R20/USD and R 3.2M at R21/USD. Hedging accelerated to 50% coverage; further escalation contingency outlined.',
          trigger: 'Apex Radar — Reuters signal "Rand Weakens Past R19/USD" (severity: critical, relevance: 92%)',
          immediate_actions_taken: [
            'FX hedging coverage increased from 35% to 50% within 48 hours of signal',
            'Forward contracts locked for R 18M of confirmed import orders',
            'Supplier renegotiation initiated for ZAR escalation clauses on top-5 import contracts',
          ],
          scenario_outcomes: [
            { scenario: 'R20/USD', npv_impact_zar: -1_650_000, probability: 0.45 },
            { scenario: 'R21/USD', npv_impact_zar: -3_200_000, probability: 0.18 },
            { scenario: 'Reversion to R18.50/USD', npv_impact_zar: 280_000, probability: 0.37 },
          ],
          decisions_required: [
            'Approve next tranche of FX hedging (R 12M, 6-month forward)',
            'Endorse repricing of import-linked SKUs (proposed +4.2% effective 15 June 2026)',
          ],
          owner: 'Treasurer',
          deadline: '2026-06-10',
        },
      },
    ];
    for (const br of boardReports) {
      const d = new Date(); d.setDate(d.getDate() - br.daysAgo);
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO board_reports (id, tenant_id, title, report_type, content, generated_by, generated_at)
         VALUES (?, ?, ?, ?, ?, 'Atheon Apex', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, br.title, br.report_type,
        JSON.stringify(br.content), d.toISOString()
      ));
    }
    console.log(`[VantaX Seeder] Seeded ${boardReports.length} board reports`);

    // ── STEP: Seed Notifications ──
    // Activity feed renders empty without these; spans recent + older entries.
    console.log('[VantaX Seeder] Seeding notifications...');
    const notificationSeeds = [
      { type: 'catalyst', severity: 'success', title: 'GR/IR Reconciliation completed', message: 'Run 9b2 matched 49/55 items (89.1% match rate, R 8.2M recovered). 4 exceptions flagged for review.', actionUrl: '/catalysts', hoursAgo: 2 },
      { type: 'signal', severity: 'critical', title: 'Apex Radar: Rand breached R19/USD', message: 'Reuters signal received. Estimated import cost impact R 1.65M over 90 days. FX hedging recommendation active.', actionUrl: '/apex', hoursAgo: 4 },
      { type: 'threshold', severity: 'warning', title: 'GR/IR exception rate above threshold', message: 'Exception rate hit 14.8% (target ≤ 8%). Top contributors: LIFNR 100013 (5 items), 100027 (3 items).', actionUrl: '/diagnostics', hoursAgo: 7 },
      { type: 'catalyst', severity: 'success', title: 'Bank Reconciliation completed', message: 'Run 6f4 reconciled 56/72 transactions (77.8%). 10 unallocated bank fees auto-categorised.', actionUrl: '/catalysts', hoursAgo: 14 },
      { type: 'anomaly', severity: 'high', title: 'Inventory shrinkage detected at JHB-DC', message: 'Cycle-count variance of 21.7% on FG-104 category. R 320k value exposure. Audit recommended.', actionUrl: '/diagnostics', hoursAgo: 22 },
      { type: 'briefing', severity: 'info', title: 'Daily Executive Briefing generated', message: 'Health delta -1.2 points. 4 risks, 3 opportunities, 4 decisions surfaced.', actionUrl: '/dashboard', hoursAgo: 26 },
      { type: 'scenario', severity: 'info', title: 'Apex scenario complete: GR/IR automation', message: 'Projected R 2.84M NPV, 3.8-month payback, 6.2x year-one ROI. Recommendation: proceed with pilot.', actionUrl: '/apex', hoursAgo: 30 },
      { type: 'catalyst', severity: 'warning', title: 'Sales Order Matching exceptions elevated', message: 'Run 0e5 found 10 amount variances and 7 status mismatches. Possible IFRS 15 timing issue.', actionUrl: '/catalysts', hoursAgo: 38 },
      { type: 'agent', severity: 'success', title: 'AP Validation Agent deployed v2.3.8', message: '2,034 invoices validated this cycle. Health score 96%, uptime 99.9%.', actionUrl: '/agents', hoursAgo: 48 },
      { type: 'signal', severity: 'high', title: 'Apex Radar: SARS confirms VAT increase', message: 'VAT moves to 16% effective July 2026. All SAP tax codes and pricing masters require update.', actionUrl: '/apex', hoursAgo: 60 },
      { type: 'catalyst', severity: 'success', title: 'Inventory Reconciliation completed', message: 'Run b73 matched 10/18 products exactly. 4 shrinkage and 4 surplus items isolated.', actionUrl: '/catalysts', hoursAgo: 72 },
      { type: 'roi', severity: 'success', title: 'ROI milestone: 5x return crossed', message: 'Q1 cumulative ROI hit 5.5x (R 3.2M recovered against R 580k Atheon spend).', actionUrl: '/roi-dashboard', hoursAgo: 96 },
      { type: 'threshold', severity: 'warning', title: 'Match Rate below target', message: 'Aggregate match rate 82.4% (target 92%). Down -5.2% vs last month. Drill-through available.', actionUrl: '/diagnostics', hoursAgo: 120 },
      { type: 'briefing', severity: 'info', title: 'Quarterly Board Report ready', message: 'Q1 2026 board report generated. Atheon Score +17 points; R 4.85M discrepancy identified.', actionUrl: '/apex', hoursAgo: 168 },
      { type: 'system', severity: 'info', title: 'SAP S/4HANA connector synced', message: 'Hourly sync completed: 2,847 records refreshed across FI/CO/MM/SD/PP/QM modules.', actionUrl: '/connectors', hoursAgo: 240 },
    ];
    for (const n of notificationSeeds) {
      const d = new Date(); d.setHours(d.getHours() - n.hoursAgo);
      seedBatch.push(c.env.DB.prepare(
        `INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, n.type, n.title, n.message, n.severity,
        n.actionUrl, n.hoursAgo > 48 ? 1 : 0, d.toISOString()
      ));
    }
    console.log(`[VantaX Seeder] Seeded ${notificationSeeds.length} notifications`);

    // ── STEP: Seed Support Tickets + Replies ──
    // Support Console renders empty without these. Use an existing tenant user
    // as raiser/assignee — fall back to skipping the seed if no users exist.
    console.log('[VantaX Seeder] Seeding support tickets...');
    await flushSeed('before-users-read');
    const tenantUsers = await c.env.DB.prepare(
      `SELECT id, email, role FROM users WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 5`
    ).bind(tenantId).all<{ id: string; email: string; role: string }>();
    const userRows = (tenantUsers.results || []) as { id: string; email: string; role: string }[];
    if (userRows.length === 0) {
      console.log('[VantaX Seeder] No tenant users — skipping support_tickets seed');
    } else {
      const primaryUserId = userRows[0].id;
      const supportAdminId = userRows.find(u => u.role === 'support_admin' || u.role === 'admin' || u.role === 'superadmin')?.id || primaryUserId;
      const ticketSeeds = [
        {
          subject: 'GR/IR matching tolerance question',
          body: 'Our procurement team flagged that the new 2% PO-tolerance rule is auto-matching invoices for vendor LIFNR 100013 that we previously held for manual review. Can we configure tighter tolerance for this vendor specifically?',
          category: 'configuration',
          priority: 'normal',
          status: 'resolved',
          daysAgo: 18,
          replies: [
            { fromAdmin: true, daysAgo: 17, body: 'Yes — vendor-specific tolerance overrides are supported under Settings → Connectors → SAP → Tolerance Rules. I can walk you through it if helpful.' },
            { fromAdmin: false, daysAgo: 16, body: 'Thanks, found it. Configured 0.5% for 100013. Closing.' },
            { fromAdmin: true, daysAgo: 16, body: 'Marking resolved. Reach out if discrepancies persist.' },
          ],
        },
        {
          subject: 'Export executive briefing to PDF',
          body: 'Is there a way to export the daily Executive Briefing as a PDF for distribution to our board? Currently I am copy-pasting from the UI.',
          category: 'feature_request',
          priority: 'low',
          status: 'in_progress',
          daysAgo: 12,
          replies: [
            { fromAdmin: true, daysAgo: 11, body: 'PDF export is on the Q3 roadmap (BD-4). In the meantime, you can use the “Board Reports” section which generates a board-ready format. Would that work?' },
            { fromAdmin: false, daysAgo: 10, body: 'Board Reports works for the quarterly cadence, but I need the daily briefing in PDF for our exec sync. Will wait for BD-4.' },
          ],
        },
        {
          subject: 'IFRS 15 revenue recognition flag — false positive?',
          body: 'The Revenue Cycle Agent flagged 26.3% of Q1 invoices as “booked in wrong period under IFRS 15”. After review, ~40% of these appear to be legitimate timing differences allowed under the contract terms. Can we tune the threshold?',
          category: 'tuning',
          priority: 'high',
          status: 'in_progress',
          daysAgo: 9,
          replies: [
            { fromAdmin: true, daysAgo: 8, body: 'Good catch — this is a known sensitivity in the IFRS 15 detection model. We can add contract-type exclusions. Can you share a sample of the false positives so we can validate the tuning before it goes live?' },
            { fromAdmin: false, daysAgo: 7, body: 'Sample attached (12 invoices, all under long-term service contracts where milestone billing is contractually deferred). Let me know if you need more.' },
            { fromAdmin: true, daysAgo: 6, body: 'Received. Engineering will deploy contract-type exclusion logic next sprint. Will keep this open until validated against your Q1 dataset.' },
          ],
        },
        {
          subject: 'Atheon Score weighting — can we customise?',
          body: 'We would prefer to weight Catalyst Effectiveness higher than the default 15% given how heavily we lean on automated catalysts. Is custom weighting supported?',
          category: 'configuration',
          priority: 'normal',
          status: 'resolved',
          daysAgo: 7,
          replies: [
            { fromAdmin: true, daysAgo: 6, body: 'Custom score weighting is available under Settings → Health → Scoring Model. Note that customised scores cannot be compared to the industry benchmark (which uses the default weighting).' },
            { fromAdmin: false, daysAgo: 6, body: 'That trade-off is fine for us — we will keep the default for benchmark comparison and use a custom view internally. Closing.' },
          ],
        },
        {
          subject: 'New user onboarding for our auditors',
          body: 'We have 2 external auditors starting next week. What is the recommended role for read-only access scoped to financial dimensions only?',
          category: 'access',
          priority: 'normal',
          status: 'open',
          daysAgo: 3,
          replies: [
            { fromAdmin: true, daysAgo: 2, body: 'For external auditors I would recommend the `auditor` role — read-only across finance + compliance dimensions with full audit-log visibility. Should I provision two seats?' },
          ],
        },
        {
          subject: 'Apex Radar — too many low-relevance signals',
          body: 'The Radar is surfacing 40+ signals per week, but only ~10 are actually relevant to us. Is there a way to filter by relevance score or category before they appear in the feed?',
          category: 'tuning',
          priority: 'normal',
          status: 'open',
          daysAgo: 2,
          replies: [
            { fromAdmin: true, daysAgo: 1, body: 'You can set a minimum relevance threshold under Apex → Settings (currently defaults to 50%). Try raising to 70% and we can iterate from there. Industry-specific tuning is also rolling out next month.' },
          ],
        },
        {
          subject: 'How does shared-savings billing reconcile?',
          body: 'Our CFO asked how the “R0 until you save R1” calculation works in practice. Can you point me at documentation or walk through one month with us?',
          category: 'billing',
          priority: 'high',
          status: 'in_progress',
          daysAgo: 5,
          replies: [
            { fromAdmin: true, daysAgo: 4, body: 'Absolutely — every billed dollar traces to a specific recovered discrepancy with the source ERP record + confidence score. I can set up a 30-min walkthrough with your CFO. Tuesday or Wednesday work?' },
            { fromAdmin: false, daysAgo: 4, body: 'Wednesday 10am SAST works. Looping in CFO.' },
            { fromAdmin: true, daysAgo: 3, body: 'Confirmed for Wed 10am SAST. Will share the April reconciliation artefact beforehand.' },
          ],
        },
        {
          subject: 'Connector sync failure (intermittent)',
          body: 'Saw 2 SAP sync failures yesterday at 02:00 and 14:00 SAST. Errors auto-recovered but I want to understand the root cause.',
          category: 'incident',
          priority: 'high',
          status: 'resolved',
          daysAgo: 4,
          replies: [
            { fromAdmin: true, daysAgo: 3, body: 'Investigated — both failures correlated with brief OAuth token refresh latency on the SAP side. We have added retry-with-backoff (3 attempts) and improved error reporting. No data loss; subsequent sync recovered all delta records.' },
            { fromAdmin: false, daysAgo: 3, body: 'Thanks for the quick turnaround. Marking resolved.' },
          ],
        },
      ];
      for (const t of ticketSeeds) {
        const ticketId = crypto.randomUUID();
        const td = new Date(); td.setDate(td.getDate() - t.daysAgo);
        const tu = new Date(); tu.setDate(tu.getDate() - Math.max(0, t.daysAgo - t.replies.length));
        seedBatch.push(c.env.DB.prepare(
          `INSERT INTO support_tickets (id, tenant_id, user_id, assignee_user_id, subject, body, category, priority, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          ticketId, tenantId, primaryUserId, supportAdminId,
          t.subject, t.body, t.category, t.priority, t.status,
          td.toISOString(), tu.toISOString()
        ));
        for (const r of t.replies) {
          const rd = new Date(); rd.setDate(rd.getDate() - r.daysAgo);
          seedBatch.push(c.env.DB.prepare(
            `INSERT INTO support_ticket_replies (id, ticket_id, tenant_id, user_id, body, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(), ticketId, tenantId,
            r.fromAdmin ? supportAdminId : primaryUserId,
            r.body, rd.toISOString()
          ));
        }
      }
      console.log(`[VantaX Seeder] Seeded ${ticketSeeds.length} support tickets with replies`);
    }

    await flushSeed('final');

    // Generate the HTML value-assessment report and set business_report_key
    // so the "Download Report" button works on the Value Assessment page.
    // Must run after flushSeed('final') so the assessment + sub-tables are
    // committed and visible to generateValueReportPDF().
    let vaReportKey: string | null = null;
    let vaReportError: string | null = null;
    try {
      vaReportKey = await generateValueReportPDF(
        c.env.DB,
        c.env.STORAGE,
        tenantId,
        vaAssessmentId,
        'VantaX (Pty) Ltd',
        DEFAULT_VALUE_ASSESSMENT_CONFIG,
      );
      console.log(`[VantaX Seeder] Generated value-assessment report: ${vaReportKey}`);
      // generateValueReportPDF returns '' when assessment_value_summary is missing.
      // Treat that as a failure so the API surfaces it instead of pretending success.
      if (!vaReportKey) {
        vaReportError = 'assessment_value_summary row missing — report not generated';
      }
    } catch (err) {
      vaReportError = (err as Error).message;
      console.warn('[VantaX Seeder] Failed to generate value report:', vaReportError);
    }

    // Summary
    // Products: SAP (18) + PHYSICAL_COUNT (18) = 36; Invoices: SAP (80) + SAP-AR (72) = 152
    const totalErpRecords = SA_SUPPLIERS.length + SA_CUSTOMERS.length + (SA_PRODUCTS.length * 2) + 80 + 72 + 80 + 80 + GL_ACCOUNTS.length + 40;

    return c.json({
      success: true,
      message: 'VantaX tenant seeded with realistic SAP S/4HANA demo data',
      tenant: { id: tenantId, slug: 'vantax' },
      cleanup: { tables: cleanupTablesCount, recordsRemoved: cleanupCount },
      seeded: {
        sapConnector: { id: connectionId, name: 'SAP S/4HANA Production', status: 'connected', modules: ['FI', 'CO', 'MM', 'SD', 'PP', 'QM'] },
        erpData: {
          total: totalErpRecords,
          suppliers: SA_SUPPLIERS.length,
          customers: SA_CUSTOMERS.length,
          products_system: SA_PRODUCTS.length,
          products_physical_count: SA_PRODUCTS.length,
          invoices_sap: 80,
          invoices_ar: 72,
          purchaseOrders: 80,
          bankTransactions: 80,
          glAccounts: GL_ACCOUNTS.length,
          journalEntries: 40,
        },
        dataQuality: {
          grir: '65 of 80 POs match invoices exactly (81.25%), 7 price variances (8.75%), 8 unmatched (10%)',
          bank: '55 of 80 bank transactions reconciled (68.75%), 10 bank fees, 15 unmatched EFTs',
          inventory: '10 of 18 products match exactly (55.6%), 4 shortage (shrinkage), 4 surplus (receiving errors)',
          salesOrder: '55 of 80 SD invoices match AR postings exactly (68.75%), 10 amount variances, 7 status mismatches, 8 unmatched',
        },
        catalysts: {
          clusters: 3,
          clusterNames: ['Finance', 'Supply Chain', 'Revenue'],
          subCatalysts: allSubCatalysts.length,
          withDataSources: allSubCatalysts.filter(s => s.data_sources && s.data_sources.length > 0).length,
          reconciliationReady: allSubCatalysts.filter(s => s.data_sources && s.data_sources.length >= 2).length,
        },
        healthScore: { overall: overallHealthScore, dimensions: Object.keys(healthDimensions).length, historyRecords: healthHistory.length },
        dashboardData: {
          processMetrics: processMetricsData.length,
          processMetricHistory: Math.min(3, processMetricsData.length) * 6,
          riskAlerts: riskAlerts.length,
          anomalies: anomaliesData.length,
          catalystActions: catalystActionsData.length,
          agentDeployments: agentDeployments.length,
        },
        newEngines: {
          radarSignals: radarSignals.length,
          radarImpacts: impactData.length,
          strategicContexts: 1,
          diagnosticAnalyses: diagMetrics.length,
          catalystPatterns: patterns.length,
          competitors: competitors.length,
          marketBenchmarks: benchmarks.length,
          regulatoryEvents: regEvents.length,
          rootCauseAnalyses: rcaData.length,
          catalystEffectiveness: effectivenessData.length,
          catalystDependencies: deps.length,
          catalystPrescriptions: catalystPrescriptions.length,
          roiTracking: 1,
          industrySeeds: industrySeeds.length,
        },
        consoleSurfaces: {
          scenarios: scenarioSeeds.length,
          boardReports: boardReports.length,
          notifications: notificationSeeds.length,
          supportTickets: userRows.length > 0 ? 8 : 0,
        },
        strategicManagement: {
          objectives: okrCount,
          keyResults: krCount,
          initiatives: initiativeSeeds.length,
          quarter: currentQuarter,
        },
        billing: billingDemo,
        valueAssessmentReport: {
          assessmentId: vaAssessmentId,
          reportKey: vaReportKey,
          error: vaReportError,
        },
      },
      nextSteps: [
        'Go to Catalysts page and execute any sub-catalyst',
        'GR/IR Reconciliation: ~81% match, ~9% price variances, ~10% unmatched POs',
        'Bank Reconciliation: ~69% reconciled, 10 bank fees, 15 unmatched EFTs',
        'Inventory Reconciliation: ~56% exact match, 4 shrinkage, 4 surplus items',
        'Sales Order Matching: ~69% SD-to-AR match, 10 amount variances, 8 unmatched',
        'AP Invoice Validation: validates 80 invoices for field completeness',
        'All modes (reconciliation, validation, comparison, extraction) do real field-level work',
        'Visit Apex → Strategic Context to see radar signals and impact analysis',
        'Visit Pulse → Diagnostics to see root-cause analyses for degraded metrics',
        'Visit Catalysts → Intelligence to see discovered patterns and trends',
      ],
    });
  } catch (err) {
    console.error('VantaX seeding failed:', err);
    return c.json({ error: 'Seeding failed', details: (err as Error).message, stack: (err as Error).stack }, 500);
  }
});

/**
 * POST /api/v1/seed-vantax/reset
 *
 * Standalone wipe of the VantaX tenant data without reseeding. Lets the
 * sales team rehearse a clean-slate demo without re-running the full
 * (multi-second) seed, and gives ops a deterministic "undo" if a demo
 * run drifts off-script (e.g. a manual catalyst execution that should
 * not have been recorded).
 *
 * Same auth guard as /seed-vantax — restricted to the VantaX tenant via
 * `getVantaXTenantId`. Returns the number of rows + tables cleaned.
 *
 * Re-seed sequence:
 *   POST /api/v1/seed-vantax/reset
 *   POST /api/v1/seed-vantax           ← full seed including billing
 *   POST /api/v1/seed-vantax/seed-findings-demo  ← (optional) findings detectors
 */
seed.post('/reset', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({
      error: 'Access denied',
      message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment',
    }, 403);
  }
  try {
    const { count, tables } = await cleanupVantaxTenant(c.env.DB, tenantId);
    console.log(`[VantaX Reset] Cleaned ${count} rows across ${tables} tables for ${tenantId}`);
    return c.json({
      success: true,
      tenant: { id: tenantId, slug: 'vantax' },
      cleanup: { tables, recordsRemoved: count },
      message: 'VantaX tenant data cleared. Re-seed with POST /api/v1/seed-vantax.',
    });
  } catch (err) {
    console.error('VantaX reset failed:', err);
    return c.json({ error: 'reset_failed', details: (err as Error).message }, 500);
  }
});

/**
 * GET /api/v1/vantax-status
 * Check current VantaX data status
 */
seed.get('/vantax-status', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ exists: false, error: 'Access denied', message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment' }, 403);
  }

  try {
    const counts: Record<string, number> = {};
    const tables = [
      ['catalystRuns', 'sub_catalyst_runs'],
      ['processMetrics', 'process_metrics'],
      ['riskAlerts', 'risk_alerts'],
      ['healthScores', 'health_scores'],
      ['catalystClusters', 'catalyst_clusters'],
      ['invoices', 'erp_invoices'],
      ['purchaseOrders', 'erp_purchase_orders'],
      ['bankTransactions', 'erp_bank_transactions'],
      ['suppliers', 'erp_suppliers'],
      ['customers', 'erp_customers'],
      ['products', 'erp_products'],
      ['connections', 'erp_connections'],
      ['glAccounts', 'erp_gl_accounts'],
      ['journalEntries', 'erp_journal_entries'],
      // New engine tables
      ['radarSignals', 'radar_signals'],
      ['radarImpacts', 'radar_signal_impacts'],
      ['radarContext', 'radar_strategic_context'],
      ['diagnosticAnalyses', 'diagnostic_analyses'],
      ['diagnosticChains', 'diagnostic_causal_chains'],
      ['diagnosticFixes', 'diagnostic_fix_tracking'],
      ['catalystPatterns', 'catalyst_patterns'],
      ['catalystEffectiveness', 'catalyst_effectiveness'],
      ['catalystDependencies', 'catalyst_dependencies'],
      // V2 engine tables
      ['externalSignals', 'external_signals'],
      ['signalImpacts', 'signal_impacts'],
      ['competitors', 'competitors'],
      ['marketBenchmarks', 'market_benchmarks'],
      ['regulatoryEvents', 'regulatory_events'],
      ['rootCauseAnalyses', 'root_cause_analyses'],
      ['causalFactors', 'causal_factors'],
      ['diagnosticPrescriptions', 'diagnostic_prescriptions'],
      ['catalystPrescriptions', 'catalyst_prescriptions'],
      ['roiTracking', 'roi_tracking'],
      ['boardReports', 'board_reports'],
      // SAP native tables
      ['sap_bkpf', 'sap_bkpf'],
      ['sap_bseg', 'sap_bseg'],
      ['sap_bsid', 'sap_bsid'],
      ['sap_bsik', 'sap_bsik'],
      ['sap_febep', 'sap_febep'],
      ['sap_ekko', 'sap_ekko'],
      ['sap_ekpo', 'sap_ekpo'],
      ['sap_ekbe', 'sap_ekbe'],
      ['sap_mard', 'sap_mard'],
      ['sap_iseg', 'sap_iseg'],
      ['sap_vbak', 'sap_vbak'],
      ['sap_vbap', 'sap_vbap'],
      ['sap_vbrk', 'sap_vbrk'],
      ['sap_vbrp', 'sap_vbrp'],
      ['sap_lfa1', 'sap_lfa1'],
      ['sap_lfb1', 'sap_lfb1'],
      ['sap_kna1', 'sap_kna1'],
      ['sap_knb1', 'sap_knb1'],
    ];

    for (const [key, table] of tables) {
      if (!ALLOWED_TABLES.has(table)) continue;
      try {
        const row = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ?`).bind(tenantId).first();
        counts[key] = Number((row as Record<string, unknown>)?.count) || 0;
      } catch {
        counts[key] = 0;
      }
    }

    return c.json({
      exists: true,
      tenantId,
      data: counts,
    });
  } catch (err) {
    console.error('VantaX status check failed:', err);
    return c.json({ exists: false, error: (err as Error).message });
  }
});

/**
 * POST /api/v1/seed-vantax/seed-findings-demo
 *
 * Seeds focused fixtures designed to make every detector in the
 * assessment-findings engine fire on the VantaX demo tenant. Each
 * fixture block contributes 3-10 records — small enough not to bloat
 * the demo dataset, large enough to trip the severity / count
 * thresholds in `severityFromCount` and `severityFromValue`.
 *
 * Idempotent: every INSERT uses an `OR REPLACE` with deterministic
 * `findings-demo:` prefixed ids so re-running the endpoint on the
 * same tenant updates rather than duplicates.
 *
 * Restricted to the VantaX tenant via the same `getVantaXTenantId`
 * guard as `/seed-vantax`. Returns the count of fixtures written per
 * detector so an operator can verify which firings to expect.
 */
seed.post('/seed-findings-demo', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ error: 'Access denied', message: 'This endpoint is restricted to the VantaX demo environment' }, 403);
  }

  const db = c.env.DB;
  const written: Record<string, number> = {};
  const PREFIX = 'findings-demo';

  // Helper: insert a row with `INSERT OR REPLACE` so re-running is idempotent.
  async function ins(sql: string, binds: unknown[]): Promise<void> {
    await db.prepare(sql).bind(...binds).run();
  }

  // ── AR: 5 detectors ───────────────────────────────────────────────
  // 90+ overdue, 60-90, 30-60 buckets — each uses different invoice ids.
  const arBuckets = [{ days: 120, code: '90plus', n: 8 }, { days: 75, code: '60to90', n: 5 }, { days: 45, code: '30to60', n: 5 }];
  let arCount = 0;
  for (const b of arBuckets) {
    for (let i = 0; i < b.n; i++) {
      await ins(
        `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, due_date, total, amount_due, currency, payment_status, status)
         VALUES (?, ?, ?, ?, date('now', '-' || ? || ' days'), date('now', '-' || ? || ' days'), ?, ?, 'ZAR', 'unpaid', 'sent')`,
        [`${PREFIX}-inv-ar-${b.code}-${i}`, tenantId, `INV-AR-${b.code.toUpperCase()}-${i}`, `Aged Customer ${b.code} ${i}`, b.days + 15, b.days, 350_000 + i * 25_000, 350_000 + i * 25_000],
      );
      arCount++;
    }
  }
  written.ar_aging = arCount;

  // Credit-limit breach: 6 customers
  for (let i = 0; i < 6; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, credit_limit, credit_balance, currency, payment_terms, status)
       VALUES (?, ?, ?, 200000, 350000, 'ZAR', 'Net 30', 'active')`,
      [`${PREFIX}-cust-overlimit-${i}`, tenantId, `Over-Limit Customer ${i}`],
    );
  }
  written.ar_credit_limit_breach = 6;

  // Top-debtor concentration: 5 huge debtors + 5 small ones
  for (let i = 0; i < 5; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
       VALUES (?, ?, ?, ?, date('now', '-30 days'), ?, ?, 'ZAR', 'unpaid', 'sent')`,
      [`${PREFIX}-inv-bigdebt-${i}`, tenantId, `INV-BIG-${i}`, `Big Debtor ${i}`, 2_000_000, 2_000_000],
    );
  }
  for (let i = 0; i < 5; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
       VALUES (?, ?, ?, ?, date('now', '-30 days'), ?, ?, 'ZAR', 'unpaid', 'sent')`,
      [`${PREFIX}-inv-smdebt-${i}`, tenantId, `INV-SM-${i}`, `Small Debtor ${i}`, 80_000, 80_000],
    );
  }
  written.ar_top_debtor_concentration = 10;

  // ── AP: 3 detectors ────────────────────────────────────────────────
  // Overdue PO delivery
  for (let i = 0; i < 4; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_name, order_date, delivery_date, total, currency, status, delivery_status)
       VALUES (?, ?, ?, ?, date('now', '-90 days'), date('now', '-30 days'), ?, 'ZAR', 'open', 'pending')`,
      [`${PREFIX}-po-late-${i}`, tenantId, `PO-LATE-${i}`, `Late Supplier ${i}`, 500_000 + i * 100_000],
    );
  }
  written.ap_overdue_delivery = 4;

  // 3-way mismatch — paid != total
  for (let i = 0; i < 5; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_paid, amount_due, currency, payment_status, status)
       VALUES (?, ?, ?, ?, date('now', '-15 days'), ?, ?, 0, 'ZAR', 'paid', 'sent')`,
      [`${PREFIX}-inv-3way-${i}`, tenantId, `INV-3W-${i}`, `Mismatch ${i}`, 100_000, 95_000 + i * 1000],
    );
  }
  written.ap_three_way_mismatch = 5;

  // Unreconciled bank
  for (let i = 0; i < 60; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_bank_transactions (id, tenant_id, bank_account, transaction_date, description, debit, credit, balance, reconciled, reference)
       VALUES (?, ?, 'OPS-001', date('now', '-' || ? || ' days'), ?, ?, ?, 0, 0, ?)`,
      [`${PREFIX}-bank-unrec-${i}`, tenantId, 60 + i, `Unmatched payment ${i}`, i % 2 === 0 ? 25_000 + i * 100 : 0, i % 2 === 0 ? 0 : 25_000 + i * 100, `REF-${i}`],
    );
  }
  written.ap_unreconciled_bank = 60;

  // ── GL: 4 detectors ────────────────────────────────────────────────
  // Suspense / clearing balances
  for (let i = 0; i < 3; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_gl_accounts (id, tenant_id, account_code, account_name, account_type, account_class, balance, currency, is_active)
       VALUES (?, ?, ?, ?, 'asset', 'suspense', ?, 'ZAR', 1)`,
      [`${PREFIX}-gl-susp-${i}`, tenantId, `9${i}90`, `Suspense Clearing Account ${i}`, 250_000 + i * 50_000],
    );
  }
  written.gl_suspense_balance = 3;

  // Off-hours journals (Saturday + after-hours)
  for (let i = 0; i < 5; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_journal_entries (id, tenant_id, journal_number, journal_date, description, total_debit, total_credit, status, posted_by, created_at)
       VALUES (?, ?, ?, datetime('now', '-15 days', 'weekday 6'), 'Manual after-hours adjustment', ?, ?, 'posted', 'finance.user', datetime('now', '-15 days', 'weekday 6', '+22 hours'))`,
      [`${PREFIX}-je-offh-${i}`, tenantId, `JE-OFFH-${i}`, 150_000 + i * 25_000, 150_000 + i * 25_000],
    );
  }
  written.gl_journal_off_hours = 5;

  // Round-amount journals
  for (let i = 0; i < 6; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_journal_entries (id, tenant_id, journal_number, journal_date, description, total_debit, total_credit, status, posted_by)
       VALUES (?, ?, ?, date('now', '-30 days'), 'Round-amount accrual', ?, ?, 'posted', 'finance.user')`,
      [`${PREFIX}-je-round-${i}`, tenantId, `JE-RND-${i}`, 100_000 * (i + 1), 100_000 * (i + 1)],
    );
  }
  written.gl_round_amount_journals = 6;

  // High manual journal volume — seed enough manual journals over 90d for the threshold to fire
  for (let i = 0; i < 25; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_journal_entries (id, tenant_id, journal_number, journal_date, description, total_debit, total_credit, status, posted_by)
       VALUES (?, ?, ?, date('now', '-' || ? || ' days'), 'Manual reclass', ?, ?, 'posted', 'finance.user')`,
      [`${PREFIX}-je-manual-${i}`, tenantId, `JE-MAN-${i}`, i + 1, 50_000 + i * 5_000, 50_000 + i * 5_000],
    );
  }
  written.gl_high_manual_volume = 25;

  // ── Procurement: 4 detectors ───────────────────────────────────────
  // Maverick spend — invoices without supplier-matching PO and no reference
  for (let i = 0; i < 5; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status, reference)
       VALUES (?, ?, ?, ?, date('now', '-20 days'), ?, ?, 'ZAR', 'unpaid', 'sent', '')`,
      [`${PREFIX}-inv-mav-${i}`, tenantId, `INV-MAV-${i}`, `Off-Contract Supplier ${i}`, 250_000 + i * 50_000, 250_000 + i * 50_000],
    );
  }
  written.proc_maverick_spend = 5;

  // Duplicate suppliers (same VAT)
  for (let i = 0; i < 3; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, vat_number, status)
       VALUES (?, ?, ?, '4123456789', 'active')`,
      [`${PREFIX}-sup-dup-${i}`, tenantId, `Duplicate Supplier Variant ${i}`],
    );
  }
  written.proc_duplicate_suppliers = 3;

  // Supplier concentration (top-5 dominate spend) — seed 5 huge POs
  for (let i = 0; i < 5; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_name, order_date, total, currency, status, delivery_status)
       VALUES (?, ?, ?, ?, date('now', '-60 days'), ?, 'ZAR', 'closed', 'received')`,
      [`${PREFIX}-po-conc-${i}`, tenantId, `PO-CONC-${i}`, `Critical Supplier ${i}`, 5_000_000, 'ZAR'],
    );
  }
  written.proc_supplier_concentration = 5;

  // Inactive supplier with open POs
  await ins(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, status) VALUES (?, ?, ?, 'inactive')`,
    [`${PREFIX}-sup-inact-1`, tenantId, 'Inactive Supplier With Open POs'],
  );
  for (let i = 0; i < 3; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_name, order_date, total, currency, status, delivery_status)
       VALUES (?, ?, ?, ?, date('now', '-90 days'), ?, 'ZAR', 'open', 'pending')`,
      [`${PREFIX}-po-inact-${i}`, tenantId, `PO-INACT-${i}`, 'Inactive Supplier With Open POs', 200_000],
    );
  }
  written.proc_inactive_with_open_pos = 3;

  // ── Inventory: 6 detectors ─────────────────────────────────────────
  // Negative stock (3 SKUs)
  for (let i = 0; i < 3; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, cost_price, selling_price, stock_on_hand, is_active)
       VALUES (?, ?, ?, ?, 'misc', 250, 500, ?, 1)`,
      [`${PREFIX}-prod-neg-${i}`, tenantId, `SKU-NEG-${i}`, `Negative Stock SKU ${i}`, -10 - i],
    );
  }
  written.inv_negative_stock = 3;

  // Margin erosion
  for (let i = 0; i < 4; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, cost_price, selling_price, stock_on_hand, is_active)
       VALUES (?, ?, ?, ?, 200, 150, 100, 1)`,
      [`${PREFIX}-prod-merg-${i}`, tenantId, `SKU-MERG-${i}`, `Loss-Maker ${i}`],
    );
  }
  written.inv_margin_erosion = 4;

  // Inactive with stock value
  for (let i = 0; i < 2; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active)
       VALUES (?, ?, ?, ?, 1500, 250, 0)`,
      [`${PREFIX}-prod-iv-${i}`, tenantId, `SKU-INA-${i}`, `Discontinued Product ${i}`],
    );
  }
  written.inv_inactive_with_value = 2;

  // Below reorder
  for (let i = 0; i < 25; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, reorder_level, is_active)
       VALUES (?, ?, ?, ?, 100, 5, 50, 1)`,
      [`${PREFIX}-prod-ro-${i}`, tenantId, `SKU-RO-${i}`, `Below-Reorder Item ${i}`],
    );
  }
  written.inv_below_reorder = 25;

  // Stale + dead stock require old created_at + no recent invoice movement.
  // Without time travel SQLite still backdates created_at via inline literal.
  for (let i = 0; i < 6; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active, created_at)
       VALUES (?, ?, ?, ?, 800, 50, 1, datetime('now', '-13 months'))`,
      [`${PREFIX}-prod-dead-${i}`, tenantId, `SKU-DEAD-${i}`, `Dead Stock SKU ${i}`],
    );
  }
  written.inv_dead_stock = 6;
  for (let i = 0; i < 4; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active, created_at)
       VALUES (?, ?, ?, ?, 600, 30, 1, datetime('now', '-7 months'))`,
      [`${PREFIX}-prod-stale-${i}`, tenantId, `SKU-STALE-${i}`, `Slow-Moving SKU ${i}`],
    );
  }
  written.inv_stale_stock = 4;

  // ── HR: 2 detectors ────────────────────────────────────────────────
  // Terminated still on payroll
  for (let i = 0; i < 3; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, gross_salary, salary_frequency, status)
       VALUES (?, ?, ?, ?, ?, 50000, 'monthly', 'terminated')`,
      [`${PREFIX}-emp-term-${i}`, tenantId, `E-TERM-${i}`, 'Ghost', `Worker${i}`],
    );
  }
  written.hr_terminated_in_payroll = 3;

  // Top-earner concentration: one whale + many normal employees
  await ins(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, position, gross_salary, salary_frequency, status)
     VALUES (?, ?, 'E-CEO', 'Top', 'Earner', 'CEO', 800000, 'monthly', 'active')`,
    [`${PREFIX}-emp-ceo`, tenantId],
  );
  for (let i = 0; i < 6; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, position, gross_salary, salary_frequency, status)
       VALUES (?, ?, ?, ?, ?, 'IC', 50000, 'monthly', 'active')`,
      [`${PREFIX}-emp-ic-${i}`, tenantId, `E-IC-${i}`, 'Normal', `Worker${i}`],
    );
  }
  written.hr_high_payroll_concentration = 7;

  // ── Tax: 3 detectors ───────────────────────────────────────────────
  // Overdue VAT submissions
  for (let i = 0; i < 2; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_tax_entries (id, tenant_id, tax_period, tax_type, output_vat, input_vat, net_vat, status, created_at)
       VALUES (?, ?, ?, 'VAT', 250000, 80000, 170000, 'draft', datetime('now', '-' || ? || ' days'))`,
      [`${PREFIX}-tax-${i}`, tenantId, `2025-${String(i + 1).padStart(2, '0')}`, 90 + i * 30],
    );
  }
  written.tax_overdue_submission = 2;

  // VAT-rate anomalies (10% instead of 15%)
  for (let i = 0; i < 6; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, subtotal, vat_amount, total, currency, payment_status, status)
       VALUES (?, ?, ?, ?, date('now', '-10 days'), 200000, 20000, 220000, 'ZAR', 'unpaid', 'sent')`,
      [`${PREFIX}-inv-vat-${i}`, tenantId, `INV-VAT-${i}`, `Off-Rate Customer ${i}`],
    );
  }
  written.tax_vat_rate_anomaly = 6;

  // Customers + suppliers missing VAT
  for (let i = 0; i < 4; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, credit_balance, currency, status, vat_number)
       VALUES (?, ?, ?, 25000, 'ZAR', 'active', NULL)`,
      [`${PREFIX}-cust-novat-${i}`, tenantId, `No-VAT Customer ${i}`],
    );
    await ins(
      `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, status, vat_number)
       VALUES (?, ?, ?, 'active', NULL)`,
      [`${PREFIX}-sup-novat-${i}`, tenantId, `No-VAT Supplier ${i}`],
    );
  }
  written.tax_missing_vat_numbers = 8;

  // ── FX: 2 detectors ────────────────────────────────────────────────
  // Foreign-currency exposure
  for (let i = 0; i < 4; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
       VALUES (?, ?, ?, ?, date('now', '-30 days'), 75000, 75000, 'USD', 'unpaid', 'sent')`,
      [`${PREFIX}-inv-fx-${i}`, tenantId, `INV-USD-${i}`, `US Customer ${i}`],
    );
  }
  written.fx_currency_exposure = 4;

  // Dual-currency suppliers — one supplier name in two currencies
  for (let i = 0; i < 2; i++) {
    const cur = i === 0 ? 'EUR' : 'USD';
    await ins(
      `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_name, order_date, total, currency, status, delivery_status)
       VALUES (?, ?, ?, 'Multi-Currency Supplier', date('now', '-60 days'), ?, ?, 'closed', 'received')`,
      [`${PREFIX}-po-fxdual-${i}`, tenantId, `PO-FXD-${i}`, 50_000, cur],
    );
  }
  written.fx_dual_use_currency = 2;

  // ── Service-company: 8 detectors ───────────────────────────────────
  // Need projects + time entries. Seed 6 employees first to satisfy FKs.
  for (let i = 0; i < 6; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, gross_salary, salary_frequency, status)
       VALUES (?, ?, ?, 'Consultant', ?, 75000, 'monthly', 'active')`,
      [`${PREFIX}-emp-svc-${i}`, tenantId, `E-SVC-${i}`, `Worker${i}`],
    );
  }

  // 1 terminated consultant for the post-termination billing detector
  await ins(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, gross_salary, salary_frequency, status, termination_date)
     VALUES (?, ?, 'E-SVC-TERM', 'Term', 'Consultant', 60000, 'monthly', 'terminated', date('now', '-30 days'))`,
    [`${PREFIX}-emp-svc-term`, tenantId],
  );

  // 2 active projects with budget overrun
  for (let i = 0; i < 2; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_projects (id, tenant_id, code, name, customer_name, status, budgeted_cost, actual_cost, contract_value, billed_to_date, recognised_revenue, currency, project_manager, start_date)
       VALUES (?, ?, ?, ?, ?, 'active', 500000, 750000, 1000000, 800000, 500000, 'ZAR', 'PM Mike', date('now', '-120 days'))`,
      [`${PREFIX}-prj-over-${i}`, tenantId, `P-OVER-${i}`, `Overrun Project ${i}`, `Customer Co ${i}`],
    );
  }
  written.svc_project_overrun = 2;

  // 2 closed projects with negative margin
  for (let i = 0; i < 2; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_projects (id, tenant_id, code, name, customer_name, status, recognised_revenue, actual_cost, contract_value, currency, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, 'closed', 400000, 600000, 500000, 'ZAR', date('now', '-1 year'), date('now', '-30 days'))`,
      [`${PREFIX}-prj-loss-${i}`, tenantId, `P-LOSS-${i}`, `Loss Project ${i}`, `Customer Loss ${i}`],
    );
  }
  written.svc_project_margin_negative = 2;

  // 1 dormant active project (no time entries against it)
  await ins(
    `INSERT OR REPLACE INTO erp_projects (id, tenant_id, code, name, customer_name, status, contract_value, currency, start_date)
     VALUES (?, ?, 'P-DORMANT', 'Dormant Engagement', 'Idle Customer', 'active', 750000, 'ZAR', date('now', '-200 days'))`,
    [`${PREFIX}-prj-dormant`, tenantId],
  );
  written.svc_zero_hours_active_project = 1;

  // 1 revrec-lag project (billed 800k, recognised 400k)
  await ins(
    `INSERT OR REPLACE INTO erp_projects (id, tenant_id, code, name, customer_name, status, billed_to_date, recognised_revenue, currency, billing_type, start_date)
     VALUES (?, ?, 'P-REVREC', 'Revrec Lag', 'Lag Customer', 'active', 800000, 400000, 'ZAR', 'milestone', date('now', '-60 days'))`,
    [`${PREFIX}-prj-revrec`, tenantId],
  );
  written.svc_revenue_recognition_lag = 1;

  // Time entries — utilisation low (180 total, 50 billable = 28%)
  for (let i = 0; i < 30; i++) {
    const isBillable = i < 8 ? 1 : 0;
    await ins(
      `INSERT OR REPLACE INTO erp_time_entries (id, tenant_id, employee_id, work_date, hours, billable, billed, billable_rate, approval_status)
       VALUES (?, ?, ?, date('now', '-' || ? || ' days'), 6, ?, 0, 1500, 'approved')`,
      [`${PREFIX}-te-util-${i}`, tenantId, `${PREFIX}-emp-svc-${i % 6}`, i + 1, isBillable],
    );
  }
  written.svc_low_billable_utilisation = 30;

  // Approved unbilled aging
  for (let i = 0; i < 8; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_time_entries (id, tenant_id, employee_id, project_id, work_date, hours, billable, billed, billable_rate, approval_status, project_code)
       VALUES (?, ?, ?, ?, date('now', '-60 days'), 8, 1, 0, 1800, 'approved', 'P-WIP')`,
      [`${PREFIX}-te-wip-${i}`, tenantId, `${PREFIX}-emp-svc-${i % 6}`, `${PREFIX}-prj-revrec`],
    );
  }
  written.svc_unbilled_time_aging = 8;

  // Pending approval > 14 days
  for (let i = 0; i < 18; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_time_entries (id, tenant_id, employee_id, work_date, hours, billable, billable_rate, approval_status)
       VALUES (?, ?, ?, date('now', '-30 days'), 8, 1, 1500, 'pending')`,
      [`${PREFIX}-te-pa-${i}`, tenantId, `${PREFIX}-emp-svc-${i % 6}`],
    );
  }
  written.svc_unapproved_time_entries = 18;

  // Time on terminated employee (post termination_date)
  for (let i = 0; i < 3; i++) {
    await ins(
      `INSERT OR REPLACE INTO erp_time_entries (id, tenant_id, employee_id, work_date, hours, billable, billable_rate, approval_status)
       VALUES (?, ?, ?, date('now', '-15 days'), 8, 1, 1800, 'approved')`,
      [`${PREFIX}-te-postterm-${i}`, tenantId, `${PREFIX}-emp-svc-term`],
    );
  }
  written.svc_inactive_employee_billed_time = 3;

  return c.json({
    success: true,
    tenant_id: tenantId,
    fixtures_written: written,
    total_records: Object.values(written).reduce((s, n) => s + n, 0),
    message: 'Run POST /api/v1/assessments to detect findings on this dataset.',
  });
});

export default seed;
