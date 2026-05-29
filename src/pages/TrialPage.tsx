/**
 * §11.1 Trial Assessment Page — Public route (no auth required)
 * Multi-step wizard: Company Info → Upload CSV → Processing → Results
 */
import { useState } from 'react';
import { api } from '@/lib/api';
import type { TrialResultsResponse } from '@/lib/api';
import { Upload, CheckCircle2, AlertTriangle, ArrowRight, Loader2, Shield, BarChart3, TrendingUp, FileText } from 'lucide-react';

type Step = 'info' | 'upload' | 'processing' | 'results';

const INDUSTRIES = ['fmcg', 'healthcare', 'mining', 'agriculture', 'logistics', 'technology', 'manufacturing', 'retail', 'general'];

export function TrialPage() {
  const [step, setStep] = useState<Step>('info');
  const [trialId, setTrialId] = useState<string | null>(null);
  const [results, setResults] = useState<TrialResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('general');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const handleStart = async () => {
    if (!companyName || !contactName || !contactEmail) {
      setError('Please fill in all required fields');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.trial.start({ company_name: companyName, industry, contact_name: contactName, contact_email: contactEmail });
      setTrialId(res.id);
      setStep('upload');
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const handleUpload = async () => {
    if (!trialId) return;
    setLoading(true);
    setError(null);
    try {
      // Simulate CSV upload metadata (in production this would parse an actual file)
      await api.trial.upload(trialId, { filename: 'trial-data.csv', row_count: 100, columns: ['date', 'amount', 'category', 'status'] });
      await api.trial.run(trialId);
      setStep('processing');
      // Poll for completion
      pollStatus(trialId);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const pollStatus = async (id: string) => {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const status = await api.trial.status(id);
        if (status.status === 'complete') {
          const res = await api.trial.results(id);
          setResults(res);
          setStep('results');
          setLoading(false);
          return;
        }
        if (status.status === 'failed') {
          setError('Assessment processing failed. Please try again.');
          setLoading(false);
          return;
        }
      } catch {
        // continue polling
      }
    }
    setError('Assessment timed out. Please check back later.');
    setLoading(false);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="border-b px-6 py-4" style={{ borderColor: 'var(--border-card)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={24} className="text-accent" />
            <span className="text-lg font-bold t-primary">Atheon</span>
            <span className="text-xs t-muted border-l pl-3 ml-1" style={{ borderColor: 'var(--border-card)' }}>Free Trial Assessment</span>
          </div>
          <a href="/" className="text-xs t-muted hover:t-primary transition-colors">← Back to Home</a>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-12">
          {(['info', 'upload', 'processing', 'results'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
                step === s ? 'bg-accent text-[var(--text-on-accent)]' :
                (['info', 'upload', 'processing', 'results'].indexOf(step) > i) ? 'text-accent' :
                't-muted'
              }`} style={
                step !== s && (['info', 'upload', 'processing', 'results'].indexOf(step) > i)
                  ? { background: `rgb(var(--accent-rgb) / 0.12)` }
                  : step !== s
                  ? { background: 'var(--bg-secondary)' }
                  : undefined
              }>
                {(['info', 'upload', 'processing', 'results'].indexOf(step) > i) ? '✓' : i + 1}
              </div>
              {i < 3 && <div className="w-12 h-0.5" style={{
                background: (['info', 'upload', 'processing', 'results'].indexOf(step) > i)
                  ? `rgb(var(--accent-rgb) / 0.35)`
                  : 'var(--divider)'
              }} />}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-sm border text-sm flex items-center gap-2" style={{ background: `rgb(var(--neg-rgb) / 0.07)`, borderColor: `rgb(var(--neg-rgb) / 0.25)` }}>
            <AlertTriangle size={14} style={{ color: 'var(--neg)' }} />
            <span style={{ color: 'var(--neg)' }}>{error}</span>
          </div>
        )}

        {/* Step 1: Company Information */}
        {step === 'info' && (
          <div className="space-y-8">
            <div className="text-center">
              <h1 className="text-3xl font-bold t-primary mb-2">Discover Your Organisation's Health</h1>
              <p className="t-secondary max-w-lg mx-auto">Get a free assessment of your operational health with actionable insights. No commitment required — results in minutes.</p>
            </div>

            <div className="max-w-md mx-auto space-y-4">
              <div>
                <label className="block text-xs font-medium t-muted mb-1">Company Name *</label>
                <input
                  type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                  placeholder="Acme Corporation"
                />
              </div>
              <div>
                <label className="block text-xs font-medium t-muted mb-1">Industry *</label>
                <select
                  value={industry} onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                >
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind} style={{ background: 'var(--bg-card-solid)' }}>{ind.charAt(0).toUpperCase() + ind.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium t-muted mb-1">Your Name *</label>
                <input
                  type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="block text-xs font-medium t-muted mb-1">Email Address *</label>
                <input
                  type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none transition-colors"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                  placeholder="john@acme.co.za"
                />
              </div>

              <button
                onClick={handleStart}
                disabled={loading}
                className="w-full py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97]"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {loading ? 'Starting...' : 'Start Free Assessment'}
              </button>

              <p className="text-caption t-muted text-center">
                Your data is encrypted and automatically deleted after 7 days. No payment information required.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Upload Data */}
        {step === 'upload' && (
          <div className="space-y-8 text-center">
            <div>
              <h2 className="text-2xl font-bold t-primary mb-2">Upload Your Data</h2>
              <p className="t-secondary">Upload a CSV file with your transactional or operational data for analysis.</p>
            </div>

            <div className="max-w-md mx-auto">
              <div
                className="border-2 border-dashed rounded-sm p-12 cursor-pointer active:scale-[0.97] transition-colors"
                style={{ borderColor: 'var(--border-card)' }}
                onClick={handleUpload}
              >
                <Upload size={40} className="mx-auto mb-4 t-muted" />
                <p className="text-sm t-primary font-medium mb-1">Click to upload CSV</p>
                <p className="text-xs t-muted">Or drag and drop your file here</p>
              </div>

              <button
                onClick={handleUpload}
                disabled={loading}
                className="mt-6 w-full py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97]"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
                {loading ? 'Processing...' : 'Run Assessment'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Processing */}
        {step === 'processing' && (
          <div className="space-y-8 text-center">
            <div>
              <h2 className="text-2xl font-bold t-primary mb-2">Analysing Your Data</h2>
              <p className="t-secondary">Our AI engine is processing your data. This typically takes 1-3 minutes.</p>
            </div>

            <div className="max-w-sm mx-auto">
              <Loader2 size={48} className="mx-auto mb-6 text-accent animate-spin" />
              <div className="space-y-3">
                {['Ingesting data', 'Running health check', 'Identifying risks', 'Calculating ROI potential', 'Generating report'].map((label, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${i < 2 ? 'text-accent' : 't-muted'}`}
                      style={{ background: i < 2 ? `rgb(var(--accent-rgb) / 0.12)` : 'var(--bg-secondary)' }}>
                      {i < 2 ? <CheckCircle2 size={12} /> : <span className="text-caption">{i + 1}</span>}
                    </div>
                    <span className={i < 2 ? 't-primary' : 't-muted'}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 'results' && results && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold t-primary mb-2">Your Assessment Results</h2>
              <p className="t-secondary">{results.companyName} — {results.industry.charAt(0).toUpperCase() + results.industry.slice(1)}</p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-sm p-6 border text-center" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}>
                <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: `rgb(var(--accent-rgb) / 0.12)` }}>
                  <span className="text-2xl font-bold font-mono tnum text-accent">{results.healthScore ?? '—'}</span>
                </div>
                <p className="text-xs t-muted">Health Score</p>
              </div>
              <div className="rounded-sm p-6 border text-center" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}>
                <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: `rgb(var(--warning-rgb) / 0.10)` }}>
                  <span className="text-2xl font-bold font-mono tnum" style={{ color: 'var(--warning)' }}>{results.issuesFound ?? 0}</span>
                </div>
                <p className="text-xs t-muted">Issues Found</p>
              </div>
              <div className="rounded-sm p-6 border text-center" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}>
                <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: `rgb(var(--accent-rgb) / 0.12)` }}>
                  <TrendingUp size={24} className="text-accent" />
                </div>
                <p className="text-lg font-bold font-mono tnum text-accent">
                  {results.projectedRoi ? `${results.projectedRoi.toFixed(1)}x` : '—'}
                </p>
                <p className="text-xs t-muted">Projected ROI</p>
              </div>
            </div>

            {/* Risks & Opportunities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.topRisks.length > 0 && (
                <div className="rounded-sm p-5 border" style={{ background: `rgb(var(--neg-rgb) / 0.05)`, borderColor: `rgb(var(--neg-rgb) / 0.18)` }}>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--neg)' }}>
                    <AlertTriangle size={14} /> Top Risks
                  </h3>
                  <ul className="space-y-2">
                    {results.topRisks.map((risk, i) => (
                      <li key={i} className="text-xs t-secondary flex items-start gap-2">
                        <span className="mt-0.5" style={{ color: 'var(--neg)' }}>•</span>
                        <div>
                          <span className="font-medium t-primary">{risk.title}</span>
                          <span className="t-muted"> — {risk.description}</span>
                          {risk.impact > 0 && <span className="font-mono tnum ml-1" style={{ color: 'var(--neg)' }}>(R{risk.impact.toLocaleString()})</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {results.topOpportunities.length > 0 && (
                <div className="rounded-sm p-5 border" style={{ background: `rgb(var(--accent-rgb) / 0.05)`, borderColor: `rgb(var(--accent-rgb) / 0.18)` }}>
                  <h3 className="text-sm font-semibold text-accent mb-3 flex items-center gap-2">
                    <TrendingUp size={14} /> Top Opportunities
                  </h3>
                  <ul className="space-y-2">
                    {results.topOpportunities.map((opp, i) => (
                      <li key={i} className="text-xs t-secondary flex items-start gap-2">
                        <span className="text-accent mt-0.5">•</span>
                        <div>
                          <span className="font-medium t-primary">{opp.title}</span>
                          <span className="t-muted"> — {opp.description}</span>
                          {opp.value > 0 && <span className="text-accent font-mono tnum ml-1">(R{opp.value.toLocaleString()})</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="text-center space-y-4">
              <button
                onClick={async () => {
                  if (trialId) {
                    try {
                      await api.trial.report(trialId);
                    } catch { /* report generation is best-effort */ }
                  }
                }}
                className="px-6 py-3 rounded-sm border t-primary text-sm hover:t-primary transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] inline-flex items-center gap-2 active:scale-[0.97]"
                style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
              >
                <FileText size={14} />
                Download Full Report
              </button>
              <div>
                <a href="/login" className="inline-flex items-center gap-2 px-8 py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
                  <ArrowRight size={16} />
                  Start Your Full Atheon Journey
                </a>
              </div>
              <p className="text-caption t-muted">This trial data will be automatically deleted in 7 days.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
