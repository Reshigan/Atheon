import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  IconApex, IconPulse, IconCatalysts, IconMind, IconMemory, IconERPAdapters,
  IconShield, IconBolt, IconArrowRight, IconPlay, IconStar, IconChevronRight,
  IconCheckCircle, IconBarChart, IconNetwork, IconConnectivity, IconControlPlane,
  IconAudit, IconChat, IconCross,
} from "@/components/icons/AtheonIcons";

/* ---- DATA ---- */

const layers = [
  { Icon: IconBarChart, title: 'Apex', subtitle: 'Executive Intelligence', desc: 'Real-time organisational health scoring with AI-generated briefings. Distills thousands of data points into a single executive view with trend analysis, risk signals, and strategic recommendations.', color: 'var(--accent)', gradient: 'from-blue-500/20 to-indigo-500/10', benefits: ["Health score dashboard", "AI executive briefings", "Trend & anomaly alerts"] },
  { Icon: IconPulse, title: 'Pulse', subtitle: 'Process Monitoring', desc: 'Continuous KPI monitoring with intelligent anomaly detection. Tracks every business process in real-time and surfaces exceptions before they become problems.', color: '#059669', gradient: 'from-emerald-500/20 to-teal-500/10', benefits: ["Real-time KPI tracking", "Anomaly detection", "Exception management"] },
  { Icon: IconCatalysts, title: 'Catalysts', subtitle: 'Autonomous AI Agents', desc: 'The next evolution of enterprise AI agents. Catalysts don’t just recommend — they act. Deploy autonomous workers that execute tasks, remediate issues, and optimise processes with full audit trails and human-in-the-loop governance.', color: '#7c3aed', gradient: 'from-violet-500/20 to-purple-500/10', benefits: ["Autonomous execution", "Human-in-the-loop", "Full audit trails"] },
  { Icon: IconMind, title: 'Mind', subtitle: 'Domain LLM Engine', desc: 'Industry-specific language models with multi-tier inference. Routes queries to the optimal model based on complexity, cost, and domain expertise. Your enterprise knowledge, amplified.', color: '#0284c7', gradient: 'from-sky-500/20 to-cyan-500/10', benefits: ["Multi-tier inference", "Domain fine-tuning", "Intelligent routing"] },
  { Icon: IconMemory, title: 'Memory', subtitle: 'Knowledge Layer', desc: 'Vector-powered semantic search across all enterprise documents. Maintains persistent context so every conversation builds on previous interactions. Your institutional memory, digitised.', color: '#e11d48', gradient: 'from-rose-500/20 to-pink-500/10', benefits: ["Semantic search", "Persistent context", "Document vectorisation"] },
  { Icon: IconNetwork, title: 'ERP Integration', subtitle: 'Universal Adapter', desc: 'Pre-built adapters for SAP, Xero, Sage, Pastel and more. Canonical API translation means your business logic is ERP-agnostic. Connect once, work everywhere.', color: '#f59e0b', gradient: 'from-amber-500/20 to-orange-500/10', benefits: ["5+ ERP adapters", "Canonical API", "Real-time sync"] },
];

const stats = [
  { value: '73%', label: 'Issues auto-resolved', icon: IconCatalysts },
  { value: '<2s', label: 'Decision latency', icon: IconBolt },
  { value: '99.9%', label: 'Uptime SLA', icon: IconShield },
  { value: '6', label: 'Intelligence layers', icon: IconApex },
];

const testimonials = [
  { name: 'Sarah Chen', role: 'CFO, Global Manufacturing', quote: 'Atheon reduced our decision-making time from days to minutes. The executive health scoring alone paid for itself within the first quarter.', initials: 'SC' },
  { name: 'Marcus van der Berg', role: 'CIO, Retail Group', quote: 'The autonomous catalysts resolved 73% of routine operational issues without human intervention. Our team now focuses on strategy, not firefighting.', initials: 'MV' },
  { name: 'Priya Naidoo', role: 'COO, Financial Services', quote: 'Six layers working as one. We finally have a single source of truth across all our ERP systems. The ROI was immediate and measurable.', initials: 'PN' },
];

