/**
 * ADMIN-004: User Impersonation
 * Support/superadmin can "View as [user]" with a 15-min time-limited session.
 * Route: /impersonate | Role: superadmin, support_admin
 *
 * Backend (verified):
 *   - GET  /api/v1/admin-tooling/impersonate/users?q=…        — cross-tenant user search
 *   - POST /api/v1/admin-tooling/impersonate/start            — starts a time-limited session
 *   - POST /api/v1/admin-tooling/impersonate/end              — ends the session
 *
 * Privilege guards: the backend blocks impersonating equal/higher-role users;
 * we reflect that with a clear error toast and disable the "View As" button
 * for users who would be rejected server-side.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HeroHeader } from '@/components/ui/hero-header';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, setTenantOverride } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/state';
import {
  Eye, Search, Clock, Loader2, AlertTriangle,
  User, LogOut,
} from 'lucide-react';

interface ImpersonatableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenant_id: string;
}

interface ImpersonationSession {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  tenantId: string;
  expiresAt: string;
  startedAt: string;
}

// Must mirror backend ROLE_LEVELS in workers/api/src/lib/roles.ts. If a target
// user's role is >= caller's role, the server will reject the impersonation —
// we disable the button preemptively for UX clarity.
const ROLE_LEVELS: Record<string, number> = {
  superadmin: 100,
  support_admin: 90,
  admin: 80,
  executive: 70,
  manager: 60,
  analyst: 50,
  operator: 40,
  viewer: 30,
};

const SESSION_STORAGE_KEY = 'atheon_impersonation_session';

function loadSessionFromStorage(): ImpersonationSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationSession;
    // Discard if expired
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ImpersonationPage() {
  const currentUser = useAppStore((s) => s.user);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<ImpersonatableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<ImpersonatableUser[]>([]);
  const [activeSession, setActiveSession] = useState<ImpersonationSession | null>(loadSessionFromStorage());
  const [confirmUser, setConfirmUser] = useState<ImpersonatableUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callerLevel = ROLE_LEVELS[currentUser?.role || ''] ?? 0;

  const loadUsers = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminTooling.impersonateSearch(q);
      const list = (res.users || []) as unknown as ImpersonatableUser[];
      setUsers(list);
      setFilteredUsers(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load users';
      setError(message);
      toast.error('Failed to load users', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Client-side filter on already-loaded list (avoids a round-trip per keystroke)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(users);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredUsers(users.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q)
      ));
    }
  }, [searchQuery, users]);

  const startImpersonation = async (target: ImpersonatableUser) => {
    setImpersonating(true);
    try {
      const res = await api.adminTooling.impersonateStart(target.id);
      const imp = (res as { impersonation?: Record<string, unknown> }).impersonation;
      if (!imp) {
        throw new Error('Impersonation response missing session data');
      }
      const session: ImpersonationSession = {
        userId: String(imp.userId),
        userName: String(imp.name),
        userEmail: String(imp.email),
        userRole: String(imp.role),
        tenantId: String(imp.tenantId),
        expiresAt: String(imp.expiresAt),
        startedAt: new Date().toISOString(),
      };
      setActiveSession(session);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      // Scope subsequent API calls to the impersonated tenant so the admin sees
      // that tenant's data, not their own.
      setTenantOverride(session.tenantId);
      setConfirmUser(null);
      toast.success('Impersonation started', {
        message: `Viewing as ${session.userName} (${session.userRole}). Session expires at ${new Date(session.expiresAt).toLocaleTimeString()}.`,
      });
    } catch (err) {
      toast.error('Impersonation failed', {
        message: err instanceof Error ? err.message : 'Could not start impersonation',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setImpersonating(false);
    }
  };

  const endImpersonation = async () => {
    setEnding(true);
    try {
      await api.adminTooling.impersonateEnd();
    } catch (err) {
      // Best-effort: even if the end call fails, we clear client state so the
      // admin isn't stuck with a dead override. Surface the error as a warning.
      toast.warning('Impersonation end may not have been logged', {
        message: err instanceof Error ? err.message : 'Session cleared locally',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActiveSession(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setTenantOverride(null);
      setEnding(false);
    }
  };

  const roleColor = (r: string): 'danger' | 'warning' | 'info' | 'default' => {
    if (r === 'superadmin') return 'danger';
    if (r === 'support_admin') return 'warning';
    if (r === 'admin') return 'info';
    return 'default';
  };

  const canImpersonate = (u: ImpersonatableUser): boolean => {
    const targetLevel = ROLE_LEVELS[u.role] ?? 0;
    return targetLevel < callerLevel && u.id !== currentUser?.id;
  };

  if (loading) return <LoadingState variant="cards" count={4} />;
  if (error && users.length === 0) {
    return (
      <ErrorState
        title="Couldn't load users"
        error={error}
        onRetry={() => loadUsers()}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Active Impersonation Banner */}
      {activeSession && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye size={18} className="text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-400">
                Viewing as {activeSession.userName} ({activeSession.userRole})
              </p>
              <p className="text-caption t-muted">
                {activeSession.userEmail} · Expires {new Date(activeSession.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={endImpersonation} disabled={ending} className="text-amber-400 border-amber-500/30">
            {ending ? <Loader2 size={12} className="animate-spin mr-1" /> : <LogOut size={12} className="mr-1" />}
            End Session
          </Button>
        </div>
      )}

      <HeroHeader
        icon={Eye}
        title="User Impersonation"
        subtitle="View the platform as any user for debugging & support"
        accent="amber"
      />

      {/* Warning */}
      <Card className="p-4 border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium t-primary">Impersonation sessions are time-limited and fully audited</p>
            <p className="t-muted mt-0.5">Sessions expire after 15 minutes. All actions taken while impersonating are logged in the audit trail with your identity as the actor. You cannot impersonate users with equal or higher privilege than your own.</p>
          </div>
        </div>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
        <input
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
          placeholder="Search users by name, email, or role..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Users List */}
      {filteredUsers.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm t-muted">No users found.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map((u) => {
            const allowed = canImpersonate(u);
            return (
              <Card key={u.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                      <User size={14} className="text-accent" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium t-primary">{u.name}</p>
                        <Badge variant={roleColor(u.role)} className="text-caption">{u.role}</Badge>
                      </div>
                      <p className="text-caption t-muted">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmUser(u)}
                      disabled={!allowed || activeSession !== null}
                      className="text-xs"
                      title={
                        !allowed
                          ? u.id === currentUser?.id
                            ? 'You cannot impersonate yourself'
                            : 'Cannot impersonate a user with equal or higher privilege'
                          : activeSession
                            ? 'End the current session first'
                            : undefined
                      }
                    >
                      <Eye size={12} className="mr-1" /> View As
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmUser(null)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Eye size={18} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold t-primary">Confirm Impersonation</h3>
                <p className="text-xs t-muted">This action will be logged</p>
              </div>
            </div>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between"><span className="t-muted">User:</span><span className="t-primary">{confirmUser.name}</span></div>
              <div className="flex justify-between"><span className="t-muted">Email:</span><span className="t-primary">{confirmUser.email}</span></div>
              <div className="flex justify-between"><span className="t-muted">Role:</span><Badge variant={roleColor(confirmUser.role)}>{confirmUser.role}</Badge></div>
              <div className="flex justify-between"><span className="t-muted">Duration:</span><span className="t-primary flex items-center gap-1"><Clock size={12} /> 15 minutes</span></div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmUser(null)} className="flex-1">Cancel</Button>
              <Button onClick={() => startImpersonation(confirmUser)} disabled={impersonating} className="flex-1 bg-amber-500 hover:bg-amber-600 text-black">
                {impersonating ? <Loader2 size={14} className="animate-spin mr-1" /> : <Eye size={14} className="mr-1" />}
                Start Session
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
