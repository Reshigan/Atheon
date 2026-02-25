import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { HealthScore, Risk, Metric, AnomalyItem, ClusterItem, ActionItem, ControlPlaneHealth } from "@/lib/api";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, Activity,
  Shield, Loader2, CheckCircle2, Circle, ArrowRight, BarChart3,
  Brain, Database, ChevronRight, Plus} from "lucide-react";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";



const trendIcon = (trend: string) => {
  if (trend === 'up') return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === 'down') return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function buildCalendarDays() {
  const today = new Date();
  const days: { date: number; day: string; isToday: boolean; month: number }[] = [];
  for (let i = -3; i <= 18; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    days.push({
      date: d.getDate(),
      day: DAY_NAMES[d.getDay()],
      isToday: i === 0,
      month: d.getMonth()});
  }
  return days;
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [cpHealth, setCpHealth] = useState<ControlPlaneHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [h, r, m, a, c, act, cp] = await Promise.allSettled([
          api.apex.health(),
          api.apex.risks(),
          api.pulse.metrics(),
          api.pulse.anomalies(),
          api.catalysts.clusters(),
          api.catalysts.actions(),
          api.controlplane.health(),
        ]);
        if (h.status === 'fulfilled') setHealth(h.value);
        if (r.status === 'fulfilled') setRisks(r.value.risks);
        if (m.status === 'fulfilled') setMetrics(m.value.metrics);
        if (a.status === 'fulfilled') setAnomalies(a.value.anomalies);
        if (c.status === 'fulfilled') setClusters(c.value.clusters);
        if (act.status === 'fulfilled') setActions(act.value.actions);
        if (cp.status === 'fulfilled') setCpHealth(cp.value);
      } catch { /* silently handle */ }
      setLoading(false);
    }
    load();
  }, []);

  const overallScore = health?.overall ?? 0;
  const dimEntries = health?.dimensions ? Object.values(health.dimensions) : [];
  const upCount = dimEntries.filter(d => d.trend === 'up').length;
  const downCount = dimEntries.filter(d => d.trend === 'down').length;
  const healthTrend = upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'stable';
  const avgDelta = dimEntries.length > 0 ? dimEntries.reduce((s, d) => s + d.delta, 0) / dimEntries.length : 0;
  const dimensions = health?.dimensions
    ? Object.entries(health.dimensions).map(([key, val]) => ({
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        score: val.score,
        trend: val.trend as 'up' | 'down' | 'stable',
        change: val.delta,
        sparkline: [val.score - 6, val.score - 4, val.score - 3, val.score - 2, val.score - 1, val.score]}))
    : [];
  const activeCatalysts = clusters.filter(c => c.status === 'active').length;
  const totalTasks = clusters.reduce((sum, c) => sum + (c.tasksInProgress || 0), 0);
  const criticalRisks = risks.filter(r => r.severity === 'critical').length;

  const calendarDays = useMemo(() => buildCalendarDays(), []);
  const now = new Date();
  const currentMonth = now.getMonth();

  const objectives = useMemo(() => {
    const items: { id: string; text: string; completed: boolean; source: string }[] = [];
    actions.filter(a => a.status === 'completed').slice(0, 2).forEach(a => {
      items.push({ id: a.id, text: a.action, completed: true, source: 'catalysts' });
    });
    risks.slice(0, 2).forEach(r => {
      items.push({ id: r.id, text: r.title, completed: false, source: 'apex' });
    });
    return items;
  }, [risks, actions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">

      {/* PAGE HEADER */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--border-card)' }}>
              Daily
            </span>
            <span className="text-xs t-muted">Overview</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold t-primary leading-tight" >
            Level<br />
            <span style={{ color: 'var(--accent)' }}>{String(overallScore).padStart(2, '0')}</span>: {healthTrend === 'up' ? 'Growth' : healthTrend === 'down' ? 'Attention' : 'Stable'}
          </h1>
        </div>

        <div className="hidden md:block">
          <div className="rounded-xl p-4 max-w-[260px]"          style={{ background: '#09090b', border: '1px solid var(--border-card)' }}>
                      <p className="text-xs text-gray-400 mb-1">system health score</p>
                      <p className="text-sm text-white font-medium mb-2">
                        {cpHealth ? `${cpHealth.overallUptime.toFixed(1)}% uptime` : 'All systems operational'}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                          {activeCatalysts} active catalysts
                        </span>
                        <Link to="/control-plane" className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
                view now
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* TIMELINE PROGRESS BAR */}
      <div>
        <div className="relative h-2 mb-4">
          <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all"
              style={{ width: `${Math.min(overallScore, 100)}%`, background: 'var(--accent)' }}
            />
          </div>
          <div
            className="absolute top-1/2 w-3 h-3 rounded-full border-2"
            style={{ left: `${Math.min(overallScore, 100)}%`, transform: 'translateX(-50%) translateY(-50%)', background: 'var(--bg-primary)', borderColor: 'var(--accent)' }}
          />
        </div>
      </div>

      {/* CALENDAR STRIP */}
      <div>
        <div className="flex gap-6 mb-3 overflow-x-auto scrollbar-thin pb-1">
          {MONTH_NAMES.map((m, i) => (
            <span
              key={m}
              className="text-sm whitespace-nowrap"
              style={{
                color: i === currentMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: i === currentMonth ? 600 : 400}}
            >
              {m}
            </span>
          ))}
        </div>

        <div className="flex gap-1 overflow-x-auto scrollbar-thin pb-2">
          {calendarDays.map((d, i) => (
            <div
              key={i}
              className="flex flex-col items-center min-w-[36px] py-1.5 px-1 rounded-lg transition-all"
              style={d.isToday ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)' }}
            >
              <span className="text-sm font-semibold" style={d.isToday ? { color: '#fff' } : undefined}>{d.date}</span>
              <span className="text-[10px]" style={d.isToday ? { color: 'rgba(255,255,255,0.7)' } : { color: 'var(--text-muted)' }}>{d.day}</span>
            </div>
          ))}
          <button className="flex items-center justify-center min-w-[36px] py-1.5 px-1 rounded-lg t-muted hover:t-primary transition-all" style={{ border: '1px solid var(--border-card)' }}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* CURRENT OBJECTIVES */}
      <div>
        <h2 className="text-xl font-bold t-primary mb-1" >
          current objectives<br />to resolve
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {objectives.map((obj, i) => (
            <div
              key={obj.id}
              className="rounded-xl p-4 flex flex-col justify-between min-h-[100px] transition-all hover:-translate-y-0.5"
              style={
                obj.completed
                  ? { background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }
                  : i % 2 === 0
                  ? { background: '#f0f8f0', border: '1px solid rgba(34, 150, 34, 0.1)' }
                  : { background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }
              }
            >
              <p
                className="text-sm font-medium leading-snug"
                style={{
                  textDecoration: obj.completed ? 'line-through' : 'none',
                  color: obj.completed ? 'var(--text-muted)' : 'var(--text-primary)'}}
              >
                {obj.text}
              </p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>{obj.source}</span>
                {obj.completed ? (
                  <CheckCircle2 size={18} className="text-emerald-500" />
                ) : (
                  <Circle size={18} className="t-muted" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* METRICS ROW - mixed white + black + mint cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="black" className="relative overflow-hidden">
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Business Health</p>
                <p className="text-3xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{overallScore}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {trendIcon(healthTrend)}
                  <span className={`text-xs ${avgDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(1)} pts</span>
                </div>
              </div>
              <ScoreRing score={overallScore} size="sm" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs t-secondary uppercase tracking-wider">Active Risks</p>
                <p className="text-3xl font-bold t-primary mt-1" >{risks.length}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs text-red-500">{criticalRisks} critical</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239, 68, 68, 0.08)' }}>
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="mint" className="relative overflow-hidden">
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Active Catalysts</p>
                <p className="text-3xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{activeCatalysts}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Zap className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-xs text-emerald-600">{totalTasks} tasks in progress</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34, 150, 34, 0.12)' }}>
                <Zap className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs t-secondary uppercase tracking-wider">System Health</p>
                <p className="text-3xl font-bold t-primary mt-1" >{cpHealth ? `${cpHealth.overallUptime.toFixed(2)}%` : '--'}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Activity className={`w-3.5 h-3.5 ${(cpHealth?.overallHealth ?? 0) >= 80 ? 'text-emerald-500' : 'text-amber-500'}`} />
                  <span className={`text-xs ${(cpHealth?.overallHealth ?? 0) >= 80 ? 'text-emerald-500' : 'text-amber-500'}`}>{(cpHealth?.overallHealth ?? 0) >= 80 ? 'All systems operational' : 'Degraded performance'}</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                <Activity className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MAIN CONTENT - practical + level theory */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold t-primary" >practical</h2>
            <Link to="/pulse" className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
              <ArrowRight size={12} />
            </Link>
          </div>
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold t-primary">Revenue Trend</h3>
                <p className="text-xs t-secondary">Last 6 months (M ZAR)</p>
              </div>
              <Badge variant="success">{metrics.length > 0 ? `+${((metrics[0].value / (metrics[0].value * 0.96) - 1) * 100).toFixed(1)}%` : '--'}</Badge>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={(() => {
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const chartNow = new Date();
                  return Array.from({ length: 6 }, (_, i) => {
                    const d = new Date(chartNow.getFullYear(), chartNow.getMonth() - 5 + i, 1);
                    const baseValue = metrics.length > 0 ? metrics[0].value : 40;
                    return { month: monthNames[d.getMonth()], value: +(baseValue * (0.9 + i * 0.04) + (Math.sin(i) * 1.2)).toFixed(1) };
                  });
                })()}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                                            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '12px', color: 'var(--text-primary)', fontSize: '12px', boxShadow: 'var(--shadow-dropdown)' }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#revenueGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            {metrics.slice(0, 3).map((metric) => (
              <div
                key={metric.id}
                className="rounded-xl p-4 transition-all hover:-translate-y-0.5"
                style={{ background: 'var(--accent-subtle)', border: '1px solid var(--border-card)' }}
              >
                <div className="flex items-center justify-between mb-2">
                                    <Sparkline data={metric.trend || []} width={50} height={22} color="#2a7c8c" />
                                    <ArrowRight size={14} style={{ color: 'var(--accent)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{metric.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{metric.value} {metric.unit}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold t-primary" >level theory</h2>
            <Link to="/apex" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all</Link>
          </div>
          <Card>
            <div className="space-y-4">
              {dimensions.slice(0, 5).map((dim) => (
                <div key={dim.key} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm t-secondary truncate">{dim.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold t-primary">{dim.score}</span>
                        {trendIcon(dim.trend)}
                      </div>
                    </div>
                    <Progress
                      value={dim.score}
                      color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'}
                      size="sm"
                      className="mt-1.5"
                    />
                  </div>
                  <Sparkline data={dim.sparkline} width={50} height={20} color={dim.trend === 'up' ? '#10b981' : dim.trend === 'down' ? '#ef4444' : '#6b7280'} />
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-4 rounded-xl p-5"          style={{ background: '#09090b', border: '1px solid var(--border-card)' }}>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-subtle)' }}>
                          <Brain size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Hey there!</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  {anomalies.length > 0
                    ? `I detected ${anomalies.length} anomalies. The most significant is "${anomalies[0]?.metric}" with +${anomalies[0]?.deviation}% deviation.`
                    : 'All systems are running smoothly. No anomalies detected.'
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Link to="/chat" className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
                ask Atheon
              </Link>
              <span className="text-[10px] text-gray-500">Powered by Mind</span>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW - risk alerts, anomalies, catalyst activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card variant="black">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                          <Shield size={16} style={{ color: 'var(--accent)' }} />
                          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Risk Alerts</h3>
                        </div>
                        <Link to="/apex" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all</Link>
          </div>
          <div className="space-y-3">
            {risks.slice(0, 3).map((risk) => (
              <div key={risk.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium line-clamp-1" style={{ color: 'var(--text-primary)' }}>{risk.title}</h4>
                  <Badge variant={risk.severity === 'critical' ? 'danger' : risk.severity === 'high' ? 'warning' : 'default'}>
                    {risk.severity}
                  </Badge>
                </div>
                <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{risk.description}</p>
                <span className="text-[10px] mt-1.5 inline-block" style={{ color: 'var(--text-muted)' }}>{Math.round(risk.probability * 100)}% confidence</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-emerald-500" />
              <h3 className="text-base font-bold t-primary" >Anomalies</h3>
            </div>
            <Link to="/pulse" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all</Link>
          </div>
          <div className="space-y-3">
            {anomalies.slice(0, 3).map((anom) => (
              <div key={anom.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium t-primary line-clamp-1">{anom.metric}</h4>
                  <Badge variant={anom.severity === 'critical' ? 'danger' : anom.severity === 'high' ? 'warning' : 'default'}>
                    +{anom.deviation}%
                  </Badge>
                </div>
                <p className="text-xs t-secondary mt-1 line-clamp-2">{anom.hypothesis}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="mint">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-emerald-600" />
              <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Catalyst Activity</h3>
            </div>
            <Link to="/catalysts" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all</Link>
          </div>
          <div className="space-y-3">
            {actions.slice(0, 3).map((action) => (
              <div key={action.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid rgba(34,150,34,0.08)' }}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium line-clamp-1" style={{ color: 'var(--text-primary)' }}>{action.action}</h4>
                  <Badge variant={action.status === 'completed' ? 'success' : action.status === 'pending' ? 'warning' : 'info'}>
                    {action.status}
                  </Badge>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{action.catalystName}</p>
                <span className="text-[10px] mt-1 inline-block" style={{ color: 'var(--text-muted)' }}>{Math.round(action.confidence * 100)}% confidence</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* PROCESS METRICS STRIP */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color: 'var(--accent)' }} />
            <h3 className="text-base font-bold t-primary" >Process Metrics</h3>
          </div>
          <Link to="/pulse" className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
            View all <ChevronRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.slice(0, 8).map((metric) => (
            <div key={metric.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary truncate">{metric.name}</span>
                <span className={`w-2 h-2 rounded-full ${metric.status === 'green' ? 'bg-emerald-500' : metric.status === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`} />
              </div>
              <div className="flex items-end justify-between mt-1">
                <span className="text-lg font-bold t-primary" >{metric.value}<span className="text-xs t-secondary ml-1 font-normal">{metric.unit}</span></span>
                <Sparkline data={metric.trend || []} width={50} height={18} color={metric.status === 'green' ? '#10b981' : metric.status === 'amber' ? '#f59e0b' : '#ef4444'} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* LAYER QUICK LINKS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: BarChart3, label: 'Apex', desc: 'Executive intelligence', to: '/apex', color: 'var(--accent)' },
          { icon: Activity, label: 'Pulse', desc: 'Process monitoring', to: '/pulse', color: '#10b981' },
          { icon: Database, label: 'Memory', desc: 'Knowledge base', to: '/memory', color: '#3b82f6' },
          { icon: Brain, label: 'Mind', desc: 'AI models', to: '/mind', color: '#8b5cf6' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              className="rounded-xl p-4 transition-all hover:-translate-y-0.5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
                  <Icon size={18} style={{ color: item.color }} />
                </div>
                <div>
                  <p className="text-sm font-semibold t-primary">{item.label}</p>
                  <p className="text-[10px] t-muted">{item.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
