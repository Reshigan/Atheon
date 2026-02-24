import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Crown, Activity, Zap, Brain, Database,
  MessageSquare, Settings, Link2, Shield, ChevronLeft, ChevronRight,
  Sparkles, Building2, ShieldCheck, Cpu, Globe, Plug, X
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
  apex: 'text-amber-600',
  pulse: 'text-emerald-600',
  catalysts: 'text-blue-600',
  mind: 'text-violet-600',
  memory: 'text-pink-600',
};

function SidebarNav({ expanded, onNavClick }: { expanded: boolean; onNavClick?: () => void }) {
  const location = useLocation();

  return (
    <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
      {navSections.map((section) => (
        <div key={section.title} className="mb-4">
          {expanded && (
            <span className="block px-3 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{section.title}</span>
          )}
          {!expanded && <div className="h-px bg-gray-200 mx-2 mb-2" />}
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
                  onClick={onNavClick}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 group',
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
                  )}
                  title={!expanded ? item.label : undefined}
                >
                  <Icon className={cn('flex-shrink-0', isActive ? 'text-indigo-600' : colorClass || 'text-gray-400 group-hover:text-gray-600')} size={18} />
                  {expanded && (
                    <div className="min-w-0 animate-fadeIn">
                      <span className="font-medium">{item.label}</span>
                      {item.sublabel && (
                        <span className="block text-[10px] text-gray-400 truncate">{item.sublabel}</span>
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
  );
}

export function Sidebar() {
  const { sidebarOpen, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useAppStore();

  const closeMobile = () => setMobileSidebarOpen(false);

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Desktop sidebar */}
      <aside className={cn(
        'fixed left-0 top-0 h-full z-40 flex-col border-r border-gray-200 bg-white/95 backdrop-blur-xl transition-all duration-300',
        'hidden lg:flex',
        sidebarOpen ? 'w-64' : 'w-16',
      )}>
        <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-200">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          {sidebarOpen && (
            <div className="animate-fadeIn">
              <h1 className="text-lg font-bold text-gradient">Atheon</h1>
              <p className="text-[10px] text-gray-500 -mt-0.5 tracking-wider uppercase">Enterprise Intelligence</p>
            </div>
          )}
        </div>

        <SidebarNav expanded={sidebarOpen} />

        <div className="border-t border-gray-200 p-2">
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center py-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          >
            {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      <aside className={cn(
        'fixed left-0 top-0 h-full z-50 flex flex-col border-r border-gray-200 bg-white backdrop-blur-xl transition-transform duration-300 w-72 lg:hidden',
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex items-center justify-between px-4 h-16 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gradient">Atheon</h1>
              <p className="text-[10px] text-gray-500 -mt-0.5 tracking-wider uppercase">Enterprise Intelligence</p>
            </div>
          </div>
          <button
            onClick={closeMobile}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <SidebarNav expanded onNavClick={closeMobile} />
      </aside>
    </>
  );
}
