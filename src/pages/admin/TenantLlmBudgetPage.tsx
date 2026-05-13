/**
 * Superadmin-only page for managing a tenant's LLM token budget and PII
 * redaction settings (backend PR #226).
 *
 * Route: /admin/tenants/:id/llm
 *
 * Shows:
 *   - Current-month token usage with progress bar + colour bands
 *   - Reset date (when the monthly counter rolls over)
 *   - PII redaction toggle state
 *
 * Editable:
 *   - Monthly token budget (number, or "Unlimited" → null)
 *   - PII redaction enabled/disabled
 *
 * Role gating is handled at the route level in App.tsx via
 * <ProtectedRoute allowedRoles={SUPERADMIN_ROLES}>.
 */
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import type { LlmBudgetResponse } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { UsageBar, usageColor } from '@/components/UsageBar';
import {
  ArrowLeft, Shield, AlertTriangle, Calendar, Save, Info, CheckCircle, XCircle, Zap,
} from 'lucide-react';
import { format } from 'date-fns';

interface TenantMeta {
  id: string;
  name: string;
  slug: string;
}

export function TenantLlmBudgetPage() {
  const { id: tenantId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [budget, setBudget] = useState<LlmBudgetResponse | null>(null);
  const [tenantMeta, setTenantMeta] = useState<TenantMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [unlimited, setUnlimited] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [redactionEnabled, setRedactionEnabled] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    void loadData(tenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const loadData = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [budgetData, tenantData] = await Promise.all([
        api.admin.getLlmBudget(id),
        api.get<{ tenant: TenantMeta }>(`/api/v1/admin/tenants/${id}`).catch(() => null),
      ]);
      setBudget(budgetData);
      if (tenantData) setTenantMeta(tenantData.tenant);

      // Seed form from server state
      setUnlimited(budgetData.monthlyTokenBudget === null);
      setBudgetInput(
        budgetData.monthlyTokenBudget === null ? '' : String(budgetData.monthlyTokenBudget),
      );
      setRedactionEnabled(budgetData.llmRedactionEnabled);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load LLM budget';
      setError(message);
      toast.error('Failed to load LLM budget', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  };

  const parsedBudget = useMemo(() => {
    if (unlimited) return null;
    const n = Number(budgetInput);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.floor(n);
  }, [unlimited, budgetInput]);

  const isDirty = useMemo(() => {
    if (!budget) return false;
    const budgetChanged = unlimited
      ? budget.monthlyTokenBudget !== null
      : budget.monthlyTokenBudget !== parsedBudget;
    const redactionChanged = redactionEnabled !== budget.llmRedactionEnabled;
    return budgetChanged || redactionChanged;
  }, [budget, unlimited, parsedBudget, redactionEnabled]);

  const canSave = !saving && isDirty && (unlimited || (typeof parsedBudget === 'number' && !Number.isNaN(parsedBudget)));

  const handleSave = async () => {
    if (!tenantId || !budget) return;
    if (!unlimited && (typeof parsedBudget !== 'number' || Number.isNaN(parsedBudget))) {
      toast.error('Invalid budget', { message: 'Enter a non-negative integer or tick Unlimited.' });
      return;
    }
    setSaving(true);
    try {
      const body: { monthlyTokenBudget?: number | null; llmRedactionEnabled?: boolean } = {};
      if (
        (unlimited && budget.monthlyTokenBudget !== null) ||
        (!unlimited && budget.monthlyTokenBudget !== parsedBudget)
      ) {
        body.monthlyTokenBudget = unlimited ? null : (parsedBudget as number);
      }
      if (redactionEnabled !== budget.llmRedactionEnabled) {
        body.llmRedactionEnabled = redactionEnabled;
      }
      const updated = await api.admin.setLlmBudget(tenantId, body);
      setBudget(updated);
      setUnlimited(updated.monthlyTokenBudget === null);
      setBudgetInput(updated.monthlyTokenBudget === null ? '' : String(updated.monthlyTokenBudget));
      setRedactionEnabled(updated.llmRedactionEnabled);
      toast.success('LLM budget updated', {
        message: 'Changes have been saved and audit-logged.',
        requestId: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save LLM budget';
      toast.error('Save failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const usagePct = useMemo(() => {
    if (!budget || budget.monthlyTokenBudget === null || budget.monthlyTokenBudget <= 0) return 0;
    return Math.min((budget.tokensUsedThisMonth / budget.monthlyTokenBudget) * 100, 100);
  }, [budget]);

  const pctColor = usageColor(usagePct);
  const pctColorClass =
    pctColor === 'red' ? 'text-red-400' : pctColor === 'amber' ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/tenants')}>
          <ArrowLeft size={16} className="mr-2" />
          Back to Tenants
        </Button>
        <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">LLM Budget</h1>
      </div>

      {tenantMeta && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Tenant:</span>
          <span className="text-sm font-medium text-white">{tenantMeta.name}</span>
          <Badge variant="info" className="text-xs">{tenantMeta.slug}</Badge>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && budget && (
        <>
          {/* Current Usage Card */}
          <Card>
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Zap size={18} className="text-accent" />
                  Current Month Usage
                </h2>
                {!budget.exists && (
                  <Badge variant="default" className="text-xs">Defaults (no row yet)</Badge>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <div className="text-xs text-gray-400 mb-1">Tokens used this month</div>
                  <div className="text-headline-xl font-bold t-primary tracking-tight leading-tight">
                    {budget.tokensUsedThisMonth.toLocaleString()}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <div className="text-xs text-gray-400 mb-1">Monthly budget</div>
                  <div className="text-headline-xl font-bold t-primary tracking-tight leading-tight">
                    {budget.monthlyTokenBudget === null
                      ? <span className="text-emerald-400">Unlimited</span>
                      : budget.monthlyTokenBudget.toLocaleString()}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
                    <Calendar size={12} /> Resets
                  </div>
                  <div className="text-sm font-medium text-white">
                    {budget.tokensResetAt
                      ? format(new Date(budget.tokensResetAt), 'PPP')
                      : 'Start of next month'}
                  </div>
                </div>
              </div>

              {budget.monthlyTokenBudget === null ? (
                <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
                  This tenant is on an <strong>unlimited</strong> plan — no token cap is enforced.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Usage</span>
                    <span className={`font-semibold ${pctColorClass}`}>{usagePct.toFixed(1)}%</span>
                  </div>
                  <UsageBar
                    used={budget.tokensUsedThisMonth}
                    budget={budget.monthlyTokenBudget}
                    showLabel={false}
                    size="md"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Redaction:</span>
                  {budget.llmRedactionEnabled ? (
                    <Badge variant="success" className="text-xs">
                      <CheckCircle size={10} className="mr-1" />
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="default" className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/25">
                      <AlertTriangle size={10} className="mr-1" />
                      Disabled
                    </Badge>
                  )}
                </div>
                {budget.updatedAt && (
                  <span className="text-xs text-gray-500">
                    Last updated {format(new Date(budget.updatedAt), 'PPP p')}
                  </span>
                )}
              </div>
            </div>
          </Card>

          {/* Edit Form */}
          <Card>
            <div className="p-6 space-y-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Shield size={18} className="text-accent" />
                Edit LLM Budget & Redaction
              </h2>

              {/* Budget field */}
              <div className="space-y-2">
                <label htmlFor="llm-budget-input" className="block text-sm font-medium text-gray-300">
                  Monthly token budget
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    id="llm-budget-input"
                    type="number"
                    min={0}
                    step={1000}
                    placeholder="e.g. 1000000"
                    value={budgetInput}
                    disabled={unlimited || saving}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    className="flex-1 max-w-xs px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent disabled:opacity-50"
                  />
                  <label className="inline-flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={unlimited}
                      disabled={saving}
                      onChange={(e) => setUnlimited(e.target.checked)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    Unlimited
                  </label>
                </div>
                <p className="text-xs text-gray-500">
                  Tokens counted across all LLM calls (prompt + completion). When exceeded, subsequent calls are rejected until the monthly reset.
                </p>
              </div>

              {/* Redaction toggle */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">PII redaction</label>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={redactionEnabled}
                      disabled={saving}
                      onChange={(e) => setRedactionEnabled(e.target.checked)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    <span className={redactionEnabled ? 'text-emerald-400' : 'text-amber-400'}>
                      {redactionEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0 text-gray-500" />
                  <span>
                    <strong className="text-gray-400">Enabled (default):</strong> PII (emails, phones, IDs, credit cards) is redacted before LLM calls.
                    Disable only if this tenant has a DPA allowing raw PII processing.
                  </span>
                </p>
              </div>

              {/* Save actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-700">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={!canSave}
                >
                  {saving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={14} className="mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
                <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                  <Info size={12} /> Changes are audit-logged
                </span>
                {isDirty && !saving && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (!budget) return;
                      setUnlimited(budget.monthlyTokenBudget === null);
                      setBudgetInput(
                        budget.monthlyTokenBudget === null ? '' : String(budget.monthlyTokenBudget),
                      );
                      setRedactionEnabled(budget.llmRedactionEnabled);
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="text-xs text-gray-500">
            <Link to="/admin/tenants" className="text-accent hover:underline">
              Back to Tenant Management
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
