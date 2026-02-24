import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ClusterItem, ActionItem, GovernanceData } from "@/lib/api";
import { Zap, Bot, Shield, CheckCircle, Clock, XCircle, Eye, Wrench, Send, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { AutonomyTier } from "@/types";

const tierConfig: Record<AutonomyTier, { label: string; icon: typeof Eye; color: string }> = {
  'read-only': { label: 'Read-Only', icon: Eye, color: 'text-amber-400' },
  'assisted': { label: 'Assisted', icon: Wrench, color: 'text-amber-400' },
  'transactional': { label: 'Transactional', icon: Send, color: 'text-emerald-400' },
};

const statusIcon = (status: string) => {
  if (status === 'completed') return <CheckCircle size={14} className="text-emerald-400" />;
  if (status === 'pending') return <Clock size={14} className="text-amber-400" />;
  if (status === 'approved') return <CheckCircle size={14} className="text-amber-400" />;
  if (status === 'rejected' || status === 'failed') return <XCircle size={14} className="text-red-400" />;
  return <Zap size={14} className="text-amber-400" />;
};

export function CatalystsPage() {
  const { activeTab, setActiveTab } = useTabState('clusters');
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [governance, setGovernance] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingAction, setUpdatingAction] = useState<string | null>(null);

  const handleApprove = async (actionId: string) => {
    if (updatingAction) return;
    setUpdatingAction(actionId);
    try {
      await api.catalysts.approveAction(actionId);
      const a = await api.catalysts.actions();
      setActions(a.actions);
    } catch {
      /* silent */
    }
    setUpdatingAction(null);
  };

  const handleReject = async (actionId: string) => {
    if (updatingAction) return;
    setUpdatingAction(actionId);
    try {
      await api.catalysts.rejectAction(actionId);
      const a = await api.catalysts.actions();
      setActions(a.actions);
    } catch {
      /* silent */
    }
    setUpdatingAction(null);
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

  const tabs = [
    { id: 'clusters', label: 'Catalyst Clusters', icon: <Bot size={14} /> },
    { id: 'actions', label: 'Action Log', icon: <Zap size={14} />, count: actions.length },
    { id: 'governance', label: 'Governance', icon: <Shield size={14} /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Zap className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Atheon Catalysts</h1>
          <p className="text-sm text-gray-500">Autonomous Execution - Intelligent Workers</p>
        </div>
      </div>

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
                        <h3 className="text-base font-semibold text-white">{cluster.name}</h3>
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

                  <p className="text-xs text-gray-400 mt-3">{cluster.description}</p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Trust Score</span>
                      <p className="text-sm font-bold text-white">{cluster.trustScore}%</p>
                    </div>
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Agents</span>
                      <p className="text-sm font-bold text-white">{cluster.agentCount}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <span className="text-[10px] text-gray-400">Completed</span>
                      <p className="text-sm font-bold text-white">{(cluster.tasksCompleted / 1000).toFixed(1)}K</p>
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
            {actions.map((action) => (
              <Card key={action.id} hover onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {statusIcon(action.status)}
                    <div>
                      <h3 className="text-sm font-semibold text-white">{action.action}</h3>
                      <p className="text-xs text-gray-400">{action.catalystName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={action.status === 'completed' ? 'success' : action.status === 'pending' ? 'warning' : 'info'}>
                      {action.status}
                    </Badge>
                    <span className="text-xs text-gray-400">{Math.round(action.confidence * 100)}%</span>
                    {expandedAction === action.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">{action.reasoning || ''}</p>

                {expandedAction === action.id && (
                  <div className="mt-4 space-y-3 animate-fadeIn">
                    <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                      <h4 className="text-xs font-semibold text-gray-400 mb-1">Reasoning Chain</h4>
                      <p className="text-xs text-gray-500">{action.reasoning || 'No reasoning provided'}</p>
                    </div>
                    {action.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleApprove(action.id); }}
                          disabled={updatingAction === action.id}
                        >
                          <CheckCircle size={12} /> Approve
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleReject(action.id); }}
                          disabled={updatingAction === action.id}
                        >
                          <XCircle size={12} /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
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
                        <span className="text-sm text-gray-400">{config.label}</span>
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
                    <span className="text-sm text-gray-400 truncate">{cluster.name}</span>
                    <div className="flex items-center gap-2">
                      <Progress value={cluster.trustScore} color={cluster.trustScore >= 90 ? 'emerald' : 'amber'} size="sm" className="w-20" />
                      <span className="text-sm font-medium text-white w-10 text-right">{cluster.trustScore}%</span>
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
                  <span className="text-xs text-gray-400">Total Actions</span>
                  <p className="text-lg font-bold text-amber-400">{governance?.totalActions ?? 0}</p>
                  <p className="text-[10px] text-gray-400">All catalyst executions</p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                  <span className="text-xs text-gray-400">Pending Approvals</span>
                  <p className="text-lg font-bold text-amber-400">{governance?.pendingApprovals ?? 0}</p>
                  <p className="text-[10px] text-gray-400">Awaiting human review</p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                  <span className="text-xs text-gray-400">Approved / Rejected</span>
                  <p className="text-lg font-bold text-white">
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
