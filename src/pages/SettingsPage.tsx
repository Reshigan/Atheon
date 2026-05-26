import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/appStore";
import type { AccentColor } from "@/stores/appStore";
import { api, ApiError } from "@/lib/api";
import type { LlmConfigResponse } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/ui/state";
import {
 Settings, User, Bell, Palette, Cpu, Loader2, Check, Sun, Moon, Shield, Key, Copy, Download, Trash2, Brain, ArrowRight, AlertTriangle
} from "lucide-react";

interface NotificationPref {
 label: string;
 desc: string;
 enabled: boolean;
}

export function SettingsPage() {
 const toast = useToast();
 const { user, setUser, theme, setTheme, accentColor, setAccentColor } = useAppStore();
 const [displayName, setDisplayName] = useState(user?.name || '');
 const [email, setEmail] = useState(user?.email || '');
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [saveError, setSaveError] = useState<string | null>(null);

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
 setSaveError(null);
 try {
 if (user) {
 setUser({ ...user, name: displayName, email });
 }
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 } catch (err) {
 setSaveError(err instanceof Error ? err.message : 'Failed to save profile');
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
 const text = err instanceof Error ? err.message : 'Failed to change password';
 setPwMsg({ type: 'error', text });
 toast.error('Failed to change password', {
  message: text,
  requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setChangingPw(false);
 };

 // MFA status — full enrollment/management UX lives on /settings/mfa.
 const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
 const [mfaStatus, setMfaStatus] = useState<{ enabled: boolean; backupCodesRemaining?: number } | null>(null);

 useEffect(() => {
   let cancelled = false;
   api.auth.mfaStatus()
     .then((res) => { if (!cancelled) setMfaStatus({ enabled: !!res.enabled, backupCodesRemaining: res.backupCodesRemaining }); })
     .catch(() => { if (!cancelled) setMfaStatus({ enabled: false }); });
   return () => { cancelled = true; };
 }, []);

 // Phase 4.4: API key — server-side generation
 const [apiKeyVisible, setApiKeyVisible] = useState(false);
 const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
 const [apiKeyMeta, setApiKeyMeta] = useState<{ id: string; name: string; prefix: string; createdAt: string } | null>(null);
 const [apiKeyLoading, setApiKeyLoading] = useState(false);
 const [apiKeyError, setApiKeyError] = useState<string | null>(null);

 const loadApiKeys = useCallback(async () => {
   try {
     const res = await api.auth.listApiKeys();
     if (res.keys.length > 0) {
       const k = res.keys[0];
       setApiKeyMeta({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt });
     }
   } catch (err) {
     console.error('Failed to load API keys', err);
     // Silent load failure — the UI just shows the "Generate" CTA, which is
     // the correct fallback. Surface an error only if the user tries to
     // generate/regenerate a key.
   }
 }, []);

 useEffect(() => { loadApiKeys(); }, [loadApiKeys]);

 const handleGenerateApiKey = async () => {
   setApiKeyLoading(true);
   setApiKeyError(null);
   try {
     const res = await api.auth.generateApiKey();
     setGeneratedApiKey(res.key);
     setApiKeyMeta({ id: res.id, name: res.name, prefix: res.prefix, createdAt: new Date().toISOString() });
     setApiKeyVisible(true);
   } catch (err) {
     const message = err instanceof Error ? err.message : 'Failed to generate API key';
     setApiKeyError(message);
     toast.error('Failed to generate API key', {
       message,
       requestId: err instanceof ApiError ? err.requestId : null,
     });
   }
   setApiKeyLoading(false);
 };

 // LLM Configuration state (superadmin only)
 const isSuperadmin = user?.role === 'superadmin';
 const [llmConfig, setLlmConfig] = useState<LlmConfigResponse | null>(null);
 const [llmProvider, setLlmProvider] = useState('workers_ai');
 const [llmModel, setLlmModel] = useState('');
 const [llmApiKey, setLlmApiKey] = useState('');
 const [llmBaseUrl, setLlmBaseUrl] = useState('');
 const [llmTemperature, setLlmTemperature] = useState(0.3);
 const [llmMaxTokens, setLlmMaxTokens] = useState(1024);
 const [llmSaving, setLlmSaving] = useState(false);
 const [llmSaved, setLlmSaved] = useState(false);
 const [llmError, setLlmError] = useState<string | null>(null);

 const loadLlmConfig = useCallback(async () => {
  if (!isSuperadmin) return;
  try {
   const config = await api.admin.getLlmConfig();
   setLlmConfig(config);
   setLlmProvider(config.provider);
   setLlmModel(config.model || '');
   setLlmBaseUrl(config.baseUrl || '');
   setLlmTemperature(config.temperature);
   setLlmMaxTokens(config.maxTokens);
  } catch (err) { console.error('Failed to load LLM config', err); }
 }, [isSuperadmin]);

 useEffect(() => { loadLlmConfig(); }, [loadLlmConfig]);

 const handleSaveLlmConfig = async () => {
  setLlmSaving(true);
  setLlmError(null);
  try {
   await api.admin.saveLlmConfig({
    provider: llmProvider,
    model: llmModel || undefined,
    apiKey: llmApiKey || undefined,
    baseUrl: llmBaseUrl || undefined,
    temperature: llmTemperature,
    maxTokens: llmMaxTokens,
   });
   setLlmSaved(true);
   setLlmApiKey('');
   await loadLlmConfig();
   setTimeout(() => setLlmSaved(false), 3000);
  } catch (err) {
   const message = err instanceof Error ? err.message : 'Failed to save LLM configuration';
   setLlmError(message);
   toast.error('Failed to save LLM configuration', {
    message,
    requestId: err instanceof ApiError ? err.requestId : null,
   });
  }
  setLlmSaving(false);
 };

 const accentOptions: { key: AccentColor; label: string; lightColor: string; darkColor: string }[] = [
 { key: 'indigo', label: 'Indigo', lightColor: '#4f46e5', darkColor: '#818cf8' },
 { key: 'blue', label: 'Blue', lightColor: '#2563eb', darkColor: '#3b82f6' },
 { key: 'violet', label: 'Violet', lightColor: '#7c3aed', darkColor: '#a78bfa' },
 { key: 'emerald', label: 'Emerald', lightColor: '#059669', darkColor: '#10b981' },
 { key: 'rose', label: 'Rose', lightColor: '#e11d48', darkColor: '#f43f5e' },
 ];

 return (
 <div className="space-y-6 animate-fadeIn">
 <HeroHeader
  icon={Settings}
  title="Settings"
  subtitle="Platform configuration & preferences"
  accent="sage"
 />

 {/* Stitch "Settings — Account & Preferences" sticky sub-nav.
     Horizontal chip strip that jumps to a section card via anchor scroll.
     Sticks just below the global header on scroll. */}
 <nav
  aria-label="Settings sections"
  className="sticky z-20 -mx-1 px-1 py-2 flex flex-wrap gap-2 backdrop-blur-md"
  style={{
   top: 'calc(var(--header-height, 48px) + 1px)',
   background: 'color-mix(in srgb, var(--bg-primary) 88%, transparent)',
   borderBottom: '1px solid var(--border-card)',
  }}
 >
  {[
   { id: 'profile',       label: 'Profile' },
   { id: 'notifications', label: 'Notifications' },
   { id: 'appearance',    label: 'Appearance' },
   { id: 'security',      label: 'Two-Factor' },
   { id: 'api',           label: 'API Key' },
   { id: 'privacy',       label: 'Data & Privacy' },
   { id: 'platform',      label: 'Platform' },
  ].map((s) => (
   <a
    key={s.id}
    href={`#${s.id}`}
    className="text-caption font-medium px-3 py-1 rounded-full t-secondary hover:t-primary transition-colors"
    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
   >
    {s.label}
   </a>
  ))}
 </nav>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
 {/* Profile */}
 <Card><span id="profile" className="sr-only">Profile</span>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <User className="w-4 h-4 text-accent" /> Profile
 </h3>
 <div className="space-y-4">
 <div className="flex items-center gap-4">
 <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-2xl font-bold text-white">
 {displayName?.charAt(0) || 'A'}
 </div>
 <div>
 <p className="text-lg font-semibold t-primary">{displayName || 'Admin'}</p>
 <p className="text-sm t-muted">{email}</p>
 <Badge variant="info" size="sm" className="mt-1">{user?.role}</Badge>
 </div>
 </div>
 <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
 <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
 <div className="flex items-center gap-3">
 <Button variant="primary" size="sm" onClick={handleSaveProfile} disabled={saving} title="Save profile changes">
 {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
 {saved ? 'Saved' : 'Save Changes'}
 </Button>
 {saved && <span className="text-xs text-emerald-500">Profile updated</span>}
 {saveError && <span className="text-xs text-red-400">{saveError}</span>}
 </div>

 {/* Password Change */}
 <div className="pt-4 mt-4" style={{ borderTop: '1px solid var(--divider)' }}>
 <h4 className="text-sm font-medium t-secondary mb-3">Change Password</h4>
 <div className="space-y-3">
 <Input label="Current Password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" />
 <Input label="New Password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 8 characters" />
 {pwMsg && (
 <div className={`text-xs p-2 rounded ${pwMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-400'}`}>
 {pwMsg.text}
 </div>
 )}
 <Button variant="secondary" size="sm" onClick={handleChangePassword} disabled={changingPw} title="Update your account password">
 {changingPw ? <Loader2 size={14} className="animate-spin" /> : null}
 Change Password
 </Button>
 </div>
 </div>
 </div>
 </Card>

 {/* Notifications */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Bell className="w-4 h-4 text-accent" /> <span id="notifications">Notifications</span>
 </h3>
 <div className="space-y-3">
 {notifications.map((notif, index) => (
 <div
 key={notif.label}
 className="flex items-center justify-between p-3 rounded-lg "
 style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
 >
 <div>
 <span className="text-sm t-primary">{notif.label}</span>
 <p className="text-caption t-muted">{notif.desc}</p>
 </div>
 <button
 onClick={() => toggleNotification(index)}
 className={`w-10 h-5 rounded-full transition-colors relative`}
 style={{ background: notif.enabled ? 'var(--accent)' : 'var(--toggle-bg)' }}
 aria-label={`Toggle ${notif.label}`}
 title={notif.enabled ? `Disable ${notif.label}` : `Enable ${notif.label}`}
 >
 <div
 className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${notif.enabled ? 'left-5' : 'left-0.5'}`}
 />
 </button>
 </div>
 ))}
 </div>
 </Card>

 {/* Appearance */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Palette className="w-4 h-4 text-accent" /> <span id="appearance">Appearance</span>
 </h3>
 <div className="space-y-4">
 <div>
 <span className="text-sm t-muted">Theme</span>
 <div className="flex gap-3 mt-2">
 <button
 onClick={() => setTheme('dark')}
 className="w-20 h-14 rounded-lg flex flex-col items-center justify-center gap-1 text-xs transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
 title="Switch to dark theme"
 style={{
 background: theme === 'dark' ? 'var(--accent-subtle)' : 'var(--bg-input)',
 border: theme === 'dark' ? '2px solid var(--accent)' : '1px solid var(--border-card)',
 color: theme === 'dark' ? 'var(--accent)' : 'var(--text-muted)'}}
 >
 <Moon size={16} />
 Dark
 </button>
 <button
 onClick={() => setTheme('light')}
 className="w-20 h-14 rounded-lg flex flex-col items-center justify-center gap-1 text-xs transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
 title="Switch to light theme"
 style={{
 background: theme === 'light' ? 'var(--accent-subtle)' : 'var(--bg-input)',
 border: theme === 'light' ? '2px solid var(--accent)' : '1px solid var(--border-card)',
 color: theme === 'light' ? 'var(--accent)' : 'var(--text-muted)'}}
 >
 <Sun size={16} />
 Light
 </button>
 </div>
 </div>
 <div>
 <span className="text-sm t-muted">Accent Colour</span>
 <div className="flex gap-3 mt-2">
 {accentOptions.map(c => {
 const swatchColor = theme === 'dark' ? c.darkColor : c.lightColor;
 return (
 <button
 key={c.key}
 onClick={() => setAccentColor(c.key)}
 title={c.label}
 className="w-8 h-8 rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
 style={{
 background: swatchColor,
 outline: c.key === accentColor ? `2px solid ${swatchColor}` : 'none',
 outlineOffset: '3px',
 transform: c.key === accentColor ? 'scale(1.15)' : 'scale(1)'}}
 />
 );
 })}
 </div>
 <p className="text-caption t-muted mt-2">
 Selected: {accentOptions.find(c => c.key === accentColor)?.label || 'Indigo'}
 </p>
 </div>
 </div>
 </Card>

 {/* Phase 4.4: MFA / Two-Factor Authentication — summary card; full UX at /settings/mfa */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> <span id="security">Two-Factor Authentication</span>
 </h3>
 {mfaEnforcementWarning && !mfaStatus?.enabled && (
   <div
     role="alert"
     className="flex items-start gap-2 p-3 rounded-lg mb-3"
     style={{
       background: mfaEnforcementWarning.daysRemaining <= 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
       border: mfaEnforcementWarning.daysRemaining <= 0 ? '1px solid rgba(239, 68, 68, 0.30)' : '1px solid rgba(245, 158, 11, 0.30)',
     }}
   >
     <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${mfaEnforcementWarning.daysRemaining <= 0 ? 'text-red-500' : 'text-amber-500'}`} />
     <p className={`text-caption ${mfaEnforcementWarning.daysRemaining <= 0 ? 'text-red-500' : 'text-amber-500'}`}>
       {mfaEnforcementWarning.daysRemaining <= 0
         ? 'MFA is required for your role — enable it now to retain access.'
         : `MFA required for your role — enable within ${mfaEnforcementWarning.daysRemaining} day${mfaEnforcementWarning.daysRemaining === 1 ? '' : 's'} to keep access.`}
     </p>
   </div>
 )}
 {mfaStatus?.enabled ? (
   <div className="space-y-3">
     <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
       <Shield className="w-5 h-5 text-emerald-500" />
       <div className="flex-1">
         <p className="text-sm font-medium text-emerald-500">MFA enabled</p>
         <p className="text-xs t-muted">
           {typeof mfaStatus.backupCodesRemaining === 'number'
             ? `${mfaStatus.backupCodesRemaining} of 8 recovery codes remaining`
             : 'Your account is protected with TOTP two-factor authentication'}
         </p>
       </div>
     </div>
     <Link
       to="/settings/mfa"
       className="inline-flex items-center gap-1.5 text-xs font-medium"
       style={{ color: 'var(--accent)' }}
     >
       Manage MFA <ArrowRight size={12} />
     </Link>
   </div>
 ) : (
   <div className="space-y-3">
     <p className="text-xs t-muted">Add an extra layer of security with a TOTP authenticator app plus 8 single-use recovery codes.</p>
     <Link to="/settings/mfa">
       <Button variant="primary" size="sm" title="Open MFA setup">
         <Shield size={14} /> Enable MFA
       </Button>
     </Link>
   </div>
 )}
 </Card>

 {/* Phase 4.4: API Key */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Key className="w-4 h-4 text-accent" /> <span id="api">API Key</span>
 </h3>
 <div className="space-y-3">
   <p className="text-xs t-muted">Use this key to authenticate API requests programmatically.</p>
   {generatedApiKey ? (
     <>
       <div className="flex items-center gap-2">
         <div className="flex-1 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] font-mono text-xs t-primary">
           {apiKeyVisible ? generatedApiKey : '•'.repeat(20)}
         </div>
         <Button variant="secondary" size="sm" onClick={() => setApiKeyVisible(!apiKeyVisible)} title={apiKeyVisible ? 'Hide API key' : 'Reveal API key'}>
           {apiKeyVisible ? 'Hide' : 'Show'}
         </Button>
         <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(generatedApiKey)} title="Copy API key to clipboard">
           <Copy size={14} />
         </Button>
       </div>
       <p className="text-caption text-amber-500">Save this key now. It will not be shown again after you leave this page.</p>
     </>
   ) : apiKeyMeta ? (
     <div className="space-y-2">
       <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
         <span className="font-mono text-xs t-primary">{apiKeyMeta.prefix}••••••••</span>
         <span className="text-caption t-muted ml-auto">Created {new Date(apiKeyMeta.createdAt).toLocaleDateString()}</span>
       </div>
       <Button variant="secondary" size="sm" onClick={handleGenerateApiKey} disabled={apiKeyLoading} title="Generate a new API key (revokes existing)">
         {apiKeyLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Regenerate Key
       </Button>
     </div>
   ) : (
     <Button variant="primary" size="sm" onClick={handleGenerateApiKey} disabled={apiKeyLoading} title="Generate a new API key">
       {apiKeyLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Generate API Key
     </Button>
   )}
   <FormError error={apiKeyError} />
   <p className="text-caption t-muted">Include as <code className="text-accent">X-API-Key</code> header in your requests.</p>
 </div>
 </Card>

 {/* Spec 7 POPIA-3: Data & Privacy */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> <span id="privacy">Data &amp; Privacy (POPIA)</span>
 </h3>
 <div className="space-y-4">
   <div className="p-3 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
     <p className="text-xs font-medium t-primary mb-1">Information Officer</p>
     <p className="text-xs t-muted">{user?.name || 'Not configured'} — {user?.email || 'Contact your administrator'}</p>
     <p className="text-xs t-muted">In terms of POPIA (Protection of Personal Information Act), you have the right to access and delete your personal data.</p>
   </div>
   <div className="flex gap-3">
     <Button variant="secondary" size="sm" title="Request a copy of all your personal data" onClick={async () => {
       try {
         const res = await api.tenants.dataExport();
         const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url; a.download = `atheon-data-export-${new Date().toISOString().slice(0,10)}.json`;
         a.click(); URL.revokeObjectURL(url);
         toast.success('Data export ready', `${res.totalRecords} records across ${res.tableCount} tables downloaded`);
       } catch (err) {
         toast.error('Data export failed', {
           message: err instanceof Error ? err.message : 'Unable to generate export',
           requestId: err instanceof ApiError ? err.requestId : null,
         });
       }
     }}>
       <Download size={14} /> Request My Data
     </Button>
     <Button variant="danger" size="sm" title="Permanently delete all your personal data" onClick={async () => {
       if (!confirm('This will permanently erase your personal data. This action cannot be undone. Continue?')) return;
       if (!confirm('Are you absolutely sure? All your data will be permanently deleted.')) return;
       try {
         await api.tenants.dataErasure();
         toast.success('Your data has been erased', 'Redirecting to login…');
         setTimeout(() => { window.location.href = '/login'; }, 1500);
       } catch (err) {
         toast.error('Data erasure failed', {
           message: err instanceof Error ? err.message : 'Unable to erase data',
           requestId: err instanceof ApiError ? err.requestId : null,
         });
       }
     }}>
       <Trash2 size={14} /> Delete My Data
     </Button>
   </div>
 </div>
 </Card>

 {/* LLM Configuration — Superadmin Only */}
 {isSuperadmin && (
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Brain className="w-4 h-4 text-purple-400" /> AI Engine Configuration
 <Badge variant="warning" size="sm">Superadmin</Badge>
 </h3>
 <p className="text-xs t-muted mb-4">Configure the AI provider powering Atheon Intelligence insights across Pulse, Apex, and Dashboard.</p>
 <div className="space-y-4">
 <div>
 <label className="text-xs font-medium t-secondary mb-1 block">Provider</label>
 <select
  value={llmProvider}
  onChange={(e) => setLlmProvider(e.target.value)}
  className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-secondary)] border border-[var(--border-card)] t-primary"
 >
  <option value="workers_ai">Cloudflare Workers AI (Default)</option>
  <option value="claude">Anthropic Claude</option>
  <option value="openai">OpenAI ChatGPT</option>
  <option value="ollama">Ollama Cloud</option>
  <option value="internal">Internal Hosted</option>
 </select>
 </div>
 <Input label="Model Name" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="e.g. claude-3-sonnet, gpt-4o, llama3.1" />
 <Input label="API Key" type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} placeholder={llmConfig?.apiKeySet ? `Current: ${llmConfig.apiKeyMasked}` : 'Enter API key'} />
 {(llmProvider === 'ollama' || llmProvider === 'internal') && (
  <Input label="Base URL" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} placeholder="https://your-server.com/v1" />
 )}
 <div className="grid grid-cols-2 gap-4">
  <div>
   <label className="text-xs font-medium t-secondary mb-1 block">Temperature ({llmTemperature})</label>
   <input type="range" aria-label="LLM temperature" min="0" max="1" step="0.1" value={llmTemperature} onChange={(e) => setLlmTemperature(parseFloat(e.target.value))} className="w-full" />
  </div>
  <div>
   <label className="text-xs font-medium t-secondary mb-1 block">Max Tokens</label>
   <input type="number" aria-label="LLM max tokens" value={llmMaxTokens} onChange={(e) => setLlmMaxTokens(parseInt(e.target.value) || 1024)} className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-secondary)] border border-[var(--border-card)] t-primary" />
  </div>
 </div>
 <div className="flex items-center gap-3">
  <Button variant="primary" size="sm" onClick={handleSaveLlmConfig} disabled={llmSaving} title="Save AI configuration">
   {llmSaving ? <Loader2 size={14} className="animate-spin" /> : llmSaved ? <Check size={14} /> : null}
   {llmSaved ? 'Saved' : 'Save Configuration'}
  </Button>
  {llmSaved && <span className="text-xs text-emerald-500">Configuration updated</span>}
  {llmError && <span className="text-xs text-red-400">{llmError}</span>}
 </div>
 </div>
 </Card>
 )}

 {/* Platform Info */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Cpu className="w-4 h-4 text-accent" /> <span id="platform">Platform</span>
 </h3>
 <div className="space-y-3">
 {[
 { label: 'Platform', value: 'Atheon\u2122 Enterprise Intelligence' },
 { label: 'Version', value: '1.0.0' },
 { label: 'Deployment', value: 'Cloudflare Pages + Workers' },
 { label: 'Region', value: 'af-south-1 (South Africa)' },
 { label: 'Database', value: 'Cloudflare D1' },
 { label: 'Vector DB', value: 'Cloudflare Vectorize' },
 { label: 'AI Engine', value: 'Atheon Intelligence' },
 ].map(item => (
 <div key={item.label} className="flex items-center justify-between py-2 last:border-0" style={{ borderBottom: '1px solid var(--divider)' }}>
 <span className="text-sm t-muted">{item.label}</span>
 <span className="text-sm t-primary font-medium">{item.value}</span>
 </div>
 ))}
 </div>
 </Card>
 </div>
 </div>
 );
}
