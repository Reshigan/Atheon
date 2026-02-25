import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ClusterItem, ActionItem, GovernanceData } from "@/lib/api";
import {
  Zap, Bot, Shield, CheckCircle, Clock, XCircle, Eye, Wrench, Send,
  ChevronDown, ChevronUp, Loader2, Upload, Calendar, AlertTriangle,
  Play, X, FileText, Plus
} from "lucide-react";
import type { AutonomyTier } from "@/types";
import { useAppStore } from "@/stores/appStore";

const tierConfig: Record<AutonomyTier, { label: string; icon: typeof Eye; color: string }> = {
  'read-only': { label: 'Read-Only', icon: Eye, color: 'text-amber-400' },
  'assisted': { label: 'Assisted', icon: Wrench, color: 'text-amber-400' },
  'transactional': { label: 'Transactional', icon: Send, color: 'text-emerald-400' },
};

const statusIcon = (status: string) => {
  if (status === 'completed') return <CheckCircle size={14} className="text-emerald-400" />;
  if (status === 'pending') return <Clock size={14} className="text-amber-400" />;
  if (status === 'approved') return <CheckCircle size={14} className="text-amber-400" />;
  if (status === 'exception') return <AlertTriangle size={14} className="text-red-400" />;
  if (status === 'rejected' || status === 'failed') return <XCircle size={14} className="text-red-400" />;
  return <Zap size={14} className="text-amber-400" />;
};

const statusBadgeVariant = (status: string): 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'completed') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'exception') return 'danger';
  if (status === 'rejected' || status === 'failed') return 'danger';
  return 'info';
};

