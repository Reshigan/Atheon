import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  IconApex, IconPulse, IconCatalysts, IconMind, IconMemory, IconERPAdapters,
  IconShield, IconBolt, IconArrowRight, IconPlay, IconChevronRight,
  IconCheckCircle, IconBarChart, IconNetwork, IconConnectivity, IconControlPlane,
  IconAudit, IconChat, IconCross,
} from "@/components/icons/AtheonIcons";

/* ============================================================
   AWARD-WINNING MARKETING PAGE
   Inspired by: Linear, Vercel, Stripe, Notion
   Features: Canvas particle network, mouse-following spotlight,
   bento grid, glass morphism, 3D perspective hover, forced dark theme
   ============================================================ */

/* ---- CSS ANIMATIONS ---- */
const animCSS = `
@keyframes mk-gradient-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes mk-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}
@keyframes mk-float-slow{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-12px) rotate(3deg)}}
@keyframes mk-pulse-ring{0%{transform:scale(.85);opacity:.5}50%{transform:scale(1.25);opacity:0}100%{transform:scale(.85);opacity:.5}}
@keyframes mk-orbit{0%{transform:rotate(0deg) translateX(140px) rotate(0deg)}100%{transform:rotate(360deg) translateX(140px) rotate(-360deg)}}
@keyframes mk-orbit-sm{0%{transform:rotate(0deg) translateX(80px) rotate(0deg)}100%{transform:rotate(360deg) translateX(80px) rotate(-360deg)}}
@keyframes mk-orbit-lg{0%{transform:rotate(0deg) translateX(220px) rotate(0deg)}100%{transform:rotate(360deg) translateX(220px) rotate(-360deg)}}
@keyframes mk-glow-breathe{0%,100%{opacity:.25;transform:scale(1)}50%{opacity:.6;transform:scale(1.12)}}
@keyframes mk-text-shimmer{0%{background-position:200% center}100%{background-position:-200% center}}
@keyframes mk-border-glow{0%,100%{border-color:rgba(99,102,241,.15)}50%{border-color:rgba(99,102,241,.45)}}
@keyframes mk-slide-up{from{opacity:0;transform:translateY(50px)}to{opacity:1;transform:translateY(0)}}
@keyframes mk-fade-in{from{opacity:0}to{opacity:1}}
@keyframes mk-scale-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
@keyframes mk-hero-text{from{opacity:0;transform:translateY(30px) scale(.97);filter:blur(8px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
@keyframes mk-logo-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes mk-line-draw{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
@keyframes mk-number-pop{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes mk-card-float{0%,100%{transform:translateY(0) rotateX(0)}50%{transform:translateY(-8px) rotateX(1deg)}}
.mk-reveal{opacity:0;transform:translateY(40px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1);}
.mk-reveal.mk-visible{opacity:1;transform:translateY(0);}
.mk-reveal-d1{transition-delay:.1s}.mk-reveal-d2{transition-delay:.2s}.mk-reveal-d3{transition-delay:.3s}
.mk-reveal-d4{transition-delay:.4s}.mk-reveal-d5{transition-delay:.5s}.mk-reveal-d6{transition-delay:.6s}
.mk-glass{background:rgba(255,255,255,.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.06);}
.mk-glass:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);}
.mk-glass-strong{background:rgba(255,255,255,.05);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,.08);}
.mk-bento-tilt{transition:transform .6s cubic-bezier(.16,1,.3,1),box-shadow .6s ease;}
.mk-bento-tilt:hover{transform:translateY(-6px) perspective(800px) rotateX(2deg);box-shadow:0 30px 60px rgba(0,0,0,.4),0 0 40px rgba(99,102,241,.08);}
`;

/* ---- DATA ---- */

