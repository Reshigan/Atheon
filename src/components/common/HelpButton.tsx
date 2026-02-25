import { useState } from "react";
import { HelpCircle, X, Book, Zap, Shield, Database, Brain, BarChart3, MessageCircle } from "lucide-react";

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
    content: "Connect to SAP, Salesforce, Xero, Sage, Pastel, and more via the ERP Adapters page. The Canonical API provides unified access across all connected systems.",
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
];

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-accent hover:bg-accent/80 text-white shadow-lg shadow-accent/20 flex items-center justify-center transition-all hover:scale-105"
        title="Help & Documentation"
      >
        <HelpCircle size={22} />
      </button>

      {/* Help panel */}
      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            style={{ background: "rgba(18,18,42,0.98)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
            className="relative w-full max-w-sm h-full overflow-y-auto shadow-2xl"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4" style={{ background: "rgba(18,18,42,0.98)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2">
                <Book className="w-5 h-5 text-accent" />
                <h2 className="text-base font-semibold text-white">Help & Documentation</h2>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Topics */}
            <div className="p-5 space-y-3">
              {helpTopics.map((topic, i) => {
                const Icon = topic.icon;
                return (
                  <details key={i} className="group">
                    <summary className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-white/[0.04] transition-colors list-none">
                                            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                                              <Icon size={16} className="text-accent" />
                      </div>
                      <span className="text-sm font-medium text-gray-200">{topic.title}</span>
                    </summary>
                    <div className="ml-11 mt-1 mb-2 text-xs text-gray-400 leading-relaxed whitespace-pre-line">
                      {topic.content}
                    </div>
                  </details>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs text-gray-500 text-center">
                Atheon v1.0 — Enterprise Intelligence Platform
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
