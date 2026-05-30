import { useState } from "react";
import { Portal } from "@/components/ui/portal";
import { HelpCircle, X, Book, Zap, Shield, Database, Brain, BarChart3, MessageCircle, Activity, Download, Rocket, Smartphone } from "lucide-react";

const helpTopics = [
  {
    icon: BarChart3,
    title: "Dashboard & Apex",
    content: "The dashboard shows your business health score, risk alerts, and key metrics. Apex provides strategic intelligence with what-if scenario analysis.",
  },
  {
    icon: Zap,
    title: "Catalysts",
    content: "AI agents that autonomously execute business processes. Deploy new catalysts, review their actions, approve or reject decisions, and track exceptions. Use 'Manual Execute' to run catalysts with specific date ranges.",
  },
  {
    icon: Brain,
    title: "Mind & Memory",
    content: "Mind is your AI assistant — ask questions in natural language. Memory stores your organisation's knowledge graph with entities and relationships.",
  },
  {
    icon: Shield,
    title: "IAM & Security",
    content: "Manage users, roles, and permissions. Every action is logged in the audit trail. Configure tenant-level access policies.",
  },
  {
    icon: Database,
    title: "ERP Integration",
    content: "Connect to SAP, Salesforce, Xero, Sage, Pastel, Odoo, and more via the ERP Adapters page. The Canonical API provides unified access across all connected systems.",
  },
  {
    icon: MessageCircle,
    title: "Chat & Notifications",
    content: "Use Chat for real-time AI conversations. Notifications alert you to important events — catalyst exceptions, system alerts, and approval requests.",
  },
  {
    icon: Book,
    title: "Getting Started",
    content: "1. Set up your ERP connections\n2. Deploy your first catalyst\n3. Review AI-generated actions\n4. Configure IAM policies\n5. Monitor via Dashboard",
  },
  {
    icon: Activity,
    title: "Pulse Diagnostics & RCA",
    content: "Root-cause analysis engine identifies why metrics drift. View causal chains (L0\u2013L5), track fixes, and receive AI-generated prescriptions with SAP transaction codes. Use the Diagnostics tab on the Pulse page.",
  },
  {
    icon: Download,
    title: "CSV Export",
    content: "Export data from any table using the download button in the top-right of each section. Exports include radar signals, diagnostics, catalyst patterns, ROI tracking, and board reports.",
  },
  {
    icon: Rocket,
    title: "Onboarding Checklist",
    content: "New users see a guided checklist on the Dashboard. Complete each step to unlock Atheon\u2019s full potential: connect ERP, deploy catalysts, run analyses, generate reports, and invite your team.",
  },
  {
    icon: Smartphone,
    title: "Mobile & Accessibility",
    content: "Atheon is responsive across desktop, tablet, and mobile. The sidebar collapses automatically on small screens. All interactive elements support keyboard navigation and screen readers.",
  },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-accent hover:bg-accent/80 text-[var(--text-on-accent)] shadow-lg shadow-accent/20 flex items-center justify-center transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:scale-105 active:scale-[0.97]"
        title="Help & Documentation"
      >
        <HelpCircle size={22} />
      </button>

      {/* Help panel */}
      {open && (
        <Portal><div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-sm h-full overflow-y-auto"
            style={{ background: 'var(--bg-card-solid)', borderLeft: '1px solid var(--border-card)' }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4" style={{ background: 'var(--bg-card-solid)', borderBottom: '1px solid var(--border-card)' }}>
              <div className="flex items-center gap-2">
                <Book className="w-5 h-5 text-accent" />
                <h2 className="text-base font-semibold t-primary">Help & Documentation</h2>
              </div>
              <button onClick={() => setOpen(false)} className="t-muted hover:t-primary transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Topics */}
            <div className="p-5 space-y-3">
              {helpTopics.map((topic, i) => {
                const Icon = topic.icon;
                return (
                  <details key={i} className="group">
                    <summary className="flex items-center gap-3 p-3 rounded-md cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors list-none active:scale-[0.97]">
                      <div className="w-8 h-8 rounded-sm bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <Icon size={16} className="text-accent" />
                      </div>
                      <span className="text-sm font-medium t-primary">{topic.title}</span>
                    </summary>
                    <div className="ml-11 mt-1 mb-2 text-xs t-muted leading-relaxed whitespace-pre-line">
                      {topic.content}
                    </div>
                  </details>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border-card)' }}>
              <p className="text-xs t-muted text-center">
                Atheon v1.0 — Enterprise Intelligence Platform
              </p>
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}
