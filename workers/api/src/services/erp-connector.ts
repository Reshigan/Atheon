/**
 * ERP Connector Service
 * Real OAuth flows, connection testing, and data sync for SAP, Salesforce, Workday, Oracle
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

// ── Adapter Registry ──
const adapters: Record<string, ERPAdapter> = {
  sap: sapAdapter,
  salesforce: salesforceAdapter,
  workday: workdayAdapter,
  oracle: oracleAdapter,
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
