import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { X, Zap, BarChart3, Brain, Shield, Database, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const steps = [
  {
    icon: Sparkles,
    title: "Welcome to Atheon",
    description: "Atheon is your enterprise intelligence platform — powered by AI agents that monitor, analyse, and act on your business data in real-time.",
    detail: "Navigate using the sidebar on the left. Each layer focuses on a different aspect of your business intelligence.",
  },
  {
    icon: BarChart3,
    title: "Apex — Strategic Intelligence",
    description: "View your business health score, risk alerts, and executive briefings. Run what-if scenarios to test strategic decisions.",
    detail: "Start here for a high-level view of your organisation's performance.",
  },
  {
    icon: Zap,
    title: "Catalysts — Autonomous Agents",
    description: "Deploy AI catalysts that autonomously execute business processes. Review actions, approve or reject, and monitor exceptions.",
    detail: "Use 'Manual Execute' to run catalysts with specific date ranges and file uploads.",
  },
  {
    icon: Brain,
    title: "Mind & Memory — AI Knowledge",
    description: "Query the AI with natural language. Memory stores your organisation's knowledge graph — entities, relationships, and insights.",
    detail: "The more data you feed, the smarter Atheon becomes.",
  },
  {
    icon: Shield,
    title: "Governance & Security",
    description: "Full audit trail, role-based access control, and tenant isolation. Every action is logged and traceable.",
    detail: "Configure IAM policies, manage users, and review audit logs from the platform pages.",
  },
  {
    icon: Database,
    title: "ERP Integration",
    description: "Connect to SAP, Salesforce, Xero, Sage, Pastel, and more. The canonical API normalises data across all systems.",
    detail: "Set up connections in ERP Adapters, then use the Canonical API for unified data access.",
  },
];

export function OnboardingModal() {
  const { onboardingDismissed, dismissOnboarding } = useAppStore();
  const [currentStep, setCurrentStep] = useState(0);

  if (onboardingDismissed) return null;

  const step = steps[currentStep];
  const StepIcon = step.icon;
  const isLast = currentStep === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        style={{ background: "rgba(18,18,42,0.97)", border: "1px solid rgba(255,255,255,0.1)" }}
        className="rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? 'w-6 bg-accent' : i < currentStep ? 'w-3 bg-accent/40' : 'w-3 bg-white/10'
                }`}
              />
            ))}
          </div>
          <button
            onClick={dismissOnboarding}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
                      <StepIcon className="w-7 h-7 text-accent" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">{step.title}</h2>
          <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">{step.detail}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={dismissOnboarding}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setCurrentStep(s => s - 1)}>
                Back
              </Button>
            )}
            {isLast ? (
              <Button variant="primary" size="sm" onClick={dismissOnboarding}>
                Get Started
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setCurrentStep(s => s + 1)}>
                Next <ArrowRight size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
