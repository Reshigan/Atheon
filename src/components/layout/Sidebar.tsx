import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import {
  IconDashboard, IconApex, IconPulse, IconCatalysts, IconMind, IconMemory,
  IconChat, IconClients, IconIAM, IconControlPlane, IconCanonicalApi,
  IconERPAdapters, IconConnectivity, IconAudit, IconSettings,
} from "@/components/icons/AtheonIcons";

const navItems = [
  { path: '/', label: 'Dashboard', icon: IconDashboard, section: 'intelligence' },
  { path: '/apex', label: 'Apex', icon: IconApex, section: 'intelligence', sublabel: 'Executive Intelligence' },
  { path: '/pulse', label: 'Pulse', icon: IconPulse, section: 'intelligence', sublabel: 'Process Intelligence' },
  { path: '/catalysts', label: 'Catalysts', icon: IconCatalysts, section: 'intelligence', sublabel: 'Autonomous Execution' },
  { path: '/mind', label: 'Mind', icon: IconMind, section: 'intelligence', sublabel: 'Domain LLM' },
  { path: '/memory', label: 'Memory', icon: IconMemory, section: 'intelligence', sublabel: 'GraphRAG' },
  { path: '/chat', label: 'Chat', icon: IconChat, section: 'intelligence', sublabel: 'Conversational AI' },
  { path: '/tenants', label: 'Clients', icon: IconClients, section: 'platform', sublabel: 'Tenant Management' },
  { path: '/iam', label: 'IAM', icon: IconIAM, section: 'platform', sublabel: 'Identity & Access' },
  { path: '/control-plane', label: 'Control Plane', icon: IconControlPlane, section: 'platform', sublabel: 'Agent Management' },
  { path: '/canonical-api', label: 'Canonical API', icon: IconCanonicalApi, section: 'platform', sublabel: 'Unified API' },
  { path: '/erp-adapters', label: 'ERP Adapters', icon: IconERPAdapters, section: 'platform', sublabel: 'System Connectors' },
  { path: '/connectivity', label: 'Connectivity', icon: IconConnectivity, section: 'system', sublabel: 'MCP + A2A' },
  { path: '/audit', label: 'Audit', icon: IconAudit, section: 'system', sublabel: 'Governance' },
  { path: '/settings', label: 'Settings', icon: IconSettings, section: 'system' },
];

/** Logo component used in both desktop and mobile sidebar — 3D capsule design */
function AtheonLogo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 'w-9 h-9' : 'w-8 h-8';
  return (
    <div className={cn(s, 'rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 shadow-md')}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className={size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'}>
        <defs>
          <linearGradient id="slp1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7dd3fc"/><stop offset="100%" stopColor="#0ea5e9"/>
          </linearGradient>
          <linearGradient id="slp2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#67e8f9"/><stop offset="100%" stopColor="#06b6d4"/>
          </linearGradient>
          <linearGradient id="sls" x1="20%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.9"/><stop offset="100%" stopColor="white" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <ellipse cx="24" cy="36" rx="10" ry="18" fill="url(#slp1)" transform="rotate(-35 24 36)"/>
        <ellipse cx="40" cy="34" rx="9" ry="17" fill="url(#slp2)" transform="rotate(25 40 34)"/>
        <ellipse cx="21" cy="30" rx="4" ry="9" fill="url(#sls)" transform="rotate(-35 21 30)" opacity="0.7"/>
        <ellipse cx="38" cy="28" rx="3.5" ry="8" fill="url(#sls)" transform="rotate(25 38 28)" opacity="0.6"/>
        <circle cx="19" cy="24" r="2.5" fill="white" opacity="0.9"/>
        <circle cx="37" cy="23" r="2" fill="white" opacity="0.8"/>
      </svg>
    </div>
  );
}

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useAppStore();
  const location = useLocation();
  const closeMobile = () => setMobileSidebarOpen(false);

  let lastSection = '';

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Desktop sidebar — icon-only narrow glass bar */}
      <aside className="fixed left-0 top-0 h-full z-40 w-16 hidden lg:flex flex-col items-center py-5 bg-glass-subtle">
        {/* Logo */}
        <div className="mb-8">
          <AtheonLogo />
        </div>

        {/* Nav icons */}
        <nav className="flex-1 flex flex-col items-center gap-0.5 overflow-y-auto scrollbar-thin w-full px-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path));
            const Icon = item.icon;
            const showDivider = lastSection !== '' && lastSection !== item.section;
            lastSection = item.section;

            return (
              <div key={item.path} className="w-full flex flex-col items-center">
                {showDivider && <div className="w-6 h-px bg-gray-300/30 my-2" />}
                <Link
                  to={item.path}
                  title={item.label}
                  className={cn(
                    'w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 group relative',
                    isActive
                      ? 'bg-white/60 shadow-sm text-gray-800'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-white/30'
                  )}
                >
                  <Icon size={19} className={cn(isActive ? 'text-gray-800' : 'text-gray-400 group-hover:text-gray-600')} />
                  {/* Tooltip */}
                  <div className="absolute left-full ml-3 px-3 py-1.5 bg-gray-800/90 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 backdrop-blur-sm shadow-lg">
                    {item.label}
                  </div>
                </Link>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Mobile sidebar — full expanded with labels */}
      <aside className={cn(
        'fixed left-0 top-0 h-full z-50 flex flex-col bg-glass-strong transition-transform duration-300 w-72 lg:hidden',
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex items-center justify-between px-4 h-16 border-b border-white/20">
          <div className="flex items-center gap-3">
            <AtheonLogo size="lg" />
            <div>
              <h1 className="text-lg font-bold text-gradient">Atheon</h1>
              <p className="text-[10px] text-gray-500 -mt-0.5 tracking-wider uppercase">Enterprise Intelligence</p>
            </div>
          </div>
          <button
            onClick={closeMobile}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white/40 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-3">
          {(() => {
            let prevSection = '';
            return navItems.map((item) => {
              const isActive = location.pathname === item.path ||
                (item.path !== '/' && location.pathname.startsWith(item.path));
              const Icon = item.icon;
              const showSectionHeader = prevSection !== item.section;
              prevSection = item.section;
              const sectionLabels: Record<string, string> = { intelligence: 'Intelligence', platform: 'Platform', system: 'System' };

              return (
                <div key={item.path}>
                  {showSectionHeader && (
                    <span className="block px-3 mt-4 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider first:mt-0">
                      {sectionLabels[item.section]}
                    </span>
                  )}
                  <Link
                    to={item.path}
                    onClick={closeMobile}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group',
                      isActive
                        ? 'bg-white/60 text-cyan-700 shadow-sm'
                        : 'text-gray-600 hover:bg-white/40 hover:text-gray-800'
                    )}
                  >
                    <Icon className={cn('flex-shrink-0', isActive ? 'text-cyan-600' : 'text-gray-400 group-hover:text-gray-600')} size={18} />
                    <div className="min-w-0">
                      <span className="font-medium">{item.label}</span>
                      {item.sublabel && (
                        <span className="block text-[10px] text-gray-400 truncate">{item.sublabel}</span>
                      )}
                    </div>
                  </Link>
                </div>
              );
            });
          })()}
        </nav>
      </aside>
    </>
  );
}
