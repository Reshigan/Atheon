import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/appStore";
import {
  Settings, User, Bell, Palette, Cpu
} from "lucide-react";

export function SettingsPage() {
  const { user } = useAppStore();

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-neutral-700/30 flex items-center justify-center">
          <Settings className="w-5 h-5 text-neutral-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-neutral-400">Platform configuration and preferences</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile */}
        <Card>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-indigo-400" /> Profile
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-2xl font-bold text-white">
                {user?.name?.charAt(0) || 'A'}
              </div>
              <div>
                <p className="text-lg font-semibold text-white">{user?.name || 'Admin'}</p>
                <p className="text-sm text-neutral-400">{user?.email}</p>
                <Badge variant="info" size="sm" className="mt-1">{user?.role}</Badge>
              </div>
            </div>
            <Input label="Display Name" defaultValue={user?.name} />
            <Input label="Email" defaultValue={user?.email} />
            <Button variant="primary" size="sm">Save Changes</Button>
          </div>
        </Card>

        {/* Notifications */}
        <Card>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" /> Notifications
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Risk alerts (critical)', desc: 'Immediate notification for critical risk alerts', enabled: true },
              { label: 'Catalyst approvals', desc: 'When a catalyst action requires approval', enabled: true },
              { label: 'Executive briefings', desc: 'Daily morning briefing notification', enabled: true },
              { label: 'Anomaly detection', desc: 'When Pulse detects process anomalies', enabled: false },
              { label: 'System health', desc: 'Uptime and performance degradation alerts', enabled: true },
            ].map((notif) => (
              <div key={notif.label} className="flex items-center justify-between p-3 rounded-lg bg-neutral-800/40">
                <div>
                  <span className="text-sm text-neutral-200">{notif.label}</span>
                  <p className="text-[10px] text-neutral-600">{notif.desc}</p>
                </div>
                <div className={`w-10 h-5 rounded-full transition-colors ${notif.enabled ? 'bg-indigo-500' : 'bg-neutral-700'} relative cursor-pointer`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${notif.enabled ? 'left-5' : 'left-0.5'}`} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Appearance */}
        <Card>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-violet-400" /> Appearance
          </h3>
          <div className="space-y-4">
            <div>
              <span className="text-sm text-neutral-300">Theme</span>
              <div className="flex gap-3 mt-2">
                <div className="w-20 h-14 rounded-lg bg-neutral-950 border-2 border-indigo-500 flex items-center justify-center text-xs text-neutral-300 cursor-pointer">
                  Dark
                </div>
                <div className="w-20 h-14 rounded-lg bg-neutral-100 border border-neutral-300 flex items-center justify-center text-xs text-neutral-700 cursor-pointer opacity-50">
                  Light
                </div>
              </div>
            </div>
            <div>
              <span className="text-sm text-neutral-300">Accent Colour</span>
              <div className="flex gap-2 mt-2">
                {['bg-indigo-500', 'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500'].map(c => (
                  <div key={c} className={`w-8 h-8 rounded-full ${c} cursor-pointer ${c === 'bg-indigo-500' ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900' : ''}`} />
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Platform Info */}
        <Card>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" /> Platform
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Platform', value: 'Atheon™ Enterprise Intelligence' },
              { label: 'Version', value: '1.0.0' },
              { label: 'Deployment', value: 'Cloudflare Pages + Workers' },
              { label: 'Region', value: 'af-south-1 (South Africa)' },
              { label: 'Database', value: 'Cloudflare D1' },
              { label: 'Vector DB', value: 'Cloudflare Vectorize' },
              { label: 'LLM', value: 'Atheon Mind 70B (Multi-Tier)' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-2 border-b border-neutral-800/50 last:border-0">
                <span className="text-sm text-neutral-400">{item.label}</span>
                <span className="text-sm text-neutral-200 font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
