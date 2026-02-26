import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  IconApex, IconPulse, IconCatalysts, IconMind, IconMemory, IconERPAdapters,
  IconShield, IconBolt, IconArrowRight, IconPlay, IconChevronRight,
  IconCheckCircle, IconBarChart, IconNetwork, IconConnectivity, IconControlPlane,
  IconAudit, IconChat, IconCross,
} from "@/components/icons/AtheonIcons";

/* ---- ANIMATIONS (injected once) ---- */
const animCSS = `
@keyframes mk-gradient-shift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
@keyframes mk-float-up { 0%,100%{transform:translateY(0) scale(1);opacity:.6} 50%{transform:translateY(-18px) scale(1.1);opacity:1} }
@keyframes mk-float-down { 0%,100%{transform:translateY(0);opacity:.5} 50%{transform:translateY(12px);opacity:.8} }
@keyframes mk-pulse-ring { 0%{transform:scale(.8);opacity:.6} 50%{transform:scale(1.3);opacity:0} 100%{transform:scale(.8);opacity:.6} }
@keyframes mk-orbit { 0%{transform:rotate(0deg) translateX(120px) rotate(0deg)} 100%{transform:rotate(360deg) translateX(120px) rotate(-360deg)} }
@keyframes mk-orbit-sm { 0%{transform:rotate(0deg) translateX(70px) rotate(0deg)} 100%{transform:rotate(360deg) translateX(70px) rotate(-360deg)} }
@keyframes mk-count-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
@keyframes mk-glow-breathe { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.7;transform:scale(1.15)} }
@keyframes mk-slide-up { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
@keyframes mk-slide-right { from{opacity:0;transform:translateX(-30px)} to{opacity:1;transform:translateX(0)} }
@keyframes mk-fade-in { from{opacity:0} to{opacity:1} }
@keyframes mk-text-shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
@keyframes mk-border-glow { 0%,100%{border-color:rgba(124,58,237,.15)} 50%{border-color:rgba(124,58,237,.4)} }
@keyframes mk-dash { to{stroke-dashoffset:0} }
.mk-appear { opacity:0; transform:translateY(30px); transition:opacity .7s ease, transform .7s ease; }
.mk-appear.mk-visible { opacity:1; transform:translateY(0); }
.mk-appear-delay-1 { transition-delay:.1s; }
.mk-appear-delay-2 { transition-delay:.2s; }
.mk-appear-delay-3 { transition-delay:.3s; }
.mk-appear-delay-4 { transition-delay:.4s; }
.mk-appear-delay-5 { transition-delay:.5s; }
`;

/* ---- DATA ---- */

const layers = [
  { Icon: IconBarChart, title: 'Apex', subtitle: 'Executive Intelligence', desc: 'Real-time organisational health scoring with AI-generated briefings. Distills thousands of data points into a single executive view with trend analysis, risk signals, and strategic recommendations.', color: 'var(--accent)', gradient: 'from-blue-500/20 to-indigo-500/10', benefits: ["Health score dashboard", "AI executive briefings", "Trend & anomaly alerts"] },
  { Icon: IconPulse, title: 'Pulse', subtitle: 'Process Monitoring', desc: 'Continuous KPI monitoring with intelligent anomaly detection. Tracks every business process in real-time and surfaces exceptions before they become problems.', color: '#059669', gradient: 'from-emerald-500/20 to-teal-500/10', benefits: ["Real-time KPI tracking", "Anomaly detection", "Exception management"] },
  { Icon: IconCatalysts, title: 'Catalysts', subtitle: 'Autonomous AI Agents', desc: "The next evolution of enterprise AI agents. Catalysts don\u2019t just recommend \u2014 they act. Deploy autonomous workers that execute tasks, remediate issues, and optimise processes with full audit trails and human-in-the-loop governance.", color: '#7c3aed', gradient: 'from-violet-500/20 to-purple-500/10', benefits: ["Autonomous execution", "Human-in-the-loop", "Full audit trails"] },
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
  { step: '01', title: 'Connect Your ERPs', desc: "Plug in your existing ERP systems through pre-built adapters. SAP, Xero, Sage, Pastel and more \u2014 no migration required.", Icon: IconERPAdapters },
  { step: '02', title: 'AI Analyses Everything', desc: 'Our six-layer intelligence engine processes every transaction, detects anomalies, and scores organisational health.', Icon: IconMind },
  { step: '03', title: 'Surface What Matters', desc: 'Executive briefings distill complexity into action. AI recommends the best path forward with confidence scores.', Icon: IconBarChart },
  { step: '04', title: 'Catalysts Execute', desc: "Approved actions are executed autonomously by Catalysts \u2014 AI agents purpose-built for your domain with full audit trails.", Icon: IconCatalysts },
];

