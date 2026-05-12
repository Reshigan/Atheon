import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { MindModels, MindStats, MindQueryResult } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  Brain,
  Settings2,
  Play,
  BarChart3,
  Loader2,
  Zap,
  AlertTriangle,
  Sparkles,
  Cpu,
  Clock,
  Hash,
  CheckCircle2,
} from "lucide-react";

/**
 * Mind — ML model governance & LLM query playground.
 *
 * Tabs:
 *  1. Model Tiers — GET /api/mind/models (tier catalog, industry adapters, training state)
 *  2. Prompt Playground — POST /api/mind/query (with tier selector + 429 budget handling)
 *  3. Usage & Stats — GET /api/mind/stats (tenant-scoped query/token/latency breakdown)
 *
 * All data here is tenant-scoped (the backend resolves tenant from auth); companyId is
 * not needed for these endpoints.
 *
 * PR #226: /api/mind/query returns 429 when the tenant's monthly LLM token budget is
 * exhausted. We surface a friendly message instead of a generic error.
 */

const BUDGET_EXCEEDED_MESSAGE =
  "Your tenant's LLM budget has been reached for this month. Contact your admin to increase it.";

export function MindPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"models" | "playground" | "stats">("models");

  // Models tab
  const [models, setModels] = useState<MindModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Playground tab
  const [prompt, setPrompt] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("tier-1");
  const [queryResult, setQueryResult] = useState<MindQueryResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);

  // Stats tab
  const [stats, setStats] = useState<MindStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const data = await api.mind.models();
      setModels(data);
      if (data.tiers && data.tiers.length > 0 && !data.tiers.find((t) => t.id === selectedTier)) {
        setSelectedTier(data.tiers[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load model catalog";
      setModelsError(message);
      toast.error("Failed to load model catalog", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setModelsLoading(false);
    }
    // selectedTier intentionally excluded — this loader runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await api.mind.stats();
      setStats(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load usage stats";
      setStatsError(message);
      toast.error("Failed to load usage stats", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setStatsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadModels();
    loadStats();
  }, [loadModels, loadStats]);

  const testPrompt = async () => {
    if (!prompt.trim()) return;
    setTesting(true);
    setPlaygroundError(null);
    setQueryResult(null);
    try {
      const result = await api.mind.query(prompt, selectedTier);
      setQueryResult(result);
    } catch (err) {
      // PR #226: tenant LLM budget exceeded — show a friendly notice, not a crash.
      if (err instanceof ApiError && err.status === 429) {
        setPlaygroundError(BUDGET_EXCEEDED_MESSAGE);
        toast.warning("LLM budget reached", {
          message: BUDGET_EXCEEDED_MESSAGE,
        });
      } else {
        const message = err instanceof Error ? err.message : "Failed to run prompt";
        setPlaygroundError(message);
        toast.error("Prompt test failed", {
          message,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const tabs = [
    { id: "models" as const, label: "Model Tiers", icon: Settings2 },
    { id: "playground" as const, label: "Prompt Playground", icon: Play },
    { id: "stats" as const, label: "Usage & Stats", icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Brain size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-lg font-semibold t-primary">Mind - AI Model Governance</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all ${activeTab === tab.id ? "t-primary" : "t-muted hover:t-secondary"}`}
            style={activeTab === tab.id ? { background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" } : undefined}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Model Tiers */}
      {activeTab === "models" && (
        <div className="space-y-4">
          {modelsLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          )}
          {!modelsLoading && modelsError && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/20">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400 flex-1">{modelsError}</p>
              <button onClick={loadModels} className="text-xs text-red-300 hover:text-red-200 underline">Retry</button>
            </div>
          )}
          {!modelsLoading && !modelsError && models && (
            <>
              <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <h2 className="text-sm font-semibold t-primary flex items-center gap-2">
                  <Cpu size={14} /> Available Model Tiers
                </h2>
                {models.tiers && models.tiers.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {models.tiers.map((tier) => (
                      <div key={tier.id} className="p-4 rounded-lg space-y-2" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium t-primary">{tier.name}</p>
                          <span className="text-caption font-mono t-muted">{tier.id}</span>
                        </div>
                        <p className="text-xs t-muted">{tier.description}</p>
                        <div className="flex items-center gap-3 text-caption t-secondary pt-2">
                          <span className="flex items-center gap-1"><Hash size={10} /> {tier.maxTokens.toLocaleString()} tokens</span>
                          {typeof tier.avgLatency === "number" && (
                            <span className="flex items-center gap-1"><Clock size={10} /> ~{tier.avgLatency}ms</span>
                          )}
                        </div>
                        <p className="text-caption font-mono t-muted pt-1 truncate" title={tier.model}>{tier.model}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted text-center py-8">No model tiers configured.</p>
                )}
              </div>

              <div className="rounded-xl p-6 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <h2 className="text-sm font-semibold t-primary flex items-center gap-2">
                  <Sparkles size={14} /> Industry Adapters
                </h2>
                {models.industryAdapters && models.industryAdapters.length > 0 ? (
                  <div className="space-y-2">
                    {models.industryAdapters.map((ad) => (
                      <div key={ad.id} className="flex items-center justify-between p-3 rounded-md" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                        <div>
                          <p className="text-sm font-medium t-primary">{ad.name}</p>
                          <p className="text-caption t-muted">{ad.metrics?.join(", ") || "No metrics listed"}</p>
                        </div>
                        <span className="text-caption px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "var(--bg-card)", color: "var(--accent)" }}>
                          <CheckCircle2 size={10} /> {ad.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted text-center py-4">No industry adapters available yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Prompt Playground */}
      {activeTab === "playground" && (
        <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <h2 className="text-sm font-semibold t-primary">Test Prompts</h2>

          <div>
            <label className="text-xs t-muted mb-1.5 block">Model Tier</label>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm t-primary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              disabled={modelsLoading || testing}
            >
              {(models?.tiers ?? [{ id: "tier-1", name: "Fast (Tier 1)" }, { id: "tier-2", name: "Standard (Tier 2)" }, { id: "tier-3", name: "Deep (Tier 3)" }]).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
              ))}
            </select>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to test against the current model tier..."
            rows={4}
            className="w-full px-3 py-2 rounded-md text-sm t-primary resize-y"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          />

          {playgroundError && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-400 flex-1">{playgroundError}</p>
              <button onClick={() => setPlaygroundError(null)} className="text-xs text-amber-300 hover:text-amber-200 underline">Dismiss</button>
            </div>
          )}

          <button
            onClick={testPrompt}
            disabled={testing || !prompt.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2"
            style={{ background: "var(--accent)", opacity: testing || !prompt.trim() ? 0.6 : 1 }}
            title="Run prompt against the selected tier"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {testing ? "Running..." : "Test Prompt"}
          </button>

          {queryResult && (
            <div className="space-y-3">
              <div className="p-4 rounded-md text-sm t-secondary whitespace-pre-wrap" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                {queryResult.response}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-caption t-muted">
                <span className="flex items-center gap-1"><Cpu size={11} /> {queryResult.model}</span>
                <span className="flex items-center gap-1"><Clock size={11} /> {queryResult.latencyMs}ms</span>
                <span className="flex items-center gap-1"><Hash size={11} /> {queryResult.tokensIn + queryResult.tokensOut} tokens</span>
                {queryResult.citations && queryResult.citations.length > 0 && (
                  <span>{queryResult.citations.length} citation{queryResult.citations.length === 1 ? "" : "s"}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {activeTab === "stats" && (
        <div className="space-y-4">
          {statsLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          )}
          {!statsLoading && statsError && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/20">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400 flex-1">{statsError}</p>
              <button onClick={loadStats} className="text-xs text-red-300 hover:text-red-200 underline">Retry</button>
            </div>
          )}
          {!statsLoading && !statsError && stats && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                  <p className="text-label">Total Queries</p>
                  <p className="text-2xl font-semibold t-primary mt-1">{stats.totalQueries.toLocaleString()}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                  <p className="text-label">Avg Latency</p>
                  <p className="text-2xl font-semibold t-primary mt-1">{stats.avgLatencyMs}ms</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                  <p className="text-label">Total Tokens</p>
                  <p className="text-2xl font-semibold t-primary mt-1">{stats.totalTokens.toLocaleString()}</p>
                </div>
              </div>

              <div className="rounded-xl p-6 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <h2 className="text-sm font-semibold t-primary">Usage by Tier</h2>
                {stats.tierBreakdown && stats.tierBreakdown.length > 0 ? (
                  <div className="space-y-2">
                    {stats.tierBreakdown.map((row) => (
                      <div key={row.tier} className="flex items-center justify-between p-3 rounded-md" style={{ background: "var(--bg-secondary)" }}>
                        <div>
                          <p className="text-xs font-medium t-primary">{row.tier}</p>
                          <p className="text-caption t-muted">{row.count} queries</p>
                        </div>
                        <span className="text-xs font-mono t-secondary">{Math.round(row.avg_latency)}ms avg</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted text-center py-8">No usage data yet. Run prompts in the Playground tab to see stats here.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
