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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Circle, ArrowRight, Loader2, Rocket, Sparkles,
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
          <h1 className="text-2xl font-bold t-primary">Welcome to Atheon</h1>
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

      {/* Celebration */}
      {allComplete && (
        <Card className="p-6 text-center" style={{ background: 'rgba(20, 184, 166, 0.05)', border: '1px solid rgba(20, 184, 166, 0.2)' }}>
          <Sparkles className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold t-primary mb-1">You're set up.</h2>
          <p className="text-sm t-muted mb-4">
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
              style={isCurrent ? { background: 'rgba(126, 179, 205, 0.05)' } : undefined}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {step.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Circle className={`w-5 h-5 ${isCurrent ? 'text-accent' : 't-muted'}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs t-muted font-mono">Step {i + 1}</span>
                    {isCurrent && <Badge variant="info" size="sm">Current</Badge>}
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