const catalystUseCases = [
  { title: 'Invoice Exception Handler', desc: 'Automatically detects, classifies, and resolves invoice discrepancies across your P2P cycle. Reduces manual review by 80%.', Icon: IconAudit, metric: '80% fewer manual reviews' },
  { title: 'Cash Flow Optimiser', desc: 'Analyses payment patterns and recommends optimal payment timing. Maximises early-pay discounts while maintaining healthy working capital.', Icon: IconBarChart, metric: '12% working capital improvement' },
  { title: 'Compliance Monitor', desc: 'Continuously scans transactions for regulatory violations, policy breaches, and audit risks. Alerts and remediates in real-time.', Icon: IconShield, metric: 'Real-time compliance' },
  { title: 'Demand Forecaster', desc: 'Uses historical patterns and market signals to predict demand with unprecedented accuracy. Feeds directly into procurement and production.', Icon: IconPulse, metric: '35% forecast accuracy gain' },
];

const whyAtheon = [
  { title: 'Beyond Dashboards', desc: "Traditional BI shows you what happened. Atheon tells you what to do about it \u2014 and does it for you.", Icon: IconApex },
  { title: 'Beyond Chatbots', desc: "Mind isn\u2019t a wrapper around GPT. It\u2019s an industry-tuned inference engine with domain memory and multi-tier routing.", Icon: IconChat },
  { title: 'Beyond RPA', desc: "Catalysts aren\u2019t scripted bots. They\u2019re intelligent agents that understand context, handle exceptions, and learn from outcomes.", Icon: IconCatalysts },
  { title: 'ERP Agnostic', desc: "Your business logic shouldn\u2019t be locked to one vendor. Our canonical API layer means you can switch ERPs without rebuilding.", Icon: IconConnectivity },
];

/* ---- SCROLL OBSERVER HOOK ---- */
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('mk-visible'); } }); },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    el.querySelectorAll('.mk-appear').forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, []);
  return ref;
}

/* ---- ANIMATED COUNTER ---- */
function AnimatedCounter({ target, suffix = '' }: { target: string; suffix?: string }) {
  const [display, setDisplay] = useState('0');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const num = parseFloat(target.replace(/[^0-9.]/g, ''));
        if (isNaN(num)) { setDisplay(target); return; }
        const dur = 1200;
        const start = performance.now();
        const animate = (now: number) => {
          const progress = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = num % 1 === 0 ? Math.round(num * eased) : parseFloat((num * eased).toFixed(1));
          setDisplay(target.replace(String(num), String(current)));
          if (progress < 1) requestAnimationFrame(animate);
          else setDisplay(target);
        };
        requestAnimationFrame(animate);
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  return <div ref={ref} style={{ animation: 'mk-count-pulse 3s ease-in-out infinite' }}>{display}{suffix}</div>;
}

