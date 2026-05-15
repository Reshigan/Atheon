import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { Assessment, AssessmentResults, CatalystScore, ERPConnection, ValueAssessmentFinding, DataQualityRecord, ProcessTimingRecord, ValueSummaryRecord } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { AssessmentFindingsPanel } from '@/components/AssessmentFindingsPanel';
import { HeroHeader } from '@/components/ui/hero-header';
import { MetricSource, type MetricProvenance } from '@/components/ui/metric-source';
import { ClipboardList } from 'lucide-react';
import { catalystDeployUrl } from '@/lib/catalyst-recommendation';

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
  const toast = useToast();

  const reportError = useCallback((title: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setError(msg);
    toast.error(title, {
      message: msg,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const loadAssessments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.assessments.list();
      setAssessments(data.assessments);
    } catch (err) {
      reportError('Failed to load assessments', err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

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
      reportError('Failed to open assessment', err);
    }
  };

  const deleteAssessment = async (id: string) => {
    if (!confirm('Delete this assessment?')) return;
    try {
      await api.assessments.delete(id);
      toast.success('Assessment deleted');
      loadAssessments();
    } catch (err) {
      reportError('Failed to delete assessment', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <HeroHeader
          icon={ClipboardList}
          title="Assessments"
          subtitle="Pre-Sale Discovery & Business Case Generation"
          accent="sage"
        />
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
          onError={(msg) => { setError(msg); toast.error('Assessment error', msg); }}
          reportError={reportError}
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
                          onClick={() => api.assessments.downloadBusiness(a.id, a)}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => api.assessments.downloadExcel(a.id, a)}
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
function NewAssessmentWizard({ onCreated, onError, reportError }: {
  onCreated: (id: string) => void;
  onError: (err: string) => void;
  reportError: (title: string, err: unknown) => void;
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
    }).catch((err) => {
      console.error('Failed to load default assessment config', err);
      // Non-critical - system can operate with default values
    });
    // Load ERP connections
    api.erp.connections().then(d => setErpConnections((d.connections || []).map((c: ERPConnection) => ({ id: c.id, erp_type: c.adapterSystem || c.adapterName, company_name: c.name })))).catch((err) => {
      console.error('Failed to load ERP connections', err);
      // Non-critical - ERP connections are optional for assessment
    });
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
      reportError('Failed to start assessment', err);
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
              <option value="">No ERP connection — use estimated data</option>
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
                {erpConnectionId ? erpConnections.find(c => c.id === erpConnectionId)?.company_name || erpConnectionId : 'Estimated data'}
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
              No ERP connection selected. Estimated data will be used for volume estimation.
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
      } catch (err) {
        console.error('Assessment status poll failed', err);
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

// ── Results View (Value Assessment — 7 Sections) ─────────────────────────
function ResultsView({ assessment }: { assessment: Assessment }) {
  const toast = useToast();
  const navigate = useNavigate();
  // 'findings' tab consumes assessment.results.findings (the new
  // assessment-findings engine output); 'value' is the older value-assessment
  // table; 'legacy' is the original catalyst-score sizing view.
  const [tab, setTab] = useState<'findings' | 'value' | 'legacy'>(() => {
    const r = assessment.results as AssessmentResults | null;
    return (r?.findings && r.findings.length > 0) ? 'findings' : 'value';
  });
  const [findings, setFindings] = useState<ValueAssessmentFinding[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQualityRecord[]>([]);
  const [processTiming, setProcessTiming] = useState<ProcessTimingRecord[]>([]);
  const [valueSummary, setValueSummary] = useState<ValueSummaryRecord | null>(null);
  const [loadingVA, setLoadingVA] = useState(true);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [findingFilter, setFindingFilter] = useState<{ category?: string; severity?: string; domain?: string }>({});
  const [feePercent, setFeePercent] = useState(20);
  const [runningVA, setRunningVA] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const results = assessment.results as AssessmentResults | null;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Load value assessment data
  useEffect(() => {
    const loadVA = async () => {
      setLoadingVA(true);
      try {
        const [fRes, dqRes, ptRes, vsRes] = await Promise.all([
          api.assessments.findings(assessment.id).catch(() => ({ findings: [], total: 0 })),
          api.assessments.dataQuality(assessment.id).catch(() => ({ dataQuality: [], total: 0 })),
          api.assessments.processTiming(assessment.id).catch(() => ({ processTiming: [], total: 0 })),
          api.assessments.valueSummary(assessment.id).catch(() => null),
        ]);
        setFindings(fRes.findings);
        setDataQuality(dqRes.dataQuality);
        setProcessTiming(ptRes.processTiming);
        setValueSummary(vsRes);
        if (vsRes?.outcome_based_fee_pct) setFeePercent(vsRes.outcome_based_fee_pct);
      } catch (err) {
        console.error('Failed to load value assessment data:', err);
      } finally {
        setLoadingVA(false);
      }
    };
    loadVA();
  }, [assessment.id]);

  // Run value assessment
  const runVA = async (mode: 'full' | 'quick') => {
    setRunningVA(true);
    try {
      await api.assessments.runValueAssessment(assessment.id, mode);
      // Poll until complete
      pollRef.current = setInterval(async () => {
        const status = await api.assessments.status(assessment.id);
        if (status.status === 'complete' || status.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRunningVA(false);
          if (status.status === 'failed') {
            toast.error('Value assessment failed', 'The assessment engine reported an error.');
            return;
          }
          toast.success('Value assessment complete');
          // Reload data
          const [fRes, dqRes, ptRes, vsRes] = await Promise.all([
            api.assessments.findings(assessment.id).catch(() => ({ findings: [], total: 0 })),
            api.assessments.dataQuality(assessment.id).catch(() => ({ dataQuality: [], total: 0 })),
            api.assessments.processTiming(assessment.id).catch(() => ({ processTiming: [], total: 0 })),
            api.assessments.valueSummary(assessment.id).catch(() => null),
          ]);
          setFindings(fRes.findings);
          setDataQuality(dqRes.dataQuality);
          setProcessTiming(ptRes.processTiming);
          setValueSummary(vsRes);
        }
      }, 3000);
    } catch (err) {
      console.error('Failed to run value assessment:', err);
      toast.error('Failed to run value assessment', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
      setRunningVA(false);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // Filtered findings
  const filteredFindings = findings.filter(f => {
    if (findingFilter.category && f.category !== findingFilter.category) return false;
    if (findingFilter.severity && f.severity !== findingFilter.severity) return false;
    if (findingFilter.domain && f.domain !== findingFilter.domain) return false;
    return true;
  });

  const hasValueData = valueSummary !== null || findings.length > 0;

  // If assessment failed
  if (assessment.status === 'failed') {
    const errorMsg = (results as Record<string, unknown>)?.error as string;
    return (
      <div className="text-center py-10">
        <p className="text-lg font-medium text-red-600">Assessment Failed</p>
        {errorMsg && <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>{errorMsg}</p>}
      </div>
    );
  }

  const formatR = (n: number) => `R ${Math.round(n).toLocaleString('en-ZA')}`;
  const formatRk = (n: number) => n >= 1000000 ? `R ${(n / 1000000).toFixed(1)}M` : `R ${Math.round(n / 1000)}k`;

  // Compute domain chart data from value summary
  const domainData = valueSummary?.value_by_domain
    ? Object.entries(valueSummary.value_by_domain).map(([domain, val]) => ({
        domain, immediate: (val as { immediate: number }).immediate || 0, ongoing: ((val as { ongoing: number }).ongoing || 0) * 12,
      })).sort((a, b) => (b.immediate + b.ongoing) - (a.immediate + a.ongoing))
    : [];
  const maxDomainValue = Math.max(...domainData.map(d => d.immediate + d.ongoing), 1);

  return (
    <div className="space-y-6">
      {/* Tab selector */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
        {[
          { key: 'findings' as const, label: 'Findings', count: results?.findings?.length || 0 },
          { key: 'value' as const, label: 'Value Assessment', count: 0 },
          { key: 'legacy' as const, label: 'Legacy Sizing', count: 0 },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t.key ? 'text-white' : ''}`}
            style={tab === t.key ? { background: 'var(--accent)' } : { color: 'var(--text-secondary)' }}
            data-testid={`assessment-tab-${t.key}`}
          >
            {t.label}{t.count > 0 ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {tab === 'findings' && (
        <AssessmentFindingsPanel
          findings={results?.findings || []}
          summary={results?.findings_summary}
          findingsByCompany={results?.findings_by_company}
          companyProfile={results?.company_profile}
          onDeployCatalyst={(catalyst, subCatalyst) =>
            navigate(catalystDeployUrl({ catalyst, subCatalyst }))
          }
        />
      )}

      {tab === 'value' && (
        <div className="space-y-6">
          {/* Run Value Assessment button if no data */}
          {!hasValueData && !loadingVA && (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
              <div className="text-4xl mb-3">📊</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Run Value Assessment</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Analyse the prospect&apos;s ERP data to discover specific issues, quantify financial impact, and generate an outcome-based pricing proposal.
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => runVA('quick')} disabled={runningVA}
                  className="px-4 py-2 text-sm font-medium rounded-lg"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                >{runningVA ? 'Running...' : 'Quick (DQ + Timing)'}</button>
                <button onClick={() => runVA('full')} disabled={runningVA}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white"
                  style={{ background: 'var(--accent)' }}
                >{runningVA ? 'Running...' : 'Full Assessment'}</button>
              </div>
            </div>
          )}

          {loadingVA && <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--bg-secondary)' }} />)}</div>}

          {runningVA && (
            <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center animate-pulse" style={{ background: 'var(--accent-subtle)' }}>
                <span className="text-xl">🔍</span>
              </div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Value Assessment Running...</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Auditing data quality, measuring processes, running reconciliations...</p>
            </div>
          )}

          {hasValueData && !loadingVA && valueSummary && (
            <>
              {/* Section 1: Headline Numbers — these tiles ARE the business
                  case. Every Rand claimed is a billing artefact under the
                  shared-savings model, so source-of-measure is mandatory. */}
              {(() => {
                const assessmentBase: Partial<MetricProvenance> = {
                  endpoint: `GET /api/assessments/${assessment.id}`,
                  refreshedAt: assessment.createdAt,
                  window: `Assessment run ${assessment.createdAt}`,
                };
                const tiles: Array<{ label: string; value: string; sub: string; color: string; source: MetricProvenance }> = [
                  {
                    label: 'Total Issues Found',
                    value: valueSummary.total_findings.toString(),
                    sub: `${valueSummary.total_critical_findings} critical`,
                    color: 'var(--text-primary)',
                    source: {
                      ...assessmentBase,
                      label: 'Total findings',
                      definition: 'Distinct discrepancies, data-quality issues, and process delays discovered by the value-assessment engine on this run.',
                      table: 'assessment_findings',
                      query: 'COUNT(*) FROM assessment_findings WHERE assessment_id = ?',
                      sample: valueSummary.total_findings,
                      notes: [{ label: 'Critical', value: `${valueSummary.total_critical_findings} (severity = critical)` }],
                    },
                  },
                  {
                    label: 'Immediate Recovery',
                    value: formatRk(valueSummary.total_immediate_value),
                    sub: 'One-time cleanup value',
                    color: '#10b981',
                    source: {
                      ...assessmentBase,
                      label: 'Immediate recovery value (ZAR)',
                      definition: 'Sum of one-time financial recovery across every finding — money already at stake in the ERP that can be recovered immediately on remediation.',
                      table: 'assessment_findings',
                      query: 'SUM(immediate_value) FROM assessment_findings WHERE assessment_id = ?',
                      notes: [
                        { label: 'Currency', value: 'ZAR' },
                        { label: 'Trace', value: 'every Rand → assessment_findings.evidence.sample_records → ERP refs' },
                      ],
                    },
                  },
                  {
                    label: 'Ongoing Monthly Value',
                    value: formatRk(valueSummary.total_ongoing_monthly_value),
                    sub: `${formatRk(valueSummary.total_ongoing_annual_value)}/year`,
                    color: '#3b82f6',
                    source: {
                      ...assessmentBase,
                      label: 'Ongoing monthly value (ZAR)',
                      definition: 'Recurring monthly savings the value-assessment engine projects after the findings are remediated and Atheon catalysts run continuously.',
                      table: 'assessment_findings',
                      query: 'SUM(ongoing_monthly_value) FROM assessment_findings WHERE assessment_id = ?',
                      notes: [
                        { label: 'Annualised', value: formatRk(valueSummary.total_ongoing_annual_value) },
                        { label: 'Currency', value: 'ZAR' },
                      ],
                    },
                  },
                  {
                    label: 'Payback Period',
                    value: `${valueSummary.payback_days} days`,
                    sub: `Outcome fee: ${formatRk(valueSummary.outcome_based_monthly_fee)}/mo`,
                    color: '#8b5cf6',
                    source: {
                      ...assessmentBase,
                      label: 'Payback period',
                      definition: 'Number of days before cumulative customer savings exceed the cumulative outcome-based Atheon fee. This is the no-brainer purchase metric.',
                      query: '(outcome_based_monthly_fee × 30) / total_immediate_value ≈ break-even days',
                      notes: [
                        { label: 'Outcome fee', value: `${formatRk(valueSummary.outcome_based_monthly_fee)}/mo` },
                        { label: 'Fee %', value: `${valueSummary.outcome_based_fee_pct}%` },
                      ],
                    },
                  },
                ];
                return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {tiles.map(m => (
                  <div key={m.label} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.label}</span>
                      <MetricSource source={m.source} />
                    </div>
                    <p className="text-xl font-bold mt-1" style={{ color: m.color }}>{m.value}</p>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.sub}</span>
                  </div>
                ))}
              </div>
                );
              })()}

              {/* Section 2: Executive Narrative */}
              {valueSummary.executive_narrative && (
                <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                  <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Executive Summary</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{valueSummary.executive_narrative}</p>
                </div>
              )}

              {/* Section 3: Value by Domain */}
              {domainData.length > 0 && (
                <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Value by Domain</h3>
                  <div className="space-y-3">
                    {domainData.map(d => (
                      <div key={d.domain}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="capitalize font-medium" style={{ color: 'var(--text-primary)' }}>{d.domain}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{formatRk(d.immediate + d.ongoing)}</span>
                        </div>
                        <div className="flex gap-0.5 h-5 rounded overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                          <div className="h-full rounded-l" style={{ width: `${(d.immediate / maxDomainValue) * 100}%`, background: '#10b981', minWidth: d.immediate > 0 ? '4px' : '0' }} />
                          <div className="h-full rounded-r" style={{ width: `${(d.ongoing / maxDomainValue) * 100}%`, background: '#3b82f6', minWidth: d.ongoing > 0 ? '4px' : '0' }} />
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-4 text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#10b981' }} /> Immediate</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#3b82f6' }} /> Ongoing (annual)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 4: Findings Explorer */}
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-card)' }}>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Findings Explorer ({filteredFindings.length})</h3>
                  <div className="flex gap-2">
                    <select className="text-xs rounded px-2 py-1" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
                      value={findingFilter.severity || ''} onChange={e => setFindingFilter(p => ({ ...p, severity: e.target.value || undefined }))}>
                      <option value="">All severities</option>
                      {['critical','high','medium','low'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select className="text-xs rounded px-2 py-1" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
                      value={findingFilter.domain || ''} onChange={e => setFindingFilter(p => ({ ...p, domain: e.target.value || undefined }))}>
                      <option value="">All domains</option>
                      {[...new Set(findings.map(f => f.domain))].map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                  {filteredFindings.slice(0, 20).map(f => (
                    <div key={f.id}>
                      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        onClick={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}>
                        <span className="text-xs">{expandedFinding === f.id ? '▾' : '▸'}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          f.severity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          f.severity === 'high' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          f.severity === 'medium' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                          'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>{f.severity}</span>
                        <span className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{f.title}</span>
                        <span className="text-xs capitalize px-2 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{f.domain}</span>
                        <span className="text-sm font-semibold" style={{ color: '#10b981' }}>{formatRk(f.financial_impact)}</span>
                      </div>
                      {expandedFinding === f.id && (
                        <div className="px-4 pb-3 pt-0 ml-6 space-y-2" style={{ borderTop: '1px solid var(--border-card)' }}>
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{f.description}</p>
                          {f.root_cause && (
                            <div className="text-xs"><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Root Cause: </span><span style={{ color: 'var(--text-secondary)' }}>{f.root_cause}</span></div>
                          )}
                          {f.prescription && (
                            <div className="text-xs"><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Prescription: </span><span style={{ color: 'var(--text-secondary)' }}>{f.prescription}</span></div>
                          )}
                          {f.evidence?.sample_records && f.evidence.sample_records.length > 0 && (
                            <div className="mt-2">
                              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Evidence:</span>
                              <div className="mt-1 rounded overflow-hidden text-xs" style={{ border: '1px solid var(--border-card)' }}>
                                <table className="w-full">
                                  <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                    <th className="px-2 py-1 text-left" style={{ color: 'var(--text-muted)' }}>Reference</th>
                                    <th className="px-2 py-1 text-left" style={{ color: 'var(--text-muted)' }}>Source</th>
                                    <th className="px-2 py-1 text-left" style={{ color: 'var(--text-muted)' }}>Target</th>
                                    <th className="px-2 py-1 text-right" style={{ color: 'var(--text-muted)' }}>Difference</th>
                                  </tr></thead>
                                  <tbody>{f.evidence.sample_records.slice(0, 5).map((r, i) => (
                                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border-card)' }}>
                                      <td className="px-2 py-1 font-medium" style={{ color: 'var(--text-primary)' }}>{String(r.ref)}</td>
                                      <td className="px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{String(r.source_value)}</td>
                                      <td className="px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{String(r.target_value)}</td>
                                      <td className="px-2 py-1 text-right font-medium" style={{ color: r.difference > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{r.difference > 0 ? formatR(r.difference) : '—'}</td>
                                    </tr>
                                  ))}</tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          <div className="flex gap-4 text-xs mt-1">
                            <span style={{ color: 'var(--text-muted)' }}>Immediate: <span className="font-medium" style={{ color: '#10b981' }}>{formatRk(f.immediate_value)}</span></span>
                            <span style={{ color: 'var(--text-muted)' }}>Ongoing: <span className="font-medium" style={{ color: '#3b82f6' }}>{formatRk(f.ongoing_monthly_value)}/mo</span></span>
                            <span style={{ color: 'var(--text-muted)' }}>Records: {f.affected_records}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredFindings.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No findings match the current filters.</div>
                  )}
                </div>
              </div>

              {/* Section 5: Data Quality Report Card */}
              {dataQuality.length > 0 && (
                <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Data Quality Report Card</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {dataQuality.map(dq => {
                      const scoreColor = dq.overall_quality_score >= 80 ? '#10b981' : dq.overall_quality_score >= 60 ? '#f59e0b' : '#ef4444';
                      return (
                        <div key={dq.id} className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{dq.table_name.replace('erp_', '').replace(/_/g, ' ')}</span>
                            <span className="text-lg font-bold" style={{ color: scoreColor }}>{Math.round(dq.overall_quality_score)}%</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bg-card)' }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${dq.overall_quality_score}%`, background: scoreColor }} />
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span>{dq.total_records.toLocaleString()} records</span>
                            <span>{dq.completeness_pct.toFixed(0)}% complete</span>
                            <span>{dq.duplicate_records} duplicates</span>
                            <span>{dq.orphan_records} orphans</span>
                            <span>{dq.stale_records} stale</span>
                            <span>{dq.referential_issues} ref issues</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 6: Process Timing */}
              {processTiming.length > 0 && (
                <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Process Timing Analysis</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {processTiming.map(t => {
                      const overBenchmark = t.avg_cycle_time_days > t.benchmark_cycle_time_days;
                      const maxTime = Math.max(t.p90_cycle_time_days, t.benchmark_cycle_time_days) * 1.2;
                      return (
                        <div key={t.id} className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.process_name}</span>
                            {overBenchmark && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Over benchmark</span>}
                          </div>
                          <div className="space-y-2 mt-3">
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span style={{ color: 'var(--text-muted)' }}>Your avg: {t.avg_cycle_time_days.toFixed(1)} days</span>
                                <span style={{ color: 'var(--text-muted)' }}>P90: {t.p90_cycle_time_days.toFixed(1)} days</span>
                              </div>
                              <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                                <div className="h-full rounded-full" style={{ width: `${(t.avg_cycle_time_days / maxTime) * 100}%`, background: overBenchmark ? '#ef4444' : '#10b981' }} />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span style={{ color: 'var(--text-muted)' }}>Benchmark: {t.benchmark_cycle_time_days} days</span>
                              </div>
                              <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                                <div className="h-full rounded-full" style={{ width: `${(t.benchmark_cycle_time_days / maxTime) * 100}%`, background: '#6b7280' }} />
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {t.records_analysed} records | {t.records_exceeding_benchmark} over benchmark
                            {t.financial_impact_of_delay > 0 && <span className="ml-2 font-medium" style={{ color: '#ef4444' }}>Impact: {formatRk(t.financial_impact_of_delay)}</span>}
                          </div>
                          {t.bottleneck_step && (
                            <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Bottleneck: {t.bottleneck_step} ({t.bottleneck_avg_days.toFixed(1)} days)</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 7: Outcome-Based Pricing */}
              <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Outcome-Based Pricing Proposal</h3>
                <div className="mb-4">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Fee as % of ongoing value delivered</label>
                  <div className="flex items-center gap-3 mt-1">
                    <input type="range" min={5} max={50} step={1} value={feePercent} onChange={e => setFeePercent(Number(e.target.value))} className="flex-1" />
                    <span className="text-lg font-bold" style={{ color: 'var(--accent)' }}>{feePercent}%</span>
                  </div>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-card)' }}>
                  <table className="w-full text-sm">
                    <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                      <th className="px-4 py-2 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Metric</th>
                      <th className="px-4 py-2 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Year 1</th>
                      <th className="px-4 py-2 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Year 2</th>
                      <th className="px-4 py-2 text-right text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Year 3</th>
                    </tr></thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                      {(() => {
                        const monthlyOngoing = valueSummary.total_ongoing_monthly_value;
                        const immediate = valueSummary.total_immediate_value;
                        const fee = feePercent / 100;
                        const y1Value = immediate + monthlyOngoing * 12;
                        const y2Value = monthlyOngoing * 12 * 1.1;
                        const y3Value = monthlyOngoing * 12 * 1.2;
                        return [
                          { label: 'Value Delivered', y1: formatRk(y1Value), y2: formatRk(y2Value), y3: formatRk(y3Value) },
                          { label: 'Atheon Fee', y1: formatRk(monthlyOngoing * 12 * fee), y2: formatRk(monthlyOngoing * 12 * 1.1 * fee), y3: formatRk(monthlyOngoing * 12 * 1.2 * fee) },
                          { label: 'Monthly Fee', y1: formatRk(monthlyOngoing * fee), y2: formatRk(monthlyOngoing * 1.1 * fee), y3: formatRk(monthlyOngoing * 1.2 * fee) },
                          { label: 'Net Value to Client', y1: formatRk(y1Value - monthlyOngoing * 12 * fee), y2: formatRk(y2Value * (1 - fee)), y3: formatRk(y3Value * (1 - fee)) },
                        ].map(row => (
                          <tr key={row.label}>
                            <td className="px-4 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{row.label}</td>
                            <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{row.y1}</td>
                            <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{row.y2}</td>
                            <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{row.y3}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Download buttons */}
              <div className="flex gap-2">
                <button onClick={() => api.assessments.downloadValueReport(assessment.id, assessment, findings, dataQuality, processTiming, valueSummary)}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white" style={{ background: 'var(--accent)' }}
                >Download Value Assessment Report</button>
                <button onClick={() => api.assessments.downloadBusiness(assessment.id, assessment)}
                  className="px-4 py-2 text-sm font-medium rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
                >Business Case PDF</button>
                <button onClick={() => api.assessments.downloadExcel(assessment.id, assessment)}
                  className="px-4 py-2 text-sm font-medium rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
                >Excel Model</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Legacy Sizing Tab (preserved for backward compatibility) */}
      {tab === 'legacy' && (
        <LegacySizingView assessment={assessment} />
      )}
    </div>
  );
}

// ── Legacy Sizing View (backward compat) ─────────────────────────────────
function LegacySizingView({ assessment }: { assessment: Assessment }) {
  const results = assessment.results as AssessmentResults | null;
  const catalysts = results?.catalyst_scores || [];
  const sizing = results?.technical_sizing;
  const totalSaving = catalysts.reduce((s: number, c: CatalystScore) => s + (c.estimated_annual_saving_zar || 0), 0);

  if (!results || catalysts.length === 0) {
    return <div className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>No legacy sizing data available.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: 'Total Annual Saving', value: `R ${(totalSaving / 1000).toFixed(0)}k` },
          { label: 'Catalysts', value: catalysts.length.toString() },
          { label: 'Payback', value: sizing ? `${((sizing.total_infra_cost_pm_saas * 12) / Math.max(totalSaving, 1)).toFixed(1)} yrs` : '—' },
        ].map(m => (
          <div key={m.label} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.label}</span>
            <p className="text-xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{m.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <table className="w-full text-sm">
          <thead><tr style={{ background: 'var(--bg-secondary)' }}>
            {['Domain', 'Priority', 'Saving', 'Confidence'].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
            {[...catalysts].sort((a, b) => (a.priority || 0) - (b.priority || 0)).map(c => (
              <tr key={c.catalyst_name}>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{c.catalyst_name}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.priority}</td>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>R {(c.estimated_annual_saving_zar / 1000).toFixed(0)}k</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button onClick={() => api.assessments.downloadBusiness(assessment.id, assessment)}
          className="px-4 py-2 text-sm font-medium rounded-lg text-white" style={{ background: 'var(--accent)' }}>Business Case PDF</button>
        {assessment.technicalReportKey && (
          <button onClick={() => api.assessments.downloadTechnical(assessment.id)}
            className="px-4 py-2 text-sm font-medium rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}>Technical PDF</button>
        )}
        <button onClick={() => api.assessments.downloadExcel(assessment.id, assessment)}
          className="px-4 py-2 text-sm font-medium rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}>Excel Model</button>
      </div>
    </div>
  );
}
