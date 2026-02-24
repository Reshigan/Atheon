import { useAppStore } from "@/stores/appStore";
import { Search, Bell, ChevronDown, Menu } from "lucide-react";
import type { IndustryVertical } from "@/types";

const industries: { value: IndustryVertical; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'fmcg', label: 'FMCG' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mining', label: 'Mining' },
];

export function Header() {
  const { sidebarOpen, user, industry, setIndustry, setMobileSidebarOpen } = useAppStore();

  return (
    <header
      className="fixed top-0 right-0 z-30 h-16 border-b border-gray-200 bg-white/80 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6"
      style={{ left: 0 }}
    >
      {/* Left: hamburger (mobile) + search */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
        >
          <Menu size={22} />
        </button>

        {/* Spacer for desktop sidebar */}
        <div className={`hidden lg:block flex-shrink-0 transition-all duration-300 ${sidebarOpen ? 'w-56' : 'w-8'}`} />

        {/* Search */}
        <div className="relative flex-1 hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Ask Atheon anything..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-100 border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all"
          />
        </div>
        {/* Mobile search icon */}
        <button className="sm:hidden p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <Search size={20} />
        </button>
      </div>

      {/* Right: industry selector, notifications, user */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Industry Selector */}
        <div className="relative">
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
            className="appearance-none bg-gray-100 border border-gray-200 rounded-lg pl-3 pr-8 py-1.5 text-xs sm:text-sm text-gray-600 cursor-pointer hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {industries.map(i => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all">
          <Bell size={18} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-[9px] font-bold text-white">3</span>
          </span>
        </button>

        {/* User */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {user?.name?.charAt(0) || 'A'}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium text-gray-800">{user?.name || 'Admin'}</p>
            <p className="text-[10px] text-gray-500">{user?.role || 'admin'}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
