import { useAppStore } from "@/stores/appStore";
import { Bell, ChevronDown, Menu, LogOut, MessageCircle, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "@/lib/api";
import type { IndustryVertical } from "@/types";

const industries: { value: IndustryVertical; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'fmcg', label: 'FMCG' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mining', label: 'Mining' },
];

export function Header() {
  const { user, industry, setIndustry, setMobileSidebarOpen, setUser } = useAppStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Continue with client-side logout even if API call fails
    }
    setToken(null);
    setUser(null);
    navigate('/login', { replace: true });
  };

  return (
    <header
      className="fixed top-0 right-0 z-30 h-16 flex items-center justify-between px-4 sm:px-6"
      style={{ left: '0px', background: 'transparent' }}
    >
      {/* Left: hamburger (mobile) + spacer (desktop) */}
      <div className="flex items-center gap-3 flex-1">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-white/40 transition-all"
        >
          <Menu size={22} />
        </button>

        {/* Spacer for desktop sidebar (always 16 = w-16 sidebar) */}
        <div className="hidden lg:block flex-shrink-0 w-10" />
      </div>

      {/* Right: action icons + user — compact like reference */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Industry Selector - compact */}
        <div className="relative hidden md:block">
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
            className="appearance-none bg-white/40 border border-white/50 rounded-full pl-3 pr-7 py-1.5 text-xs text-gray-500 cursor-pointer hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 backdrop-blur-sm transition-all"
          >
            {industries.map(i => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
        </div>

        {/* Action icons — small rounded buttons like reference */}
        <div className="flex items-center gap-0.5">
          <button className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-white/40 transition-all" title="Messages">
            <MessageCircle size={17} />
          </button>
          <button className="relative p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-white/40 transition-all" title="Notifications">
            <Bell size={17} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
          </button>
          <button className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-white/40 transition-all" title="Settings">
            <Settings size={17} />
          </button>
        </div>

        {/* User avatar */}
        <div className="flex items-center gap-2 ml-1">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ring-2 ring-white/50">
            {user?.name?.charAt(0) || 'A'}
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-white/40 transition-all"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