const layers = [
  { Icon: IconBarChart, title: "Apex", subtitle: "Executive Intelligence", desc: "AI-generated executive briefings. Real-time health scoring distills thousands of data points into a single strategic view.", color: "#6366f1", benefits: ["Health score dashboard", "AI briefings", "Trend analysis"] },
  { Icon: IconPulse, title: "Pulse", subtitle: "Process Monitoring", desc: "Continuous KPI tracking with intelligent anomaly detection. Surfaces exceptions before they become problems.", color: "#059669", benefits: ["Real-time KPIs", "Anomaly detection", "Exception alerts"] },
  { Icon: IconCatalysts, title: "Catalysts", subtitle: "Autonomous AI Agents", desc: "The next evolution. Catalysts don\u2019t recommend \u2014 they act. Deploy autonomous workers with full audit trails.", color: "#8b5cf6", benefits: ["Autonomous execution", "Human-in-the-loop", "Full audit trails"] },
  { Icon: IconMind, title: "Mind", subtitle: "Domain LLM Engine", desc: "Industry-specific language models with multi-tier inference. Routes to the optimal model for every query.", color: "#0ea5e9", benefits: ["Multi-tier inference", "Domain fine-tuning", "Intelligent routing"] },
  { Icon: IconMemory, title: "Memory", subtitle: "Knowledge Layer", desc: "Vector-powered semantic search across all enterprise documents. Persistent context across every interaction.", color: "#f43f5e", benefits: ["Semantic search", "Persistent context", "Document vectorisation"] },
  { Icon: IconNetwork, title: "ERP Integration", subtitle: "Universal Adapter", desc: "Pre-built adapters for SAP, Xero, Sage, Pastel and more. Connect once, work everywhere.", color: "#f59e0b", benefits: ["5+ ERP adapters", "Canonical API", "Real-time sync"] },
];

const stats = [
  { value: "73", suffix: "%", label: "Issues Auto-Resolved" },
  { value: "2", prefix: "<", suffix: "s", label: "Decision Latency" },
  { value: "99.9", suffix: "%", label: "Uptime SLA" },
  { value: "6", suffix: "", label: "Intelligence Layers" },
];

const securityFeatures = [
  { label: "SOC 2 Type II", Icon: IconShield },
  { label: "AES-256 Encryption", Icon: IconShield },
  { label: "Azure AD SSO", Icon: IconControlPlane },
  { label: "Full Audit Trails", Icon: IconAudit },
  { label: "Tenant Isolation", Icon: IconNetwork },
  { label: "Zero-Trust Arch", Icon: IconConnectivity },
  { label: "GDPR & POPIA", Icon: IconCheckCircle },
  { label: "PBKDF2 Hashing", Icon: IconShield },
];

const steps = [
  { num: "01", title: "Connect ERPs", desc: "Plug in existing systems through pre-built adapters. SAP, Xero, Sage, Pastel \u2014 no migration.", Icon: IconERPAdapters },
  { num: "02", title: "AI Analyses", desc: "Six-layer intelligence processes every transaction, detects anomalies, scores organisational health.", Icon: IconMind },
  { num: "03", title: "Surface Insights", desc: "Executive briefings distill complexity into action. AI recommends the best path with confidence scores.", Icon: IconBarChart },
  { num: "04", title: "Catalysts Act", desc: "Approved actions executed autonomously by domain-specific AI agents with full audit trails.", Icon: IconCatalysts },
];

const catalystUseCases = [
  { title: "Invoice Exception Handler", metric: "80%", metricLabel: "fewer manual reviews", desc: "Detects, classifies, and resolves invoice discrepancies across your P2P cycle.", Icon: IconAudit },
  { title: "Cash Flow Optimiser", metric: "12%", metricLabel: "working capital gain", desc: "Analyses payment patterns and recommends optimal timing for maximum discounts.", Icon: IconBarChart },
  { title: "Compliance Monitor", metric: "24/7", metricLabel: "real-time scanning", desc: "Continuously scans for regulatory violations, policy breaches, and audit risks.", Icon: IconShield },
  { title: "Demand Forecaster", metric: "35%", metricLabel: "accuracy improvement", desc: "Predicts demand using historical patterns and market signals with unprecedented precision.", Icon: IconPulse },
];

const whyAtheon = [
  { title: "Beyond Dashboards", desc: "Traditional BI shows what happened. Atheon tells you what to do \u2014 and does it.", Icon: IconApex },
  { title: "Beyond Chatbots", desc: "Mind isn\u2019t a GPT wrapper. It\u2019s an industry-tuned inference engine with domain memory.", Icon: IconChat },
  { title: "Beyond RPA", desc: "Catalysts aren\u2019t scripted bots. They understand context, handle exceptions, learn from outcomes.", Icon: IconCatalysts },
  { title: "ERP Agnostic", desc: "Your logic shouldn\u2019t be locked to one vendor. Switch ERPs without rebuilding.", Icon: IconConnectivity },
];

