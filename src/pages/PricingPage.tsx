/**
 * /pricing — public-facing pricing page.
 *
 * Lists the three plan tiers from /api/billing/plans. Public visitors
 * see "Start trial" CTAs that route to /trial. Logged-in trial-tier
 * users see "Upgrade" CTAs that POST /api/billing/checkout and redirect
 * to the Stripe Checkout URL.
 *
 * No auth required to view; the upgrade flow itself requires an active
 * tenant session.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles } from "lucide-react";
import { api, ApiError, getToken } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type Plan = Awaited<ReturnType<typeof api.billing.plans>>['plans'][number];

const HIGHLIGHT_PLAN_ID = 'professional';

export function PricingPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const isAuthenticated = !!getToken();

  useEffect(() => {
    api.billing.plans()
      .then(res => setPlans(res.plans))
      .catch(err => {
        toast.error('Failed to load plans', {
          message: err instanceof Error ? err.message : undefined,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCheckout(planId: string) {
    if (checkoutLoading) return;
    if (!isAuthenticated) {
      // Public visitor — route to trial signup with the plan as a hint.
      navigate(`/trial?plan=${encodeURIComponent(planId)}`);
      return;
    }
    setCheckoutLoading(planId);
    try {
      const res = await api.billing.checkout({ plan_id: planId, billing_cycle: cycle });
      window.location.href = res.url;
    } catch (err) {
      toast.error('Checkout failed', {
        message: err instanceof Error ? err.message : 'Unable to start checkout',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="min-h-screen px-6 py-12 max-w-7xl mx-auto" data-testid="pricing-page">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold t-primary mb-3">Plans &amp; Pricing</h1>
        <p className="text-base t-muted max-w-2xl mx-auto">
          Per-tenant pricing. The annual cycle bundles ~20% off vs monthly. No hidden enterprise tier —
          if you need more users or ERP connections, the Enterprise plan covers it.
        </p>
        {/* Billing-cycle toggle */}
        <div className="inline-flex items-center gap-1 mt-6 p-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
          {(['monthly', 'annual'] as const).map(c => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] capitalize ${
                cycle === c ? 'bg-accent text-[var(--text-on-accent)]' : 't-secondary hover:t-primary'
              }`}
              data-testid={`cycle-${c}`}
            >
              {c}{c === 'annual' && <span className="ml-1.5 text-caption opacity-80">(save ~20%)</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map(plan => {
            const price = cycle === 'annual' ? plan.price.annual : plan.price.monthly;
            const monthlyEquivalent = cycle === 'annual' ? Math.round(plan.price.annual / 12) : plan.price.monthly;
            const isHighlight = plan.id === HIGHLIGHT_PLAN_ID;
            return (
              <Card
                key={plan.id}
                className={`p-6 flex flex-col ${isHighlight ? 'border-accent/40' : ''}`}
                style={isHighlight ? { background: 'rgba(126, 179, 205, 0.05)', boxShadow: '0 4px 24px rgba(126, 179, 205, 0.15)' } : undefined}
                data-testid={`plan-${plan.id}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-semibold t-primary">{plan.name}</h3>
                  {isHighlight && (
                    <Badge variant="info" size="sm">
                      <Sparkles size={10} className="mr-1" /> Most popular
                    </Badge>
                  )}
                </div>
                <p className="text-sm t-muted mb-4">{plan.description}</p>
                <div className="mb-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold t-primary">${monthlyEquivalent}</span>
                  <span className="text-sm t-muted">/ month</span>
                </div>
                <div className="text-xs t-muted mb-5">
                  {cycle === 'annual' ? `billed annually $${price.toLocaleString()}` : `billed monthly · ${plan.currency}`}
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm t-secondary">
                      <Check size={14} className="text-accent flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isHighlight ? 'primary' : 'secondary'}
                  className="w-full"
                  onClick={() => startCheckout(plan.id)}
                  disabled={checkoutLoading === plan.id}
                  data-testid={`checkout-${plan.id}`}
                >
                  {checkoutLoading === plan.id ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" /> Redirecting…</>
                  ) : isAuthenticated ? (
                    'Upgrade to ' + plan.name
                  ) : (
                    'Start free trial'
                  )}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-center mt-10 text-xs t-muted">
        Need something custom? Email <a href="mailto:sales@vantax.co.za" className="text-accent hover:underline">sales@vantax.co.za</a> —
        the Enterprise tier covers most asks, and we can build a private tier for unusual ones.
      </div>
    </div>
  );
}

export default PricingPage;
