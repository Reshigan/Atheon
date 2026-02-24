import { useAppStore } from "@/stores/appStore";
import { Search, Bell, ChevronDown, Menu, LogOut, MessageCircle, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { setToken } from "@/lib/api";
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

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    navigate('/login', { replace: true });
  };

  return (
    <header
      className="fixed top-0 right-0 z-30 h-16 bg-glass flex items-center justify-between px-4 sm:px-6"
      style={{ left: '0px' }}
    >
      {/* Left: hamburger (mobile) + spacer (desktop) + search */}
      <div className="flex items-center gap-3 flex-1 max-w-lg">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-white/40 transition-all"
        >
          <Menu size={22} />
        </button>

        {/* Spacer for desktop sidebar (always 16 = w-16 sidebar) */}
        <div className="hidden lg:block flex-shrink-0 w-8" />

        {/* Search */}
        <div className="relative flex-1 hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Ask Atheon anything..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-white/50 border border-white/60 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 focus:bg-white/70 transition-all backdrop-blur-sm"
          />
        </div>
        {/* Mobile search icon */}
        <button className="sm:hidden p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white/40">
          <Search size={20} />
        </button>
      </div>

      {/* Right: industry selector, action icons, user */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        {/* Industry Selector */}
        <div className="relative hidden sm:block">
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
            className="appearance-none bg-white/50 border border-white/60 rounded-xl pl-3 pr-8 py-1.5 text-xs sm:text-sm text-gray-600 cursor-pointer hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 backdrop-blur-sm transition-all"
          >
            {industries.map(i => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Action icons row — matching reference style */}
        <div className="flex items-center gap-0.5">
          <button className="p-2 rounded-xl text-gray-500 hover:text-cyan-600 hover:bg-white/40 transition-all" title="Messages">
            <MessageCircle size={18} />
          </button>
          <button className="relative p-2 rounded-xl text-gray-500 hover:text-cyan-600 hover:bg-white/40 transition-all" title="Notifications">
            <Bell size={18} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>
          <button className="p-2 rounded-xl text-gray-500 hover:text-cyan-600 hover:bg-white/40 transition-all" title="Settings">
            <Settings size={18} />
          </button>
        </div>

        {/* User avatar + info */}
        <div className="flex items-center gap-2 sm:gap-3 ml-1 sm:ml-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0 shadow-md shadow-cyan-500/20 ring-2 ring-white/60">
            {user?.name?.charAt(0) || 'A'}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium text-gray-800">{user?.name || 'Admin'}</p>
            <p className="text-[10px] text-gray-500 capitalize">{user?.role || 'admin'}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50/80 transition-all"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