/* ---- FLOATING PARTICLES ---- */
function FloatingParticles({ count = 20, color = 'var(--accent)' }: { count?: number; color?: string }) {
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: 2 + Math.random() * 4,
    delay: Math.random() * 5,
    duration: 3 + Math.random() * 4,
  }));
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <div key={p.id} className="absolute rounded-full" style={{
          left: p.left, top: p.top, width: p.size, height: p.size,
          background: color, opacity: 0.4,
          animation: `mk-float-up ${p.duration}s ease-in-out ${p.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

/* ---- COMPONENT ---- */

export function MarketingPage() {
  const navigate = useNavigate();
  const scrollRef = useScrollReveal();

  useEffect(() => {
    if (!document.getElementById('mk-anim-styles')) {
      const style = document.createElement('style');
      style.id = 'mk-anim-styles';
      style.textContent = animCSS;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div ref={scrollRef} className="min-h-screen" style={{ background: 'var(--bg-primary)', backgroundImage: 'var(--bg-pattern)', backgroundAttachment: 'fixed' }}>

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
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')} className="text-[13px] font-medium px-4 py-2 rounded-lg t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all">Sign In</button>
            <Button variant="primary" size="sm" onClick={() => navigate('/login')}>Get Started <IconArrowRight size={12} /></Button>
          </div>
        </div>
      </nav>

      {/* HERO — animated gradient background + floating particles + orbiting elements */}
      <section className="relative pt-24 pb-28 lg:pt-36 lg:pb-44 overflow-hidden">
        {/* Animated gradient blobs */}
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(78, 124, 246, 0.25) 0%, transparent 70%)', animation: 'mk-glow-breathe 6s ease-in-out infinite' }} />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(124, 58, 237, 0.2) 0%, transparent 70%)', animation: 'mk-glow-breathe 8s ease-in-out 2s infinite' }} />
        <div className="absolute top-20 right-10 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(5, 150, 105, 0.15) 0%, transparent 70%)', animation: 'mk-glow-breathe 7s ease-in-out 1s infinite' }} />

        <FloatingParticles count={25} color="rgba(78, 124, 246, 0.5)" />

        {/* Orbiting dots around hero center */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: 0.12 }}>
          <div className="relative w-0 h-0">
            <div className="absolute w-3 h-3 rounded-full bg-accent" style={{ animation: 'mk-orbit 12s linear infinite' }} />
            <div className="absolute w-2 h-2 rounded-full" style={{ background: '#7c3aed', animation: 'mk-orbit-sm 8s linear infinite reverse' }} />
            <div className="absolute w-2.5 h-2.5 rounded-full" style={{ background: '#059669', animation: 'mk-orbit 15s linear 3s infinite' }} />
          </div>
        </div>

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <div className="mk-appear inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-semibold mb-8" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--border-card)', boxShadow: '0 2px 8px rgba(78, 124, 246, 0.1)' }}>
            <IconBolt size={12} className="text-accent" /> Enterprise Intelligence Platform
          </div>
          <h1 className="mk-appear mk-appear-delay-1 text-4xl sm:text-5xl lg:text-[4rem] font-extrabold leading-[1.04] t-primary mb-6 tracking-tight">
            The AI that doesn{'\u2019'}t just<br />
            <span style={{ backgroundImage: 'linear-gradient(90deg, var(--accent), #7c3aed, #0284c7, var(--accent))', backgroundSize: '300% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'mk-text-shimmer 6s linear infinite' }}>analyse {'\u2014'} it acts</span>
          </h1>
          <p className="mk-appear mk-appear-delay-2 text-base lg:text-lg leading-relaxed t-secondary max-w-2xl mx-auto mb-5">
            Six AI intelligence layers working as one unified system. From executive health scoring to autonomous execution, Atheon transforms raw ERP data into strategic advantage {'\u2014'} then acts on it.
          </p>
          <p className="mk-appear mk-appear-delay-3 text-sm t-muted max-w-xl mx-auto mb-10">
            Catalysts are the evolution of enterprise AI agents. They don{'\u2019'}t just recommend {'\u2014'} they execute with full audit trails and human-in-the-loop governance.
          </p>
          <div className="mk-appear mk-appear-delay-4 flex flex-col sm:flex-row gap-3 justify-center mb-16">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')} className="shadow-lg shadow-accent/20 group">
              Start Free Trial <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
            </Button>
            <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-[var(--bg-secondary)] hover:scale-[1.02]" style={{ border: '1px solid var(--border-card)', color: 'var(--accent)' }}>
              <IconPlay size={14} className="text-accent" /> See How It Works
            </button>
          </div>

          {/* Animated Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {stats.map((s, i) => {
              const SIcon = s.icon;
              return (
                <div key={s.label} className={`mk-appear mk-appear-delay-${i + 1} rounded-xl p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group`} style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 2px 12px rgba(100, 120, 180, 0.07)' }}>
                  <div className="flex justify-center mb-2"><SIcon size={18} className="text-accent transition-transform duration-300 group-hover:scale-125" /></div>
                  <div className="text-2xl font-extrabold t-primary"><AnimatedCounter target={s.value} /></div>
                  <div className="text-[10px] mt-1 t-muted font-medium uppercase tracking-wider">{s.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PLATFORM LAYERS — staggered reveal */}
      <section id="features" className="py-20 lg:py-28 relative" style={{ background: 'var(--bg-secondary)' }}>
        <FloatingParticles count={12} color="rgba(78, 124, 246, 0.3)" />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="mk-appear inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Platform Architecture
            </div>
            <h2 className="mk-appear mk-appear-delay-1 text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Six layers of intelligence</h2>
            <p className="mk-appear mk-appear-delay-2 text-sm t-secondary max-w-xl mx-auto leading-relaxed">Each layer works independently and as a unified system {'\u2014'} from data ingestion to autonomous action.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {layers.map((layer, i) => {
              const LIcon = layer.Icon;
              return (
                <div key={layer.title} className={`mk-appear mk-appear-delay-${(i % 3) + 1} group rounded-2xl p-6 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl cursor-default`} style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${layer.gradient} flex items-center justify-center mb-5 transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg`}>
                    <LIcon size={22} style={{ color: layer.color }} />
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

      {/* CATALYSTS SPOTLIGHT — the star section with animated border + particles */}
      <section id="catalysts" className="py-20 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(124, 58, 237, 0.08) 0%, transparent 50%), radial-gradient(circle at 70% 50%, rgba(78, 124, 246, 0.05) 0%, transparent 50%)' }} />
        <FloatingParticles count={30} color="rgba(124, 58, 237, 0.4)" />

        {/* Animated glow ring behind section */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ border: '2px solid rgba(124, 58, 237, 0.1)', animation: 'mk-pulse-ring 4s ease-in-out infinite' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none" style={{ border: '1px solid rgba(78, 124, 246, 0.08)', animation: 'mk-pulse-ring 4s ease-in-out 1s infinite' }} />

        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="mk-appear inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold mb-5 uppercase tracking-wider" style={{ background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', border: '1px solid rgba(124, 58, 237, 0.2)', animation: 'mk-border-glow 3s ease-in-out infinite' }}>
              <IconCatalysts size={14} /> The Evolution of AI Agents
            </div>
            <h2 className="mk-appear mk-appear-delay-1 text-3xl sm:text-4xl lg:text-5xl font-extrabold t-primary mb-5 tracking-tight">
              Meet <span style={{ backgroundImage: 'linear-gradient(90deg, #7c3aed, #4e7cf6, #7c3aed)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'mk-text-shimmer 4s linear infinite' }}>Catalysts</span>
            </h2>
            <p className="mk-appear mk-appear-delay-2 text-base t-secondary max-w-2xl mx-auto leading-relaxed">
              Today{'\u2019'}s AI assistants tell you what to do. <strong className="t-primary">Catalysts actually do it.</strong> Purpose-built autonomous agents that understand your business context, execute complex multi-step workflows, handle exceptions intelligently, and learn from every outcome.
            </p>
          </div>

          {/* Evolution comparison — animated reveal */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14">
            <div className="mk-appear mk-appear-delay-1 rounded-2xl p-6 transition-all duration-300 hover:shadow-lg" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider t-muted mb-3">Traditional RPA</div>
              <div className="space-y-2.5">
                {['Scripted workflows', 'Breaks on exceptions', 'No context awareness', 'Manual maintenance'].map(item => (
                  <div key={item} className="flex items-center gap-2.5 text-[13px] t-muted">
                    <IconCross size={12} className="text-red-400 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="mk-appear mk-appear-delay-2 rounded-2xl p-6 transition-all duration-300 hover:shadow-lg" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider t-muted mb-3">AI Copilots</div>
              <div className="space-y-2.5">
                {['Recommendations only', 'Human must execute', 'Limited domain knowledge', 'No persistent memory'].map(item => (
                  <div key={item} className="flex items-center gap-2.5 text-[13px] t-muted">
                    <IconCross size={12} className="text-amber-400 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="mk-appear mk-appear-delay-3 rounded-2xl p-6 relative transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl" style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.06), rgba(78, 124, 246, 0.06))', border: '1px solid rgba(124, 58, 237, 0.25)', boxShadow: '0 4px 30px rgba(124, 58, 237, 0.12)', animation: 'mk-border-glow 3s ease-in-out infinite' }}>
              <div className="absolute -top-px -right-px px-3 py-0.5 rounded-bl-lg rounded-tr-xl text-[9px] font-bold uppercase tracking-wider text-white" style={{ background: 'linear-gradient(135deg, #7c3aed, #4e7cf6)' }}>Next Gen</div>
              <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#7c3aed' }}>Atheon Catalysts</div>
              <div className="space-y-2.5">
                {['Autonomous execution', 'Handles exceptions', 'Full domain context', 'Learns & improves'].map(item => (
                  <div key={item} className="flex items-center gap-2.5 text-[13px] t-primary font-medium">
                    <IconCheckCircle size={12} style={{ color: '#7c3aed' }} className="flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Catalyst use cases — animated cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {catalystUseCases.map((uc, i) => {
              const UCIcon = uc.Icon;
              return (
                <div key={uc.title} className={`mk-appear mk-appear-delay-${i + 1} group rounded-2xl p-6 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl`} style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg" style={{ background: 'rgba(124, 58, 237, 0.1)' }}>
                      <UCIcon size={22} style={{ color: '#7c3aed' }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold t-primary mb-1.5">{uc.title}</h3>
                      <p className="text-[13px] t-secondary leading-relaxed mb-3">{uc.desc}</p>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed' }}>
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

      {/* WHY ATHEON — animated icons */}
      <section className="py-20 lg:py-28 relative" style={{ background: 'var(--bg-secondary)' }}>
        <FloatingParticles count={10} color="rgba(78, 124, 246, 0.25)" />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="mk-appear inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Why Atheon
            </div>
            <h2 className="mk-appear mk-appear-delay-1 text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Not another dashboard. Not another chatbot.</h2>
            <p className="mk-appear mk-appear-delay-2 text-sm t-secondary max-w-xl mx-auto leading-relaxed">Atheon is fundamentally different from traditional BI, RPA, and AI copilot tools.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {whyAtheon.map((item, i) => {
              const WIcon = item.Icon;
              return (
                <div key={item.title} className={`mk-appear mk-appear-delay-${i + 1} group rounded-2xl p-6 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl`} style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 group-hover:scale-110 group-hover:rotate-6" style={{ background: 'var(--accent-subtle)' }}>
                      <WIcon size={22} className="text-accent" />
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

      {/* HOW IT WORKS — animated step line */}
      <section id="how" className="py-20 lg:py-28 relative">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="mk-appear inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-4 uppercase tracking-wider" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              Getting Started
            </div>
            <h2 className="mk-appear mk-appear-delay-1 text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">From data to decision in seconds</h2>
            <p className="mk-appear mk-appear-delay-2 text-sm t-secondary max-w-lg mx-auto leading-relaxed">Four steps. No complex setup. No data migration. Start seeing results immediately.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 relative">
            {/* Animated connecting line */}
            <div className="hidden lg:block absolute top-16 left-[12.5%] right-[12.5%] h-px overflow-hidden">
              <div className="h-full w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--accent), var(--accent), transparent)', opacity: 0.2 }} />
              <div className="absolute top-0 left-0 h-full w-1/3" style={{ background: 'linear-gradient(90deg, var(--accent), transparent)', animation: 'mk-gradient-shift 3s linear infinite', backgroundSize: '300% 100%' }} />
            </div>
            {steps.map((s, i) => {
              const SIcon = s.Icon;
              return (
                <div key={s.step} className={`mk-appear mk-appear-delay-${i + 1} group rounded-2xl p-6 text-center transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl relative`} style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 4px 20px rgba(100, 120, 180, 0.08)' }}>
                  <div className="w-14 h-14 rounded-xl mx-auto mb-5 flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg" style={{ background: 'var(--accent-subtle)' }}>
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

      {/* SECURITY — animated shield */}
      <section id="security" className="py-20 lg:py-28" style={{ background: 'var(--bg-secondary)' }}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="mk-appear rounded-2xl p-8 lg:p-14 relative overflow-hidden" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', boxShadow: '0 8px 40px rgba(100, 120, 180, 0.10)' }}>
            <div className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)', animation: 'mk-glow-breathe 5s ease-in-out infinite', opacity: 0.05 }} />
            <div className="flex flex-col lg:flex-row items-start gap-10 relative">
              <div className="flex-1">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 transition-all duration-500 hover:scale-110" style={{ background: 'var(--accent-subtle)', animation: 'mk-float-down 4s ease-in-out infinite' }}>
                  <IconShield size={26} className="text-accent" />
                </div>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold t-primary mb-4 tracking-tight">Enterprise-grade security</h2>
                <p className="text-[13px] t-secondary leading-relaxed max-w-md mb-4">Every layer is built with zero-trust principles, end-to-end encryption, and comprehensive audit logging. Your data never leaves your security boundary.</p>
                <p className="text-[13px] t-muted leading-relaxed max-w-md">Supports SaaS, on-premise, and hybrid deployment models. Your security team stays in control.</p>
              </div>
              <div className="flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {securityFeatures.map((f, i) => {
                    const FIcon = f.Icon;
                    return (
                      <div key={f.label} className={`mk-appear mk-appear-delay-${(i % 4) + 1} flex items-center gap-3 p-3 rounded-xl transition-all duration-300 hover:bg-[var(--bg-secondary)] hover:scale-[1.02]`}>
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

      {/* CTA — animated gradient background */}
      <section className="py-24 lg:py-32 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(78, 124, 246, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(124, 58, 237, 0.08) 0%, transparent 50%)' }} />
        <FloatingParticles count={15} color="rgba(78, 124, 246, 0.35)" />
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <div className="mk-appear w-16 h-16 rounded-2xl mx-auto mb-8 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0e2a, #141a3d)', boxShadow: '0 8px 40px rgba(78, 124, 246, 0.4)', animation: 'mk-float-down 3s ease-in-out infinite' }}>
            <svg width="32" height="32" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="ctaA" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#7db4ff"/><stop offset="40%" stopColor="#4e7cf6"/><stop offset="100%" stopColor="#2952cc"/></linearGradient></defs><path d="M32 10 L15 52 h8.5 l4-9.5 h9 l4 9.5 h8.5 Z M32 22 l5.5 13 h-11 Z" fill="url(#ctaA)"/><rect x="21" y="33" width="22" height="2.5" rx="1.25" fill="#7db4ff" opacity="0.6"/><circle cx="32" cy="9" r="2" fill="#7db4ff" opacity="0.8"/></svg>
          </div>
          <h2 className="mk-appear mk-appear-delay-1 text-2xl sm:text-3xl lg:text-4xl font-extrabold mb-5 tracking-tight t-primary">Ready to redefine enterprise intelligence?</h2>
          <p className="mk-appear mk-appear-delay-2 text-sm mb-4 leading-relaxed t-secondary">Join the organisations deploying Catalysts to transform operational data into autonomous action.</p>
          <p className="mk-appear mk-appear-delay-3 text-[13px] mb-10 leading-relaxed t-muted">Free trial includes all six intelligence layers. No credit card required. Deploy in under 15 minutes.</p>
          <div className="mk-appear mk-appear-delay-4 flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')} className="shadow-lg shadow-accent/25 group">
              Start Free Trial <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
            </Button>
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-[var(--bg-secondary)] hover:scale-[1.02]" style={{ border: '1px solid var(--border-card)', color: 'var(--accent)' }}>
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