const securityFeatures = [
  { label: 'SOC 2 Type II architecture', Icon: IconShield },
  { label: 'End-to-end AES-256 encryption', Icon: IconShield },
  { label: 'RBAC & Azure AD SSO', Icon: IconControlPlane },
  { label: 'Complete audit trails', Icon: IconAudit },
  { label: 'Tenant data isolation', Icon: IconNetwork },
  { label: 'PBKDF2 password hashing', Icon: IconShield },
  { label: 'Zero-trust architecture', Icon: IconConnectivity },
  { label: 'GDPR & POPIA compliant', Icon: IconCheckCircle },
];

const steps = [
  { step: '01', title: 'Connect Your ERPs', desc: 'Plug in your existing ERP systems through pre-built adapters. SAP, Xero, Sage, Pastel and more — no migration required.', Icon: IconERPAdapters },
  { step: '02', title: 'AI Analyses Everything', desc: 'Our six-layer intelligence engine processes every transaction, detects anomalies, and scores organisational health.', Icon: IconMind },
  { step: '03', title: 'Surface What Matters', desc: 'Executive briefings distill complexity into action. AI recommends the best path forward with confidence scores.', Icon: IconBarChart },
  { step: '04', title: 'Catalysts Execute', desc: 'Approved actions are executed autonomously by Catalysts — AI agents purpose-built for your domain with full audit trails.', Icon: IconCatalysts },
];

const catalystUseCases = [
  { title: 'Invoice Exception Handler', desc: 'Automatically detects, classifies, and resolves invoice discrepancies across your P2P cycle. Reduces manual review by 80%.', Icon: IconAudit, metric: '80% fewer manual reviews' },
  { title: 'Cash Flow Optimiser', desc: 'Analyses payment patterns and recommends optimal payment timing. Maximises early-pay discounts while maintaining healthy working capital.', Icon: IconBarChart, metric: '12% working capital improvement' },
  { title: 'Compliance Monitor', desc: 'Continuously scans transactions for regulatory violations, policy breaches, and audit risks. Alerts and remediates in real-time.', Icon: IconShield, metric: 'Real-time compliance' },
  { title: 'Demand Forecaster', desc: 'Uses historical patterns and market signals to predict demand with unprecedented accuracy. Feeds directly into procurement and production.', Icon: IconPulse, metric: '35% forecast accuracy gain' },
];

const whyAtheon = [
  { title: 'Beyond Dashboards', desc: 'Traditional BI shows you what happened. Atheon tells you what to do about it — and does it for you.', Icon: IconApex },
  { title: 'Beyond Chatbots', desc: 'Mind isn’t a wrapper around GPT. It’s an industry-tuned inference engine with domain memory and multi-tier routing.', Icon: IconChat },
  { title: 'Beyond RPA', desc: 'Catalysts aren’t scripted bots. They’re intelligent agents that understand context, handle exceptions, and learn from outcomes.', Icon: IconCatalysts },
  { title: 'ERP Agnostic', desc: 'Your business logic shouldn’t be locked to one vendor. Our canonical API layer means you can switch ERPs without rebuilding.', Icon: IconConnectivity },
];

/* ---- COMPONENT ---- */

