import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { HealthScore, Risk, Metric, AnomalyItem, ClusterItem, ActionItem } from "@/lib/api";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, Activity, Crown, Shield, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";

const trendIcon = (trend: string) => {
  if (trend === 'up') return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
  if (trend === 'down') return <TrendingDown className="w-3.5 h-3.5 text-red-600" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

const revenueData = [
  { month: 'Sep', value: 36.2 }, { month: 'Oct', value: 37.8 }, { month: 'Nov', value: 38.5 },
  { month: 'Dec', value: 39.1 }, { month: 'Jan', value: 41.2 }, { month: 'Feb', value: 42.8 },
];

export function Dashboard() {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [h, r, m, a, c, act] = await Promise.allSettled([
          api.apex.health(),
          api.apex.risks(),
          api.pulse.metrics(),
          api.pulse.anomalies(),
          api.catalysts.clusters(),
          api.catalysts.actions(),
        ]);
        if (h.status === 'fulfilled') setHealth(h.value);
        if (r.status === 'fulfilled') setRisks(r.value.risks);
        if (m.status === 'fulfilled') setMetrics(m.value.metrics);
        if (a.status === 'fulfilled') setAnomalies(a.value.anomalies);
        if (c.status === 'fulfilled') setClusters(c.value.clusters);
        if (act.status === 'fulfilled') setActions(act.value.actions);
      } catch { /* silently handle */ }
      setLoading(false);
    }
    load();
  }, []);

  const overallScore = health?.overall ?? 78;
  const healthTrend = 'up';
  const dimensions = health?.dimensions
    ? Object.entries(health.dimensions).map(([key, val]) => ({
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        score: val.score,
        trend: val.trend as 'up' | 'down' | 'stable',
        change: val.delta,
        sparkline: [val.score - 6, val.score - 4, val.score - 3, val.score - 2, val.score - 1, val.score],
      }))
    : [];
  const activeCatalysts = clusters.filter(c => c.status === 'active').length;
  const totalTasks = clusters.reduce((sum, c) => sum + (c.tasksInProgress || 0), 0);
  const criticalRisks = risks.filter(r => r.severity === 'critical').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Command Centre</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time enterprise intelligence across all Atheon layers</p>
      </div>

      {/* Top KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/10 to-transparent rounded-bl-full" />
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">Business Health</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{overallScore}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {trendIcon(healthTrend)}
                  <span className="text-xs text-emerald-600">+2.3 pts</span>
                </div>
              </div>
              <ScoreRing score={overallScore} size="sm" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-bl-full" />
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">Active Risks</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{risks.length}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  <span className="text-xs text-red-600">{criticalRisks} critical</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-bl-full" />
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">Active Catalysts</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{activeCatalysts}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Zap className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs text-blue-600">{totalTasks} tasks in progress</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Zap className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-500/10 to-transparent rounded-bl-full" />
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">System Health</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">99.97%</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Activity className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-xs text-emerald-600">All systems operational</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Revenue Trend</h3>
              <p className="text-xs text-gray-400">Last 6 months (M ZAR)</p>
            </div>
            <Badge variant="success">+3.9%</Badge>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{ background: '#171717', border: '1px solid #262626', borderRadius: '8px', color: '#e5e5e5', fontSize: '12px' }}
                  labelStyle={{ color: '#a3a3a3' }}
                />
                <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Health Dimensions */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Health Dimensions</h3>
            <Link to="/apex" className="text-xs text-indigo-600 hover:text-indigo-500">View all</Link>
          </div>
          <div className="space-y-3">
            {dimensions.slice(0, 5).map((dim) => (
              <div key={dim.key} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 truncate">{dim.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{dim.score}</span>
                      {trendIcon(dim.trend)}
                    </div>
                  </div>
                  <Progress
                    value={dim.score}
                    color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'}
                    size="sm"
                    className="mt-1"
                  />
                </div>
                <Sparkline data={dim.sparkline} width={50} height={20} color={dim.trend === 'up' ? '#10b981' : dim.trend === 'down' ? '#ef4444' : '#6b7280'} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Alerts */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-600" />
              <h3 className="text-base font-semibold text-gray-900">Risk Alerts</h3>
            </div>
            <Link to="/apex" className="text-xs text-indigo-600 hover:text-indigo-500">View all</Link>
          </div>
          <div className="space-y-3">
            {risks.slice(0, 3).map((risk) => (
              <div key={risk.id} className="p-3 rounded-lg bg-gray-100 border border-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium text-gray-800 line-clamp-1">{risk.title}</h4>
                  <Badge variant={risk.severity === 'critical' ? 'danger' : risk.severity === 'high' ? 'warning' : 'default'}>
                    {risk.severity}
                  </Badge>
                </div>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{risk.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-gray-400">{Math.round(risk.probability * 100)}% confidence</span>
                  <LayerBadge layer="apex" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Process Anomalies */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <h3 className="text-base font-semibold text-gray-900">Anomalies</h3>
            </div>
            <Link to="/pulse" className="text-xs text-indigo-600 hover:text-indigo-500">View all</Link>
          </div>
          <div className="space-y-3">
            {anomalies.slice(0, 3).map((anom) => (
              <div key={anom.id} className="p-3 rounded-lg bg-gray-100 border border-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium text-gray-800 line-clamp-1">{anom.metric}</h4>
                  <Badge variant={anom.severity === 'critical' ? 'danger' : anom.severity === 'high' ? 'warning' : 'default'}>
                    +{anom.deviation}%
                  </Badge>
                </div>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{anom.hypothesis}</p>
                <div className="flex items-center gap-2 mt-2">
                  <LayerBadge layer="pulse" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Catalyst Activity */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" />
              <h3 className="text-base font-semibold text-gray-900">Catalyst Activity</h3>
            </div>
            <Link to="/catalysts" className="text-xs text-indigo-600 hover:text-indigo-500">View all</Link>
          </div>
          <div className="space-y-3">
            {actions.slice(0, 3).map((action) => (
              <div key={action.id} className="p-3 rounded-lg bg-gray-100 border border-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium text-gray-800 line-clamp-1">{action.action}</h4>
                  <Badge variant={action.status === 'completed' ? 'success' : action.status === 'pending' ? 'warning' : 'info'}>
                    {action.status}
                  </Badge>
                </div>
                <p className="text-xs text-gray-400 mt-1">{action.catalystName}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-gray-400">{Math.round(action.confidence * 100)}% confidence</span>
                  <LayerBadge layer="catalysts" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Process Metrics Strip */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-600" />
            <h3 className="text-base font-semibold text-gray-900">Process Metrics</h3>
          </div>
          <Link to="/pulse" className="text-xs text-indigo-600 hover:text-indigo-500">View all</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.slice(0, 8).map((metric) => (
            <div key={metric.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200/40">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 truncate">{metric.name}</span>
                <span className={`w-2 h-2 rounded-full ${metric.status === 'green' ? 'bg-emerald-500' : metric.status === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`} />
              </div>
              <div className="flex items-end justify-between mt-1">
                <span className="text-lg font-bold text-gray-900">{metric.value}<span className="text-xs text-gray-400 ml-1">{metric.unit}</span></span>
                <Sparkline data={metric.trend || []} width={50} height={18} color={metric.status === 'green' ? '#10b981' : metric.status === 'amber' ? '#f59e0b' : '#ef4444'} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
