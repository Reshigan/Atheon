export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  DASHBOARD_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string; // Bug #12: Separate encryption key from JWT_SECRET
  AZURE_AD_CLIENT_SECRET: string;
  AZURE_AD_TENANT_ID: string;
  AZURE_AD_CLIENT_ID: string;
  // BUG-27: Microsoft Graph (contact form + email delivery)
  MS_GRAPH_CLIENT_ID: string;
  MS_GRAPH_CLIENT_SECRET: string;
  MS_GRAPH_TENANT_ID: string;
  // BUG-11: SSO redirect URI (optional, defaults to production URL)
  SSO_REDIRECT_URI?: string;
  // BUG-03: Demo login secret (only used in non-production)
  DEMO_LOGIN_SECRET?: string;
  OLLAMA_API_KEY: string;
  ENVIRONMENT: string;
  /** One-time setup secret for initial admin provisioning. Must match wrangler secret. */
  SETUP_SECRET?: string;
  SENTRY_DSN?: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  permissions: string[];
}

export interface AppBindings {
  Bindings: Env;
  Variables: { auth: AuthContext };
}

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export type DeploymentModel = 'saas' | 'on-premise' | 'hybrid';
export type AutonomyTier = 'read-only' | 'assisted' | 'transactional';
export type AtheonLayer = 'apex' | 'pulse' | 'catalysts' | 'mind' | 'memory';
export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IndustryVertical = 'fmcg' | 'healthcare' | 'mining' | 'general' | 'agriculture' | 'logistics' | 'technology' | 'manufacturing';