export function MarketingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', backgroundImage: 'var(--bg-pattern)', backgroundAttachment: 'fixed' }}>

      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl" style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--border-card)', boxShadow: '0 2px 20px rgba(100, 120, 180, 0.08)' }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0e2a, #141a3d)', boxShadow: '0 2px 12px rgba(78, 124, 246, 0.3)' }}>
              <svg width="16" height="16" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="navA" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#7db4ff"/><stop offset="40%" stopColor="#4e7cf6"/><stop offset="100%" stopColor="#2952cc"/></linearGradient></defs><path d="M32 10 L15 52 h8.5 l4-9.5 h9 l4 9.5 h8.5 Z M32 22 l5.5 13 h-11 Z" fill="url(#navA)"/><rect x="21" y="33" width="22" height="2.5" rx="1.25" fill="#7db4ff" opacity="0.6"/></svg>
            </span>
            <span className="text-lg font-extrabold tracking-tighter t-primary">Atheon</span>
          </span>
          <div className="hidden md:flex items-center gap-8 text-[13px] font-medium t-secondary">
            <a href="#features" className="hover:text-accent transition-colors">Platform</a>
            <a href="#catalysts" className="hover:text-accent transition-colors">Catalysts</a>
            <a href="#how" className="hover:text-accent transition-colors">How It Works</a>
            <a href="#security" className="hover:text-accent transition-colors">Security</a>
            <a href="#testimonials" className="hover:text-accent transition-colors">Customers</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')} className="text-[13px] font-medium px-4 py-2 rounded-lg t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all">Sign In</button>
            <Button variant="primary" size="sm" onClick={() => navigate('/login')}>Get Started <IconArrowRight size={12} /></Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-20 pb-24 lg:pt-28 lg:pb-36 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(78, 124, 246, 0.4) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-15 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(124, 58, 237, 0.3) 0%, transparent 70%)' }} />
        <div className="absolute top-32 right-10 w-72 h-72 rounded-full opacity-10 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(5, 150, 105, 0.4) 0%, transparent 70%)' }} />

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-semibold mb-8" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--border-card)', boxShadow: '0 2px 8px rgba(78, 124, 246, 0.1)' }}>
            <IconBolt size={12} className="text-accent" /> Enterprise Intelligence Platform
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-[3.75rem] font-extrabold leading-[1.06] t-primary mb-6 tracking-tight">
            The AI that doesn{'\u2019'}t just<br />
            <span style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #7c3aed 50%, #0284c7 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>analyse {'\u2014'} it acts</span>
          </h1>
          <p className="text-base lg:text-lg leading-relaxed t-secondary max-w-2xl mx-auto mb-5">
            Six AI intelligence layers working as one unified system. From executive health scoring to autonomous execution, Atheon transforms raw ERP data into strategic advantage {'\u2014'} then acts on it.
          </p>
          <p className="text-sm t-muted max-w-xl mx-auto mb-10">
            Catalysts are the evolution of enterprise AI agents. They don{'\u2019'}t just recommend {'\u2014'} they execute with full audit trails and human-in-the-loop governance.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')} className="shadow-lg shadow-accent/20">Start Free Trial <IconArrowRight size={14} /></Button>
            <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-[var(--bg-secondary)]" style={{ border: '1px solid var(--border-card)', color: 'var(--accent)' }}>
              <IconPlay size={14} className="text-accent" /> See How It Works
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {stats.map(s => {
              const SIcon = s.icon;
              return (
                <div key={s.label} className="rounded-xl p-4 text-center transition-all hover:-translate-y-0.5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 2px 12px rgba(100, 120, 180, 0.07)' }}>
                  <div className="flex justify-center mb-2"><SIcon size={16} className="text-accent" /></div>
                  <div className="text-2xl font-extrabold t-primary">{s.value}</div>
                  <div className="text-[10px] mt-0.5 t-muted font-medium">{s.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PLATFORM LAYERS */}
      <section id="features" className="py-20 lg:py-28" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Platform Architecture
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Six layers of intelligence</h2>
            <p className="text-sm t-secondary max-w-xl mx-auto leading-relaxed">Each layer works independently and as a unified system {'\u2014'} from data ingestion to autonomous action. Together they form the most comprehensive enterprise intelligence platform available.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {layers.map((layer) => {
              const LIcon = layer.Icon;
              return (
                <div key={layer.title} className="group rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-default" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${layer.gradient} flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110`}>
                    <LIcon size={20} style={{ color: layer.color }} />
                  </div>
                  <h3 className="text-base font-bold t-primary mb-1">{layer.title}</h3>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: layer.color }}>{layer.subtitle}</p>
                  <p className="text-[13px] t-secondary leading-relaxed mb-4">{layer.desc}</p>
                  <div className="space-y-1.5">
                    {layer.benefits.map(b => (
                      <div key={b} className="flex items-center gap-2">
                        <IconCheckCircle size={12} style={{ color: layer.color }} className="flex-shrink-0" />
                        <span className="text-[11px] font-medium t-muted">{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CATALYSTS SPOTLIGHT */}
      <section id="catalysts" className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(124, 58, 237, 0.3) 0%, transparent 50%), radial-gradient(circle at 70% 50%, rgba(78, 124, 246, 0.2) 0%, transparent 50%)' }} />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed' }}>
              The Evolution of AI Agents
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">
              Meet Catalysts {'\u2014'} AI that <span style={{ color: '#7c3aed' }}>executes</span>
            </h2>
            <p className="text-sm t-secondary max-w-2xl mx-auto leading-relaxed">
              Today{'\u2019'}s AI assistants tell you what to do. Catalysts actually do it. Purpose-built autonomous agents that understand your business context, execute complex multi-step workflows, handle exceptions intelligently, and learn from every outcome {'\u2014'} all with enterprise-grade governance.
            </p>
          </div>

          {/* Catalyst comparison */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14">
            <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider t-muted mb-3">Traditional RPA</div>
              <div className="space-y-2">
                {['Scripted workflows', 'Breaks on exceptions', 'No context awareness', 'Manual maintenance'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[13px] t-muted">
                    <IconCross size={12} className="text-red-400 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider t-muted mb-3">AI Copilots</div>
              <div className="space-y-2">
                {['Recommendations only', 'Human must execute', 'Limited domain knowledge', 'No persistent memory'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[13px] t-muted">
                    <IconCross size={12} className="text-amber-400 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl p-6 relative" style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.05), rgba(78, 124, 246, 0.05))', border: '1px solid rgba(124, 58, 237, 0.2)', boxShadow: '0 4px 20px rgba(124, 58, 237, 0.1)' }}>
              <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#7c3aed' }}>Atheon Catalysts</div>
              <div className="space-y-2">
                {['Autonomous execution', 'Handles exceptions', 'Full domain context', 'Learns & improves'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[13px] t-primary font-medium">
                    <IconCheckCircle size={12} style={{ color: '#7c3aed' }} className="flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Catalyst use cases */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {catalystUseCases.map(uc => {
              const UCIcon = uc.Icon;
              return (
                <div key={uc.title} className="group rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110" style={{ background: 'rgba(124, 58, 237, 0.1)' }}>
                      <UCIcon size={20} style={{ color: '#7c3aed' }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold t-primary mb-1">{uc.title}</h3>
                      <p className="text-[13px] t-secondary leading-relaxed mb-3">{uc.desc}</p>
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed' }}>
                        <IconBolt size={10} /> {uc.metric}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* WHY ATHEON */}
      <section className="py-20 lg:py-28" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Why Atheon
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Not another dashboard. Not another chatbot.</h2>
            <p className="text-sm t-secondary max-w-xl mx-auto leading-relaxed">Atheon is fundamentally different from traditional BI, RPA, and AI copilot tools.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {whyAtheon.map(item => {
              const WIcon = item.Icon;
              return (
                <div key={item.title} className="group rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110" style={{ background: 'var(--accent-subtle)' }}>
                      <WIcon size={20} className="text-accent" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold t-primary mb-1.5">{item.title}</h3>
                      <p className="text-[13px] t-secondary leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-20 lg:py-28 relative">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Getting Started
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">From data to decision in seconds</h2>
            <p className="text-sm t-secondary max-w-lg mx-auto leading-relaxed">Four steps. No complex setup. No data migration. Start seeing results immediately.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 relative">
            <div className="hidden lg:block absolute top-16 left-[12.5%] right-[12.5%] h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--accent), var(--accent), transparent)', opacity: 0.15 }} />
            {steps.map(s => {
              const SIcon = s.Icon;
              return (
                <div key={s.step} className="group rounded-2xl p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl relative" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className="w-14 h-14 rounded-xl mx-auto mb-5 flex items-center justify-center transition-transform duration-300 group-hover:scale-110" style={{ background: 'var(--accent-subtle)' }}>
                    <SIcon size={24} className="text-accent" />
                  </div>
                  <div className="text-[10px] font-bold mb-2 uppercase tracking-widest" style={{ color: 'var(--accent)', opacity: 0.4 }}>{s.step}</div>
                  <h3 className="text-sm font-bold t-primary mb-2">{s.title}</h3>
                  <p className="text-[13px] t-secondary leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section id="testimonials" className="py-20 lg:py-28" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Customer Success
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Trusted by industry leaders</h2>
            <p className="text-sm t-secondary max-w-lg mx-auto leading-relaxed">From manufacturing to financial services, enterprises trust Atheon to power their most critical decisions.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {testimonials.map(t => (
              <div key={t.name} className="rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <IconStar key={i} size={14} className="text-accent" />
                  ))}
                </div>
                <p className="text-[13px] t-secondary leading-relaxed mb-6">&ldquo;{t.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--accent), #7c3aed)' }}>
                    {t.initials}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold t-primary">{t.name}</p>
                    <p className="text-[11px] t-muted">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section id="security" className="py-20 lg:py-28">
        <div className="max-w-5xl mx-auto px-6">
          <div className="rounded-2xl p-8 lg:p-14 relative overflow-hidden" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 8px 40px rgba(100, 120, 180, 0.10)' }}>
            <div className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-5 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
            <div className="flex flex-col lg:flex-row items-start gap-10 relative">
              <div className="flex-1">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: 'var(--accent-subtle)' }}>
                  <IconShield size={22} className="text-accent" />
                </div>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Enterprise-grade security</h2>
                <p className="text-[13px] t-secondary leading-relaxed max-w-md mb-4">Every layer is built with zero-trust principles, end-to-end encryption, and comprehensive audit logging. Your data never leaves your security boundary.</p>
                <p className="text-[13px] t-muted leading-relaxed max-w-md">Supports SaaS, on-premise, and hybrid deployment models. Your security team stays in control.</p>
              </div>
              <div className="flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {securityFeatures.map(f => {
                    const FIcon = f.Icon;
                    return (
                      <div key={f.label} className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-[var(--bg-secondary)]">
                        <FIcon size={16} className="text-accent flex-shrink-0" />
                        <span className="text-[13px] font-medium t-secondary">{f.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #dbeafe 30%, #ede9fe 60%, #e0f2fe 100%)' }}>
        <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(78, 124, 246, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(124, 58, 237, 0.1) 0%, transparent 50%)' }} />
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-6 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0e2a, #141a3d)', boxShadow: '0 8px 30px rgba(78, 124, 246, 0.35)' }}>
            <svg width="28" height="28" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="ctaA" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#7db4ff"/><stop offset="40%" stopColor="#4e7cf6"/><stop offset="100%" stopColor="#2952cc"/></linearGradient></defs><path d="M32 10 L15 52 h8.5 l4-9.5 h9 l4 9.5 h8.5 Z M32 22 l5.5 13 h-11 Z" fill="url(#ctaA)"/><rect x="21" y="33" width="22" height="2.5" rx="1.25" fill="#7db4ff" opacity="0.6"/><circle cx="32" cy="9" r="2" fill="#7db4ff" opacity="0.8"/></svg>
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold mb-5 tracking-tight t-primary">Ready to transform your enterprise?</h2>
          <p className="text-sm mb-4 leading-relaxed t-secondary">Join industry leaders who use Atheon to turn operational data into strategic advantage.</p>
          <p className="text-[13px] mb-10 leading-relaxed t-muted">Free trial includes all six intelligence layers. No credit card required. Deploy in under 15 minutes.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')} className="shadow-lg shadow-accent/25">Start Free Trial <IconArrowRight size={14} /></Button>
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-[var(--bg-secondary)]" style={{ border: '1px solid var(--border-card)', color: 'var(--accent)' }}>
              Contact Sales <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10" style={{ background: 'var(--bg-primary)', borderTop: '1px solid var(--border-card)' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <span className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0e2a, #141a3d)' }}>
                <svg width="12" height="12" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="ftA" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#7db4ff"/><stop offset="40%" stopColor="#4e7cf6"/><stop offset="100%" stopColor="#2952cc"/></linearGradient></defs><path d="M32 10 L15 52 h8.5 l4-9.5 h9 l4 9.5 h8.5 Z M32 22 l5.5 13 h-11 Z" fill="url(#ftA)"/><rect x="21" y="33" width="22" height="2.5" rx="1.25" fill="#7db4ff" opacity="0.6"/></svg>
              </span>
              <span className="text-sm font-extrabold tracking-tighter t-primary">Atheon</span>
            </span>
            <div className="flex items-center gap-8 text-[13px] t-muted">
              <a href="#features" className="hover:text-accent transition-colors">Platform</a>
              <a href="#catalysts" className="hover:text-accent transition-colors">Catalysts</a>
              <a href="#security" className="hover:text-accent transition-colors">Security</a>
              <span>&copy; {new Date().getFullYear()} Atheon</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
