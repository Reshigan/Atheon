/**
 * §9.2 Guided Onboarding Checklist
 * 7-step checklist with progress tracking, persisted to backend.
 */
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { OnboardingStep } from "@/lib/api";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Rocket, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export function OnboardingChecklist() {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalSteps, setTotalSteps] = useState(7);
  const [progressPct, setProgressPct] = useState(0);
  const [allComplete, setAllComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  useEffect(() => {
    const wasDismissed = localStorage.getItem('atheon-checklist-dismissed') === 'true';
    if (wasDismissed) { setDismissed(true); setLoading(false); return; }
    api.onboarding.progress().then((data) => {
      setSteps(data.steps);
      setCompletedCount(data.completedCount);
      setTotalSteps(data.totalSteps);
      setProgressPct(data.progressPct);
      setAllComplete(data.allComplete);
      if (data.allComplete) setDismissed(true);
    }).catch(() => { /* silent */ }).finally(() => setLoading(false));
  }, []);

  const handleComplete = async (stepId: string) => {
    if (completing) return;
    setCompleting(stepId);
    try {
      await api.onboarding.completeStep(stepId);
      setSteps(prev => prev.map(s => s.id === stepId ? { ...s, completed: true, completedAt: new Date().toISOString() } : s));
      const newCount = completedCount + 1;
      setCompletedCount(newCount);
      setProgressPct(Math.round((newCount / totalSteps) * 100));
      if (newCount === totalSteps) setAllComplete(true);
    } catch { /* silent */ }
    setCompleting(null);
  };

  const handleDismiss = async () => {
    localStorage.setItem('atheon-checklist-dismissed', 'true');
    try { await api.onboarding.dismiss(); } catch { /* silent */ }
    setDismissed(true);
  };

  if (dismissed || loading || allComplete) return null;

  return (
    <div
      className="rounded-xl overflow-hidden mb-5"
      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 2px 12px rgba(100, 120, 180, 0.07)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-card)' }}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <Rocket size={16} className="text-accent flex-shrink-0" />
          <span className="text-sm font-semibold t-primary truncate">Getting Started</span>
          <span className="text-caption t-muted ml-1">{completedCount}/{totalSteps}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-24 hidden sm:block">
            <Progress value={progressPct} size="sm" />
          </div>
          <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded t-muted hover:t-primary transition-all" title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={handleDismiss} className="p-1 rounded t-muted hover:text-red-400 transition-all" title="Dismiss checklist">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="px-4 py-3 space-y-1.5">
          {steps.map((step) => (
            <button
              key={step.id}
              onClick={() => !step.completed && handleComplete(step.id)}
              disabled={step.completed || completing === step.id}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-all hover:bg-[var(--bg-secondary)] disabled:opacity-70 disabled:cursor-default group"
            >
              <div className="flex-shrink-0 mt-0.5">
                {completing === step.id ? (
                  <Loader2 size={16} className="text-accent animate-spin" />
                ) : step.completed ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <Circle size={16} className="t-muted group-hover:text-accent transition-colors" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-medium leading-tight ${step.completed ? 't-muted line-through' : 't-primary'}`}>{step.label}</p>
                <p className="text-caption t-muted mt-0.5 leading-snug">{step.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
