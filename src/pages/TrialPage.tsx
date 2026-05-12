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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={24} className="text-[#4A6B5A]" />
            <span className="text-lg font-bold text-white">Atheon</span>
            <span className="text-xs text-gray-400 border-l border-gray-600 pl-3 ml-1">Free Trial Assessment</span>
          </div>
          <a href="/" className="text-xs text-gray-400 hover:text-white transition-colors">← Back to Home</a>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-12">
          {(['info', 'upload', 'processing', 'results'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s ? 'bg-[#4A6B5A] text-white' :
                (['info', 'upload', 'processing', 'results'].indexOf(step) > i) ? 'bg-emerald-500/20 text-emerald-400' :
                'bg-white/5 text-gray-500'
              }`}>
                {(['info', 'upload', 'processing', 'results'].indexOf(step) > i) ? '✓' : i + 1}
              </div>
              {i < 3 && <div className={`w-12 h-0.5 ${(['info', 'upload', 'processing', 'results'].indexOf(step) > i) ? 'bg-emerald-500/40' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Step 1: Company Information */}
        {step === 'info' && (
          <div className="space-y-8">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-white mb-2">Discover Your Organisation's Health</h1>
              <p className="text-gray-400 max-w-lg mx-auto">Get a free assessment of your operational health with actionable insights. No commitment required — results in minutes.</p>
            </div>

            <div className="max-w-md mx-auto space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Company Name *</label>
                <input
                  type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#4A6B5A] transition-colors"
                  placeholder="Acme Corporation"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Industry *</label>
                <select
                  value={industry} onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-[#4A6B5A] transition-colors"
                >
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind} className="bg-slate-800">{ind.charAt(0).toUpperCase() + ind.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Your Name *</label>
                <input
                  type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#4A6B5A] transition-colors"
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Email Address *</label>
                <input
                  type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#4A6B5A] transition-colors"
                  placeholder="john@acme.co.za"
                />
              </div>

              <button
                onClick={handleStart}
                disabled={loading}
                className="w-full py-3 rounded-lg bg-[#4A6B5A] hover:bg-[#5d8a6f] text-white font-medium text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {loading ? 'Starting...' : 'Start Free Assessment'}
              </button>

              <p className="text-caption text-gray-500 text-center">
                Your data is encrypted and automatically deleted after 7 days. No payment information required.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Upload Data */}
        {step === 'upload' && (
          <div className="space-y-8 text-center">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Upload Your Data</h2>
              <p className="text-gray-400">Upload a CSV file with your transactional or operational data for analysis.</p>
            </div>

            <div className="max-w-md mx-auto">
              <div
                className="border-2 border-dashed border-white/20 rounded-xl p-12 hover:border-[#4A6B5A]/50 transition-colors cursor-pointer"
                onClick={handleUpload}
              >
                <Upload size={40} className="mx-auto mb-4 text-gray-400" />
                <p className="text-sm text-white font-medium mb-1">Click to upload CSV</p>
                <p className="text-xs text-gray-500">Or drag and drop your file here</p>
              </div>

              <button
                onClick={handleUpload}
                disabled={loading}
                className="mt-6 w-full py-3 rounded-lg bg-[#4A6B5A] hover:bg-[#5d8a6f] text-white font-medium text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
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
              <h2 className="text-2xl font-bold text-white mb-2">Analysing Your Data</h2>
              <p className="text-gray-400">Our AI engine is processing your data. This typically takes 1-3 minutes.</p>
            </div>

            <div className="max-w-sm mx-auto">
              <Loader2 size={48} className="mx-auto mb-6 text-[#4A6B5A] animate-spin" />
              <div className="space-y-3">
                {['Ingesting data', 'Running health check', 'Identifying risks', 'Calculating ROI potential', 'Generating report'].map((label, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${i < 2 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-500'}`}>
                      {i < 2 ? <CheckCircle2 size={12} /> : <span className="text-caption">{i + 1}</span>}
                    </div>
                    <span className={i < 2 ? 'text-white' : 'text-gray-500'}>{label}</span>
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
              <h2 className="text-2xl font-bold text-white mb-2">Your Assessment Results</h2>
              <p className="text-gray-400">{results.companyName} — {results.industry.charAt(0).toUpperCase() + results.industry.slice(1)}</p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl p-6 bg-white/5 border border-white/10 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-[#4A6B5A]/20 flex items-center justify-center mb-3">
                  <span className="text-2xl font-bold text-[#4A6B5A]">{results.healthScore ?? '—'}</span>
                </div>
                <p className="text-xs text-gray-400">Health Score</p>
              </div>
              <div className="rounded-xl p-6 bg-white/5 border border-white/10 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/20 flex items-center justify-center mb-3">
                  <span className="text-2xl font-bold text-amber-400">{results.issuesFound ?? 0}</span>
                </div>
                <p className="text-xs text-gray-400">Issues Found</p>
              </div>
              <div className="rounded-xl p-6 bg-white/5 border border-white/10 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center mb-3">
                  <TrendingUp size={24} className="text-emerald-400" />
                </div>
                <p className="text-lg font-bold text-emerald-400">
                  {results.projectedRoi ? `${results.projectedRoi.toFixed(1)}x` : '—'}
                </p>
                <p className="text-xs text-gray-400">Projected ROI</p>
              </div>
            </div>

            {/* Risks & Opportunities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.topRisks.length > 0 && (
                <div className="rounded-xl p-5 bg-red-500/5 border border-red-500/15">
                  <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                    <AlertTriangle size={14} /> Top Risks
                  </h3>
                  <ul className="space-y-2">
                    {results.topRisks.map((risk, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">•</span>
                        <div>
                          <span className="font-medium text-gray-200">{risk.title}</span>
                          <span className="text-gray-400"> — {risk.description}</span>
                          {risk.impact > 0 && <span className="text-red-400 ml-1">(R{risk.impact.toLocaleString()})</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {results.topOpportunities.length > 0 && (
                <div className="rounded-xl p-5 bg-emerald-500/5 border border-emerald-500/15">
                  <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                    <TrendingUp size={14} /> Top Opportunities
                  </h3>
                  <ul className="space-y-2">
                    {results.topOpportunities.map((opp, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">•</span>
                        <div>
                          <span className="font-medium text-gray-200">{opp.title}</span>
                          <span className="text-gray-400"> — {opp.description}</span>
                          {opp.value > 0 && <span className="text-emerald-400 ml-1">(R{opp.value.toLocaleString()})</span>}
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
                className="px-6 py-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm hover:bg-white/10 transition-all inline-flex items-center gap-2"
              >
                <FileText size={14} />
                Download Full Report
              </button>
              <div>
                <a href="/login" className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-[#4A6B5A] hover:bg-[#5d8a6f] text-white font-medium text-sm transition-all">
                  <ArrowRight size={16} />
                  Start Your Full Atheon Journey
                </a>
              </div>
              <p className="text-caption text-gray-500">This trial data will be automatically deleted in 7 days.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
