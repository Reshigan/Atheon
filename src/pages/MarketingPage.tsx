import { useNavigate } from "react-router-dom";
import { AtheonLogoInline } from "@/components/common/Hero3D";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Shield, Brain, Zap, BarChart3,
  Activity, Database, Network, CheckCircle2,
  ChevronRight, Play, Star,
} from "lucide-react";

const SERIF = "Georgia, 'Times New Roman', serif";

const layers = [
  { icon: BarChart3, title: 'Apex', subtitle: 'Executive Intelligence', desc: 'Real-time health scoring with AI-generated briefings that distill thousands of data points into action.', color: '#2a7c8c' },
  { icon: Activity, title: 'Pulse', subtitle: 'Process Monitoring', desc: 'Continuous KPI monitoring with intelligent anomaly detection and automated exception alerts.', color: '#2563eb' },
  { icon: Zap, title: 'Catalysts', subtitle: 'Autonomous Execution', desc: 'AI workers that execute tasks, remediate issues, and optimise processes with full audit trails.', color: '#059669' },
  { icon: Brain, title: 'Mind', subtitle: 'Domain LLM Engine', desc: 'Industry-specific language models with multi-tier inference and intelligent routing.', color: '#7c3aed' },
  { icon: Database, title: 'Memory', subtitle: 'Knowledge Layer', desc: 'Vector-powered semantic search across all enterprise documents with persistent context.', color: '#0284c7' },
  { icon: Network, title: 'ERP Integration', subtitle: 'Universal Adapter', desc: 'Pre-built adapters for SAP, Xero, Sage, Pastel and more with canonical API translation.', color: '#e11d48' },
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
    <div className="min-h-screen" style={{ background: '#e8eff6' }}>

      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl" style={{ background: 'rgba(232, 239, 246, 0.85)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-0.5">
            <AtheonLogoInline className="text-3xl" />
            <span className="text-2xl font-bold" style={{ fontFamily: SERIF, color: '#1a2332' }}>theon</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: '#555' }}>
            <a href="#features" className="hover:text-[#1a1a1a] transition-colors">Features</a>
            <a href="#how" className="hover:text-[#1a1a1a] transition-colors">How It Works</a>
            <a href="#security" className="hover:text-[#1a1a1a] transition-colors">Security</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')} className="text-sm font-medium px-4 py-2 rounded-lg transition-all hover:bg-black/[0.04]" style={{ color: '#1a1a1a' }}>
              Sign In
            </button>
            <Button variant="primary" size="sm" onClick={() => navigate('/login')}>
              Get Started <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-20 pb-24 lg:pt-28 lg:pb-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold mb-8" style={{ background: '#ffffff', color: '#2a7c8c', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <Zap size={12} /> Enterprise Intelligence Platform
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.1] mb-6"          style={{ fontFamily: SERIF, color: '#1a2332' }}>
                      Intelligence that<br />
                      <span style={{ color: '#2a7c8c' }}>moves your business</span>
          </h1>
          <p className="text-lg lg:text-xl leading-relaxed max-w-2xl mx-auto mb-10" style={{ color: '#666' }}>
            Six AI layers working as one — from executive health scoring to autonomous execution. Transform raw ERP data into strategic advantage.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')}>
              Start Free Trial <ArrowRight size={16} />
            </Button>
            <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:shadow-md" style={{ background: '#ffffff', color: '#1a1a1a', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <Play size={14} /> See How It Works
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-20 max-w-3xl mx-auto">
            {stats.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-bold" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>{s.value}</div>
                <div className="text-xs mt-1 font-medium" style={{ color: '#999' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLATFORM LAYERS */}
      <section id="features" className="py-20 lg:py-28"      style={{ background: '#dce6f0' }}>
              <div className="max-w-6xl mx-auto px-6">
                <div className="text-center mb-16">
                  <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a2332' }}>Six layers of intelligence</h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: '#666' }}>Each layer works independently and as a unified system — from data ingestion to autonomous action.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {layers.map((layer) => {
              const Icon = layer.icon;
              return (
                <div key={layer.title} className="rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-lg" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5" style={{ background: `${layer.color}1F` }}>
                    <Icon size={20} style={{ color: layer.color }} />
                  </div>
                  <h3 className="text-lg font-bold mb-0.5" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>{layer.title}</h3>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: layer.color }}>{layer.subtitle}</p>
                  <p className="text-sm leading-relaxed" style={{ color: '#666' }}>{layer.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-20 lg:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>From data to decision in seconds</h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: '#666' }}>Four steps. No complex setup. Start seeing results immediately.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: '01', title: 'Connect', desc: 'Plug in your ERP systems through pre-built adapters. SAP, Xero, Sage and more.' },
              { step: '02', title: 'Analyse', desc: 'AI processes transactions, detects anomalies, and scores organisational health.' },
              { step: '03', title: 'Decide', desc: 'Executive briefings surface what matters. AI recommends the best actions.' },
              { step: '04', title: 'Execute', desc: 'Catalysts autonomously execute approved actions with full compliance trails.' },
            ].map(s => (
              <div key={s.step} className="rounded-2xl p-6 text-center transition-all hover:-translate-y-1" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: 'rgba(42,124,140,0.2)' }}>{s.step}</div>
                <h3 className="text-lg font-bold mb-2" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>{s.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#666' }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-20 lg:py-28"      style={{ background: '#dce6f0' }}>
              <div className="max-w-6xl mx-auto px-6">
                <div className="text-center mb-16">
                  <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a2332' }}>Trusted by industry leaders</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map(t => (
              <div key={t.name} className="rounded-2xl p-6" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={14} fill="#2a7c8c" stroke="none" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed mb-5" style={{ color: '#444' }}>{`\u201C${t.quote}\u201D`}</p>
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{t.name}</p>
                  <p className="text-xs" style={{ color: '#999' }}>{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section id="security" className="py-20 lg:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-3xl p-10 lg:p-16" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div className="flex flex-col lg:flex-row items-start gap-12">
              <div className="flex-1">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"                style={{ background: 'rgba(42,124,140,0.08)' }}>
                                  <Shield size={24} style={{ color: '#2a7c8c' }} />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>Enterprise-grade security</h2>
                <p className="text-base leading-relaxed" style={{ color: '#666' }}>Every layer is built with zero-trust principles, end-to-end encryption, and comprehensive audit logging.</p>
              </div>
              <div className="flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {securityFeatures.map(f => (
                    <div key={f} className="flex items-center gap-3">
                      <CheckCircle2 size={18} style={{ color: '#2a7c8c' }} className="flex-shrink-0" />
                      <span className="text-sm font-medium" style={{ color: '#444' }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28"      style={{ background: '#1a2332' }}>
              <div className="max-w-3xl mx-auto px-6 text-center">
                <h2 className="text-3xl sm:text-4xl font-bold mb-6" style={{ fontFamily: SERIF, color: '#e8ecf0' }}>Ready to transform your enterprise?</h2>
          <p className="text-lg mb-10" style={{ color: '#a0a0b0' }}>Join industry leaders who use Atheon to turn operational data into strategic advantage.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')}>
              Start Free Trial <ArrowRight size={16} />
            </Button>
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-white/[0.1]" style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#f0f0f2' }}>
              Contact Sales <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10" style={{ background: '#e8eff6', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-baseline gap-0.5">
              <AtheonLogoInline className="text-2xl" />
              <span className="text-xl font-bold" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>theon</span>
            </div>
            <div className="flex items-center gap-8 text-sm" style={{ color: '#999' }}>
              <a href="#features" className="hover:text-[#1a1a1a] transition-colors">Features</a>
              <a href="#how" className="hover:text-[#1a1a1a] transition-colors">How It Works</a>
              <a href="#security" className="hover:text-[#1a1a1a] transition-colors">Security</a>
              <span>{`\u00A9 ${new Date().getFullYear()} Atheon`}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
