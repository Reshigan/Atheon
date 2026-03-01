export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  DASHBOARD_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  AZURE_AD_CLIENT_SECRET: string;
  AZURE_AD_TENANT_ID: string;
  AZURE_AD_CLIENT_ID: string;
  OLLAMA_API_KEY: string;
  ENVIRONMENT: string;
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
export type IndustryVertical = 'fmcg' | 'healthcare' | 'mining' | 'general';
