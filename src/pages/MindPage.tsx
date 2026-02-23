import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, Cpu, Layers, Gauge, Zap, Database, BarChart3 } from "lucide-react";

const modelTiers = [
  { name: 'Tier 1 — Edge (Workers AI)', model: '@cf/meta/llama-3.1-8b-instruct', context: '8K tokens', latency: '<50ms', cost: 'Low', usage: 72, description: 'Fast classification, routing, simple Q&A' },
  { name: 'Tier 2 — Atheon Mind 70B', model: 'atheon-mind-70b-q4', context: '32K tokens', latency: '200-500ms', cost: 'Medium', usage: 23, description: 'Complex reasoning, analysis, report generation' },
  { name: 'Tier 3 — Apex Reasoning', model: 'atheon-mind-70b-full', context: '128K tokens', latency: '1-3s', cost: 'High', usage: 5, description: 'Scenario modelling, Monte Carlo, strategic analysis' },
];

const trainingPhases = [
  { name: 'Domain Pre-Training', status: 'completed', progress: 100, duration: '2.5 weeks', tokens: '500B tokens' },
  { name: 'Instruction Fine-Tuning (SFT)', status: 'completed', progress: 100, duration: '4 days', tokens: '50K pairs' },
  { name: 'DPO Alignment', status: 'completed', progress: 100, duration: '1.5 weeks', tokens: '10K preferences' },
  { name: 'LoRA Adapter — Vanta X', status: 'active', progress: 78, duration: '6 hours', tokens: 'Client-specific' },
];

const evaluationMetrics = [
  { name: 'Task Completion Accuracy', value: 94.2, target: 95 },
  { name: 'Format Compliance Rate', value: 97.8, target: 95 },
  { name: 'Hallucination Rate', value: 2.1, target: 3, inverse: true },
  { name: 'Citation Accuracy', value: 96.5, target: 95 },
  { name: 'Enterprise Benchmark Score', value: 88.7, target: 85 },
  { name: 'Latency P95 (Tier 2)', value: 450, target: 500, unit: 'ms', inverse: true },
];

export function MindPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
          <Brain className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Atheon Mind</h1>
          <p className="text-sm text-neutral-400">Proprietary Domain LLM - Enterprise Intelligence Engine</p>
        </div>
      </div>

      {/* Model Tiers */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-violet-400" /> Inference Tiers
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modelTiers.map((tier) => (
            <Card key={tier.name} hover>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">{tier.name}</h3>
                <Badge variant="outline">{tier.usage}% traffic</Badge>
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Model</span>
                  <span className="text-xs text-neutral-300 font-mono">{tier.model}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Context</span>
                  <span className="text-xs text-neutral-300">{tier.context}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Latency</span>
                  <span className="text-xs text-neutral-300">{tier.latency}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Cost</span>
                  <Badge variant={tier.cost === 'Low' ? 'success' : tier.cost === 'Medium' ? 'warning' : 'danger'} size="sm">{tier.cost}</Badge>
                </div>
              </div>
              <p className="text-xs text-neutral-500">{tier.description}</p>
              <Progress value={tier.usage} color="indigo" size="sm" className="mt-3" />
            </Card>
          ))}
        </div>
      </div>

      {/* Training Pipeline */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-violet-400" /> Training Pipeline
        </h2>
        <Card>
          <div className="space-y-4">
            {trainingPhases.map((phase) => (
              <div key={phase.name} className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  phase.status === 'completed' ? 'bg-emerald-500/15' : 'bg-amber-500/15'
                }`}>
                  {phase.status === 'completed' ? (
                    <Zap className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Gauge className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-200">{phase.name}</span>
                    <Badge variant={phase.status === 'completed' ? 'success' : 'warning'}>{phase.status}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-neutral-600">
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
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-400" /> Evaluation Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {evaluationMetrics.map((metric) => {
            const passing = metric.inverse ? metric.value <= metric.target : metric.value >= metric.target;
            return (
              <Card key={metric.name}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500">{metric.name}</span>
                  <Badge variant={passing ? 'success' : 'warning'} size="sm">{passing ? 'Pass' : 'Below Target'}</Badge>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-2xl font-bold text-white">{metric.value}</span>
                  <span className="text-sm text-neutral-500 mb-0.5">{metric.unit || '%'}</span>
                </div>
                <div className="text-[10px] text-neutral-600 mt-1">Target: {metric.target}{metric.unit || '%'}</div>
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
      <Card className="border-violet-500/20">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-violet-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white">Architecture Note</h3>
            <p className="text-xs text-neutral-400 mt-1">
              Atheon Mind uses a multi-tier inference architecture. The <span className="text-violet-400">cortex-mind-proxy</span> Worker
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
