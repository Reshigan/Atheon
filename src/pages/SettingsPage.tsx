import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/appStore";
import { api } from "@/lib/api";
import {
  Settings, User, Bell, Palette, Cpu, Loader2, Check
} from "lucide-react";

interface NotificationPref {
  label: string;
  desc: string;
  enabled: boolean;
}

export function SettingsPage() {
  const { user, setUser } = useAppStore();
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accentColor, setAccentColor] = useState('bg-blue-500');

  const [notifications, setNotifications] = useState<NotificationPref[]>([
    { label: 'Risk alerts (critical)', desc: 'Immediate notification for critical risk alerts', enabled: true },
    { label: 'Catalyst approvals', desc: 'When a catalyst action requires approval', enabled: true },
    { label: 'Executive briefings', desc: 'Daily morning briefing notification', enabled: true },
    { label: 'Anomaly detection', desc: 'When Pulse detects process anomalies', enabled: false },
    { label: 'System health', desc: 'Uptime and performance degradation alerts', enabled: true },
  ]);

  const toggleNotification = (index: number) => {
    setNotifications(prev => prev.map((n, i) => i === index ? { ...n, enabled: !n.enabled } : n));
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaved(false);
    try {
      if (user) {
        setUser({ ...user, name: displayName, email });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silent
    }
    setSaving(false);
  };

  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleChangePassword = async () => {
    if (newPw.length < 8) {
      setPwMsg({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }
    setChangingPw(true);
    setPwMsg(null);
    try {
      await api.auth.changePassword(newPw, currentPw || undefined);
      setPwMsg({ type: 'success', text: 'Password changed successfully' });
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setPwMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
    }
    setChangingPw(false);
  };

  const accentOptions = [
    { class: 'bg-blue-600', name: 'Blue' },
    { class: 'bg-sky-500', name: 'Sky' },
    { class: 'bg-cyan-500', name: 'Cyan' },
    { class: 'bg-emerald-500', name: 'Emerald' },
    { class: 'bg-amber-500', name: 'Amber' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <Settings className="w-5 h-5 text-gray-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Platform configuration and preferences</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile */}
        <Card>
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600" /> Profile
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-2xl font-bold text-white">
                {displayName?.charAt(0) || 'A'}
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900">{displayName || 'Admin'}</p>
                <p className="text-sm text-gray-500">{email}</p>
                <Badge variant="info" size="sm" className="mt-1">{user?.role}</Badge>
              </div>
            </div>
            <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
                {saved ? 'Saved' : 'Save Changes'}
              </Button>
              {saved && <span className="text-xs text-emerald-600">Profile updated</span>}
            </div>

            {/* Password Change */}
            <div className="border-t border-gray-200 pt-4 mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Change Password</h4>
              <div className="space-y-3">
                <Input label="Current Password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" />
                <Input label="New Password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 8 characters" />
                {pwMsg && (
                  <div className={`text-xs p-2 rounded ${pwMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {pwMsg.text}
                  </div>
                )}
                <Button variant="secondary" size="sm" onClick={handleChangePassword} disabled={changingPw}>
                  {changingPw ? <Loader2 size={14} className="animate-spin" /> : null}
                  Change Password
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Notifications */}
        <Card>
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-600" /> Notifications
          </h3>
          <div className="space-y-3">
            {notifications.map((notif, index) => (
              <div key={notif.label} className="flex items-center justify-between p-3 rounded-lg bg-gray-100">
                <div>
                  <span className="text-sm text-gray-800">{notif.label}</span>
                  <p className="text-[10px] text-gray-400">{notif.desc}</p>
                </div>
                <button
                  onClick={() => toggleNotification(index)}
                  className={`w-10 h-5 rounded-full transition-colors ${notif.enabled ? 'bg-blue-500' : 'bg-gray-300'} relative`}
                  aria-label={`Toggle ${notif.label}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${notif.enabled ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </Card>

        {/* Appearance */}
        <Card>
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-600" /> Appearance
          </h3>
          <div className="space-y-4">
            <div>
              <span className="text-sm text-gray-600">Theme</span>
              <div className="flex gap-3 mt-2">
                <div className="w-20 h-14 rounded-lg bg-gray-800 border border-gray-300 flex items-center justify-center text-xs text-gray-300 cursor-not-allowed opacity-40" title="Dark theme not available">
                  Dark
                </div>
                <div className="w-20 h-14 rounded-lg bg-white border-2 border-blue-500 flex items-center justify-center text-xs text-gray-600">
                  Light
                </div>
              </div>
            </div>
            <div>
              <span className="text-sm text-gray-600">Accent Colour</span>
              <div className="flex gap-2 mt-2">
                {accentOptions.map(c => (
                  <button
                    key={c.class}
                    onClick={() => setAccentColor(c.class)}
                    title={c.name}
                    className={`w-8 h-8 rounded-full ${c.class} transition-all ${c.class === accentColor ? 'ring-2 ring-offset-2 ring-offset-white ring-blue-400 scale-110' : 'hover:scale-105'}`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Selected: {accentOptions.find(c => c.class === accentColor)?.name || 'Indigo'}</p>
            </div>
          </div>
        </Card>

        {/* Platform Info */}
        <Card>
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-600" /> Platform
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Platform', value: 'Atheon\u2122 Enterprise Intelligence' },
              { label: 'Version', value: '1.0.0' },
              { label: 'Deployment', value: 'Cloudflare Pages + Workers' },
              { label: 'Region', value: 'af-south-1 (South Africa)' },
              { label: 'Database', value: 'Cloudflare D1' },
              { label: 'Vector DB', value: 'Cloudflare Vectorize' },
              { label: 'LLM', value: 'Atheon Mind 70B (Multi-Tier)' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
                <span className="text-sm text-gray-500">{item.label}</span>
                <span className="text-sm text-gray-800 font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
