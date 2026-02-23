import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Crown, Activity, Zap, Brain, Database,
  MessageSquare, Settings, Link2, Shield, ChevronLeft, ChevronRight,
  Sparkles, Building2, ShieldCheck, Cpu, Globe, Plug
} from "lucide-react";

const navSections = [
  {
    title: 'Intelligence',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard, layer: null },
      { path: '/apex', label: 'Apex', icon: Crown, layer: 'apex' as const, sublabel: 'Executive Intelligence' },
      { path: '/pulse', label: 'Pulse', icon: Activity, layer: 'pulse' as const, sublabel: 'Process Intelligence' },
      { path: '/catalysts', label: 'Catalysts', icon: Zap, layer: 'catalysts' as const, sublabel: 'Autonomous Execution' },
      { path: '/mind', label: 'Mind', icon: Brain, layer: 'mind' as const, sublabel: 'Domain LLM' },
      { path: '/memory', label: 'Memory', icon: Database, layer: 'memory' as const, sublabel: 'GraphRAG' },
      { path: '/chat', label: 'Chat', icon: MessageSquare, layer: null, sublabel: 'Conversational AI' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { path: '/tenants', label: 'Clients', icon: Building2, layer: null, sublabel: 'Tenant Management' },
      { path: '/iam', label: 'IAM', icon: ShieldCheck, layer: null, sublabel: 'Identity & Access' },
      { path: '/control-plane', label: 'Control Plane', icon: Cpu, layer: null, sublabel: 'Agent Management' },
      { path: '/canonical-api', label: 'Canonical API', icon: Globe, layer: null, sublabel: 'Unified API' },
      { path: '/erp-adapters', label: 'ERP Adapters', icon: Plug, layer: null, sublabel: 'System Connectors' },
    ],
  },
  {
    title: 'System',
    items: [
      { path: '/connectivity', label: 'Connectivity', icon: Link2, layer: null, sublabel: 'MCP + A2A' },
      { path: '/audit', label: 'Audit', icon: Shield, layer: null, sublabel: 'Governance' },
      { path: '/settings', label: 'Settings', icon: Settings, layer: null },
    ],
  },
];

const layerColors: Record<string, string> = {
  apex: 'text-amber-400',
  pulse: 'text-emerald-400',
  catalysts: 'text-blue-400',
  mind: 'text-violet-400',
  memory: 'text-pink-400',
};

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const location = useLocation();

  return (
    <aside className={cn(
      'fixed left-0 top-0 h-full z-40 flex flex-col border-r border-neutral-800/50 bg-neutral-950/95 backdrop-blur-xl transition-all duration-300',
      sidebarOpen ? 'w-64' : 'w-16'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-neutral-800/50">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        {sidebarOpen && (
          <div className="animate-fadeIn">
            <h1 className="text-lg font-bold text-gradient">Atheon</h1>
            <p className="text-[10px] text-neutral-500 -mt-0.5 tracking-wider uppercase">Enterprise Intelligence</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        {navSections.map((section) => (
          <div key={section.title} className="mb-4">
            {sidebarOpen && (
              <span className="block px-3 mb-1.5 text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">{section.title}</span>
            )}
            {!sidebarOpen && <div className="h-px bg-neutral-800/50 mx-2 mb-2" />}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location.pathname === item.path || 
                  (item.path !== '/' && location.pathname.startsWith(item.path));
                const Icon = item.icon;
                const colorClass = item.layer ? layerColors[item.layer] : '';

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 group',
                      isActive
                        ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                        : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 border border-transparent'
                    )}
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <Icon className={cn('flex-shrink-0', isActive ? 'text-indigo-400' : colorClass || 'text-neutral-500 group-hover:text-neutral-300')} size={18} />
                    {sidebarOpen && (
                      <div className="min-w-0 animate-fadeIn">
                        <span className="font-medium">{item.label}</span>
                        {item.sublabel && (
                          <span className="block text-[10px] text-neutral-500 truncate">{item.sublabel}</span>
                        )}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse button */}
      <div className="border-t border-neutral-800/50 p-2">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center py-2 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60 transition-all"
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>
    </aside>
  );
}
