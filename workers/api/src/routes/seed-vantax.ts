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

    // STEP 1: Cleanup ALL old data for this tenant
    // Shared with /reset — full tenant wipe in dependency-safe order.
    const { count: cleanupCount, tables: cleanupTablesCount } =
      await cleanupVantaxTenant(c.env.DB, tenantId);
    console.log(`[VantaX Seeder] Cleaned ${cleanupCount} old records`);

    // STEP 2: Create SAP S/4HANA Connector in erp_connections
    const sapAdapterId = 'sap-s4hana';
    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
         VALUES (?, 'SAP S/4HANA', 'sap', '2023', 'OData', 'available', ?, ?)`
      ).bind(
        sapAdapterId,
        JSON.stringify(['sync', 'read', 'write', 'reconcile']),
        JSON.stringify(['oauth2', 'basic', 'api_key']),
      ).run();
    } catch { /* adapter may already exist */ }

    const connectionId = crypto.randomUUID();
    await c.env.DB.prepare(
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
    ).run();

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
      await c.env.DB.prepare(
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
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
    }

    // STEP 5: Seed SAP Products (Material Master) — system inventory
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      await c.env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, external_id, source_system, sku, name, category, product_group, uom, cost_price, selling_price, vat_rate, stock_on_hand, reorder_level, reorder_quantity, warehouse, is_active, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?, 'JHB-MAIN', 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-M${(30000 + i).toString()}`,
        p.sku, p.name, p.cat, p.cat, p.uom, p.cost, p.sell, p.stock, p.reorder, Math.floor(p.reorder * 1.5),
        now,
      ).run();
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
      await c.env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, external_id, source_system, sku, name, category, product_group, uom, cost_price, selling_price, vat_rate, stock_on_hand, reorder_level, reorder_quantity, warehouse, is_active, synced_at)
         VALUES (?, ?, ?, 'PHYSICAL_COUNT', ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?, 'JHB-MAIN', 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `PHY-M${(30000 + i).toString()}`,
        p.sku, p.name, p.cat, p.cat, p.uom, p.cost, p.sell, physicalStock, p.reorder, Math.floor(p.reorder * 1.5),
        now,
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO erp_bank_transactions (id, tenant_id, external_id, source_system, bank_account, transaction_date, description, reference, debit, credit, balance, reconciled, synced_at)
         VALUES (?, ?, ?, 'SAP', 'FNB-62-000-4521-01', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-BK-${(80000 + i).toString()}`,
        txDate, desc, ref, debit, credit, runningBalance, reconciled, now,
      ).run();
    }

    // STEP 9: Seed GL Accounts and Journal Entries (SAP FI)
    for (const gl of GL_ACCOUNTS) {
      await c.env.DB.prepare(
        `INSERT INTO erp_gl_accounts (id, tenant_id, external_id, source_system, account_code, account_name, account_type, account_class, currency, balance, is_active, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, 'ZAR', ?, 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-GL-${gl.code}`,
        gl.code, gl.name, gl.type, gl.cls, gl.balance, now,
      ).run();
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
      await c.env.DB.prepare(
        `INSERT INTO erp_journal_entries (id, tenant_id, external_id, source_system, journal_number, journal_date, description, total_debit, total_credit, status, posted_by, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, 'posted', 'SAP-AUTO', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-JE-${(60000 + i).toString()}`,
        `JE-${(60000 + i).toString()}`, jDate,
        jeDescriptions[i % jeDescriptions.length],
        amount, amount, now,
      ).run();
    }

    // ── SAP NATIVE TABLE SEEDING ──
    // Populate actual SAP table structures so the LLM sees real SAP field names
    // and sub-catalysts process authentic SAP data.

    // SAP-SEED-1: LFA1 — Vendor Master General Data
    // Quality gaps: vendors 11-12 missing STCD1 (tax number), vendors 13-14 missing TELF1
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const s = SA_SUPPLIERS[i];
      const lifnr = (10000 + i).toString().padStart(10, '0');
      await c.env.DB.prepare(
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
      ).run();
    }

    // SAP-SEED-2: LFB1 — Vendor Master Company Code Data
    // Quality gaps: vendors 8-10 missing AKONT (recon account), vendor 14 missing ZTERM
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const lifnr = (10000 + i).toString().padStart(10, '0');
      const zterms = ['ZB30', 'ZB45', 'ZB30', 'ZB60', 'ZB30', 'ZB45', 'ZB30', 'ZB60'];
      await c.env.DB.prepare(
        `INSERT INTO sap_lfb1 (id, tenant_id, LIFNR, BUKRS, AKONT, ZTERM, ZWELS, REPRF, HBKID)
         VALUES (?, ?, ?, '1000', ?, ?, 'CT', ?, 'FNB1')`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        (i >= 8 && i <= 10) ? null : '2000',  // missing recon account
        i === 14 ? null : zterms[i % zterms.length],  // missing payment terms
        i < 8 ? 'X' : null,  // double-invoice check
      ).run();
    }

    // SAP-SEED-3: KNA1 — Customer Master General Data
    // Quality gaps: customers 18-19 missing STCD1, customer 15-17 missing ORT01
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const cu = SA_CUSTOMERS[i];
      const kunnr = (20000 + i).toString().padStart(10, '0');
      await c.env.DB.prepare(
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
      ).run();
    }

    // SAP-SEED-4: KNB1 — Customer Master Company Code Data
    // Quality gaps: customers 12-14 KLIMK exceeded, customers 15-17 KLIMK = 0
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const kunnr = (20000 + i).toString().padStart(10, '0');
      let klimk = 500000 + i * 150000 + 50000;
      if (i >= 15 && i <= 17) klimk = 0;

      await c.env.DB.prepare(
        `INSERT INTO sap_knb1 (id, tenant_id, KUNNR, BUKRS, AKONT, ZTERM, KLIMK, CTLPC)
         VALUES (?, ?, ?, '1000', '1100', 'ZB30', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        klimk,
        klimk > 0 ? 'A' : null,  // no credit control for zero-limit customers
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO sap_bkpf (id, tenant_id, BUKRS, BELNR, GJAHR, BLART, BUDAT, BLDAT, MONAT, CPUDT, XBLNR, BSTAT, WAERS, USNAM, TCODE, AWTYP, AWKEY)
         VALUES (?, ?, '1000', ?, '2026', ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'SAPUSER', 'FB60', 'BKPF', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        i <= 40 ? 'KR' : 'KG',  // KR=vendor invoice, KG=vendor credit
        budat, bldat, monat, budat,
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,  // missing XBLNR for 73-80
        i <= 65 ? '' : 'V',  // V = parked (not posted)
        belnr,
      ).run();
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
      await c.env.DB.prepare(
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
      ).run();

      // Line 2: Expense posting (BSCHL 40 = debit)
      await c.env.DB.prepare(
        `INSERT INTO sap_bseg (id, tenant_id, BUKRS, BELNR, GJAHR, BUZEI, BSCHL, KOART, KONTO, DMBTR, WRBTR, MWSKZ, MWSTS, SGTXT, SHKZG)
         VALUES (?, ?, '1000', ?, '2026', '002', '40', 'S', '5000', ?, ?, 'I2', 0, ?, 'S')`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        Math.round((dmbtr - vat) * 100) / 100, Math.round((total - vat) * 100) / 100,
        `Cost of Sales - ${SA_SUPPLIERS[suppIdx].name}`,
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
    }

    // SAP-SEED-8: EKKO — Purchase Order Headers (80 POs)
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const bedat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];

      await c.env.DB.prepare(
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
      ).run();
    }

    // SAP-SEED-9: EKPO — Purchase Order Items (1-2 items per PO)
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.cost));
      const netpr = Math.round(total / qty * 100) / 100;

      await c.env.DB.prepare(
        `INSERT INTO sap_ekpo (id, tenant_id, EBELN, EBELP, MATNR, TXZ01, MENGE, MEINS, NETPR, PEINH, NETWR, MATKL, WERKS, LGORT, MWSKZ)
         VALUES (?, ?, ?, '00010', ?, ?, ?, ?, ?, 1, ?, ?, 'JHB1', '0001', 'I2')`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        p.sku, p.name, qty, p.uom, netpr, Math.round(netpr * qty * 100) / 100,
        p.cat,
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO sap_ekbe (id, tenant_id, EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BUZEI, BEWTP, MENGE, WRBTR, WAERS, BUDAT)
         VALUES (?, ?, ?, '00010', '0001', '1', '2026', ?, '001', 'E', ?, ?, 'ZAR', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        (5000000000 + i).toString(),
        grQty, Math.round(grQty * (total / qty) * 100) / 100, budat,
      ).run();

      // Invoice Receipt (VGABE = '2') — only for POs 1-72
      if (i <= 72) {
        let irAmt = total;
        if (i >= 66 && i <= 72) {
          // IR amount differs from PO by 3-7%
          const variancePct = 0.03 + ((i * 13) % 5) * 0.01;
          irAmt = Math.round(total * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
        }
        await c.env.DB.prepare(
          `INSERT INTO sap_ekbe (id, tenant_id, EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BUZEI, BEWTP, MENGE, WRBTR, WAERS, BUDAT)
           VALUES (?, ?, ?, '00010', '0002', '2', '2026', ?, '001', 'Q', ?, ?, 'ZAR', ?)`
        ).bind(
          crypto.randomUUID(), tenantId, ebeln,
          bkpfBelnrs[i - 1],
          qty, irAmt, budat,
        ).run();
      }
    }

    // SAP-SEED-11: MARD — Material Warehouse Stock
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      await c.env.DB.prepare(
        `INSERT INTO sap_mard (id, tenant_id, MATNR, WERKS, LGORT, LABST, INSME, SPEME, EINME, RETME, LFGJA, LFMON)
         VALUES (?, ?, ?, 'JHB1', '0001', ?, ?, ?, 0, 0, '2026', '03')`
      ).bind(
        crypto.randomUUID(), tenantId,
        p.sku, p.stock,
        i >= 10 && i < 14 ? Math.floor(p.stock * 0.05) : 0,  // quality inspection stock
        i >= 14 ? Math.floor(p.stock * 0.03) : 0,  // blocked stock
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO sap_vbak (id, tenant_id, VBELN, AUART, VKORG, VTWEG, SPART, KUNNR, BSTNK, AUDAT, VDATU, NETWR, WAERK, VBTYP, ERNAM)
         VALUES (?, ?, ?, 'TA', '1000', '10', '00', ?, ?, ?, ?, ?, 'ZAR', 'C', 'SAPSALES')`
      ).bind(
        crypto.randomUUID(), tenantId, vbeln,
        kunnr,
        `CUST-PO-${(60000 + i).toString()}`,
        audat,
        new Date(Date.now() - (daysAgo - 14) * 86400000).toISOString().split('T')[0],
        total,
      ).run();
    }

    // SAP-SEED-14: VBAP — Sales Order Items
    for (let i = 1; i <= 80; i++) {
      const vbeln = vbakVbelns[i - 1];
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.sell));

      await c.env.DB.prepare(
        `INSERT INTO sap_vbap (id, tenant_id, VBELN, POSNR, MATNR, ARKTX, KWMENG, VRKME, NETPR, NETWR, WAERK, WERKS, MATKL)
         VALUES (?, ?, ?, '000010', ?, ?, ?, ?, ?, ?, 'ZAR', 'JHB1', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, vbeln,
        p.sku, p.name, qty, p.uom,
        Math.round(total / qty * 100) / 100, total,
        p.cat,
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO sap_vbrk (id, tenant_id, VBELN, FKART, VKORG, KUNAG, KUNRG, FKDAT, RFBSK, NETWR, MWSBK, WAERK, BUKRS, XBLNR, ERNAM)
         VALUES (?, ?, ?, 'F2', '1000', ?, ?, ?, ?, ?, ?, 'ZAR', '1000', ?, 'SAPSALES')`
      ).bind(
        crypto.randomUUID(), tenantId, billingVbeln,
        kunnr, kunnr, fkdat, rfbsk,
        netwr, Math.round(netwr * 0.15 * 100) / 100,
        `INV-${(100000 + i).toString()}`,
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO sap_vbrp (id, tenant_id, VBELN, POSNR, FKIMG, VRKME, NETWR, MWSBP, MATNR, ARKTX, AUBEL, AUPOS, WERKS)
         VALUES (?, ?, ?, '000010', ?, ?, ?, ?, ?, ?, ?, '000010', 'JHB1')`
      ).bind(
        crypto.randomUUID(), tenantId, billingVbeln,
        qty, p.uom, netwr, Math.round(netwr * 0.15 * 100) / 100,
        p.sku, p.name,
        vbakVbelns[i - 1],
      ).run();
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

      await c.env.DB.prepare(
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
      ).run();
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

      await c.env.DB.prepare(
        `INSERT INTO sap_febep (id, tenant_id, BUKRS, HESSION, AESSION, VALUT, KWBTR, WRBTR, WAERS, VWEZW, XBLNR, SGTXT)
         VALUES (?, ?, '1000', ?, ?, ?, ?, ?, 'ZAR', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId,
        (7000000 + i).toString(),  // HESSION = bank statement number
        (i).toString().padStart(5, '0'),  // AESSION = line item
        valut, kwbtr, Math.abs(kwbtr),
        vwezw, xblnr, sgtxt,
      ).run();
    }

    console.log('[VantaX Seeder] SAP native tables seeded');

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

    await c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Finance', 'finance', 'Financial reconciliation and controls - SAP FI/CO modules. GR/IR 3-way match, AP invoice validation, bank reconciliation against FNB Corporate.', 'active', 'supervised', 3, ?)
    `).bind(financeClusterId, tenantId, JSON.stringify(financeSubCatalysts)).run();

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

    await c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Supply Chain', 'operations', 'Supply chain management and procurement - SAP MM/SD. Inventory verification, PO-to-GR matching, vendor master validation.', 'active', 'supervised', 3, ?)
    `).bind(supplyChainClusterId, tenantId, JSON.stringify(supplyChainSubCatalysts)).run();

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

    await c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Revenue', 'revenue', 'Revenue cycle management - SAP SD/FI. IFRS 15 compliance, AR aging, sales order-to-invoice matching.', 'active', 'supervised', 3, ?)
    `).bind(revenueClusterId, tenantId, JSON.stringify(revenueSubCatalysts)).run();

    // STEP 11: Create Sub-Catalyst KPIs (aggregate tracking)
    const allSubCatalysts = [
      ...financeSubCatalysts.map(s => ({ ...s, clusterId: financeClusterId })),
      ...supplyChainSubCatalysts.map(s => ({ ...s, clusterId: supplyChainClusterId })),
      ...revenueSubCatalysts.map(s => ({ ...s, clusterId: revenueClusterId })),
    ];

    for (const sub of allSubCatalysts) {
      await c.env.DB.prepare(`
        INSERT INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name, total_runs, successful_runs, success_rate, avg_confidence, status, threshold_success_green, threshold_success_amber, threshold_success_red)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'green', 90, 70, 50)
      `).bind(crypto.randomUUID(), tenantId, sub.clusterId, sub.name).run();
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
    await c.env.DB.prepare(`
      INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), tenantId, overallHealthScore, JSON.stringify(healthDimensions), now).run();

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
      await c.env.DB.prepare(
        `INSERT INTO health_score_history (id, tenant_id, overall_score, dimensions, catalyst_name, recorded_at) VALUES (?, ?, ?, ?, 'System Health Check', ?)`
      ).bind(crypto.randomUUID(), tenantId, hh.score, JSON.stringify(hhDims), d.toISOString()).run();
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
    const metricIds: string[] = [];
    for (const pm of processMetricsData) {
      const pmId = crypto.randomUUID();
      metricIds.push(pmId);
      await c.env.DB.prepare(
        `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, domain, category, threshold_green, threshold_amber, threshold_red, trend, source_system, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(pmId, tenantId, pm.name, pm.value, pm.unit, pm.status, pm.domain, pm.category, pm.thresholdGreen, pm.thresholdAmber, pm.thresholdRed, JSON.stringify(pm.trend), pm.sourceSystem, now).run();
    }
    console.log(`[VantaX Seeder] Seeded ${processMetricsData.length} process metrics`);

    // STEP 12d: Process Metric History for "Metrics Over Time" chart
    for (let mi = 0; mi < Math.min(3, processMetricsData.length); mi++) {
      const pm = processMetricsData[mi];
      for (let mo = -5; mo <= 0; mo++) {
        const d = new Date(); d.setMonth(d.getMonth() + mo);
        const histVal = pm.trend[Math.max(0, mo + 5)] ?? pm.value;
        await c.env.DB.prepare(
          `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), tenantId, metricIds[mi], histVal, d.toISOString()).run();
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
      await c.env.DB.prepare(
        `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, 'active', ?)`
      ).bind(crypto.randomUUID(), tenantId, ra.title, ra.description, ra.severity, ra.category, ra.probability, ra.impactValue, JSON.stringify(ra.actions), now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO anomalies (id, tenant_id, metric, severity, deviation, expected_value, actual_value, hypothesis, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
      ).bind(crypto.randomUUID(), tenantId, an.metric, an.severity, an.deviation, an.expectedValue, an.actualValue, an.description, now).run();
    }
    console.log(`[VantaX Seeder] Seeded ${anomaliesData.length} anomalies`);

    // STEP 12g: Catalyst Actions
    const catalystActionsData = [
      { clusterId: financeClusterId, catalystName: 'GR/IR Reconciliation', action: 'Auto-matched 45 of 55 GR/IR items with 87.2% confidence', status: 'completed', confidence: 0.872, reasoning: 'High match rates on PO-invoice pairs with exact quantity and within 1% price tolerance.' },
      { clusterId: financeClusterId, catalystName: 'AP Invoice Validation', action: 'Flagged 3 potential duplicate invoices totalling R52,400', status: 'pending', confidence: 0.78, reasoning: 'Vendor reference patterns suggest possible duplicate submissions. Manual review recommended.' },
      { clusterId: financeClusterId, catalystName: 'Bank Reconciliation', action: 'Reconciled 55 of 80 bank transactions automatically', status: 'completed', confidence: 0.845, reasoning: 'EFT payments matched using reference and amount. 15 items require manual matching due to new reference format.' },
      { clusterId: supplyChainClusterId, catalystName: 'Inventory Reconciliation', action: 'Identified 4 high-value items with >10% count variance', status: 'in_progress', confidence: 0.91, reasoning: 'Systematic shortage pattern in Warehouse B — possible receiving process breakdown.' },
      { clusterId: revenueClusterId, catalystName: 'Sales Order Matching', action: 'Matched 55 of 80 billing documents to AR postings', status: 'completed', confidence: 0.82, reasoning: 'Primary match on document number and amount. 10 items show amount variances within tolerance.' },
      { clusterId: supplyChainClusterId, catalystName: 'Demand Forecasting', action: 'Generated Q3 demand forecast — 12% volume increase projected', status: 'completed', confidence: 0.74, reasoning: 'Seasonal patterns and order pipeline analysis suggest Q3 uptick. Load shedding impact factored in as 8% production constraint.' },
      { clusterId: financeClusterId, catalystName: 'AP Invoice Validation', action: 'Processing R1.2M in pending invoice approvals', status: 'in_progress', confidence: 0.85, reasoning: 'Batch of 12 invoices from 3 major suppliers awaiting 3-way match verification.' },
    ];
    for (const ca of catalystActionsData) {
      await c.env.DB.prepare(
        `INSERT INTO catalyst_actions (id, tenant_id, cluster_id, catalyst_name, action, status, confidence, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, ca.clusterId, ca.catalystName, ca.action, ca.status, ca.confidence, ca.reasoning, now).run();
    }
    console.log(`[VantaX Seeder] Seeded ${catalystActionsData.length} catalyst actions`);

    // STEP 12h: Agent Deployments (Control Plane)
    const agentDeployments = [
      { clusterId: financeClusterId, name: 'Finance Reconciliation Agent', agentType: 'reconciliation', status: 'running', version: '2.4.1', healthScore: 94, uptime: 99.7, tasksExecuted: 1245 },
      { clusterId: supplyChainClusterId, name: 'Supply Chain Monitor', agentType: 'monitoring', status: 'running', version: '2.4.1', healthScore: 88, uptime: 98.5, tasksExecuted: 892 },
      { clusterId: revenueClusterId, name: 'Revenue Cycle Agent', agentType: 'reconciliation', status: 'running', version: '2.4.1', healthScore: 91, uptime: 99.2, tasksExecuted: 678 },
      { clusterId: financeClusterId, name: 'AP Validation Agent', agentType: 'validation', status: 'running', version: '2.3.8', healthScore: 96, uptime: 99.9, tasksExecuted: 2034 },
      { clusterId: null, name: 'Radar Signal Collector', agentType: 'intelligence', status: 'running', version: '1.2.0', healthScore: 85, uptime: 97.8, tasksExecuted: 156 },
    ];
    for (const ad of agentDeployments) {
      await c.env.DB.prepare(
        `INSERT INTO agent_deployments (id, tenant_id, cluster_id, name, agent_type, status, deployment_model, version, health_score, uptime, tasks_executed, config, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?, 'saas', ?, ?, ?, ?, '{}', ?)`
      ).bind(crypto.randomUUID(), tenantId, ad.clusterId, ad.name, ad.agentType, ad.status, ad.version, ad.healthScore, ad.uptime, ad.tasksExecuted, now).run();
    }
    console.log(`[VantaX Seeder] Seeded ${agentDeployments.length} agent deployments`);

    // Step 10: Create Executive Briefing
    await c.env.DB.prepare(`
      INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at, health_delta, red_metric_count, anomaly_count, active_risk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), tenantId,
      'Daily Executive Briefing - ' + new Date().toLocaleDateString(),
      'VantaX SAP operations showing mixed performance. Critical attention needed in Supply Chain (inventory variance 21.7%) and Revenue Recognition (26.3% timing differences).',
      JSON.stringify([
        'High GR/IR Discrepancy Rate — 17% exceeds 10% threshold (Financial)',
        'Inventory Shrinkage Detected — 21.7% variance indicates potential issues (Operational)',
        'Revenue Recognition Delay — 26.3% not recognized in correct period (Compliance)',
        'Duplicate Payment Risk — AP validation detected duplicates (Financial)',
      ]),
      JSON.stringify([
        'Process Automation — estimated R 2.5M savings by Q2 2025',
        'System Integration — estimated R 1.8M savings by Q3 2025',
      ]),
      JSON.stringify([
        { kpi: 'Match Rate', movement: '-5.2%', period: 'vs last month' },
        { kpi: 'Exception Rate', movement: '+3.1%', period: 'vs last month' },
        { kpi: 'Processing Time', movement: '-12s', period: 'vs last month' },
      ]),
      JSON.stringify([
        'Approve inventory audit budget (R 500K)',
        'Review revenue recognition policy with CFO',
        'Prioritize GR/IR process improvement',
      ]),
      now,
      -1.2,  // health_delta
      3,     // red_metric_count (Bank Recon, Inventory, OEE)
      5,     // anomaly_count
      7      // active_risk_count
    ).run();

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
      await c.env.DB.prepare(
        `INSERT INTO radar_signals (id, tenant_id, source, signal_type, title, description, url, raw_data, severity, relevance_score, status, detected_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?, ?, 'analysed', ?, ?)`
      ).bind(sigId, tenantId, sig.source, sig.type, sig.title, sig.description, sig.severity, sig.relevance, now, now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO radar_signal_impacts (id, tenant_id, signal_id, dimension, impact_direction, impact_magnitude, affected_metrics, recommended_actions, llm_reasoning, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Analysis generated by Atheon Intelligence based on signal context and current health dimensions.', ?)`
      ).bind(impId, tenantId, signalIds[imp.sigIdx], imp.dimension, imp.direction, imp.magnitude, JSON.stringify(imp.metrics), JSON.stringify(imp.actions), now).run();
    }

    // Seed strategic context
    const ctxId = crypto.randomUUID();
    await c.env.DB.prepare(
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
    ).run();

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
      await c.env.DB.prepare(
        `INSERT INTO diagnostic_analyses (id, tenant_id, metric_id, metric_name, metric_value, metric_status, trigger_type, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'auto', 'completed', ?, ?)`
      ).bind(analysisId, tenantId, crypto.randomUUID(), dm.name, dm.value, dm.status, now, now).run();

      // L0-L3 causal chain for each
      const chains = [
        { level: 0, type: 'direct', title: `${dm.name} at ${dm.value}%`, desc: `Metric ${dm.name} is in ${dm.status} status at ${dm.value}%, below target thresholds.`, confidence: 95, priority: dm.status === 'red' ? 'critical' : 'high', effort: 'low' },
        { level: 1, type: 'direct', title: `Data quality issues in source systems`, desc: `Inconsistent data entry and delayed postings in SAP S/4HANA are causing reconciliation mismatches. Manual data entry errors account for approximately 15% of discrepancies.`, confidence: 80, priority: 'high', effort: 'medium' },
        { level: 2, type: 'contributing', title: `Process timing gaps between systems`, desc: `Cut-off timing differences between sub-systems create temporary reconciliation breaks. Month-end close procedures do not adequately address inter-system timing gaps.`, confidence: 70, priority: 'medium', effort: 'medium' },
        { level: 3, type: 'systemic', title: `Lack of real-time integration layer`, desc: `Batch processing architecture means reconciliation data is always stale by 4-8 hours. A real-time event-driven integration would eliminate most timing-related discrepancies.`, confidence: 60, priority: 'medium', effort: 'high' },
      ];

      for (const ch of chains) {
        const chainId = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO diagnostic_causal_chains (id, tenant_id, analysis_id, level, cause_type, title, description, confidence, evidence, related_metrics, recommended_fix, fix_priority, fix_effort, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?)`
        ).bind(chainId, tenantId, analysisId, ch.level, ch.type, ch.title, ch.desc, ch.confidence, `Review and address: ${ch.title}`, ch.priority, ch.effort, now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO catalyst_patterns (id, tenant_id, pattern_type, title, description, frequency, first_seen, last_seen, affected_clusters, affected_sub_catalysts, severity, status, recommended_actions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '[]', ?)`
      ).bind(patId, tenantId, pat.type, pat.title, pat.desc, pat.freq, thirtyDaysAgo, now, JSON.stringify(pat.clusters), JSON.stringify(pat.subs), pat.severity, now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO competitors (id, tenant_id, name, industry, estimated_revenue, market_share, strengths, weaknesses, last_updated, signals_count)
         VALUES (?, ?, ?, ?, 'undisclosed', ?, ?, ?, ?, 0)`
      ).bind(crypto.randomUUID(), tenantId, comp.name, comp.industry, comp.marketShare, JSON.stringify(comp.strengths), JSON.stringify(comp.weaknesses), now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO market_benchmarks (id, tenant_id, industry, metric_name, benchmark_value, benchmark_unit, source, measured_at)
         VALUES (?, ?, 'general', ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, bm.name, bm.value, bm.unit, bm.source, now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO regulatory_events (id, tenant_id, title, description, effective_date, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, re.title, re.body, re.effectiveDate, re.status).run();
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
      await c.env.DB.prepare(
        `INSERT INTO root_cause_analyses (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, impact_summary, status, generated_at)
         VALUES (?, ?, ?, ?, ?, '[]', 85, ?, 'active', ?)`
      ).bind(rcaId, tenantId, crypto.randomUUID(), rca.metricName, rca.status, `Metric value: ${rca.metricValue}`, now).run();

      for (const f of rca.factors) {
        await c.env.DB.prepare(
          `INSERT INTO causal_factors (id, rca_id, tenant_id, layer, factor_type, title, description, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), rcaId, tenantId, `L${f.level}`, f.category, f.title, f.description, f.confidence, now).run();
      }

      for (const p of rca.prescriptions) {
        await c.env.DB.prepare(
          `INSERT INTO diagnostic_prescriptions (id, rca_id, tenant_id, priority, title, description, expected_impact, effort_level, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        ).bind(crypto.randomUUID(), rcaId, tenantId, p.priority, p.title, p.description, `${p.estimatedImpact}% improvement`, p.effort, now).run();
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
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO catalyst_effectiveness (id, tenant_id, cluster_id, sub_catalyst_name, period_start, period_end, runs_count, success_rate, avg_match_rate, avg_duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, financeClusterId, eff.subCatalystName, new Date(Date.now() - 30*86400000).toISOString(), now, eff.matchRate, eff.matchRate, eff.avgProcessingTime * 1000, now).run();
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
      await c.env.DB.prepare(
        `INSERT INTO catalyst_dependencies (id, tenant_id, source_cluster_id, source_sub_catalyst, target_cluster_id, target_sub_catalyst, dependency_type, strength, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, financeClusterId, dep.from, financeClusterId, dep.to, dep.type, dep.strength, dep.desc).run();
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
      await c.env.DB.prepare(
        `INSERT INTO catalyst_prescriptions (id, tenant_id, cluster_id, sub_catalyst_name, prescription_type, title, description, sap_transactions, expected_impact, effort_level, priority, status, created_at)
         VALUES (?, ?, ?, 'General', 'optimization', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, financeClusterId, cp.title, cp.description, JSON.stringify([cp.sapTransaction]), `R ${(cp.estimatedSavings / 1000).toFixed(0)}K savings`, cp.effort, cp.priority, cp.status, now).run();
    }
    console.log(`[VantaX Seeder] Seeded ${catalystPrescriptions.length} catalyst prescriptions`);

    // ── STEP: Seed Run Analytics ──
    console.log('[VantaX Seeder] Seeding catalyst run analytics...');
    const runAnalyticsData = [
      {
        clusterId: financeClusterId, subCatalystName: 'GR/IR Reconciliation',
        totalItems: 55, completed: 45, exceptions: 7, escalated: 2, pending: 1, autoApproved: 38,
        avgConf: 0.872, minConf: 0.34, maxConf: 0.99, durationMs: 45200,
        insights: ['High overall confidence — most items processed automatically.', '87% auto-approved — high automation rate.', '2 item(s) escalated for human review.'],
      },
      {
        clusterId: financeClusterId, subCatalystName: 'AP Invoice Validation',
        totalItems: 40, completed: 34, exceptions: 4, escalated: 1, pending: 1, autoApproved: 30,
        avgConf: 0.91, minConf: 0.42, maxConf: 0.98, durationMs: 28400,
        insights: ['High overall confidence — most items processed automatically.', '88% auto-approved — high automation rate.', 'Wide confidence spread — some items may need manual review while others auto-process.'],
      },
      {
        clusterId: financeClusterId, subCatalystName: 'Bank Reconciliation',
        totalItems: 80, completed: 55, exceptions: 18, escalated: 4, pending: 3, autoApproved: 42,
        avgConf: 0.685, minConf: 0.18, maxConf: 0.97, durationMs: 62100,
        insights: ['Exception rate is high (23%). Review exception patterns for automation opportunities.', '4 item(s) escalated for human review.', 'Wide confidence spread — some items may need manual review while others auto-process.'],
      },
      {
        clusterId: supplyChainClusterId, subCatalystName: 'Inventory Reconciliation',
        totalItems: 45, completed: 25, exceptions: 15, escalated: 3, pending: 2, autoApproved: 18,
        avgConf: 0.556, minConf: 0.12, maxConf: 0.95, durationMs: 38700,
        insights: ['Exception rate is high (33%). Review exception patterns for automation opportunities.', 'Low overall confidence — consider reviewing data quality or mappings.', '3 item(s) escalated for human review.'],
      },
      {
        clusterId: revenueClusterId, subCatalystName: 'Sales Order Matching',
        totalItems: 32, completed: 22, exceptions: 7, escalated: 2, pending: 1, autoApproved: 17,
        avgConf: 0.745, minConf: 0.28, maxConf: 0.96, durationMs: 52300,
        insights: ['Exception rate is high (22%). Review exception patterns for automation opportunities.', '2 item(s) escalated for human review.'],
      },
    ];
    for (const ra of runAnalyticsData) {
      const runId = crypto.randomUUID();
      const dist: Record<string, number> = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
      // Simulate confidence distribution from avgConf
      const total = ra.totalItems;
      if (ra.avgConf > 0.8) { dist['80-100'] = Math.round(total * 0.6); dist['60-80'] = Math.round(total * 0.25); dist['40-60'] = Math.round(total * 0.1); dist['20-40'] = Math.round(total * 0.03); dist['0-20'] = Math.round(total * 0.02); }
      else if (ra.avgConf > 0.6) { dist['80-100'] = Math.round(total * 0.3); dist['60-80'] = Math.round(total * 0.35); dist['40-60'] = Math.round(total * 0.2); dist['20-40'] = Math.round(total * 0.1); dist['0-20'] = Math.round(total * 0.05); }
      else { dist['80-100'] = Math.round(total * 0.15); dist['60-80'] = Math.round(total * 0.2); dist['40-60'] = Math.round(total * 0.3); dist['20-40'] = Math.round(total * 0.2); dist['0-20'] = Math.round(total * 0.15); }

      await c.env.DB.prepare(
        `INSERT INTO catalyst_run_analytics (id, tenant_id, cluster_id, sub_catalyst_name, run_id, completed_at, duration_ms, total_items, completed_items, exception_items, escalated_items, pending_items, auto_approved_items, avg_confidence, min_confidence, max_confidence, confidence_distribution, status, insights) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, ra.clusterId, ra.subCatalystName, runId,
        ra.durationMs, ra.totalItems, ra.completed, ra.exceptions, ra.escalated, ra.pending, ra.autoApproved,
        ra.avgConf, ra.minConf, ra.maxConf, JSON.stringify(dist), JSON.stringify(ra.insights),
      ).run();
    }
    console.log(`[VantaX Seeder] Seeded ${runAnalyticsData.length} run analytics records`);

    // ── STEP: Seed §11.7 Atheon Score History ──
    console.log('[VantaX Seeder] Seeding §11 Atheon Score history...');
    const scoreMonths = [
      { offset: -5, score: 52 }, { offset: -4, score: 56 }, { offset: -3, score: 61 },
      { offset: -2, score: 65 }, { offset: -1, score: 69 }, { offset: 0, score: 73 },
    ];
    for (const sm of scoreMonths) {
      const d = new Date(); d.setMonth(d.getMonth() + sm.offset);
      await c.env.DB.prepare(
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
      ).run();
    }
    console.log('[VantaX Seeder] Seeded 6 Atheon Score history records');

    // ── STEP: Seed §11.2 Baseline Snapshots ──
    console.log('[VantaX Seeder] Seeding §11 baseline snapshots...');
    const baselineDate = new Date(); baselineDate.setMonth(baselineDate.getMonth() - 5);
    await c.env.DB.prepare(
      `INSERT INTO baseline_snapshots (id, tenant_id, snapshot_type, health_score, dimensions, metric_count_green, metric_count_amber, metric_count_red, total_discrepancy_value, total_process_conformance, avg_catalyst_success_rate, roi_at_snapshot, captured_at) VALUES (?, ?, 'day_zero', 48, ?, 3, 5, 4, 2450000, 62.5, 45.0, 0, ?)`
    ).bind(crypto.randomUUID(), tenantId,
      JSON.stringify({ finance: 45, operations: 52, compliance: 38, revenue: 55, supply_chain: 50 }),
      baselineDate.toISOString()
    ).run();
    await c.env.DB.prepare(
      `INSERT INTO baseline_snapshots (id, tenant_id, snapshot_type, health_score, dimensions, metric_count_green, metric_count_amber, metric_count_red, total_discrepancy_value, total_process_conformance, avg_catalyst_success_rate, roi_at_snapshot, captured_at) VALUES (?, ?, 'manual', 73, ?, 7, 3, 2, 850000, 81.3, 72.0, 4850000, ?)`
    ).bind(crypto.randomUUID(), tenantId,
      JSON.stringify({ finance: 75, operations: 71, compliance: 68, revenue: 78, supply_chain: 73 }),
      now
    ).run();
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
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO health_targets (id, tenant_id, target_type, target_name, target_value, target_deadline, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`
      ).bind(crypto.randomUUID(), tenantId, t.type, t.name, t.value, dl.toISOString().split('T')[0]).run();
    }
    console.log('[VantaX Seeder] Seeded 4 health targets');

    // ── STEP: Seed §11.4 Anonymised Benchmarks ──
    console.log('[VantaX Seeder] Seeding §11 anonymised benchmarks...');
    const benchDimensions = ['finance', 'operations', 'compliance', 'revenue', 'supply_chain'];
    for (const dim of benchDimensions) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO anonymised_benchmarks (id, industry, dimension, period, tenant_count, avg_score, p25_score, p50_score, p75_score, min_score, max_score) VALUES (?, 'manufacturing', ?, '2026-Q1', 8, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), dim,
        55 + Math.round(Math.random() * 15),
        40 + Math.round(Math.random() * 10),
        52 + Math.round(Math.random() * 10),
        65 + Math.round(Math.random() * 10),
        25 + Math.round(Math.random() * 10),
        80 + Math.round(Math.random() * 15),
      ).run();
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
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO resolution_patterns (id, industry, pattern_signature, resolution_count, avg_resolution_days, avg_value_recovered, common_fix_types, last_updated) VALUES (?, 'manufacturing', ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), rp.sig, rp.count, rp.days, rp.value, JSON.stringify(rp.fixes), now).run();
    }
    console.log('[VantaX Seeder] Seeded 5 resolution patterns');

    // ── STEP: Seed V2 ROI Tracking ──
    console.log('[VantaX Seeder] Seeding V2 ROI tracking...');
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO roi_tracking (id, tenant_id, period, total_discrepancy_value_identified, total_discrepancy_value_recovered, total_downstream_losses_prevented, total_person_hours_saved, licence_cost_annual, roi_multiple, calculated_at)
       VALUES (?, ?, 'Q1 2026', 4850000, 3200000, 1800000, 2400, 580000, 8.3, ?)`
    ).bind(crypto.randomUUID(), tenantId, now).run();
    console.log('[VantaX Seeder] Seeded ROI tracking record');

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
        await c.env.DB.prepare(
          `INSERT INTO industry_radar_seeds (id, industry, category, title, summary, default_magnitude, default_direction, region)
           VALUES (?, ?, ?, ?, ?, 5, 'headwind', 'ZA')`
        ).bind(crypto.randomUUID(), seed.industry, seed.category || 'general', seed.title, seed.description || '').run();
      } else if (seed.type === 'benchmark') {
        await c.env.DB.prepare(
          `INSERT INTO industry_benchmark_seeds (id, industry, metric_name, benchmark_value, benchmark_unit, source, region)
           VALUES (?, ?, ?, ?, ?, ?, 'ZA')`
        ).bind(crypto.randomUUID(), seed.industry, (seed as Record<string, unknown>).name, (seed as Record<string, unknown>).value, (seed as Record<string, unknown>).unit, (seed as Record<string, unknown>).source).run();
      } else if (seed.type === 'regulatory') {
        await c.env.DB.prepare(
          `INSERT INTO industry_regulatory_seeds (id, industry, title, description, jurisdiction)
           VALUES (?, ?, ?, ?, 'ZA')`
        ).bind(crypto.randomUUID(), seed.industry, seed.title, (seed as Record<string, unknown>).body || '').run();
      }
    }
    console.log('[VantaX Seeder] Seeded industry playbook seeds');

    // ── Value Assessment Engine Seed Data ─────────────────────────────
    // Create a completed value assessment with realistic findings
    const vaAssessmentId = `va-demo-${tenantId.slice(0, 8)}`;

    // Clean up any existing value assessment data
    for (const vaTable of ['assessment_value_summary', 'assessment_process_timing', 'assessment_data_quality', 'assessment_findings', 'assessment_runs']) {
      try { await c.env.DB.prepare(`DELETE FROM ${vaTable} WHERE tenant_id = ?`).bind(tenantId).run(); } catch { /* table may not exist */ }
    }
    try { await c.env.DB.prepare(`DELETE FROM assessments WHERE tenant_id = ? AND id LIKE 'va-demo-%'`).bind(tenantId).run(); } catch { /* ignore */ }

    // Create the assessment record
    try {
      await c.env.DB.prepare(
        `INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, erp_connection_id, status, config, created_by, completed_at)
         VALUES (?, ?, 'VantaX (Pty) Ltd', 'technology', ?, 'complete', '{"mode":"full","outcomeFeePercent":20}', 'system', datetime('now'))`
      ).bind(vaAssessmentId, tenantId, connectionId).run();
    } catch { /* may exist */ }

    // Assessment runs (4 domains)
    const vaRunDomains = [
      { id: `va-run-fin-${tenantId.slice(0,6)}`, domain: 'finance', status: 'complete', findingsCount: 6, immediateValue: 342000, ongoingValue: 28500 },
      { id: `va-run-proc-${tenantId.slice(0,6)}`, domain: 'procurement', status: 'complete', findingsCount: 5, immediateValue: 215000, ongoingValue: 38000 },
      { id: `va-run-wf-${tenantId.slice(0,6)}`, domain: 'workforce', status: 'complete', findingsCount: 3, immediateValue: 78000, ongoingValue: 15500 },
      { id: `va-run-sc-${tenantId.slice(0,6)}`, domain: 'supply_chain', status: 'complete', findingsCount: 4, immediateValue: 145000, ongoingValue: 23000 },
    ];
    for (const run of vaRunDomains) {
      await c.env.DB.prepare(
        `INSERT INTO assessment_runs (id, assessment_id, tenant_id, cluster_name, sub_catalyst_name, domain, status, source_record_count, discrepancies, total_source_value, total_discrepancy_value, findings, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'value_assessment', ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hour'))`
      ).bind(run.id, vaAssessmentId, tenantId, run.domain, run.domain, run.status, run.findingsCount, run.findingsCount, run.immediateValue + run.ongoingValue, run.immediateValue, JSON.stringify({ immediateValue: run.immediateValue, ongoingMonthlyValue: run.ongoingValue })).run();
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
      await c.env.DB.prepare(
        `INSERT INTO assessment_findings (id, assessment_id, run_id, tenant_id, finding_type, severity, title, description, affected_records, financial_impact, evidence, root_cause, prescription, category, immediate_value, ongoing_monthly_value, domain, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), vaAssessmentId, f.runId, tenantId, f.type, f.severity, f.title, f.desc, f.affected, f.impact, JSON.stringify(f.evidence), f.rootCause, f.prescription, f.category, f.immediate, f.ongoing, f.domain).run();
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
      await c.env.DB.prepare(
        `INSERT INTO assessment_data_quality (id, assessment_id, tenant_id, table_name, total_records, complete_records, completeness_pct, field_scores, referential_issues, duplicate_records, orphan_records, stale_records, overall_quality_score, issues, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', datetime('now'))`
      ).bind(crypto.randomUUID(), vaAssessmentId, tenantId, dq.table, dq.total, dq.complete, dq.pct, JSON.stringify(dq.fieldScores), dq.refIssues, dq.dups, dq.orphans, dq.stale, dq.quality).run();
    }

    // Process Timing records (4 processes)
    const vaTimingRecords = [
      { process: 'Order-to-Cash', avg: 28.5, median: 26.0, p90: 42.0, benchmark: 21, bottleneck: 'Billing creation', bottleneckDays: 5.2, records: 72, exceeding: 28, impact: 45000 },
      { process: 'Procure-to-Pay', avg: 18.3, median: 16.0, p90: 28.0, benchmark: 12, bottleneck: 'Approval routing', bottleneckDays: 4.2, records: 80, exceeding: 35, impact: 134600 },
      { process: 'Invoice Approval', avg: 6.8, median: 5.0, p90: 14.0, benchmark: 3, bottleneck: 'Manager sign-off', bottleneckDays: 3.1, records: 152, exceeding: 67, impact: 28000 },
      { process: 'Month-End Close', avg: 12.0, median: 11.0, p90: 16.0, benchmark: 5, bottleneck: 'Intercompany reconciliation', bottleneckDays: 4.5, records: 12, exceeding: 12, impact: 35000 },
    ];

    for (const t of vaTimingRecords) {
      await c.env.DB.prepare(
        `INSERT INTO assessment_process_timing (id, assessment_id, tenant_id, process_name, avg_cycle_time_days, median_cycle_time_days, p90_cycle_time_days, benchmark_cycle_time_days, bottleneck_step, bottleneck_avg_days, records_analysed, records_exceeding_benchmark, financial_impact_of_delay, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'))`
      ).bind(crypto.randomUUID(), vaAssessmentId, tenantId, t.process, t.avg, t.median, t.p90, t.benchmark, t.bottleneck, t.bottleneckDays, t.records, t.exceeding, t.impact).run();
    }

    // Value Summary (1 aggregate record)
    const totalImmediate = vaRunDomains.reduce((s, r) => s + r.immediateValue, 0); // 780,000
    const totalOngoingMonthly = vaRunDomains.reduce((s, r) => s + r.ongoingValue, 0); // 105,000
    const totalOngoingAnnual = totalOngoingMonthly * 12; // 1,260,000
    const outcomeFee = totalOngoingMonthly * 0.20; // R21,000/mo
    const paybackDays = Math.round((outcomeFee / ((totalImmediate / 365) + (totalOngoingMonthly / 30))) * 30); // ~42 days

    await c.env.DB.prepare(
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
    ).run();

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
    try {
      billingDemo = await materialiseDemoBilling(c.env.DB, tenantId);
      console.log('[VantaX Seeder] Billing demo materialised:', billingDemo);
    } catch (e) {
      console.error('[VantaX Seeder] Billing demo materialise failed:', e);
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
        billing: billingDemo,
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
