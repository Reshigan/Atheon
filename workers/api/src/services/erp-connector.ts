/**
 * ERP Connector Service
 * Real OAuth flows, connection testing, and data sync for SAP, Salesforce, Workday, Oracle, Xero, Sage, Pastel
 */

export interface ERPCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  authUrl?: string;
  tokenUrl?: string;
  scope?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface ERPTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface SyncResult {
  recordsSynced: number;
  recordsFailed: number;
  duration: number;
  entities: { type: string; count: number }[];
  errors: string[];
}

interface ERPAdapter {
  name: string;
  getAuthUrl(credentials: ERPCredentials, state: string): string;
  exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse>;
  testConnection(credentials: ERPCredentials, token: string): Promise<{ connected: boolean; version?: string; message: string }>;
  syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult>;
}

// ── SAP S/4HANA Adapter ──
const sapAdapter: ERPAdapter = {
  name: 'SAP S/4HANA',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/sap/bc/sec/oauth2/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'API_BUSINESS_PARTNER_0001 API_SALES_ORDER_SRV',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/sap/bc/sec/oauth2/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`SAP token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml' },
      });
      return {
        connected: resp.ok,
        version: resp.headers.get('sap-metadata-version') || '2.0',
        message: resp.ok ? 'Connected to SAP S/4HANA OData API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'business_partners': '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$top=1000',
          'sales_orders': '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder?$top=1000',
          'purchase_orders': '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder?$top=1000',
          'materials': '/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product?$top=1000',
          'gl_accounts': '/sap/opu/odata/sap/API_JOURNALENTRYITEMBASIC_SRV/A_JournalEntryItemBasic?$top=1000',
        };
        const path = apiMap[entity] || `/sap/opu/odata/sap/${entity}?$top=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { d?: { results?: unknown[] } };
          const count = data.d?.results?.length || 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Salesforce Adapter ──
const salesforceAdapter: ERPAdapter = {
  name: 'Salesforce',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || 'https://login.salesforce.com/services/oauth2/authorize';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'api refresh_token',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || 'https://login.salesforce.com/services/oauth2/token';
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`Salesforce token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/services/data/v59.0/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json() as { version?: string };
        return { connected: true, version: data.version || 'v59.0', message: 'Connected to Salesforce REST API' };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const soqlMap: Record<string, string> = {
          'accounts': 'SELECT Id,Name,Industry,BillingCity FROM Account LIMIT 1000',
          'contacts': 'SELECT Id,Name,Email,Phone FROM Contact LIMIT 1000',
          'opportunities': 'SELECT Id,Name,Amount,StageName,CloseDate FROM Opportunity LIMIT 1000',
          'leads': 'SELECT Id,Name,Company,Status FROM Lead LIMIT 1000',
          'cases': 'SELECT Id,Subject,Status,Priority FROM Case LIMIT 1000',
        };
        const soql = soqlMap[entity] || `SELECT Id,Name FROM ${entity} LIMIT 1000`;
        const resp = await fetch(
          `${credentials.baseUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
          { headers },
        );
        if (resp.ok) {
          const data = await resp.json() as { totalSize?: number };
          const count = data.totalSize || 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Workday Adapter ──
const workdayAdapter: ERPAdapter = {
  name: 'Workday',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'wd:soapapi',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }),
    });
    if (!resp.ok) throw new Error(`Workday token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/api/v1/workers?limit=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return {
        connected: resp.ok,
        version: 'v40.1',
        message: resp.ok ? 'Connected to Workday REST API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'workers': '/api/v1/workers?limit=1000',
          'positions': '/api/v1/positions?limit=1000',
          'organizations': '/api/v1/organizations?limit=1000',
          'time_off': '/api/v1/timeOffEntries?limit=1000',
          'payroll': '/api/v1/payrollResults?limit=1000',
        };
        const path = apiMap[entity] || `/api/v1/${entity}?limit=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { total?: number; data?: unknown[] };
          const count = data.total || data.data?.length || 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Oracle Fusion Adapter ──
const oracleAdapter: ERPAdapter = {
  name: 'Oracle Fusion',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/oauth2/v1/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'urn:opc:resource:consumer::all',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/oauth2/v1/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }),
    });
    if (!resp.ok) throw new Error(`Oracle token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/fscmRestApi/resources/v1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return {
        connected: resp.ok,
        version: 'v1',
        message: resp.ok ? 'Connected to Oracle Fusion REST API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'suppliers': '/fscmRestApi/resources/v1/suppliers?limit=1000',
          'invoices': '/fscmRestApi/resources/v1/invoices?limit=1000',
          'purchase_orders': '/fscmRestApi/resources/v1/purchaseOrders?limit=1000',
          'gl_journals': '/fscmRestApi/resources/v1/journals?limit=1000',
          'items': '/fscmRestApi/resources/v1/items?limit=1000',
        };
        const path = apiMap[entity] || `/fscmRestApi/resources/v1/${entity}?limit=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { count?: number; items?: unknown[] };
          const count = data.count || data.items?.length || 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Xero Adapter ──
const xeroAdapter: ERPAdapter = {
  name: 'Xero',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access',
      state,
    });
    return `https://login.xero.com/identity/connect/authorize?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const resp = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`Xero token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch('https://api.xero.com/connections', {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const connections = await resp.json() as { tenantId?: string; tenantName?: string }[];
        return {
          connected: true,
          version: '2.0',
          message: `Connected to Xero. ${connections.length} organisation(s) linked.`,
        };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Xero-Tenant-Id': credentials.apiKey || '' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'invoices': '/api.xro/2.0/Invoices?page=1',
          'contacts': '/api.xro/2.0/Contacts?page=1',
          'accounts': '/api.xro/2.0/Accounts',
          'bank_transactions': '/api.xro/2.0/BankTransactions?page=1',
          'payments': '/api.xro/2.0/Payments?page=1',
          'purchase_orders': '/api.xro/2.0/PurchaseOrders?page=1',
          'credit_notes': '/api.xro/2.0/CreditNotes?page=1',
          'items': '/api.xro/2.0/Items?page=1',
          'journals': '/api.xro/2.0/Journals',
          'manual_journals': '/api.xro/2.0/ManualJournals?page=1',
          'employees': '/api.xro/2.0/Employees',
          'tax_rates': '/api.xro/2.0/TaxRates',
          'tracking_categories': '/api.xro/2.0/TrackingCategories',
        };
        const path = apiMap[entity] || `/api.xro/2.0/${entity}`;
        const resp = await fetch(`https://api.xero.com${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as Record<string, unknown[]>;
          const key = Object.keys(data).find(k => Array.isArray(data[k]));
          const count = key ? (data[key] as unknown[]).length : 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Sage Business Cloud Accounting Adapter ──
const sageAdapter: ERPAdapter = {
  name: 'Sage Business Cloud',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || 'https://oauth.accounting.sage.com/authorize';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'full_access',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || 'https://oauth.accounting.sage.com/token';
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`Sage token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const baseApi = credentials.baseUrl || 'https://api.accounting.sage.com/v3.1';
      const resp = await fetch(`${baseApi}/me`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json() as { displayed_as?: string };
        return { connected: true, version: 'v3.1', message: `Connected to Sage: ${data.displayed_as || 'OK'}` };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const baseApi = credentials.baseUrl || 'https://api.accounting.sage.com/v3.1';
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'contacts': '/contacts?items_per_page=200',
          'sales_invoices': '/sales_invoices?items_per_page=200',
          'purchase_invoices': '/purchase_invoices?items_per_page=200',
          'ledger_accounts': '/ledger_accounts?items_per_page=200',
          'bank_accounts': '/bank_accounts',
          'tax_rates': '/tax_rates',
          'products': '/products?items_per_page=200',
          'services': '/services?items_per_page=200',
          'journals': '/journals?items_per_page=200',
          'payments': '/contact_payments?items_per_page=200',
          'bank_transfers': '/bank_transfers?items_per_page=200',
          'stock_items': '/stock_items?items_per_page=200',
        };
        const path = apiMap[entity] || `/${entity}?items_per_page=200`;
        const resp = await fetch(`${baseApi}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { $total?: number; $items?: unknown[] };
          const count = data.$total || data.$items?.length || 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Sage Pastel (Sage 50cloud / Pastel Partner/Xpress) Adapter ──
const pastelAdapter: ERPAdapter = {
  name: 'Sage Pastel',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    // Pastel uses API key authentication, but for on-premise we generate a config URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      state,
    });
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/auth`;
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    // Pastel SDK uses API key; this returns a session-based token
    const resp = await fetch(`${credentials.baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: credentials.apiKey || credentials.clientSecret,
        username: credentials.username,
        password: credentials.password,
        code,
      }),
    });
    if (!resp.ok) throw new Error(`Pastel auth failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/api/v1/company`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-API-Key': credentials.apiKey || '',
          'Accept': 'application/json',
        },
      });
      if (resp.ok) {
        const data = await resp.json() as { CompanyName?: string; Version?: string };
        return {
          connected: true,
          version: data.Version || '2024',
          message: `Connected to Pastel: ${data.CompanyName || 'OK'}`,
        };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-API-Key': credentials.apiKey || '',
      'Accept': 'application/json',
    };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'customers': '/api/v1/customers?limit=500',
          'suppliers': '/api/v1/suppliers?limit=500',
          'invoices': '/api/v1/invoices?limit=500',
          'purchase_orders': '/api/v1/purchase-orders?limit=500',
          'inventory': '/api/v1/inventory-items?limit=500',
          'gl_accounts': '/api/v1/general-ledger/accounts?limit=500',
          'gl_transactions': '/api/v1/general-ledger/transactions?limit=500',
          'bank_accounts': '/api/v1/bank-accounts',
          'employees': '/api/v1/employees?limit=500',
          'tax_types': '/api/v1/tax-types',
          'quotes': '/api/v1/quotes?limit=500',
          'credit_notes': '/api/v1/credit-notes?limit=500',
        };
        const path = apiMap[entity] || `/api/v1/${entity}?limit=500`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { TotalResults?: number; Results?: unknown[] };
          const count = data.TotalResults || data.Results?.length || 0;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Adapter Registry ──
const adapters: Record<string, ERPAdapter> = {
  sap: sapAdapter,
  salesforce: salesforceAdapter,
  workday: workdayAdapter,
  oracle: oracleAdapter,
  xero: xeroAdapter,
  sage: sageAdapter,
  pastel: pastelAdapter,
};

export function getERPAdapter(system: string): ERPAdapter | null {
  return adapters[system.toLowerCase()] || null;
}

export function listERPAdapters(): { system: string; name: string }[] {
  return Object.entries(adapters).map(([system, adapter]) => ({
    system,
    name: adapter.name,
  }));
}
