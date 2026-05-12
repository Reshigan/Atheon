/**
 * SPEC-009: Billing & Subscription Management (Stripe integration)
 * Handles subscription lifecycle, checkout, portal, webhooks, and usage metering.
 *
 * Phase 10-19: shared-savings billing endpoints (`/period`, `/periods`).
 * These compute the *Atheon revenue* for a date range from resolved RCAs +
 * verified catalyst actions + causal factor impact_value. They are the
 * dollar-audit-defensible artefact for the shared-savings invoice — every
 * line item carries the originating rca_id and verified action ids so a
 * customer dispute can be traced back to the underlying ERP record.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { requireRole } from '../middleware/tenant';
import { computeBillablePeriod } from '../services/billing-engine';
import { logError } from '../services/logger';

const billing = new Hono<AppBindings>();

// ─── Phase 10-19: Shared-savings billing ──────────────────────
// ISO yyyy-mm-dd validator. Rejects time/zone components so we never
// straddle a timezone boundary on the inclusive/exclusive period math.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validatePeriodRange(from: unknown, to: unknown): { from: string; to: string } | string {
  if (typeof from !== 'string' || !ISO_DATE.test(from)) return 'invalid_from';
  if (typeof to !== 'string' || !ISO_DATE.test(to)) return 'invalid_to';
  if (from >= to) return 'from_must_precede_to';
  return { from, to };
}

// GET /api/billing/period?from=YYYY-MM-DD&to=YYYY-MM-DD
// Read-only preview of the next invoice; never persists.
billing.get('/period',
  requireRole('admin', 'support_admin', 'superadmin', 'system_admin'),
  async (c) => {
    const auth = c.get('auth') as AuthContext;
    const range = validatePeriodRange(c.req.query('from'), c.req.query('to'));
    if (typeof range === 'string') return c.json({ error: range }, 400);
    try {
      const { period } = await computeBillablePeriod(c.env.DB, auth.tenantId, {
        periodStart: range.from, periodEnd: range.to, persist: false,
      });
      return c.json({ period });
    } catch (err) {
      logError('billing.period_preview_failed', err, { tenantId: auth.tenantId }, range);
      return c.json({ error: 'compute_failed' }, 500);
    }
  });

// POST /api/billing/period — compute and persist the period (idempotent
// on (tenant_id, period_start, period_end); re-runs UPDATE the row).
billing.post('/period',
  requireRole('admin', 'support_admin', 'superadmin', 'system_admin'),
  async (c) => {
    const auth = c.get('auth') as AuthContext;
    let body: { from?: unknown; to?: unknown } = {};
    try { body = await c.req.json(); } catch { /* allow empty body */ }
    const range = validatePeriodRange(body.from, body.to);
    if (typeof range === 'string') return c.json({ error: range }, 400);
    try {
      const result = await computeBillablePeriod(c.env.DB, auth.tenantId, {
        periodStart: range.from, periodEnd: range.to, persist: true,
      });
      return c.json({
        period: result.period,
        persisted: result.persisted,
        period_id: result.periodId,
        line_items_inserted: result.lineItemsInserted,
      });
    } catch (err) {
      logError('billing.period_persist_failed', err, { tenantId: auth.tenantId }, range);
      return c.json({ error: 'compute_failed' }, 500);
    }
  });

// GET /api/billing/periods — historical billable periods for the tenant.
billing.get('/periods',
  requireRole('admin', 'support_admin', 'superadmin', 'system_admin'),
  async (c) => {
    const auth = c.get('auth') as AuthContext;
    const limitRaw = Number(c.req.query('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;
    try {
      const r = await c.env.DB.prepare(
        `SELECT id, period_start, period_end, total_realised_savings, atheon_share_pct,
                atheon_revenue, currency, status, generated_at, invoiced_at, paid_at
           FROM billable_periods
          WHERE tenant_id = ?
          ORDER BY period_end DESC, generated_at DESC
          LIMIT ?`
      ).bind(auth.tenantId, limit).all();
      return c.json({ periods: r.results ?? [] });
    } catch (err) {
      logError('billing.periods_list_failed', err, { tenantId: auth.tenantId }, {});
      return c.json({ error: 'list_failed' }, 500);
    }
  });

// ─── Plan Definitions ───────────────────────────────────────
const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'For small teams getting started with business intelligence',
    price: { monthly: 49, annual: 470 },
    currency: 'USD',
    features: ['Up to 5 users', '1 ERP connection', 'Basic dashboards', 'Email support'],
    limits: { users: 5, erpConnections: 1, catalystClusters: 3, storageGb: 5 },
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For growing businesses needing advanced analytics',
    price: { monthly: 149, annual: 1430 },
    currency: 'USD',
    features: ['Up to 25 users', '5 ERP connections', 'Advanced analytics', 'Priority support', 'Custom catalysts'],
    limits: { users: 25, erpConnections: 5, catalystClusters: 10, storageGb: 50 },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large organizations with complex requirements',
    price: { monthly: 499, annual: 4790 },
    currency: 'USD',
    features: ['Unlimited users', 'Unlimited ERP connections', 'Full platform access', 'Dedicated support', 'SLA guarantee', 'Custom integrations'],
    limits: { users: -1, erpConnections: -1, catalystClusters: -1, storageGb: 500 },
  },
];

