import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import type { Assessment, AssessmentResults, CatalystScore, SubCatalystScore, ERPConnection } from '@/lib/api';

type View = 'list' | 'new' | 'running' | 'results';

const INDUSTRIES = [
  'Manufacturing', 'Retail', 'Financial Services', 'Healthcare',
  'Construction', 'Technology', 'Agriculture', 'Mining',
  'Logistics', 'Professional Services', 'Education', 'Hospitality',
];

export function AssessmentsPage() {
  const [view, setView] = useState<View>('list');
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssessments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.assessments.list();
      setAssessments(data.assessments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAssessments(); }, [loadAssessments]);

  const openResults = async (id: string) => {
    setSelectedId(id);
    try {
      const data = await api.assessments.get(id);
      setSelectedAssessment(data);
      if (data.status === 'running' || data.status === 'pending') {
        setView('running');
      } else {
        setView('results');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteAssessment = async (id: string) => {
    if (!confirm('Delete this assessment?')) return;
    try {
      await api.assessments.delete(id);
      loadAssessments();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Assessments</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Pre-sale analysis &amp; business case generation</p>
        </div>
        <div className="flex gap-2">
          {view !== 'list' && (
            <button
              onClick={() => { setView('list'); setSelectedId(null); setSelectedAssessment(null); loadAssessments(); }}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
            >
              &larr; Back
            </button>
          )}
          <button
            onClick={() => setView('new')}
            className="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ background: 'var(--accent)' }}
          >
            + New Assessment
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {view === 'list' && (
        <ListView
          assessments={assessments}
          loading={loading}
          onView={openResults}
          onDelete={deleteAssessment}
        />
      )}
      {view === 'new' && (
        <NewAssessmentWizard
          onCreated={(id) => { setSelectedId(id); setView('running'); }}
          onError={setError}
        />
      )}
      {view === 'running' && selectedId && (
        <RunningView
          id={selectedId}
          onComplete={(a) => { setSelectedAssessment(a); setView('results'); }}
        />
      )}
      {view === 'results' && selectedAssessment && (
        <ResultsView assessment={selectedAssessment} />
      )}
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────
function ListView({ assessments, loading, onView, onDelete }: {
  assessments: Assessment[];
  loading: boolean;
  onView: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) {
    return <div className="space-y-3">{[1,2,3].map(i => (
      <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
    ))}</div>;
  }

  if (assessments.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">📊</div>
        <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>No assessments yet</h3>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Run a pre-assessment against a prospect&apos;s ERP to generate a business case.</p>
      </div>
    );
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'complete': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'running': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: 'var(--bg-secondary)' }}>
            {['Prospect', 'Industry', 'Status', 'Catalysts', 'Est. Saving', 'Date', 'Actions'].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
          {assessments.map(a => {
            const results = a.results as AssessmentResults | null;
            const catalystCount = results?.catalyst_scores?.length || 0;
            const totalSaving = results?.catalyst_scores?.reduce((sum: number, c: CatalystScore) => sum + (c.estimated_annual_saving_zar || 0), 0) || 0;

            return (
              <tr key={a.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{a.prospectName}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{a.prospectIndustry}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(a.status)}`}>{a.status}</span>
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{catalystCount}</td>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                  {totalSaving > 0 ? `R ${(totalSaving / 1000).toFixed(0)}k` : '—'}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {new Date(a.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => onView(a.id)}
                      className="text-xs px-2 py-1 rounded"
                      style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                    >
                      View
                    </button>
                    {a.status === 'complete' && (
                      <>
                        <button
                          onClick={() => api.assessments.downloadBusiness(a.id)}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => api.assessments.downloadExcel(a.id)}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                        >
                          Excel
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => onDelete(a.id)}
                      className="text-xs px-2 py-1 rounded text-red-600 bg-red-50 dark:bg-red-900/20"
                    >
                      Del
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── New Assessment Wizard ─────────────────────────────────────────────────
function NewAssessmentWizard({ onCreated, onError }: {
  onCreated: (id: string) => void;
  onError: (err: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [erpConnections, setErpConnections] = useState<{ id: string; erp_type: string; company_name: string }[]>([]);

  // Step 1: Prospect details
  const [prospectName, setProspectName] = useState('');
  const [prospectIndustry, setProspectIndustry] = useState('');
  const [erpConnectionId, setErpConnectionId] = useState('');

  // Step 2: Config
  const [config, setConfig] = useState({
    deployment_model: 'saas' as 'saas' | 'on-premise' | 'hybrid',
    currency: 'ZAR',
    exchange_rate_to_zar: 1,
    target_users: 50,
    contract_years: 3,
    saas_price_per_user_pm: 450,
    onprem_licence_fee_pa: 360000,
    hybrid_licence_fee_pa: 180000,
  });

  useEffect(() => {
    // Load default config
    api.assessments.getDefaultConfig().then(d => {
      if (d && typeof d === 'object') setConfig(prev => ({ ...prev, ...(d as Record<string, unknown>) }));
    }).catch(() => {});
    // Load ERP connections
    api.erp.connections().then(d => setErpConnections((d.connections || []).map((c: ERPConnection) => ({ id: c.id, erp_type: c.adapterSystem || c.adapterName, company_name: c.name })))).catch(() => {});
  }, []);

  const submit = async () => {
    if (!prospectName || !prospectIndustry) {
      onError('Prospect name and industry are required');
      return;
    }
    try {
      setSubmitting(true);
      const data = await api.assessments.create({
        prospect_name: prospectName,
        prospect_industry: prospectIndustry,
        erp_connection_id: erpConnectionId || undefined,
        config,
      });
      onCreated(data.id);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' };

  return (
    <div className="max-w-2xl mx-auto rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                s <= step ? 'text-white' : ''
              }`}
              style={{ background: s <= step ? 'var(--accent)' : 'var(--bg-secondary)', color: s > step ? 'var(--text-muted)' : undefined }}
            >
              {s}
            </div>
            {s < 3 && <div className="w-12 h-0.5 rounded" style={{ background: s < step ? 'var(--accent)' : 'var(--bg-secondary)' }} />}
          </div>
        ))}
        <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
          {step === 1 ? 'Prospect Details' : step === 2 ? 'Configuration' : 'Review & Run'}
        </span>
      </div>

      {/* Step 1: Prospect */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Prospect Details</h3>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prospect Name</label>
            <input
              value={prospectName}
              onChange={e => setProspectName(e.target.value)}
              placeholder="e.g. Protea Manufacturing"
              className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Industry</label>
            <select value={prospectIndustry} onChange={e => setProspectIndustry(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
              <option value="">Select industry...</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>ERP Connection (optional)</label>
            <select value={erpConnectionId} onChange={e => setErpConnectionId(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
              <option value="">No ERP connection — use synthetic data</option>
              {erpConnections.map(c => <option key={c.id} value={c.id}>{c.company_name} ({c.erp_type})</option>)}
            </select>
          </div>

          <button
            onClick={() => { if (prospectName && prospectIndustry) setStep(2); else onError('Fill in prospect name and industry'); }}
            className="w-full py-2.5 text-sm font-medium rounded-lg text-white" style={{ background: 'var(--accent)' }}
          >
            Next &rarr;
          </button>
        </div>
      )}

      {/* Step 2: Config */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Assessment Configuration</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Deployment Model</label>
              <select
                value={config.deployment_model}
                onChange={e => setConfig({ ...config, deployment_model: e.target.value as 'saas' | 'on-premise' | 'hybrid' })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}
              >
                <option value="saas">SaaS</option>
                <option value="on-premise">On-Premise</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Currency</label>
              <select
                value={config.currency}
                onChange={e => setConfig({ ...config, currency: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}
              >
                <option value="ZAR">ZAR (South African Rand)</option>
                <option value="USD">USD (US Dollar)</option>
                <option value="GBP">GBP (British Pound)</option>
                <option value="EUR">EUR (Euro)</option>
                <option value="AUD">AUD (Australian Dollar)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Exchange Rate to ZAR</label>
              <input type="number" step="0.01" value={config.exchange_rate_to_zar}
                onChange={e => setConfig({ ...config, exchange_rate_to_zar: parseFloat(e.target.value) || 1 })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Target Users</label>
              <input type="number" value={config.target_users}
                onChange={e => setConfig({ ...config, target_users: parseInt(e.target.value) || 50 })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Contract Years</label>
              <input type="number" value={config.contract_years}
                onChange={e => setConfig({ ...config, contract_years: parseInt(e.target.value) || 3 })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>SaaS Price/User/Month</label>
              <input type="number" value={config.saas_price_per_user_pm}
                onChange={e => setConfig({ ...config, saas_price_per_user_pm: parseInt(e.target.value) || 450 })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>On-Prem Licence Fee/Year</label>
              <input type="number" value={config.onprem_licence_fee_pa}
                onChange={e => setConfig({ ...config, onprem_licence_fee_pa: parseInt(e.target.value) || 360000 })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Hybrid Licence Fee/Year</label>
              <input type="number" value={config.hybrid_licence_fee_pa}
                onChange={e => setConfig({ ...config, hybrid_licence_fee_pa: parseInt(e.target.value) || 180000 })}
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 text-sm rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}>
              &larr; Back
            </button>
            <button onClick={() => setStep(3)} className="flex-1 py-2.5 text-sm font-medium rounded-lg text-white" style={{ background: 'var(--accent)' }}>
              Next &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Run */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Review &amp; Run</h3>

          <div className="rounded-lg p-4 space-y-2" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Prospect</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{prospectName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Industry</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{prospectIndustry}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>ERP Connection</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {erpConnectionId ? erpConnections.find(c => c.id === erpConnectionId)?.company_name || erpConnectionId : 'Synthetic data'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Deployment Model</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{config.deployment_model}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Target Users</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{config.target_users}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Contract</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{config.contract_years} years</span>
            </div>
          </div>

          {!erpConnectionId && (
            <div className="p-3 rounded-lg text-xs bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              No ERP connection selected. Synthetic / mock data will be used for volume estimation.
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 text-sm rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}>
              &larr; Back
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 py-2.5 text-sm font-medium rounded-lg text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {submitting ? 'Running...' : 'Run Assessment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Running View ──────────────────────────────────────────────────────────
function RunningView({ id, onComplete }: {
  id: string;
  onComplete: (a: Assessment) => void;
}) {
  const [stage, setStage] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stages = [
    { label: 'Connecting to ERP', icon: '🔌' },
    { label: 'Collecting volume data', icon: '📦' },
    { label: 'Scoring catalysts', icon: '🧮' },
    { label: 'Generating reports', icon: '📄' },
    { label: 'Complete', icon: '✅' },
  ];

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const data = await api.assessments.status(id);
        if (!mounted) return;

        if (data.status === 'complete') {
          setStage(4);
          if (pollRef.current) clearInterval(pollRef.current);
          // Fetch full results
          const full = await api.assessments.get(id);
          if (mounted) onComplete(full);
        } else if (data.status === 'failed') {
          setStage(-1);
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          // Increment stage based on time elapsed
          setStage(prev => Math.min(prev + 1, 3));
        }
      } catch {
        // Continue polling
      }
    };

    pollRef.current = setInterval(poll, 3000);
    // Initial call
    poll();

    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, onComplete]);

  if (stage === -1) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">❌</div>
        <h3 className="text-lg font-medium text-red-600">Assessment Failed</h3>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>An error occurred during processing. Check the logs.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center animate-pulse" style={{ background: 'var(--accent-subtle)' }}>
          <span className="text-2xl">{stages[Math.min(stage, 4)].icon}</span>
        </div>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Running Assessment</h3>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>This may take 30–60 seconds</p>
      </div>

      <div className="space-y-3">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
              i < stage ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30' :
              i === stage ? 'animate-pulse' : ''
            }`} style={i === stage ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : i > stage ? { background: 'var(--bg-secondary)', color: 'var(--text-muted)' } : undefined}>
              {i < stage ? '✓' : i + 1}
            </div>
            <span className="text-sm" style={{ color: i <= stage ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Results View ──────────────────────────────────────────────────────────
function ResultsView({ assessment }: { assessment: Assessment }) {
  const [tab, setTab] = useState<'business' | 'technical'>('business');
  const results = assessment.results as AssessmentResults | null;

  if (!results) {
    return <div className="text-center py-10" style={{ color: 'var(--text-muted)' }}>No results available.</div>;
  }

  const catalysts = results.catalyst_scores || [];
  const sizing = results.technical_sizing;
  const totalSaving = catalysts.reduce((s: number, c: CatalystScore) => s + (c.estimated_annual_saving_zar || 0), 0);
  const avgPriority = catalysts.length > 0 ? (catalysts.reduce((s: number, c: CatalystScore) => s + (c.priority || 0), 0) / catalysts.length).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      {/* Header metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Annual Saving', value: `R ${(totalSaving / 1000).toFixed(0)}k` },
          { label: 'Catalysts Identified', value: catalysts.length.toString() },
          { label: 'Avg Priority', value: avgPriority },
          { label: 'Payback Period', value: sizing ? `${((sizing.total_infra_cost_pm_saas * 12) / Math.max(totalSaving, 1)).toFixed(1)} yrs` : '—' },
        ].map(m => (
          <div key={m.label} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.label}</span>
            <p className="text-xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
        {(['business', 'technical'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'text-white' : ''}`}
            style={tab === t ? { background: 'var(--accent)' } : { color: 'var(--text-secondary)' }}
          >
            {t === 'business' ? 'Business Case' : 'Technical Sizing'}
          </button>
        ))}
      </div>

      {/* Business Case Tab */}
      {tab === 'business' && (
        <div className="space-y-4">
          {/* Catalyst Priority Table */}
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  {['Domain', 'Priority', 'Total Saving', 'Confidence', 'Sub-Catalysts'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                {[...catalysts].sort((a: CatalystScore, b: CatalystScore) => (a.priority || 0) - (b.priority || 0)).map((c: CatalystScore) => (
                  <CatalystRow key={c.catalyst_name} catalyst={c} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Download */}
          <div className="flex gap-2">
            <button
              onClick={() => api.assessments.downloadBusiness(assessment.id)}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{ background: 'var(--accent)' }}
            >
              Download Business Case PDF
            </button>
          </div>
        </div>
      )}

      {/* Technical Sizing Tab */}
      {tab === 'technical' && sizing && (
        <div className="space-y-4">
          {/* Cost comparison */}
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <h3 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Infrastructure Cost Comparison</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)' }}>
                <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>SaaS (Cloudflare)</h4>
                <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>R {sizing.total_infra_cost_pm_saas.toLocaleString()}/mo</p>
                <div className="text-xs mt-2 space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <p>API calls: {sizing.total_monthly_api_calls.toLocaleString()}</p>
                  <p>D1 storage: {sizing.total_db_size_gb.toFixed(2)} GB</p>
                  <p>R2 storage: {sizing.total_storage_gb.toFixed(2)} GB</p>
                  <p>Vectorize queries: {sizing.total_monthly_vector_queries.toLocaleString()}</p>
                  <p>AI tokens: {sizing.total_monthly_llm_tokens.toLocaleString()}</p>
                </div>
              </div>
              <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)' }}>
                <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>On-Premise</h4>
                <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>R {sizing.monthly_licence_revenue.toLocaleString()}/mo revenue</p>
                <div className="text-xs mt-2 space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <p>Infra cost: R {sizing.total_infra_cost_pm_onprem.toLocaleString()}/mo</p>
                  <p>Margin: {sizing.gross_margin_pct_onprem.toFixed(1)}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* Margin */}
          {sizing.gross_margin_pct_saas !== undefined && (
            <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
              <h3 className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Gross Margin (SaaS)</h3>
              <p className="text-2xl font-semibold" style={{ color: sizing.gross_margin_pct_saas >= 50 ? 'var(--color-success, #10b981)' : 'var(--color-warning, #f59e0b)' }}>
                {sizing.gross_margin_pct_saas.toFixed(1)}%
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                (Monthly licence revenue - SaaS infra cost) / Monthly licence revenue
              </p>
            </div>
          )}

          {/* Downloads */}
          <div className="flex gap-2">
            <button
              onClick={() => api.assessments.downloadTechnical(assessment.id)}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{ background: 'var(--accent)' }}
            >
              Download Technical PDF
            </button>
            <button
              onClick={() => api.assessments.downloadExcel(assessment.id)}
              className="px-4 py-2 text-sm font-medium rounded-lg"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
            >
              Download Excel Model
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Catalyst Row (expandable) ─────────────────────────────────────────────
function CatalystRow({ catalyst }: { catalyst: CatalystScore }) {
  const [expanded, setExpanded] = useState(false);
  const c = catalyst;
  const priorityLabel = c.priority <= 1 ? 'critical' : c.priority <= 2 ? 'high' : c.priority <= 3 ? 'medium' : 'low';
  const priorityColor: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
          <span className="mr-1">{expanded ? '▾' : '▸'}</span>
          {c.catalyst_name}
        </td>
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColor[priorityLabel] || priorityColor.low}`}>
            {priorityLabel}
          </span>
        </td>
        <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
          R {(c.estimated_annual_saving_zar / 1000).toFixed(0)}k
        </td>
        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.confidence}</td>
        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.sub_catalysts?.length || 0}</td>
      </tr>
      {expanded && c.sub_catalysts && c.sub_catalysts.length > 0 && (
        <tr>
          <td colSpan={5} className="px-4 py-2" style={{ background: 'var(--bg-secondary)' }}>
            <div className="space-y-1.5">
              {c.sub_catalysts.map((sc: SubCatalystScore, i: number) => (
                <div key={i} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>{sc.name}</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>R {(sc.estimated_annual_saving_zar / 1000).toFixed(0)}k</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
