/**
 * /onboarding — guided wizard walking new users through the 7 stop-gates
 * the Customer Success playbook expects in week 1.
 *
 * Existing OnboardingChecklist on the Dashboard is *passive* (a small
 * collapsible card). This page is *active* — the entire screen is the
 * wizard, with deep-link CTAs for each step. Once all 7 steps clear, the
 * page celebrates and routes back to /dashboard.
 *
 * Steps map to existing app routes:
 *   connect_erp     → /integrations
 *   deploy_catalyst → /catalysts
 *   run_catalyst    → /catalysts
 *   review_action   → /catalysts (Exceptions tab)
 *   view_diagnostics → /pulse
 *   generate_report → /apex
 *   invite_user     → /iam
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, ArrowRight, Loader2, Rocket, Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { OnboardingStep } from "@/lib/api";

const STEP_TARGETS: Record<string, { route: string; cta: string }> = {
  connect_erp:      { route: '/integrations',                      cta: 'Open Integrations' },
  deploy_catalyst:  { route: '/catalysts',                          cta: 'Open Catalysts' },
  run_catalyst:     { route: '/catalysts',                          cta: 'Open Catalysts' },
  review_action:    { route: '/catalysts',                          cta: 'Open Exceptions queue' },
  view_diagnostics: { route: '/pulse',                              cta: 'Open Pulse · Diagnostics' },
  generate_report:  { route: '/apex',                               cta: 'Open Apex · Briefing' },
  invite_user:      { route: '/iam',                                cta: 'Open IAM · Users' },
};

export function OnboardingWizardPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalSteps, setTotalSteps] = useState(7);
  const [progressPct, setProgressPct] = useState(0);
  const [allComplete, setAllComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await api.onboarding.progress();
      setSteps(data.steps);
      setCompletedCount(data.completedCount);
      setTotalSteps(data.totalSteps);
      setProgressPct(data.progressPct);
      setAllComplete(data.allComplete);
    } catch (err) {
      toast.error('Failed to load onboarding progress', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }

  // Initial load — once-on-mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function markComplete(stepId: string) {
    if (completing) return;
    setCompleting(stepId);
    try {
      await api.onboarding.completeStep(stepId);
      await refresh();
    } catch (err) {
      toast.error('Failed to mark step complete', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setCompleting(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  const currentStep = steps.find(s => !s.completed);

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto space-y-6" data-testid="onboarding-wizard">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Rocket className="w-5 h-5 text-accent" />
          <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">Welcome to Atheon</h1>
        </div>
        <p className="text-sm t-muted">
          A short guided setup. Each step is a real first-week milestone — the same checklist your
          customer success engineer is tracking. You can leave and come back any time.
        </p>
      </div>

      {/* Progress bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium t-primary">{completedCount} of {totalSteps} complete</span>
          <span className="text-xs t-muted">{progressPct}%</span>
        </div>
        <Progress value={progressPct} color={allComplete ? 'emerald' : 'amber'} size="md" />
      </Card>

      {/* Celebration — Stitch sage success card */}
      {allComplete && (
        <Card className="p-7 text-center" style={{ background: 'rgba(163, 177, 138, 0.08)', border: '1px solid rgba(163, 177, 138, 0.30)' }}>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 border"
            style={{
              background: 'rgba(163, 177, 138, 0.15)',
              borderColor: 'rgba(163, 177, 138, 0.35)',
            }}
            aria-hidden="true"
          >
            <Sparkles className="w-7 h-7" style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mb-2">You're set up.</h2>
          <p className="text-body-sm t-muted mb-5 max-w-md mx-auto leading-relaxed">
            All seven first-week milestones complete. Your customer success engineer can now schedule
            the week-4 ROI review.
          </p>
          <Button variant="primary" onClick={() => navigate('/dashboard')}>
            Go to Dashboard <ArrowRight size={14} className="ml-1" />
          </Button>
        </Card>
      )}

      {/* Step list */}
      <div className="space-y-3">
        {steps.map((step, i) => {
          const target = STEP_TARGETS[step.id];
          const isCurrent = !step.completed && currentStep?.id === step.id;
          return (
            <Card
              key={step.id}
              className={`p-4 transition-colors ${isCurrent ? 'border-accent/40' : ''}`}
              style={isCurrent ? { background: 'rgba(163, 177, 138, 0.06)', borderLeft: '3px solid var(--accent)' } : undefined}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {/* Step number bubble matches Stitch onboarding: completed
                      steps get a sage check; pending steps show the step
                      number; current step pulses subtly. */}
                  {step.completed ? (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center border"
                      style={{
                        background: 'rgba(52, 211, 153, 0.15)',
                        borderColor: 'rgba(52, 211, 153, 0.35)',
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                  ) : (
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center border text-caption font-mono font-bold ${
                        isCurrent ? 'animate-pulse' : ''
                      }`}
                      style={{
                        background: isCurrent ? 'rgba(163, 177, 138, 0.15)' : 'var(--bg-secondary)',
                        borderColor: isCurrent ? 'var(--accent)' : 'var(--border-card)',
                        color: isCurrent ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {i + 1}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-caption t-muted font-mono uppercase tracking-widest">Step {i + 1} / {totalSteps}</span>
                    {isCurrent && <StatusPill status="in_progress" label="Current" size="sm" />}
                    {step.completed && step.completedAt && (
                      <span className="text-caption t-muted">
                        Done {new Date(step.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold t-primary mt-1">{step.label}</h3>
                  <p className="text-xs t-muted mt-1">{step.description}</p>
                  {!step.completed && target && (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(target.route)}
                      >
                        {target.cta} <ArrowRight size={12} className="ml-1" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => markComplete(step.id)}
                        disabled={completing === step.id}
                      >
                        {completing === step.id ? (
                          <><Loader2 size={12} className="mr-1 animate-spin" /> Marking…</>
                        ) : (
                          <>I&apos;ve done this</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="text-caption t-muted text-center pt-2">
        Need help? File a ticket at <a href="/support-tickets" className="text-accent hover:underline">/support-tickets</a> or
        ping your CS engineer in your shared Slack channel.
      </div>
    </div>
  );
}

export default OnboardingWizardPage;
