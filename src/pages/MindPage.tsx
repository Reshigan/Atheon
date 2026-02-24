import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { MindModels, MindStats } from "@/lib/api";
import { Brain, Cpu, Layers, Gauge, Zap, Database, BarChart3, Loader2 } from "lucide-react";

export function MindPage() {
  const [models, setModels] = useState<MindModels | null>(null);
  const [stats, setStats] = useState<MindStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [m, s] = await Promise.allSettled([
        api.mind.models(), api.mind.stats(),
      ]);
      if (m.status === 'fulfilled') setModels(m.value);
      if (s.status === 'fulfilled') setStats(s.value);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const modelTiers = (models?.tiers || []).map(t => ({
    name: t.name, model: t.model, context: `${t.maxTokens} tokens`,
    latency: `${t.avgLatency}ms`, cost: t.avgLatency < 100 ? 'Low' : t.avgLatency < 500 ? 'Medium' : 'High',
    usage: stats?.tierBreakdown?.find(b => b.tier === t.id)?.count || 0,
    description: t.description,
  }));
  const totalUsage = modelTiers.reduce((s, t) => s + t.usage, 0) || 1;

  const pipeline = models?.trainingPipeline;
  const trainingPhases = [
    { name: 'Domain Pre-Training', status: pipeline?.preTraining?.status || 'pending', progress: pipeline?.preTraining?.progress || 0, duration: pipeline?.preTraining?.dataset || '', tokens: '' },
    { name: 'Domain Fine-Tuning', status: pipeline?.domainFineTuning?.status || 'pending', progress: pipeline?.domainFineTuning?.progress || 0, duration: `Epoch ${pipeline?.domainFineTuning?.currentEpoch || 0}/${pipeline?.domainFineTuning?.totalEpochs || 0}`, tokens: '' },
    { name: 'RLHF Alignment', status: pipeline?.rlhf?.status || 'pending', progress: pipeline?.rlhf?.progress || 0, duration: '', tokens: '' },
  ];

  const eval_ = pipeline?.evaluation;
  const evaluationMetrics = [
    { name: 'MMLU Score', value: eval_?.mmlu || 0, target: 80 },
    { name: 'HumanEval', value: eval_?.humaneval || 0, target: 50 },
    { name: 'Domain Accuracy', value: eval_?.domainAccuracy || 0, target: 85 },
    { name: 'Hallucination Rate', value: eval_?.hallucination_rate || 0, target: 5, inverse: true, unit: '%' },
    { name: 'Avg Latency', value: stats?.avgLatencyMs || 0, target: 500, unit: 'ms', inverse: true },
    { name: 'Total Queries', value: stats?.totalQueries || 0, target: 100 },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <Brain className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Atheon Mind</h1>
          <p className="text-sm text-gray-500">Proprietary Domain LLM - Enterprise Intelligence Engine</p>
        </div>
      </div>

      {/* Model Tiers */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" /> Inference Tiers
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modelTiers.map((tier) => (
            <Card key={tier.name} hover>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">{tier.name}</h3>
                <Badge variant="outline">{Math.round((tier.usage / totalUsage) * 100)}% traffic</Badge>
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Model</span>
                  <span className="text-xs text-gray-600 font-mono">{tier.model}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Context</span>
                  <span className="text-xs text-gray-600">{tier.context}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Latency</span>
                  <span className="text-xs text-gray-600">{tier.latency}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Cost</span>
                  <Badge variant={tier.cost === 'Low' ? 'success' : tier.cost === 'Medium' ? 'warning' : 'danger'} size="sm">{tier.cost}</Badge>
                </div>
              </div>
              <p className="text-xs text-gray-400">{tier.description}</p>
              <Progress value={Math.round((tier.usage / totalUsage) * 100)} color="blue" size="sm" className="mt-3" />
            </Card>
          ))}
        </div>
      </div>

      {/* Training Pipeline */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-blue-600" /> Training Pipeline
        </h2>
        <Card>
          <div className="space-y-4">
            {trainingPhases.map((phase) => (
              <div key={phase.name} className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  phase.status === 'completed' ? 'bg-emerald-50' : 'bg-amber-50'
                }`}>
                  {phase.status === 'completed' ? (
                    <Zap className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Gauge className="w-4 h-4 text-amber-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{phase.name}</span>
                    <Badge variant={phase.status === 'completed' ? 'success' : 'warning'}>{phase.status}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-400">
                    <span>{phase.duration}</span>
                    <span>{phase.tokens}</span>
                  </div>
                  <Progress value={phase.progress} color={phase.status === 'completed' ? 'emerald' : 'amber'} size="sm" className="mt-1" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Evaluation Metrics */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" /> Evaluation Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {evaluationMetrics.map((metric) => {
            const passing = metric.inverse ? metric.value <= metric.target : metric.value >= metric.target;
            return (
              <Card key={metric.name}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">{metric.name}</span>
                  <Badge variant={passing ? 'success' : 'warning'} size="sm">{passing ? 'Pass' : 'Below Target'}</Badge>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-2xl font-bold text-gray-900">{metric.value}</span>
                  <span className="text-sm text-gray-400 mb-0.5">{metric.unit || '%'}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-1">Target: {metric.target}{metric.unit || '%'}</div>
                <Progress
                  value={metric.inverse ? metric.target - metric.value + metric.target : metric.value}
                  max={metric.inverse ? metric.target * 2 : 100}
                  color={passing ? 'emerald' : 'amber'}
                  size="sm"
                  className="mt-2"
                />
              </Card>
            );
          })}
        </div>
      </div>

      {/* Architecture Note */}
      <Card className="border-blue-200">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Architecture Note</h3>
            <p className="text-xs text-gray-500 mt-1">
              Atheon Mind uses a multi-tier inference architecture. The <span className="text-blue-600">atheon-mind-proxy</span> Worker
              classifies query complexity and routes to the appropriate tier. Tier 1 (Workers AI) handles 72% of queries at the edge
              with sub-50ms latency. Complex reasoning escalates to Tier 2/3 with full Atheon Mind 70B capabilities.
              Client-specific LoRA adapters are hot-swapped based on tenant context.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