// GET /api/billing/plans - List available plans
billing.get('/plans', async (c) => {
  return c.json({ plans: PLANS });
});

// GET /api/billing/subscription - Get current subscription
billing.get('/subscription', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const tenantId = auth.tenantId;

  const subscription = await c.env.DB.prepare(
    'SELECT * FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(tenantId).first();

  if (!subscription) {
    return c.json({
      subscription: null,
      plan: PLANS[0], // Default to starter
      status: 'trialing',
      message: 'No active subscription. Using free trial.',
    });
  }

  const plan = PLANS.find(p => p.id === subscription.plan_id) || PLANS[0];

  return c.json({
    subscription: {
      id: subscription.id,
      planId: subscription.plan_id,
      status: subscription.status,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === 1,
      stripeSubscriptionId: subscription.stripe_subscription_id,
      stripeCustomerId: subscription.stripe_customer_id,
      createdAt: subscription.created_at,
    },
    plan,
  });
});

// POST /api/billing/checkout - Create checkout session
billing.post('/checkout', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const { data: body, errors } = await getValidatedJsonBody<{
    plan_id: string;
    billing_cycle: string;
    success_url?: string;
    cancel_url?: string;
  }>(c, [
    { field: 'plan_id', type: 'string', required: true },
    { field: 'billing_cycle', type: 'string', required: true },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }
  if (body.billing_cycle !== 'monthly' && body.billing_cycle !== 'annual') {
    return c.json({ error: 'billing_cycle must be "monthly" or "annual"' }, 400);
  }

  const plan = PLANS.find(p => p.id === body.plan_id);
  if (!plan) {
    return c.json({ error: 'Invalid plan' }, 400);
  }

  if (!c.env.STRIPE_SECRET_KEY) {
    // Stripe isn't configured — return 503 with a clear message instead
    // of building a fake URL. Atheon ops sees this in Sentry as a 503,
    // not a customer-facing crash.
    return c.json({
      error: 'Billing temporarily unavailable',
      details: 'STRIPE_SECRET_KEY not configured in this environment.',
    }, 503);
  }

  const tenant = await c.env.DB.prepare(
    'SELECT t.*, u.email as admin_email FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id AND u.role = "admin" WHERE t.id = ? LIMIT 1'
  ).bind(auth.tenantId).first<{ id: string; name: string; admin_email?: string }>();

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const { resolvePriceId, createCheckoutSession } = await import('../services/stripe');
  const price = resolvePriceId(body.plan_id, body.billing_cycle as 'monthly' | 'annual', c.env.STRIPE_PRICE_MAP);
  if (!price) {
    return c.json({ error: `No Stripe price configured for ${body.plan_id}:${body.billing_cycle}` }, 500);
  }

  // Defaults — caller can override, but most flows use the standard ones.
  const successUrl = body.success_url || 'https://atheon.vantax.co.za/settings?upgrade=success';
  const cancelUrl  = body.cancel_url  || 'https://atheon.vantax.co.za/pricing?upgrade=cancelled';

  let session: { id: string; url: string };
  try {
    session = await createCheckoutSession({
      apiKey: c.env.STRIPE_SECRET_KEY,
      priceId: price.priceId,
      tenantId: auth.tenantId,
      customerEmail: auth.email || tenant.admin_email,
      successUrl,
      cancelUrl,
      metadata: { plan_id: body.plan_id, billing_cycle: body.billing_cycle, tenant_id: auth.tenantId },
    });
  } catch (err) {
    console.error('Stripe Checkout session creation failed:', err);
    return c.json({ error: 'Stripe Checkout creation failed', details: (err as Error).message }, 502);
  }

  // Track the checkout intent so the webhook handler can resolve the plan
  // even if Stripe forgets to return our metadata (rare but observed).
  await c.env.DB.prepare(
    'INSERT INTO billing_checkouts (id, tenant_id, plan_id, billing_cycle, status, stripe_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(crypto.randomUUID(), auth.tenantId, body.plan_id, body.billing_cycle, 'pending', session.id).run().catch(() => {
    // Table may not exist yet — non-fatal; webhook can fall back to metadata.
  });

  return c.json({
    sessionId: session.id,
    url: session.url,
    planId: body.plan_id,
    billingCycle: body.billing_cycle,
  }, 201);
});

