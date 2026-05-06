export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  DASHBOARD_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string; // Separate encryption key from JWT_SECRET for enhanced security
  AZURE_AD_CLIENT_SECRET: string;
  AZURE_AD_TENANT_ID: string;
  AZURE_AD_CLIENT_ID: string;
  // Microsoft Graph credentials for contact form and email delivery
  MS_GRAPH_CLIENT_ID: string;
  MS_GRAPH_CLIENT_SECRET: string;
  MS_GRAPH_TENANT_ID: string;
  // SSO redirect URI (optional, defaults to production URL)
  SSO_REDIRECT_URI?: string;
  /** Shared OIDC client secret used as a fallback when sso_configs.client_secret is unset.
   *  Per-tenant configs should set client_secret directly; this exists so a small
   *  multi-tenant deployment can share a single IdP app for testing. */
  OIDC_CLIENT_SECRET?: string;
  /** Stripe API key (sk_live_… or sk_test_…). Required for /api/billing/checkout
   *  to create real Stripe Checkout Sessions. When unset, the endpoint returns
   *  a 503 with a clear message — Atheon ops can see this in Sentry without
   *  customers seeing scary stack traces. */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret (whsec_…). When set, /api/billing/webhook
   *  verifies the `Stripe-Signature` header before processing the event.
   *  When unset, the webhook accepts unsigned events — only safe in dev. */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Stripe price IDs per (plan, billing_cycle). JSON-encoded:
   *    {"starter:monthly":"price_…","starter:annual":"price_…",…}
   *  Lets Atheon ops point staging vs prod at different Stripe products
   *  without redeploying. Falls back to a hardcoded test-mode mapping. */
  STRIPE_PRICE_MAP?: string;
  // Demo login secret (only used in non-production environments)
  DEMO_LOGIN_SECRET?: string;
  OLLAMA_API_KEY: string;
  ENVIRONMENT: string;
  /**
   * Deployment role distinguishes Atheon's own SaaS / control-plane
   * instance from a customer-hosted hybrid / on-premise instance:
   *
   *   - 'cloud'    (default): Atheon's hosted Workers — exposes
   *                /api/agent/license-check for customer instances to
   *                phone home against. Skip license-enforcement
   *                middleware (customers don't gate their own license).
   *   - 'customer': running inside a customer's docker-compose / k8s.
   *                Periodically calls home to ATHEON_LICENSE_CHECK_URL
   *                with LICENCE_KEY; if revoked, license-enforcement
   *                middleware returns 503 on data-plane requests.
   *
   * Wrangler.toml sets this to 'cloud' for the SaaS deploy; the
   * customer docker-compose sets it to 'customer'. Tests default to
   * unset / 'cloud' so the middleware no-ops.
   */
  DEPLOYMENT_ROLE?: 'cloud' | 'customer';
  /** URL to phone home for license validation (customer-side only). */
  ATHEON_LICENSE_CHECK_URL?: string;
  /** Customer-deploy licence key (matches managed_deployments.licence_key). */
  LICENCE_KEY?: string;
  /** One-time setup secret for initial admin provisioning. Must match wrangler secret. */
  SETUP_SECRET?: string;
  SENTRY_DSN?: string;
  /**
   * Queue binding for catalyst execution fan-out + DAG chaining.
   * Optional so local/test environments without the binding still compile.
   * Declared in wrangler.toml as [[queues.producers]] queue="catalyst-tasks".
   */
  CATALYST_QUEUE?: Queue<unknown>;
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
  Variables: {
    auth: AuthContext;
    /** Set by requestIdMiddleware (workers/api/src/middleware/requestid.ts) on every request. */
    requestId: string;
    /** Set by webhookHmacMiddleware when an HMAC-signed request matches a
     *  registered source. Downstream handlers (audit, ingest routes) read
     *  this for source-attribution on inserts. */
    webhookSourceId?: string;
    /** Set by webhookHmacMiddleware (which reads body to verify HMAC).
     *  Downstream handlers can re-parse with JSON.parse(c.get('rawBody'))
     *  instead of re-reading c.req which is no longer consumable. */
    rawBody?: string;
  };
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
export type IndustryVertical = 'fmcg' | 'healthcare' | 'mining' | 'general' | 'agriculture' | 'logistics' | 'technology' | 'manufacturing' | 'retail';