const trustLogos = ["Deloitte", "McKinsey", "KPMG", "Accenture", "PwC", "EY", "Bain", "BCG"];

/* ---- CANVAS PARTICLE NETWORK ---- */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; r: number; o: number }>>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    // Create particles
    const count = Math.min(80, Math.floor(canvas.offsetWidth / 15));
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    particlesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 1 + Math.random() * 1.5,
      o: 0.15 + Math.random() * 0.35,
    }));

    const maxDist = 150;
    const mouseDist = 200;

    const animate = () => {
      const cw = canvas.offsetWidth;
      const ch = canvas.offsetHeight;
      ctx.clearRect(0, 0, cw, ch);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const pts = particlesRef.current;

      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = cw;
        if (p.x > cw) p.x = 0;
        if (p.y < 0) p.y = ch;
        if (p.y > ch) p.y = 0;

        // Mouse attraction
        if (mx > 0 && my > 0) {
          const dx = mx - p.x;
          const dy = my - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < mouseDist) {
            p.vx += dx * 0.00005;
            p.vy += dy * 0.00005;
          }
        }

        // Speed limit
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 0.6) {
          p.vx *= 0.98;
          p.vy *= 0.98;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 102, 241, ${p.o})`;
        ctx.fill();
      }

      // Draw connections
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.15;
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Mouse glow
      if (mx > 0 && my > 0) {
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 200);
        grad.addColorStop(0, "rgba(99, 102, 241, 0.06)");
        grad.addColorStop(1, "rgba(99, 102, 241, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.addEventListener("mousemove", handleMouse);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", handleMouse);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ opacity: 0.8 }} />;
}

/* ---- SCROLL REVEAL HOOK ---- */
function useScrollReveal(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("mk-visible"); }),
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" }
    );
    el.querySelectorAll(".mk-reveal").forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, [ref]);
}

/* ---- ANIMATED COUNTER ---- */
function AnimatedCounter({ value, prefix = "", suffix = "" }: { value: string; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const num = parseFloat(value);
        if (isNaN(num)) { setDisplay(value); return; }
        const dur = 1500;
        const start = performance.now();
        const isDecimal = value.includes(".");
        const animate = (now: number) => {
          const progress = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - progress, 4);
          const current = isDecimal ? (num * eased).toFixed(1) : String(Math.round(num * eased));
          setDisplay(current);
          if (progress < 1) requestAnimationFrame(animate);
          else setDisplay(value);
        };
        requestAnimationFrame(animate);
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return <span ref={ref}>{prefix}{display}{suffix}</span>;
}

/* ---- MOUSE SPOTLIGHT ---- */
function useMouseSpotlight(ref: React.RefObject<HTMLDivElement | null>) {
  const handleMove = useCallback((e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("mousemove", handleMove);
    return () => el.removeEventListener("mousemove", handleMove);
  }, [ref, handleMove]);
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export function MarketingPage() {
  const navigate = useNavigate();
  const mainRef = useRef<HTMLDivElement>(null);
  useScrollReveal(mainRef);
  useMouseSpotlight(mainRef);

  // Inject CSS once
  useEffect(() => {
    if (!document.getElementById("mk-award-css")) {
      const s = document.createElement("style");
      s.id = "mk-award-css";
      s.textContent = animCSS;
      document.head.appendChild(s);
    }
  }, []);

  return (
    <div
      ref={mainRef}
      className="min-h-screen"
      style={{
        background: "#06080f",
        color: "#e2e8f0",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        ["--mx" as string]: "50%",
        ["--my" as string]: "50%",
      }}
    >

      {/* ========== NAVBAR ========== */}
      <nav className="fixed top-0 w-full z-50" style={{ background: "rgba(6, 8, 15, 0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:shadow-lg group-hover:shadow-indigo-500/20" style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)" }}>
              <svg width="16" height="16" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="navLogo" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#a5b4fc"/><stop offset="50%" stopColor="#6366f1"/><stop offset="100%" stopColor="#4338ca"/></linearGradient></defs><path d="M32 8 L13 54 h10 l4-10 h10 l4 10 h10 Z M32 22 l6 14 h-12 Z" fill="url(#navLogo)"/></svg>
            </div>
            <span className="text-base font-bold tracking-tight text-white">Atheon</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-[13px] font-medium text-white/50">
            <a href="#platform" className="hover:text-white transition-colors duration-200">Platform</a>
            <a href="#catalysts" className="hover:text-white transition-colors duration-200">Catalysts</a>
            <a href="#how" className="hover:text-white transition-colors duration-200">How It Works</a>
            <a href="#security" className="hover:text-white transition-colors duration-200">Security</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/login")} className="text-[13px] font-medium px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-all duration-200">Sign In</button>
            <button onClick={() => navigate("/login")} className="text-[13px] font-semibold px-5 py-2.5 rounded-lg text-white transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-px" style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1)", boxShadow: "0 2px 12px rgba(99, 102, 241, 0.3)" }}>
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ========== HERO ========== */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        {/* Canvas particle network */}
        <ParticleCanvas />

        {/* Gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-[700px] h-[700px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)", animation: "mk-glow-breathe 8s ease-in-out infinite" }} />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, transparent 70%)", animation: "mk-glow-breathe 10s ease-in-out 3s infinite" }} />
        <div className="absolute top-1/3 right-1/6 w-[300px] h-[300px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(14, 165, 233, 0.08) 0%, transparent 70%)", animation: "mk-glow-breathe 7s ease-in-out 1s infinite" }} />

        {/* Orbiting elements */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: 0.08 }}>
          <div className="relative w-0 h-0">
            <div className="absolute w-2 h-2 rounded-full bg-indigo-400" style={{ animation: "mk-orbit 20s linear infinite" }} />
            <div className="absolute w-1.5 h-1.5 rounded-full bg-violet-400" style={{ animation: "mk-orbit-sm 14s linear infinite reverse" }} />
            <div className="absolute w-1 h-1 rounded-full bg-cyan-400" style={{ animation: "mk-orbit-lg 28s linear 5s infinite" }} />
          </div>
        </div>

        {/* Mouse-following gradient spotlight */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(600px circle at var(--mx) var(--my), rgba(99, 102, 241, 0.04), transparent 60%)" }} />

        {/* Hero content */}
        <div className="relative max-w-5xl mx-auto px-6 text-center z-10">
          <div style={{ animation: "mk-hero-text 1s cubic-bezier(.16,1,.3,1) forwards", animationDelay: "0.1s", opacity: 0 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-semibold mb-10 border border-indigo-500/20" style={{ background: "rgba(99, 102, 241, 0.08)", color: "#a5b4fc" }}>
              <IconBolt size={12} /> Enterprise Intelligence Platform
            </div>
          </div>

          <h1 style={{ animation: "mk-hero-text 1s cubic-bezier(.16,1,.3,1) forwards", animationDelay: "0.25s", opacity: 0 }} className="text-5xl sm:text-6xl lg:text-[5.5rem] font-extrabold leading-[1.02] tracking-tight mb-8">
            <span className="text-white">The AI that doesn{"\u2019"}t</span><br />
            <span className="text-white">just analyse </span>
            <span style={{ backgroundImage: "linear-gradient(135deg, #a5b4fc, #6366f1, #8b5cf6, #06b6d4, #a5b4fc)", backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "mk-text-shimmer 5s linear infinite" }}>
              {"— it acts"}
            </span>
          </h1>

          <p style={{ animation: "mk-hero-text 1s cubic-bezier(.16,1,.3,1) forwards", animationDelay: "0.45s", opacity: 0 }} className="text-lg lg:text-xl text-white/50 leading-relaxed max-w-2xl mx-auto mb-4">
            Six AI intelligence layers working as one. From executive health scoring to autonomous execution, Atheon transforms raw ERP data into strategic advantage.
          </p>

          <p style={{ animation: "mk-hero-text 1s cubic-bezier(.16,1,.3,1) forwards", animationDelay: "0.55s", opacity: 0 }} className="text-sm text-white/30 max-w-xl mx-auto mb-12">
            Catalysts are the evolution of enterprise AI agents. They don{"\u2019"}t just recommend {"—"} they execute.
          </p>

          <div style={{ animation: "mk-hero-text 1s cubic-bezier(.16,1,.3,1) forwards", animationDelay: "0.65s", opacity: 0 }} className="flex flex-col sm:flex-row gap-4 justify-center mb-20">
            <button onClick={() => navigate("/login")} className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-[15px] font-semibold text-white transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 group" style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1)", boxShadow: "0 4px 24px rgba(99, 102, 241, 0.35)" }}>
              Start Free Trial <IconArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <button onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })} className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-[15px] font-semibold text-white/70 border border-white/10 transition-all duration-300 hover:bg-white/5 hover:text-white hover:border-white/20">
              <IconPlay size={16} /> See How It Works
            </button>
          </div>

          {/* Stats row */}
          <div style={{ animation: "mk-hero-text 1.2s cubic-bezier(.16,1,.3,1) forwards", animationDelay: "0.85s", opacity: 0 }} className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {stats.map((s) => (
              <div key={s.label} className="text-center group">
                <div className="text-3xl lg:text-4xl font-extrabold text-white mb-1 transition-all duration-300 group-hover:text-indigo-300" style={{ animation: "mk-number-pop 4s ease-in-out infinite" }}>
                  <AnimatedCounter value={s.value} prefix={s.prefix} suffix={s.suffix} />
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2" style={{ animation: "mk-float 2s ease-in-out infinite" }}>
          <div className="w-6 h-10 rounded-full border-2 border-white/10 flex items-start justify-center p-1.5">
            <div className="w-1 h-2.5 rounded-full bg-white/30" style={{ animation: "mk-float 1.5s ease-in-out infinite" }} />
          </div>
        </div>
      </section>

      {/* ========== TRUST BAR ========== */}
      <section className="py-14 relative overflow-hidden" style={{ borderTop: "1px solid rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
        <div className="text-center mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/20">Trusted by forward-thinking enterprises</p>
        </div>
        <div className="relative overflow-hidden" style={{ maskImage: "linear-gradient(90deg, transparent, black 15%, black 85%, transparent)" }}>
          <div className="flex gap-16 items-center whitespace-nowrap" style={{ animation: "mk-logo-scroll 30s linear infinite" }}>
            {[...trustLogos, ...trustLogos].map((logo, i) => (
              <span key={i} className="text-lg font-bold tracking-tight text-white/[0.07] select-none flex-shrink-0">{logo}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PLATFORM LAYERS - BENTO GRID ========== */}
      <section id="platform" className="py-24 lg:py-36 relative">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(99, 102, 241, 0.04) 0%, transparent 60%)" }} />
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="mk-reveal inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-5 uppercase tracking-[0.15em] border border-indigo-500/15" style={{ background: "rgba(99, 102, 241, 0.06)", color: "#a5b4fc" }}>
              Platform Architecture
            </div>
            <h2 className="mk-reveal mk-reveal-d1 text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-5">
              Six layers of <span style={{ backgroundImage: "linear-gradient(135deg, #a5b4fc, #6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>intelligence</span>
            </h2>
            <p className="mk-reveal mk-reveal-d2 text-base text-white/40 max-w-xl mx-auto leading-relaxed">
              Each layer works independently and as a unified system {"—"} from data ingestion to autonomous action.
            </p>
          </div>

          {/* Bento grid: 2 large top + 4 small bottom, or 3x2 on mobile */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {layers.map((layer, i) => {
              const LIcon = layer.Icon;
              const isLarge = i < 2;
              return (
                <div
                  key={layer.title}
                  className={`mk-reveal mk-reveal-d${(i % 3) + 1} mk-glass mk-bento-tilt rounded-2xl ${isLarge && i === 0 ? "lg:col-span-2" : ""} p-7 relative group overflow-hidden`}
                >
                  {/* Hover spotlight */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(400px circle at var(--mx) var(--my), ${layer.color}08, transparent 60%)` }} />

                  <div className="relative z-10">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg" style={{ background: `${layer.color}15`, boxShadow: `0 0 0 1px ${layer.color}20` }}>
                      <LIcon size={22} style={{ color: layer.color }} />
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-base font-bold text-white">{layer.title}</h3>
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: `${layer.color}99` }}>{layer.subtitle}</span>
                    </div>
                    <p className="text-[13px] text-white/40 leading-relaxed mb-5">{layer.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {layer.benefits.map(b => (
                        <span key={b} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium" style={{ background: `${layer.color}0a`, color: `${layer.color}aa`, border: `1px solid ${layer.color}15` }}>
                          <IconCheckCircle size={10} /> {b}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========== CATALYSTS SPOTLIGHT ========== */}
      <section id="catalysts" className="py-24 lg:py-36 relative overflow-hidden">
        {/* Animated rings */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full pointer-events-none" style={{ border: "1px solid rgba(139, 92, 246, 0.06)", animation: "mk-pulse-ring 5s ease-in-out infinite" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ border: "1px solid rgba(99, 102, 241, 0.04)", animation: "mk-pulse-ring 5s ease-in-out 1.5s infinite" }} />

        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(139, 92, 246, 0.05) 0%, transparent 60%)" }} />

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="mk-reveal inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold mb-6 uppercase tracking-[0.15em] border" style={{ background: "rgba(139, 92, 246, 0.08)", color: "#c4b5fd", borderColor: "rgba(139, 92, 246, 0.2)", animation: "mk-border-glow 3s ease-in-out infinite" }}>
              <IconCatalysts size={14} /> The Evolution of AI Agents
            </div>
            <h2 className="mk-reveal mk-reveal-d1 text-3xl sm:text-4xl lg:text-[3.5rem] font-extrabold text-white tracking-tight mb-6 leading-[1.05]">
              Meet{" "}
              <span style={{ backgroundImage: "linear-gradient(135deg, #c4b5fd, #8b5cf6, #6366f1, #c4b5fd)", backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "mk-text-shimmer 4s linear infinite" }}>
                Catalysts
              </span>
            </h2>
            <p className="mk-reveal mk-reveal-d2 text-base text-white/40 max-w-2xl mx-auto leading-relaxed">
              Today{"\u2019"}s AI assistants tell you what to do. <strong className="text-white/70">Catalysts actually do it.</strong> Purpose-built autonomous agents that understand context, execute workflows, handle exceptions, and learn.
            </p>
          </div>

          {/* Evolution comparison */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
            {/* Traditional RPA */}
            <div className="mk-reveal mk-reveal-d1 mk-glass rounded-2xl p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/25 mb-4">Traditional RPA</div>
              <div className="space-y-3">
                {["Scripted workflows", "Breaks on exceptions", "No context awareness", "Manual maintenance"].map(item => (
                  <div key={item} className="flex items-center gap-2.5 text-[13px] text-white/30">
                    <IconCross size={12} className="text-red-400/60 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>

            {/* AI Copilots */}
            <div className="mk-reveal mk-reveal-d2 mk-glass rounded-2xl p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/25 mb-4">AI Copilots</div>
              <div className="space-y-3">
                {["Recommendations only", "Human must execute", "Limited domain knowledge", "No persistent memory"].map(item => (
                  <div key={item} className="flex items-center gap-2.5 text-[13px] text-white/30">
                    <IconCross size={12} className="text-amber-400/60 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Atheon Catalysts */}
            <div className="mk-reveal mk-reveal-d3 rounded-2xl p-6 relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.05))", border: "1px solid rgba(139, 92, 246, 0.2)", animation: "mk-border-glow 3s ease-in-out infinite" }}>
              <div className="absolute -top-px -right-px px-3 py-1 rounded-bl-xl rounded-tr-xl text-[9px] font-bold uppercase tracking-wider text-white" style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}>Next Gen</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-300/80 mb-4">Atheon Catalysts</div>
              <div className="space-y-3">
                {["Autonomous execution", "Handles exceptions", "Full domain context", "Learns & improves"].map(item => (
                  <div key={item} className="flex items-center gap-2.5 text-[13px] text-white/80 font-medium">
                    <IconCheckCircle size={12} className="text-violet-400 flex-shrink-0" /> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Use cases */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {catalystUseCases.map((uc, i) => {
              const UCIcon = uc.Icon;
              return (
                <div key={uc.title} className={`mk-reveal mk-reveal-d${i + 1} mk-glass mk-bento-tilt rounded-2xl p-6 group`}>
                  <div className="flex items-start gap-5">
                    <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 group-hover:scale-110" style={{ background: "rgba(139, 92, 246, 0.08)", boxShadow: "0 0 0 1px rgba(139, 92, 246, 0.15)" }}>
                      <UCIcon size={24} style={{ color: "#a78bfa" }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-white mb-1.5">{uc.title}</h3>
                      <p className="text-[13px] text-white/35 leading-relaxed mb-4">{uc.desc}</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-extrabold text-violet-300">{uc.metric}</span>
                        <span className="text-[11px] font-medium text-white/30">{uc.metricLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========== WHY ATHEON ========== */}
      <section className="py-24 lg:py-36 relative" style={{ background: "linear-gradient(180deg, #06080f 0%, #0a0d1a 100%)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 40% at 50% 100%, rgba(99, 102, 241, 0.04) 0%, transparent 60%)" }} />
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="mk-reveal inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-5 uppercase tracking-[0.15em] border border-indigo-500/15" style={{ background: "rgba(99, 102, 241, 0.06)", color: "#a5b4fc" }}>
              Why Atheon
            </div>
            <h2 className="mk-reveal mk-reveal-d1 text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-5">
              Not another dashboard.<br className="hidden sm:block" /> Not another chatbot.
            </h2>
            <p className="mk-reveal mk-reveal-d2 text-base text-white/40 max-w-xl mx-auto leading-relaxed">
              Fundamentally different from traditional BI, RPA, and AI copilot tools.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {whyAtheon.map((item, i) => {
              const WIcon = item.Icon;
              return (
                <div key={item.title} className={`mk-reveal mk-reveal-d${i + 1} mk-glass mk-bento-tilt rounded-2xl p-7 group`}>
                  <div className="flex items-start gap-5">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 group-hover:scale-110 group-hover:rotate-3" style={{ background: "rgba(99, 102, 241, 0.08)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.12)" }}>
                      <WIcon size={22} className="text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white mb-2">{item.title}</h3>
                      <p className="text-[13px] text-white/35 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section id="how" className="py-24 lg:py-36 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="mk-reveal inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold mb-5 uppercase tracking-[0.15em] border border-indigo-500/15" style={{ background: "rgba(99, 102, 241, 0.06)", color: "#a5b4fc" }}>
              Getting Started
            </div>
            <h2 className="mk-reveal mk-reveal-d1 text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-5">
              From data to decision in{" "}
              <span style={{ backgroundImage: "linear-gradient(135deg, #a5b4fc, #6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>seconds</span>
            </h2>
            <p className="mk-reveal mk-reveal-d2 text-base text-white/40 max-w-lg mx-auto leading-relaxed">
              Four steps. No complex setup. No data migration. Start seeing results immediately.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative">
            {/* Animated connecting line */}
            <div className="hidden lg:block absolute top-20 left-[15%] right-[15%] h-px">
              <div className="h-full w-full" style={{ background: "linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.15), rgba(99, 102, 241, 0.15), transparent)" }} />
              <div className="absolute top-0 left-0 h-full w-20" style={{ background: "linear-gradient(90deg, rgba(99, 102, 241, 0.5), transparent)", animation: "mk-gradient-shift 4s linear infinite", backgroundSize: "300% 100%" }} />
            </div>

            {steps.map((s, i) => {
              const SIcon = s.Icon;
              return (
                <div key={s.num} className={`mk-reveal mk-reveal-d${i + 1} mk-glass mk-bento-tilt rounded-2xl p-6 text-center group`}>
                  <div className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-indigo-500/15" style={{ background: "rgba(99, 102, 241, 0.06)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.1)" }}>
                    <SIcon size={26} className="text-indigo-400" />
                  </div>
                  <div className="text-[10px] font-bold mb-3 uppercase tracking-[0.2em] text-indigo-400/30">{s.num}</div>
                  <h3 className="text-sm font-bold text-white mb-2">{s.title}</h3>
                  <p className="text-[13px] text-white/35 leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========== SECURITY ========== */}
      <section id="security" className="py-24 lg:py-36 relative" style={{ background: "linear-gradient(180deg, #06080f 0%, #080b16 100%)" }}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="mk-reveal mk-glass-strong rounded-3xl p-10 lg:p-16 relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute top-0 right-0 w-80 h-80 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(99, 102, 241, 0.06) 0%, transparent 70%)", animation: "mk-glow-breathe 6s ease-in-out infinite" }} />

            <div className="flex flex-col lg:flex-row items-start gap-12 relative">
              <div className="flex-1">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6" style={{ background: "rgba(99, 102, 241, 0.08)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.12)", animation: "mk-float-slow 5s ease-in-out infinite" }}>
                  <IconShield size={28} className="text-indigo-400" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-5">Enterprise-grade<br />security</h2>
                <p className="text-[14px] text-white/40 leading-relaxed mb-4 max-w-md">
                  Zero-trust architecture. End-to-end encryption. Comprehensive audit logging. Your data never leaves your security boundary.
                </p>
                <p className="text-[13px] text-white/25 leading-relaxed max-w-md">
                  SaaS, on-premise, or hybrid. Your security team stays in control.
                </p>
              </div>
              <div className="flex-1 w-full">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {securityFeatures.map((f, i) => {
                    const FIcon = f.Icon;
                    return (
                      <div key={f.label} className={`mk-reveal mk-reveal-d${(i % 4) + 1} flex items-center gap-3 p-3.5 rounded-xl transition-all duration-300 hover:bg-white/[0.03]`}>
                        <FIcon size={16} className="text-indigo-400/70 flex-shrink-0" />
                        <span className="text-[13px] font-medium text-white/50">{f.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className="py-28 lg:py-40 relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(99, 102, 241, 0.06) 0%, transparent 60%)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ border: "1px solid rgba(99, 102, 241, 0.04)", animation: "mk-pulse-ring 6s ease-in-out infinite" }} />

        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <div className="mk-reveal w-20 h-20 rounded-2xl mx-auto mb-10 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)", boxShadow: "0 8px 50px rgba(99, 102, 241, 0.35)", animation: "mk-float 4s ease-in-out infinite" }}>
            <svg width="36" height="36" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="ctaLogo" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#a5b4fc"/><stop offset="50%" stopColor="#6366f1"/><stop offset="100%" stopColor="#4338ca"/></linearGradient></defs><path d="M32 8 L13 54 h10 l4-10 h10 l4 10 h10 Z M32 22 l6 14 h-12 Z" fill="url(#ctaLogo)"/></svg>
          </div>

          <h2 className="mk-reveal mk-reveal-d1 text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-6">
            Ready to redefine<br />enterprise intelligence?
          </h2>
          <p className="mk-reveal mk-reveal-d2 text-base text-white/40 leading-relaxed mb-4 max-w-lg mx-auto">
            Join the organisations deploying Catalysts to transform operational data into autonomous action.
          </p>
          <p className="mk-reveal mk-reveal-d3 text-sm text-white/25 leading-relaxed mb-12 max-w-md mx-auto">
            All six intelligence layers. No credit card required. Deploy in under 15 minutes.
          </p>
          <div className="mk-reveal mk-reveal-d4 flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => navigate("/login")} className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-[15px] font-semibold text-white transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 group" style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1)", boxShadow: "0 4px 24px rgba(99, 102, 241, 0.35)" }}>
              Start Free Trial <IconArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <button className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-[15px] font-semibold text-white/60 border border-white/10 transition-all duration-300 hover:bg-white/5 hover:text-white hover:border-white/20">
              Contact Sales <IconChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }} className="py-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)" }}>
                <svg width="12" height="12" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="ftLogo" x1="16" y1="8" x2="48" y2="56"><stop offset="0%" stopColor="#a5b4fc"/><stop offset="50%" stopColor="#6366f1"/><stop offset="100%" stopColor="#4338ca"/></linearGradient></defs><path d="M32 8 L13 54 h10 l4-10 h10 l4 10 h10 Z M32 22 l6 14 h-12 Z" fill="url(#ftLogo)"/></svg>
              </div>
              <span className="text-sm font-bold tracking-tight text-white/80">Atheon</span>
            </div>
            <div className="flex items-center gap-8 text-[13px] text-white/25">
              <a href="#platform" className="hover:text-white/60 transition-colors">Platform</a>
              <a href="#catalysts" className="hover:text-white/60 transition-colors">Catalysts</a>
              <a href="#security" className="hover:text-white/60 transition-colors">Security</a>
              <span>&copy; {new Date().getFullYear()} Atheon</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
