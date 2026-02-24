import { useAppStore } from "@/stores/appStore";
import { Bell, ChevronDown, Menu, LogOut, MessageCircle, Settings, X, Check, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "@/lib/api";
import type { NotificationItem } from "@/lib/api";
import type { IndustryVertical } from "@/types";
import { useState, useEffect, useRef, useCallback } from "react";

const industries: { value: IndustryVertical; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'fmcg', label: 'FMCG' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mining', label: 'Mining' },
];

const severityColors: Record<string, string> = {
  critical: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-cyan-400',
  info: 'bg-gray-500',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Header() {
  const { user, industry, setIndustry, setMobileSidebarOpen, setUser, theme, toggleTheme } = useAppStore();
  const navigate = useNavigate();

  // Notifications state
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showNotifications]);

  // Fetch unread count on mount and periodically
  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await api.notifications.unreadCount();
      setUnreadCount(data.unreadCount);
    } catch {
      // Silently fail — notifications aren't critical
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000); // poll every 30s
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch full notifications when dropdown opens
  const openNotifications = async () => {
    setShowNotifications((prev) => !prev);
    if (!showNotifications) {
      setLoadingNotifs(true);
      try {
        const data = await api.notifications.list({ limit: 20 });
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      } catch {
        // fallback empty
      } finally {
        setLoadingNotifs(false);
      }
    }
  };

  // Mark all as read
  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      await api.notifications.markRead(unreadIds);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silently fail
    }
  };

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
      style={{ left: '0px', background: 'rgba(26, 26, 46, 0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      {/* Left: hamburger (mobile) + spacer (desktop) */}
      <div className="flex items-center gap-3 flex-1">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 rounded-xl text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-all"
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
            className="appearance-none bg-white/[0.04] border border-white/[0.08] rounded-full pl-3 pr-7 py-1.5 text-xs text-gray-400 cursor-pointer hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-amber-500/20 backdrop-blur-sm transition-all"
          >
            {industries.map(i => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
        </div>

        {/* Action icons — small rounded buttons */}
        <div className="flex items-center gap-0.5">
          {/* Messages → Chat page */}
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-full text-gray-500 hover:text-amber-400 hover:bg-white/[0.06] transition-all"
            title="Messages"
          >
            <MessageCircle size={17} />
          </button>

          {/* Notifications → Dropdown with real API data */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={openNotifications}
              className={`relative p-2 rounded-full transition-all ${showNotifications ? 'text-amber-400 bg-white/[0.08]' : 'text-gray-500 hover:text-amber-400 hover:bg-white/[0.06]'}`}
              title="Notifications"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notifications dropdown panel */}
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-[#1e1e2a]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden z-50">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                  <h3 className="text-sm font-semibold text-gray-200">Notifications</h3>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-xs text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1"
                      >
                        <Check size={12} /> Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1 rounded-full text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="max-h-80 overflow-y-auto">
                  {loadingNotifs ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="py-8 text-center">
                      <Bell size={24} className="mx-auto mb-2 text-gray-600" />
                      <p className="text-sm text-gray-500">No notifications yet</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (n.actionUrl) {
                            navigate(n.actionUrl.replace('https://atheon.vantax.co.za', ''));
                          }
                          setShowNotifications(false);
                        }}
                        className={`w-full text-left px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.04] transition-all ${!n.read ? 'bg-amber-500/[0.04]' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityColors[n.severity] || 'bg-gray-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm leading-tight ${!n.read ? 'font-semibold text-gray-200' : 'text-gray-400'}`}>
                              {n.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                            <p className="text-[10px] text-gray-600 mt-1">{timeAgo(n.createdAt)}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Footer */}
                {notifications.length > 0 && (
                  <div className="px-4 py-2 border-t border-white/[0.06] bg-white/[0.02]">
                    <button
                      onClick={() => {
                        navigate('/audit');
                        setShowNotifications(false);
                      }}
                      className="text-xs text-amber-400 hover:text-amber-300 font-medium"
                    >
                      View all activity
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full text-gray-500 hover:text-amber-400 hover:bg-white/[0.06] transition-all"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* Settings → Settings page */}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full text-gray-500 hover:text-amber-400 hover:bg-white/[0.06] transition-all"
            title="Settings"
          >
            <Settings size={17} />
          </button>
        </div>

        {/* User avatar */}
        <div className="flex items-center gap-2 ml-1">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ring-2 ring-white/[0.1]">
            {user?.name?.charAt(0) || 'A'}
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 rounded-full text-gray-500 hover:text-red-400 hover:bg-white/[0.06] transition-all"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
