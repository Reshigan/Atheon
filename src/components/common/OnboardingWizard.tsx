/**
 * SPEC-024: Onboarding Wizard
 * Step-by-step onboarding flow for new users with progress tracking.
 */
import { useState, useEffect } from 'react';
import { CheckCircle, ChevronRight, ChevronLeft, X, Rocket, Building2, Database, Shield, BarChart3 } from 'lucide-react';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  action: string;
  actionUrl: string;
  completed: boolean;
  optional?: boolean;
}

interface Props {
  tenantName?: string;
  onComplete?: () => void;
  onDismiss?: () => void;
  completedSteps?: string[];
}

const DEFAULT_STEPS: Omit<OnboardingStep, 'completed'>[] = [
  {
    id: 'profile',
    title: 'Complete Your Profile',
    description: 'Set up your name, avatar, and notification preferences to personalize your experience.',
    icon: <Shield size={20} />,
    action: 'Go to Settings',
    actionUrl: '/settings',
  },
  {
    id: 'erp',
    title: 'Connect Your ERP',
    description: 'Link your accounting system (Xero, QuickBooks, Sage) to start syncing financial data automatically.',
    icon: <Database size={20} />,
    action: 'Connect ERP',
    actionUrl: '/erp-adapters',
  },
  {
    id: 'team',
    title: 'Invite Team Members',
    description: 'Add colleagues so they can view insights, run catalysts, and collaborate on business intelligence.',
    icon: <Building2 size={20} />,
    action: 'Invite Team',
    actionUrl: '/iam',
  },
  {
    id: 'catalyst',
    title: 'Run Your First Catalyst',
    description: 'Launch an AI-powered analysis to discover insights about your business health and risks.',
    icon: <Rocket size={20} />,
    action: 'Browse Catalysts',
    actionUrl: '/catalysts',
  },
  {
    id: 'dashboard',
    title: 'Explore the Dashboard',
    description: 'Review your health score, metrics, risks, and AI-generated insights on the main dashboard.',
    icon: <BarChart3 size={20} />,
    action: 'View Dashboard',
    actionUrl: '/',
    optional: true,
  },
];

export function OnboardingWizard({ tenantName, onComplete, onDismiss, completedSteps = [] }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const steps: OnboardingStep[] = DEFAULT_STEPS.map(s => ({
    ...s,
    completed: completedSteps.includes(s.id),
  }));

  const completedCount = steps.filter(s => s.completed).length;
  const progress = Math.round((completedCount / steps.length) * 100);
  const allComplete = completedCount === steps.length;

  // Auto-dismiss when all complete
  useEffect(() => {
    if (allComplete) {
      onComplete?.();
    }
  }, [allComplete, onComplete]);

  // Check localStorage for dismissal
  useEffect(() => {
    try {
      const d = localStorage.getItem('atheon:onboarding_dismissed');
      if (d === 'true') setDismissed(true);
    } catch { /* ignore */ }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('atheon:onboarding_dismissed', 'true'); } catch { /* ignore */ }
    onDismiss?.();
  };

  if (dismissed || allComplete) return null;

  const step = steps[currentStep];

  return (
    <div
      className="rounded-2xl p-5 mb-4"
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
        boxShadow: '0 2px 12px rgba(100, 120, 180, 0.07)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold t-primary">
            {tenantName ? `Welcome to ${tenantName}` : 'Get Started with Atheon'}
          </h3>
          <p className="text-caption t-muted mt-0.5">
            {completedCount}/{steps.length} steps completed
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] t-muted"
          aria-label="Dismiss onboarding"
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-[var(--bg-secondary)] mb-4">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps indicator */}
      <div className="flex gap-1.5 mb-4">
        {steps.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setCurrentStep(i)}
            className={`flex-1 h-1 rounded-full transition-all ${
              i === currentStep ? 'bg-accent' :
              s.completed ? 'bg-emerald-500' : 'bg-[var(--bg-secondary)]'
            }`}
            aria-label={`Step ${i + 1}: ${s.title}`}
          />
        ))}
      </div>

      {/* Current step */}
      {step && (
        <div className="flex items-start gap-4">
          <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
            step.completed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-accent/15 text-accent'
          }`}>
            {step.completed ? <CheckCircle size={20} /> : step.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium t-primary">{step.title}</h4>
              {step.optional && (
                <span className="text-caption px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] t-muted">Optional</span>
              )}
              {step.completed && (
                <span className="text-caption px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">Done</span>
              )}
            </div>
            <p className="text-caption t-muted mt-1">{step.description}</p>
            {!step.completed && (
              <a
                href={step.actionUrl}
                className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 text-caption font-medium rounded-lg bg-accent text-white hover:opacity-90 transition-opacity"
              >
                {step.action}
                <ChevronRight size={12} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border-card)]">
        <button
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="text-caption t-muted hover:t-primary disabled:opacity-30 flex items-center gap-1"
        >
          <ChevronLeft size={12} /> Previous
        </button>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentStep(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                i === currentStep ? 'bg-accent w-3' :
                s.completed ? 'bg-emerald-500' : 'bg-[var(--bg-secondary)]'
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
          disabled={currentStep === steps.length - 1}
          className="text-caption t-muted hover:t-primary disabled:opacity-30 flex items-center gap-1"
        >
          Next <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
