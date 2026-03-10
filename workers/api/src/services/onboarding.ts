/**
 * Customer Onboarding Service
 * Provides a guided setup flow for new tenants:
 *   1. Create tenant record + entitlements
 *   2. Provision admin user with secure password
 *   3. Configure default catalyst clusters for the industry
 *   4. Run initial database migrations/seeds
 *   5. Return onboarding status with next steps
 *
 * Called from POST /api/v1/admin/onboard or the frontend onboarding wizard.
 */

/** Input payload for the onboarding wizard */
export interface OnboardingRequest {
  companyName: string;
  slug: string;
  industry: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  plan?: string;
  region?: string;
  deploymentModel?: string;
}

/** Result of the onboarding process */
export interface OnboardingResult {
  success: boolean;
  tenantId: string;
  adminUserId: string;
  catalystClustersCreated: number;
  steps: Array<{ step: string; status: 'success' | 'skipped' | 'error'; detail?: string }>;
}

/** Default catalyst clusters seeded per industry */
const INDUSTRY_CATALYSTS: Record<string, Array<{ name: string; domain: string; description: string }>> = {
  fmcg: [
    { name: 'Finance & Revenue', domain: 'finance', description: 'Revenue recognition, margin analysis, trade spend optimization' },
    { name: 'Supply Chain', domain: 'operations', description: 'Demand forecasting, inventory optimization, logistics tracking' },
    { name: 'Retail Analytics', domain: 'sales', description: 'POS analytics, category management, promotion effectiveness' },
  ],
  healthcare: [
    { name: 'Financial Operations', domain: 'finance', description: 'Claims processing, revenue cycle management, cost allocation' },
    { name: 'Clinical Operations', domain: 'operations', description: 'Patient flow, resource utilization, compliance monitoring' },
    { name: 'Workforce Management', domain: 'hr', description: 'Staff scheduling, credentialing, labor cost analysis' },
  ],
  mining: [
    { name: 'Financial Control', domain: 'finance', description: 'Cost-per-ton analysis, CAPEX tracking, commodity hedging' },
    { name: 'Production Operations', domain: 'operations', description: 'Production monitoring, equipment utilization, safety compliance' },
    { name: 'Environmental & ESG', domain: 'compliance', description: 'Emissions tracking, water management, rehabilitation costing' },
  ],
  manufacturing: [
    { name: 'Cost Accounting', domain: 'finance', description: 'Standard costing, variance analysis, WIP tracking' },
    { name: 'Production Intelligence', domain: 'operations', description: 'OEE monitoring, quality control, predictive maintenance' },
    { name: 'Procurement', domain: 'procurement', description: 'Supplier performance, RFQ optimization, spend analytics' },
  ],
  technology: [
    { name: 'Revenue Intelligence', domain: 'finance', description: 'SaaS metrics, ARR/MRR tracking, churn analysis' },
    { name: 'Engineering Operations', domain: 'operations', description: 'Sprint velocity, incident response, infrastructure costs' },
    { name: 'Customer Success', domain: 'sales', description: 'NPS tracking, usage analytics, expansion revenue' },
  ],
  general: [
    { name: 'Finance', domain: 'finance', description: 'General ledger analysis, cash flow forecasting, budget variance' },
    { name: 'Operations', domain: 'operations', description: 'Process efficiency, resource utilization, compliance monitoring' },
  ],
};

/**
 * Execute the full customer onboarding flow.
 * Creates tenant, admin user, and default catalysts in a single transaction-like sequence.
 * @param db - D1 database binding
 * @param request - Onboarding configuration
 * @param hashPasswordFn - Password hashing function (injected to avoid circular imports)
 * @returns OnboardingResult with status of each step
 */
export async function onboardCustomer(
  db: D1Database,
  request: OnboardingRequest,
  hashPasswordFn: (password: string) => Promise<string>,
): Promise<OnboardingResult> {
  const steps: OnboardingResult['steps'] = [];
  const tenantId = request.slug;
  const adminUserId = crypto.randomUUID();
  let catalystClustersCreated = 0;

  // Step 1: Create tenant
  try {
    await db.prepare(
      `INSERT INTO tenants (id, name, slug, industry, plan, status, deployment_model, region)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      tenantId,
      request.companyName,
      request.slug,
      request.industry,
      request.plan || 'starter',
      request.deploymentModel || 'saas',
      request.region || 'af-south-1',
    ).run();
    steps.push({ step: 'create_tenant', status: 'success' });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('UNIQUE constraint')) {
      steps.push({ step: 'create_tenant', status: 'skipped', detail: 'Tenant already exists' });
    } else {
      steps.push({ step: 'create_tenant', status: 'error', detail: message });
      return { success: false, tenantId, adminUserId, catalystClustersCreated, steps };
    }
  }

  // Step 2: Create tenant entitlements
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users, autonomy_tiers, sso_enabled, api_access)
       VALUES (?, '["apex","pulse","mind","memory"]', '["finance","operations"]', 10, 25, '["read-only","assisted"]', 0, 1)`
    ).bind(tenantId).run();
    steps.push({ step: 'create_entitlements', status: 'success' });
  } catch (err) {
    steps.push({ step: 'create_entitlements', status: 'error', detail: (err as Error).message });
  }

  // Step 3: Create admin user
  try {
    const passwordHash = await hashPasswordFn(request.adminPassword);
    await db.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
       VALUES (?, ?, ?, ?, 'admin', ?, '["*"]', 'active')`
    ).bind(adminUserId, tenantId, request.adminEmail, request.adminName, passwordHash).run();
    steps.push({ step: 'create_admin_user', status: 'success' });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('UNIQUE constraint')) {
      steps.push({ step: 'create_admin_user', status: 'skipped', detail: 'Admin user already exists' });
    } else {
      steps.push({ step: 'create_admin_user', status: 'error', detail: message });
    }
  }

  // Step 4: Seed default catalyst clusters for the industry
  const industryCatalysts = INDUSTRY_CATALYSTS[request.industry] || INDUSTRY_CATALYSTS.general;
  for (const cat of industryCatalysts) {
    try {
      await db.prepare(
        `INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier)
         VALUES (?, ?, ?, ?, ?, 'inactive', 'read-only')`
      ).bind(
        crypto.randomUUID(),
        tenantId,
        cat.name,
        cat.domain,
        cat.description,
      ).run();
      catalystClustersCreated++;
    } catch (err) {
      steps.push({ step: `create_catalyst_${cat.domain}`, status: 'error', detail: (err as Error).message });
    }
  }
  if (catalystClustersCreated > 0) {
    steps.push({ step: 'seed_catalyst_clusters', status: 'success', detail: `${catalystClustersCreated} clusters created` });
  }

  // Step 5: Create audit log entry for the onboarding
  try {
    await db.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome)
       VALUES (?, ?, ?, 'tenant.onboarded', 'security', 'tenants', ?, 'success')`
    ).bind(
      crypto.randomUUID(),
      tenantId,
      adminUserId,
      JSON.stringify({ companyName: request.companyName, industry: request.industry, plan: request.plan }),
    ).run();
    steps.push({ step: 'audit_log', status: 'success' });
  } catch (err) {
    steps.push({ step: 'audit_log', status: 'error', detail: (err as Error).message });
  }

  const hasErrors = steps.some(s => s.status === 'error');

  return {
    success: !hasErrors,
    tenantId,
    adminUserId,
    catalystClustersCreated,
    steps,
  };
}