// POST /api/billing/portal - Create billing portal session
billing.post('/portal', async (c) => {
  const auth = c.get('auth') as AuthContext;

  const subscription = await c.env.DB.prepare(
    'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(auth.tenantId).first<{ stripe_customer_id: string }>();

  if (!subscription?.stripe_customer_id) {
    return c.json({ error: 'No active subscription found' }, 404);
  }

  // In production: create Stripe Billing Portal session
  return c.json({
    message: 'Billing portal session. Stripe integration pending configuration.',
    customerId: subscription.stripe_customer_id,
  });
});

// POST /api/billing/cancel - Cancel subscription
billing.post('/cancel', async (c) => {
  const auth = c.get('auth') as AuthContext;

  await c.env.DB.prepare(
    'UPDATE subscriptions SET cancel_at_period_end = 1 WHERE tenant_id = ? AND status = ?'
  ).bind(auth.tenantId, 'active').run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), auth.tenantId, auth.userId, 'subscription_cancel', 'billing', 'subscription', '{}', 'success').run();

  return c.json({ success: true, message: 'Subscription will cancel at end of current period.' });
});

// GET /api/billing/usage - Get usage metrics
billing.get('/usage', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const tenantId = auth.tenantId;

  const [userCount, erpCount, clusterCount] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM erp_connections WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
  ]);

  return c.json({
    usage: {
      users: userCount?.count || 0,
      erpConnections: erpCount?.count || 0,
      catalystClusters: clusterCount?.count || 0,
    },
    updatedAt: new Date().toISOString(),
  });
});

// GET /api/billing/invoices - List invoices
billing.get('/invoices', async (c) => {
  const auth = c.get('auth') as AuthContext;

  const invoices = await c.env.DB.prepare(
    'SELECT * FROM billing_invoices WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(auth.tenantId).all().catch(() => ({ results: [] }));

  return c.json({
    invoices: (invoices.results || []).map((inv: Record<string, unknown>) => ({
      id: inv.id,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      paidAt: inv.paid_at,
      invoiceUrl: inv.invoice_url,
      createdAt: inv.created_at,
    })),
  });
});

// POST /api/billing/webhook - Stripe webhook handler
billing.post('/webhook', async (c) => {
  // Read raw body once — we need it both for signature verification and
  // for parsing. Hono's c.req.json() can't be called after c.req.text().
  const bodyText = await c.req.text();

  // Verify Stripe signature when STRIPE_WEBHOOK_SECRET is configured.
  // Without the secret set, we accept unsigned events — only safe in dev.
  if (c.env.STRIPE_WEBHOOK_SECRET) {
    const sigHeader = c.req.header('stripe-signature') || '';
    const { verifyWebhookSignature } = await import('../services/stripe');
    const verdict = await verifyWebhookSignature({
      bodyText,
      signatureHeader: sigHeader,
      secret: c.env.STRIPE_WEBHOOK_SECRET,
    });
    if (!verdict.valid) {
      console.warn('Stripe webhook signature rejected:', verdict.reason);
      return c.json({ error: 'Invalid Stripe signature', details: verdict.reason }, 400);
    }
  }

  let body: { type: string; data: { object: Record<string, unknown> } };
  try {
    body = JSON.parse(bodyText) as { type: string; data: { object: Record<string, unknown> } };
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  switch (body.type) {
    case 'checkout.session.completed': {
      const session = body.data.object;
      const tenantId = session.client_reference_id as string;
      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string;
      // Resolve plan from session metadata or fall back to checkout record
      const metadata = (session.metadata || {}) as Record<string, string>;
      let planId = metadata.plan_id || 'starter';
      if (!metadata.plan_id && tenantId) {
        const checkout = await c.env.DB.prepare(
          'SELECT plan_id FROM billing_checkouts WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
        ).bind(tenantId, 'pending').first<{ plan_id: string }>().catch(() => null);
        if (checkout?.plan_id) planId = checkout.plan_id;
      }

      if (tenantId && subscriptionId) {
        await c.env.DB.prepare(
          'INSERT OR REPLACE INTO subscriptions (id, tenant_id, stripe_subscription_id, stripe_customer_id, plan_id, status, current_period_start, current_period_end, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\', \'+30 days\'), datetime(\'now\'))'
        ).bind(crypto.randomUUID(), tenantId, subscriptionId, customerId, planId, 'active').run();
        // Mark checkout as completed
        await c.env.DB.prepare(
          'UPDATE billing_checkouts SET status = ? WHERE tenant_id = ? AND status = ?'
        ).bind('completed', tenantId, 'pending').run().catch(() => {});
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = body.data.object;
      await c.env.DB.prepare(
        'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?'
      ).bind(sub.status, sub.id).run();
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = body.data.object;
      await c.env.DB.prepare(
        'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?'
      ).bind('canceled', sub.id).run();
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = body.data.object;
      const sub = await c.env.DB.prepare(
        'SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = ?'
      ).bind(invoice.customer).first<{ tenant_id: string }>();
      if (sub) {
        await c.env.DB.prepare(
          'UPDATE subscriptions SET status = ? WHERE tenant_id = ?'
        ).bind('past_due', sub.tenant_id).run();
      }
      break;
    }
  }

  return c.json({ received: true });
});

export default billing;