export function CatalystsPage() {
  const user = useAppStore((s) => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'executive';
  const { activeTab, setActiveTab } = useTabState('clusters');
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [governance, setGovernance] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingAction, setUpdatingAction] = useState<string | null>(null);

  // Manual Execution state
  const [showManualExec, setShowManualExec] = useState(false);
  const [manualForm, setManualForm] = useState({
    cluster_id: '', catalyst_name: '', action: '',
    start_datetime: '', end_datetime: '', reasoning: '',
  });
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execSuccess, setExecSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deploy Catalyst state
  const [showDeployCatalyst, setShowDeployCatalyst] = useState(false);
  const [deployForm, setDeployForm] = useState({ name: '', domain: 'finance', autonomy_tier: 'assisted', description: '' });
  const [deploying, setDeploying] = useState(false);

  const handleApprove = async (actionId: string) => {
    if (updatingAction) return;
    setUpdatingAction(actionId);
    try {
      await api.catalysts.approveAction(actionId);
      const a = await api.catalysts.actions();
      setActions(a.actions);
    } catch { /* silent */ }
    setUpdatingAction(null);
  };

  const handleReject = async (actionId: string) => {
    if (updatingAction) return;
    setUpdatingAction(actionId);
    try {
      await api.catalysts.rejectAction(actionId);
      const a = await api.catalysts.actions();
      setActions(a.actions);
    } catch { /* silent */ }
    setUpdatingAction(null);
  };

  const handleManualExecute = async () => {
    if (!manualForm.cluster_id || !manualForm.catalyst_name || !manualForm.action || !manualForm.start_datetime || !manualForm.end_datetime) {
      setExecError('All fields are required');
      return;
    }
    setExecuting(true);
    setExecError(null);
    setExecSuccess(null);
    try {
      const formData = new FormData();
      formData.append('cluster_id', manualForm.cluster_id);
      formData.append('catalyst_name', manualForm.catalyst_name);
      formData.append('action', manualForm.action);
      formData.append('start_datetime', manualForm.start_datetime);
      formData.append('end_datetime', manualForm.end_datetime);
      if (manualForm.reasoning) formData.append('reasoning', manualForm.reasoning);
      if (manualFile) formData.append('file', manualFile);

      const result = await api.catalysts.manualExecute(formData);
      setExecSuccess(result.message);
      const a = await api.catalysts.actions();
      setActions(a.actions);
      setTimeout(() => {
        setShowManualExec(false);
        setManualForm({ cluster_id: '', catalyst_name: '', action: '', start_datetime: '', end_datetime: '', reasoning: '' });
        setManualFile(null);
        setExecSuccess(null);
      }, 2000);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    }
    setExecuting(false);
  };

  const handleDeployCatalyst = async () => {
    if (!deployForm.name.trim() || deploying) return;
    setDeploying(true);
    try {
      await api.catalysts.createCluster({
        name: deployForm.name.trim(),
        domain: deployForm.domain,
        autonomy_tier: deployForm.autonomy_tier,
        description: deployForm.description || `${deployForm.name} catalyst cluster`,
      });
      const c = await api.catalysts.clusters();
      setClusters(c.clusters);
      setShowDeployCatalyst(false);
      setDeployForm({ name: '', domain: 'finance', autonomy_tier: 'assisted', description: '' });
    } catch { /* silent */ }
    setDeploying(false);
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [c, a, g] = await Promise.allSettled([
        api.catalysts.clusters(), api.catalysts.actions(), api.catalysts.governance(),
      ]);
      if (c.status === 'fulfilled') setClusters(c.value.clusters);
      if (a.status === 'fulfilled') setActions(a.value.actions);
      if (g.status === 'fulfilled') setGovernance(g.value);
      setLoading(false);
    }
    load();
  }, []);

  const exceptionCount = actions.filter(a => a.status === 'exception').length;

  const tabs = [
    { id: 'clusters', label: 'Catalyst Clusters', icon: <Bot size={14} /> },
    { id: 'actions', label: 'Action Log', icon: <Zap size={14} />, count: actions.length },
    { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle size={14} />, count: exceptionCount },
    ...(isAdmin ? [{ id: 'governance', label: 'Governance', icon: <Shield size={14} /> }] : []),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  const renderActionCard = (action: ActionItem, showExceptionHighlight = false) => {
    const isException = action.status === 'exception';
    const outputData = action.outputData as Record<string, string> | undefined;
    const inputData = action.inputData as Record<string, unknown> | undefined;
    const isManual = inputData?.manual === true;

    return (
      <Card
        key={action.id}
        hover
        onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
        className={isException && showExceptionHighlight ? 'ring-1 ring-red-500/40 bg-red-500/[0.03]' : ''}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {statusIcon(action.status)}
            <div>
              <h3 className="text-sm font-semibold t-primary">{action.action}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs t-secondary">{action.catalystName}</p>
                {isManual && <Badge variant="outline" size="sm">Manual</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant(action.status)}>
              {action.status}
            </Badge>
            <span className="text-xs t-secondary">{Math.round(action.confidence * 100)}%</span>
            {expandedAction === action.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
          </div>
        </div>
        <p className="text-xs t-muted mt-1 line-clamp-2">{action.reasoning || ''}</p>

        {expandedAction === action.id && (
          <div className="mt-4 space-y-3 animate-fadeIn">
            <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
              <h4 className="text-xs font-semibold text-gray-400 mb-1">Reasoning Chain</h4>
              <p className="text-xs t-muted">{action.reasoning || 'No reasoning provided'}</p>
            </div>

            {isException && outputData && (
              <div className="p-3 rounded-lg bg-red-500/[0.08] border border-red-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={14} className="text-red-400" />
                  <h4 className="text-xs font-semibold text-red-400">Exception Details</h4>
                </div>
                {outputData.exception_type && (
                  <Badge variant="danger" size="sm" className="mb-2">{outputData.exception_type.replace(/_/g, ' ')}</Badge>
                )}
                <p className="text-xs text-red-300/80 mt-1">{outputData.exception_detail || ''}</p>
                {outputData.suggested_action && (
                  <div className="mt-2 p-2 rounded bg-amber-500/[0.06] border border-amber-500/20">
                    <p className="text-xs text-amber-300"><strong>Suggested Action:</strong> {outputData.suggested_action}</p>
                  </div>
                )}
              </div>
            )}

            {inputData && Object.keys(inputData).length > 0 && (
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                <h4 className="text-xs font-semibold text-gray-400 mb-2">Input Data</h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(inputData).filter(([k]) => k !== 'manual' && k !== 'file_preview').map(([key, val]) => (
                    <div key={key}>
                      <span className="text-[10px] text-gray-500">{key.replace(/_/g, ' ')}</span>
                      <p className="text-xs text-gray-300">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {action.status === 'completed' && outputData && !isException && (
              <div className="p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20">
                <h4 className="text-xs font-semibold text-emerald-400 mb-1">Result</h4>
                <p className="text-xs text-emerald-300/80">{outputData.detail || JSON.stringify(outputData)}</p>
              </div>
            )}

            {isAdmin && (action.status === 'pending' || action.status === 'exception') && (
              <div className="flex gap-2">
                <Button variant="success" size="sm" onClick={(e) => { e.stopPropagation(); handleApprove(action.id); }} disabled={updatingAction === action.id}>
                  {updatingAction === action.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve
                </Button>
                <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); handleReject(action.id); }} disabled={updatingAction === action.id}>
                  <XCircle size={12} /> Reject
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-primary">Atheon Catalysts</h1>
            <p className="text-sm t-muted">Autonomous Execution - Intelligent Workers</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowManualExec(true)}>
              <Upload size={14} /> Manual Execute
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowDeployCatalyst(true)}>
              <Plus size={14} /> Deploy Catalyst
            </Button>
          </div>
        )}
      </div>

      {exceptionCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-500/[0.08] border border-red-500/20 rounded-xl">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-300">{exceptionCount} exception{exceptionCount > 1 ? 's' : ''} require{exceptionCount === 1 ? 's' : ''} attention</p>
            <p className="text-xs text-red-400/70">Review and resolve catalyst exceptions before running new jobs</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setActiveTab('exceptions')}>View Exceptions</Button>
        </div>
      )}

      {showManualExec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div style={{ background: "rgba(18,18,42,0.95)", border: "1px solid rgba(255,255,255,0.1)" }} className="rounded-2xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Play size={18} className="text-amber-400" /> Manual Catalyst Execution</h3>
              <button onClick={() => { setShowManualExec(false); setExecError(null); setExecSuccess(null); }} className="text-gray-400 hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs t-muted">Catalyst Cluster</label>
                <select className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={manualForm.cluster_id} onChange={e => setManualForm(p => ({ ...p, cluster_id: e.target.value }))}>
                  <option value="">Select a cluster...</option>
                  {clusters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs t-muted">Catalyst Name</label>
                <input className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={manualForm.catalyst_name} onChange={e => setManualForm(p => ({ ...p, catalyst_name: e.target.value }))} placeholder="e.g. Invoice Reconciliation" />
              </div>
              <div>
                <label className="text-xs t-muted">Action</label>
                <input className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={manualForm.action} onChange={e => setManualForm(p => ({ ...p, action: e.target.value }))} placeholder="e.g. Reconcile Feb 2026 invoices" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs t-muted flex items-center gap-1"><Calendar size={10} /> Start Date/Time</label>
                  <input type="datetime-local" className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={manualForm.start_datetime} onChange={e => setManualForm(p => ({ ...p, start_datetime: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs t-muted flex items-center gap-1"><Calendar size={10} /> End Date/Time</label>
                  <input type="datetime-local" className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={manualForm.end_datetime} onChange={e => setManualForm(p => ({ ...p, end_datetime: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs t-muted">Upload File (optional)</label>
                <div className="mt-1 p-4 border-2 border-dashed border-white/[0.1] rounded-lg text-center cursor-pointer hover:border-amber-500/30 transition-colors" onClick={() => fileInputRef.current?.click()}>
                  {manualFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText size={16} className="text-amber-400" />
                      <span className="text-sm text-gray-300">{manualFile.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); setManualFile(null); }} className="text-gray-500 hover:text-red-400"><X size={14} /></button>
                    </div>
                  ) : (
                    <div><Upload size={20} className="mx-auto text-gray-500 mb-1" /><p className="text-xs t-muted">Click to upload CSV, Excel, or PDF file</p></div>
                  )}
                  <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls,.pdf,.json,.txt" onChange={e => setManualFile(e.target.files?.[0] || null)} />
                </div>
              </div>
              <div>
                <label className="text-xs t-muted">Reasoning (optional)</label>
                <textarea className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200 resize-none" rows={2} value={manualForm.reasoning} onChange={e => setManualForm(p => ({ ...p, reasoning: e.target.value }))} placeholder="Why is this being run manually?" />
              </div>
            </div>
            {execError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {execError}</div>
            )}
            {execSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2"><CheckCircle size={14} /> {execSuccess}</div>
            )}
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => { setShowManualExec(false); setExecError(null); setExecSuccess(null); }}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleManualExecute} disabled={executing || !manualForm.cluster_id || !manualForm.catalyst_name || !manualForm.action || !manualForm.start_datetime || !manualForm.end_datetime}>
                {executing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Execute
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeployCatalyst && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div style={{ background: "rgba(18,18,42,0.95)", border: "1px solid rgba(255,255,255,0.1)" }} className="rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary">Deploy New Catalyst</h3>
              <button onClick={() => setShowDeployCatalyst(false)} className="text-gray-400 hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs t-muted">Cluster Name</label><input className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={deployForm.name} onChange={e => setDeployForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Finance Catalyst" /></div>
              <div><label className="text-xs t-muted">Domain</label><select className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={deployForm.domain} onChange={e => setDeployForm(p => ({ ...p, domain: e.target.value }))}><option value="finance">Finance</option><option value="procurement">Procurement</option><option value="supply-chain">Supply Chain</option><option value="hr">HR</option><option value="sales">Sales</option><option value="operations">Operations</option><option value="compliance">Compliance</option></select></div>
              <div><label className="text-xs t-muted">Autonomy Tier</label><select className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200" value={deployForm.autonomy_tier} onChange={e => setDeployForm(p => ({ ...p, autonomy_tier: e.target.value }))}><option value="read-only">Read-Only</option><option value="assisted">Assisted</option><option value="transactional">Transactional</option></select></div>
              <div><label className="text-xs t-muted">Description (optional)</label><textarea className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-200 resize-none" rows={2} value={deployForm.description} onChange={e => setDeployForm(p => ({ ...p, description: e.target.value }))} placeholder="What does this catalyst do?" /></div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setShowDeployCatalyst(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleDeployCatalyst} disabled={deploying || !deployForm.name.trim()}>
                {deploying ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Deploy
              </Button>
            </div>
          </div>
        </div>
      )}

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'clusters' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clusters.map((cluster) => {
              const tier = tierConfig[cluster.autonomyTier as AutonomyTier] || tierConfig['read-only'];
              const TierIcon = tier.icon;
              return (
                <Card key={cluster.id} hover>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold t-primary">{cluster.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <TierIcon size={12} className={tier.color} />
                          <span className={`text-xs ${tier.color}`}>{tier.label}</span>
                          {cluster.domain && (
                            <Badge variant="outline" size="sm">{cluster.domain}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Badge variant={cluster.status === 'active' ? 'success' : cluster.status === 'paused' ? 'warning' : 'danger'}>
                      {cluster.status}
                    </Badge>
                  </div>

                  <p className="text-xs t-secondary mt-3">{cluster.description}</p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Trust Score</span>
                      <p className="text-sm font-bold t-primary">{cluster.trustScore}%</p>
                    </div>
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Agents</span>
                      <p className="text-sm font-bold t-primary">{cluster.agentCount}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Completed</span>
                      <p className="text-sm font-bold t-primary">{(cluster.tasksCompleted / 1000).toFixed(1)}K</p>
                    </div>
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Success Rate</span>
                      <p className="text-sm font-bold text-emerald-400">{cluster.successRate}%</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span>Trust Score</span>
                      <span>{cluster.trustScore}%</span>
                    </div>
                    <Progress value={cluster.trustScore} color={cluster.trustScore >= 90 ? 'emerald' : cluster.trustScore >= 80 ? 'blue' : 'amber'} size="sm" />
                  </div>
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}

      {activeTab === 'actions' && (
        <TabPanel>
          <div className="space-y-3">
            {actions.map((action) => renderActionCard(action, false))}
            {actions.length === 0 && (
              <div className="text-center py-12 text-gray-500"><Zap size={32} className="mx-auto mb-2 opacity-50" /><p className="text-sm">No catalyst actions yet</p></div>
            )}
          </div>
        </TabPanel>
      )}

      {activeTab === 'exceptions' && (
        <TabPanel>
          <div className="space-y-3">
            {actions.filter(a => a.status === 'exception').map((action) => renderActionCard(action, true))}
            {exceptionCount === 0 && (
              <div className="text-center py-12 text-gray-500"><CheckCircle size={32} className="mx-auto mb-2 text-emerald-500 opacity-50" /><p className="text-sm">No exceptions — all clear</p></div>
            )}
          </div>
        </TabPanel>
      )}

      {activeTab === 'governance' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-amber-400" /> Autonomy Tiers
              </h3>
              <div className="space-y-3">
                {Object.entries(tierConfig).map(([key, config]) => {
                  const Icon = config.icon;
                  const count = clusters.filter(c => c.autonomyTier === key).length;
                  return (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className={config.color} />
                        <span className="text-sm t-secondary">{config.label}</span>
                      </div>
                      <Badge variant="outline">{count} clusters</Badge>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" /> Trust Scores
              </h3>
              <div className="space-y-3">
                {clusters.slice(0, 5).map((cluster) => (
                  <div key={cluster.id} className="flex items-center justify-between">
                    <span className="text-sm t-secondary truncate">{cluster.name}</span>
                    <div className="flex items-center gap-2">
                      <Progress value={cluster.trustScore} color={cluster.trustScore >= 90 ? 'emerald' : 'amber'} size="sm" className="w-20" />
                      <span className="text-sm font-medium t-primary w-10 text-right">{cluster.trustScore}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" /> Governance Metrics
              </h3>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                  <span className="text-xs t-secondary">Total Actions</span>
                  <p className="text-lg font-bold text-amber-400">{governance?.totalActions ?? 0}</p>
                  <p className="text-[10px] text-gray-400">All catalyst executions</p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                  <span className="text-xs t-secondary">Pending Approvals</span>
                  <p className="text-lg font-bold text-amber-400">{governance?.pendingApprovals ?? 0}</p>
                  <p className="text-[10px] text-gray-400">Awaiting human review</p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                  <span className="text-xs t-secondary">Approved / Rejected</span>
                  <p className="text-lg font-bold t-primary">
                    <span className="text-emerald-400">{governance?.approved ?? 0}</span>
                    {' / '}
                    <span className="text-red-500">{governance?.rejected ?? 0}</span>
                  </p>
                  <p className="text-[10px] text-gray-400">Human override decisions</p>
                </div>
              </div>
            </Card>
          </div>
        </TabPanel>
      )}
    </div>
  );
}
