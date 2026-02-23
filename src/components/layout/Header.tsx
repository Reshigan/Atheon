import { useAppStore } from "@/stores/appStore";
import { Bell, Search, Globe } from "lucide-react";
import type { IndustryVertical } from "@/types";

const industries: { value: IndustryVertical; label: string }[] = [
  { value: 'general', label: 'All Industries' },
  { value: 'fmcg', label: 'FMCG' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mining', label: 'Mining' },
];

export function Header() {
  const { user, industry, setIndustry, sidebarOpen } = useAppStore();

  return (
    <header
      className="fixed top-0 right-0 z-30 h-16 border-b border-neutral-800/50 bg-neutral-950/80 backdrop-blur-xl flex items-center justify-between px-6"
      style={{ left: sidebarOpen ? '16rem' : '4rem' }}
    >
      {/* Search */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
          <input
            type="text"
            placeholder="Ask Atheon anything..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-neutral-900/60 border border-neutral-800/50 text-sm text-neutral-300 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-neutral-600 bg-neutral-800 border border-neutral-700">
            /
          </kbd>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-4">
        {/* Industry selector */}
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-neutral-500" />
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
            className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            {industries.map(ind => (
              <option key={ind.value} value={ind.value}>{ind.label}</option>
            ))}
          </select>
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 transition-all">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        </button>

        {/* User */}
        <div className="flex items-center gap-3 pl-4 border-l border-neutral-800">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white">
            {user?.name?.charAt(0) || 'A'}
          </div>
          <div className="hidden lg:block">
            <p className="text-sm font-medium text-neutral-200">{user?.name || 'Admin'}</p>
            <p className="text-[10px] text-neutral-500">{user?.role || 'admin'}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
