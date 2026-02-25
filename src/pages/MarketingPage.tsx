import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Shield, Brain, Zap, BarChart3,
  Activity, Database, Network, CheckCircle2,
  ChevronRight, Play, Star,
} from "lucide-react";

const layers = [
  { icon: BarChart3, title: 'Apex', subtitle: 'Executive Intelligence', desc: 'Real-time health scoring with AI-generated briefings that distill thousands of data points into action.', color: 'var(--accent)' },
  { icon: Activity, title: 'Pulse', subtitle: 'Process Monitoring', desc: 'Continuous KPI monitoring with intelligent anomaly detection and automated exception alerts.', color: '#059669' },
  { icon: Zap, title: 'Catalysts', subtitle: 'Autonomous Execution', desc: 'AI workers that execute tasks, remediate issues, and optimise processes with full audit trails.', color: '#7c3aed' },
  { icon: Brain, title: 'Mind', subtitle: 'Domain LLM Engine', desc: 'Industry-specific language models with multi-tier inference and intelligent routing.', color: '#0284c7' },
  { icon: Database, title: 'Memory', subtitle: 'Knowledge Layer', desc: 'Vector-powered semantic search across all enterprise documents with persistent context.', color: '#e11d48' },
  { icon: Network, title: 'ERP Integration', subtitle: 'Universal Adapter', desc: 'Pre-built adapters for SAP, Xero, Sage, Pastel and more with canonical API translation.', color: '#f59e0b' },
];

const stats = [
  { value: '6', label: 'Intelligence Layers' },
  { value: '5+', label: 'ERP Adapters' },
  { value: '99.9%', label: 'Uptime SLA' },
  { value: '24/7', label: 'Autonomous Monitoring' },
];

const testimonials = [
  { name: 'Sarah Chen', role: 'CFO, Global Manufacturing', quote: 'Atheon reduced our decision-making time from days to minutes. The executive health scoring alone paid for itself.' },
  { name: 'Marcus van der Berg', role: 'CIO, Retail Group', quote: 'The autonomous catalysts resolved 73% of routine operational issues without human intervention.' },
  { name: 'Priya Naidoo', role: 'COO, Financial Services', quote: 'Six layers working as one. We finally have a single source of truth across all our ERP systems.' },
];

const securityFeatures = [
  'SOC 2 Type II architecture',
  'End-to-end encryption',
  'RBAC & Azure AD SSO',
  'Complete audit trails',
  'Tenant data isolation',
  'PBKDF2 password hashing',
];

export function MarketingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* NAVBAR */}
      <nav className="sticky top-0 z-50" style={{ background: 'var(--bg-header)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-card)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--accent)' }}>Atheon</span>
          <div className="hidden md:flex items-center gap-6 text-xs font-medium t-secondary">
            <a href="#features" className="hover:t-primary transition-colors">Features</a>
            <a href="#how" className="hover:t-primary transition-colors">How It Works</a>
            <a href="#security" className="hover:t-primary transition-colors">Security</a>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/login')} className="text-xs font-medium px-3 py-1.5 rounded-lg t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all">Sign In</button>
            <Button variant="primary" size="sm" onClick={() => navigate('/login')}>Get Started <ArrowRight size={12} /></Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold mb-6" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--border-card)' }}>
            <Zap size={10} /> Enterprise Intelligence Platform
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] t-primary mb-5 tracking-tight">
            Intelligence that<br /><span style={{ color: 'var(--accent)' }}>moves your business</span>
          </h1>
          <p className="text-base lg:text-lg leading-relaxed t-secondary max-w-2xl mx-auto mb-8">
            Six AI layers working as one {'\u2014'} from executive health scoring to autonomous execution. Transform raw ERP data into strategic advantage.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')}>Start Free Trial <ArrowRight size={14} /></Button>
            <Button variant="secondary" size="lg" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}><Play size={12} /> See How It Works</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-16 max-w-3xl mx-auto">
            {stats.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold t-primary">{s.value}</div>
                <div className="text-[10px] mt-0.5 t-muted font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLATFORM LAYERS */}
      <section id="features" className="py-16 lg:py-24" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold t-primary mb-3 tracking-tight">Six layers of intelligence</h2>
            <p className="text-sm t-secondary max-w-lg mx-auto">Each layer works independently and as a unified system {'\u2014'} from data ingestion to autonomous action.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {layers.map((layer) => {
              const Icon = layer.icon;
              return (
                <div key={layer.title} className="rounded-xl p-5 transition-all hover:-translate-y-0.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-4" style={{ background: 'var(--accent-subtle)' }}>
                    <Icon size={16} style={{ color: layer.color }} />
                  </div>
                  <h3 className="text-sm font-semibold t-primary mb-0.5">{layer.title}</h3>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: layer.color }}>{layer.subtitle}</p>
                  <p className="text-xs t-secondary leading-relaxed">{layer.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold t-primary mb-3 tracking-tight">From data to decision in seconds</h2>
            <p className="text-sm t-secondary max-w-lg mx-auto">Four steps. No complex setup. Start seeing results immediately.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: '01', title: 'Connect', desc: 'Plug in your ERP systems through pre-built adapters. SAP, Xero, Sage and more.' },
              { step: '02', title: 'Analyse', desc: 'AI processes transactions, detects anomalies, and scores organisational health.' },
              { step: '03', title: 'Decide', desc: 'Executive briefings surface what matters. AI recommends the best actions.' },
              { step: '04', title: 'Execute', desc: 'Catalysts autonomously execute approved actions with full compliance trails.' },
            ].map(s => (
              <div key={s.step} className="rounded-xl p-5 text-center transition-all hover:-translate-y-0.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                <div className="text-3xl font-bold mb-3" style={{ color: 'var(--accent)', opacity: 0.2 }}>{s.step}</div>
                <h3 className="text-sm font-semibold t-primary mb-1.5">{s.title}</h3>
                <p className="text-xs t-secondary leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-16 lg:py-24" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold t-primary mb-3 tracking-tight">Trusted by industry leaders</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {testimonials.map(t => (
              <div key={t.name} className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                <div className="flex items-center gap-0.5 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={12} fill="var(--accent)" stroke="none" />
                  ))}
                </div>
                <p className="text-xs t-secondary leading-relaxed mb-4">{`\u201C${t.quote}\u201D`}</p>
                <div>
                  <p className="text-xs font-semibold t-primary">{t.name}</p>
                  <p className="text-[10px] t-muted">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section id="security" className="py-16 lg:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="rounded-xl p-8 lg:p-12" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
            <div className="flex flex-col lg:flex-row items-start gap-8">
              <div className="flex-1">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: 'var(--accent-subtle)' }}>
                  <Shield size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold t-primary mb-3 tracking-tight">Enterprise-grade security</h2>
                <p className="text-sm t-secondary leading-relaxed">Every layer is built with zero-trust principles, end-to-end encryption, and comprehensive audit logging.</p>
              </div>
              <div className="flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {securityFeatures.map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} className="flex-shrink-0" />
                      <span className="text-xs font-medium t-secondary">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24" style={{ background: '#09090b' }}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 tracking-tight">Ready to transform your enterprise?</h2>
          <p className="text-sm text-zinc-400 mb-8">Join industry leaders who use Atheon to turn operational data into strategic advantage.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')}>Start Free Trial <ArrowRight size={14} /></Button>
            <button className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium text-zinc-300 transition-all hover:text-white" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
              Contact Sales <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-8" style={{ background: 'var(--bg-primary)', borderTop: '1px solid var(--border-card)' }}>
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--accent)' }}>Atheon</span>
          <div className="flex items-center gap-6 text-xs t-muted">
            <a href="#features" className="hover:t-primary transition-colors">Features</a>
            <a href="#how" className="hover:t-primary transition-colors">How It Works</a>
            <a href="#security" className="hover:t-primary transition-colors">Security</a>
            <span>{`\u00A9 ${new Date().getFullYear()} Atheon`}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
