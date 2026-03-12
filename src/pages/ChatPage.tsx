import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayerBadge } from "@/components/ui/layer-badge";
import { api } from "@/lib/api";
import type { MindQueryResult } from "@/lib/api";
import { MessageSquare, Send, Plus, User, Sparkles, Loader2, Trash2, ChevronDown } from "lucide-react";
import { IconAttachment } from "@/components/icons/AtheonIcons";
import type { AtheonLayer } from "@/types";

interface ChatMessage {
 id: string;
 role: 'user' | 'assistant';
 content: string;
 layer?: AtheonLayer;
 citations?: { id: string; source: string; confidence: number }[];
 tier?: string;
}

/** Phase 4.1: Render markdown-like formatting for assistant responses */
function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('### ')) return <h4 key={i} className="font-semibold t-primary mt-3 mb-1 text-sm">{line.slice(4)}</h4>;
    if (line.startsWith('## ')) return <h3 key={i} className="font-bold t-primary mt-3 mb-1">{line.slice(3)}</h3>;
    if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold t-primary mt-2 mb-1">{line.replace(/\*\*/g, '')}</p>;
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return <p key={i} className="ml-3 t-secondary flex items-start gap-1"><span className="text-accent mt-0.5 flex-shrink-0">•</span><span>{line.slice(2)}</span></p>;
    }
    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] || '';
      return <p key={i} className="ml-3 t-secondary flex items-start gap-2"><span className="text-accent font-mono text-xs mt-0.5 flex-shrink-0">{num}.</span><span>{line.replace(/^\d+\.\s/, '')}</span></p>;
    }
    if (line.includes('`')) {
      const parts = line.split(/(`[^`]+`)/);
      return <p key={i}>{parts.map((part, pi) => part.startsWith('`') && part.endsWith('`') ? <code key={pi} className="px-1 py-0.5 rounded bg-[var(--bg-secondary)] font-mono text-xs text-accent">{part.slice(1, -1)}</code> : part)}</p>;
    }
    if (line === '') return <p key={i} className="h-2" />;
    return <p key={i}>{line}</p>;
  });
}

interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

export function ChatPage() {
 const [input, setInput] = useState('');
 const [threads, setThreads] = useState<ChatThread[]>([]);
 const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
 const [sending, setSending] = useState(false);
 const [loadingHistory, setLoadingHistory] = useState(true);
 const [selectedTier, setSelectedTier] = useState<string>('tier-1');
 const [showTierMenu, setShowTierMenu] = useState(false);
 const messagesEndRef = useRef<HTMLDivElement>(null);

 const tierOptions = [
   { id: 'tier-1', label: 'Fast (Tier 1)', desc: 'Low latency, basic queries' },
   { id: 'tier-2', label: 'Standard (Tier 2)', desc: 'Balanced speed & depth' },
   { id: 'tier-3', label: 'Deep (Tier 3)', desc: 'Complex analysis, highest quality' },
 ];

 const activeThread= threads.find((t) => t.id === activeThreadId);
 const messages = activeThread?.messages ?? [];

 // Phase 4.1: Auto-scroll to bottom on new messages
 useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

 const createNewThread = useCallback(() => {
   const id = `thread-${Date.now()}`;
   const newThread: ChatThread = { id, title: 'New conversation', messages: [], createdAt: new Date().toISOString() };
   setThreads((prev) => [newThread, ...prev]);
   setActiveThreadId(id);
 }, []);

 // UX-09: Always start with a blank thread; load history threads in sidebar only
 useEffect(() => {
   const blankId = `thread-${Date.now()}`;
   const blankThread: ChatThread = { id: blankId, title: 'New conversation', messages: [], createdAt: new Date().toISOString() };

   api.mind.history()
     .then((data) => {
       const restored: ChatMessage[] = [];
       for (const item of data.queries) {
         restored.push({ id: `u-${item.id}`, role: 'user', content: item.query });
         restored.push({
           id: item.id,
           role: 'assistant',
           content: item.response,
           citations: item.citations.map((c: string, i: number) => ({ id: `c-${i}`, source: c, confidence: 0.9 }))});
       }
       if (restored.length > 0) {
         const historyThread: ChatThread = {
           id: 'history',
           title: restored[0]?.content?.slice(0, 40) || 'Previous conversation',
           messages: restored,
           createdAt: new Date().toISOString(),
         };
         // Blank thread is active; history available in sidebar
         setThreads([blankThread, historyThread]);
       } else {
         setThreads([blankThread]);
       }
     })
     .catch(() => {
       setThreads([blankThread]);
     })
     .finally(() => setLoadingHistory(false));

   setActiveThreadId(blankId);
 }, []);

 const suggestedQueries = [
 { text: 'Why is OTIF declining?', layer: 'pulse' as AtheonLayer },
 { text: 'Show me today\'s executive briefing', layer: 'apex' as AtheonLayer },
 { text: 'Which catalysts need approval?', layer: 'catalysts' as AtheonLayer },
 { text: 'What is our current FX exposure?', layer: 'apex' as AtheonLayer },
 { text: 'Show process bottlenecks in P2P', layer: 'pulse' as AtheonLayer },
 { text: 'Deploy a new finance catalyst', layer: 'catalysts' as AtheonLayer },
 ];

 const addMessageToThread = useCallback((threadId: string, msg: ChatMessage) => {
   setThreads((prev) => prev.map((t) => {
     if (t.id !== threadId) return t;
     const updated = { ...t, messages: [...t.messages, msg] };
     // Auto-title thread from first user message
     if (t.title === 'New conversation' && msg.role === 'user') {
       updated.title = msg.content.slice(0, 40) + (msg.content.length > 40 ? '...' : '');
     }
     return updated;
   }));
 }, []);

 const deleteThread = useCallback((threadId: string) => {
   setThreads((prev) => {
     const remaining = prev.filter((t) => t.id !== threadId);
     if (remaining.length === 0) {
       const id = `thread-${Date.now()}`;
       const fresh: ChatThread = { id, title: 'New conversation', messages: [], createdAt: new Date().toISOString() };
       setActiveThreadId(id);
       return [fresh];
     }
     if (activeThreadId === threadId) setActiveThreadId(remaining[0].id);
     return remaining;
   });
 }, [activeThreadId]);

 const handleSend = async () => {
 if (!input.trim() || sending || !activeThreadId) return;
 const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: input, tier: selectedTier };
  addMessageToThread(activeThreadId, userMsg);
  setInput('');
  setSending(true);
  try {
  const result: MindQueryResult = await api.mind.query(userMsg.content, selectedTier);
  const assistantMsg: ChatMessage = {
  id: result.id,
  role: 'assistant',
  content: result.response,
  tier: selectedTier,
  citations: result.citations.map((c, i) => ({ id: `c-${i}`, source: c, confidence: 0.9 }))};
 addMessageToThread(activeThreadId, assistantMsg);
 } catch {
 addMessageToThread(activeThreadId, { id: `e-${Date.now()}`, role: 'assistant', content: 'Sorry, I could not process that query. Please try again.' });
 }
 setSending(false);
 };

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center">
 <MessageSquare className="w-5 h-5 text-accent"/>
 </div>
 <div>
 <h1 className="text-2xl font-bold t-primary">Atheon Chat</h1>
 <p className="text-sm t-muted">Unified conversational interface across all intelligence layers</p>
 </div>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
 {/* Sidebar - Thread List (Bug #8: multi-thread support) */}
 <div className="space-y-3">
 <Button variant="primary" size="sm" className="w-full" onClick={createNewThread} title="Start a new conversation thread"><Plus size={14} /> New Thread</Button>
  {/* Phase 4.1: Model tier selector */}
  <div className="relative">
    <button onClick={() => setShowTierMenu(!showTierMenu)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-secondary hover:border-accent/30 transition-all" title="Select AI model tier">
      <span className="text-xs">{tierOptions.find(t => t.id === selectedTier)?.label}</span>
      <ChevronDown size={14} className={`transition-transform ${showTierMenu ? 'rotate-180' : ''}`} />
    </button>
    {showTierMenu && (
      <div className="absolute z-10 w-full mt-1 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card-solid)] shadow-lg overflow-hidden">
        {tierOptions.map(tier => (
          <button key={tier.id} onClick={() => { setSelectedTier(tier.id); setShowTierMenu(false); }} className={`w-full text-left px-3 py-2 text-xs hover:bg-accent/10 transition-colors ${selectedTier === tier.id ? 'bg-accent/5 text-accent' : 't-secondary'}`}>
            <div className="font-medium">{tier.label}</div>
            <div className="text-[10px] text-gray-400">{tier.desc}</div>
          </button>
        ))}
      </div>
    )}
  </div>
  {threads.map((thread) => (
 <Card
   key={thread.id}
   hover
   className={`cursor-pointer ${thread.id === activeThreadId ? 'border-accent/30' : ''}`}
   onClick={() => setActiveThreadId(thread.id)}
 >
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1 min-w-0">
 <h3 className="text-sm font-medium t-primary truncate">{thread.title}</h3>
 <span className="text-[10px] text-gray-400">{thread.messages.length} messages</span>
 </div>
 {threads.length > 1 && (
   <button
     onClick={(e) => { e.stopPropagation(); deleteThread(thread.id); }}
     className="p-1 rounded hover:bg-red-500/10 transition-colors"
     title="Delete this conversation thread"
   >
     <Trash2 size={12} className="text-gray-400 hover:text-red-400" />
   </button>
 )}
 </div>
 </Card>
 ))}
 </div>

 {/* Chat Area */}
 <div className="lg:col-span-3">
 <Card className="flex flex-col" style={{ minHeight: '600px' }}>
 {/* Messages */}
 <div className="flex-1 space-y-4 mb-4 overflow-y-auto" style={{ maxHeight: '500px' }}>
 {loadingHistory && (
 <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading conversation history...</div>
 )}
 {!loadingHistory && messages.length === 0 && (
  <div className="flex flex-col items-center justify-center h-40 text-gray-400">
    <Sparkles className="w-8 h-8 text-accent/30 mb-3" />
    <p className="text-sm">Ask Atheon anything to get started</p>
    <p className="text-xs text-gray-500 mt-1">Select a suggested query below or type your own</p>
  </div>
  )}
 {messages.map((msg) => (
 <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
 {msg.role === 'assistant' && (
 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-[#3d6ce6] flex items-center justify-center flex-shrink-0">
 <Sparkles className="w-4 h-4 text-white" />
 </div>
 )}
 <div className={`max-w-2xl rounded-xl p-4 ${
 msg.role === 'user'
 ? 'bg-accent/10 border border-accent/20'
 : 'bg-[var(--bg-secondary)] border border-[var(--border-card)]'
 }`}>
 <div className="text-sm t-primary whitespace-pre-wrap leading-relaxed">
  {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
  </div>

 {/* Citations */}
 {msg.citations && msg.citations.length > 0 && (
 <div className="mt-3 space-y-1.5">
 {msg.citations.map((cit) => (
 <div key={cit.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs">
 <IconAttachment size={12} className="text-accent" />
 <span className="text-gray-400">{cit.source}</span>
 <Badge variant="info" size="sm">{Math.round(cit.confidence * 100)}%</Badge>
 </div>
 ))}
 </div>
 )}

 {msg.layer && <LayerBadge layer={msg.layer} className="mt-2" />}
  {msg.tier && <span className="text-[10px] text-gray-500 mt-1 block">Model: {tierOptions.find(t => t.id === msg.tier)?.label || msg.tier}</span>}
  </div>
 {msg.role === 'user' && (
 <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0">
 <User className="w-4 h-4 text-gray-400" />
 </div>
 )}
 </div>
 ))}
 {sending && (
 <div className="flex gap-3">
 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-[#3d6ce6] flex items-center justify-center flex-shrink-0">
 <Loader2 className="w-4 h-4 text-white animate-spin" />
 </div>
 <div className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-center gap-2">
    <span className="text-sm t-muted">Thinking</span>
    <span className="flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  </div>
  </div>
  </div>
  )}
  <div ref={messagesEndRef} />
  </div>

 {/* Suggested Queries */}
 <div className="mb-3">
 <span className="text-[10px] text-gray-400 uppercase tracking-wider mb-2 block">Suggested</span>
 <div className="flex flex-wrap gap-2">
 {suggestedQueries.map((q, i) => (
 <button
 key={i}
 onClick={() => setInput(q.text)}
 className="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs text-gray-400 hover:bg-[var(--bg-card)] hover:border-accent/30 hover:text-accent transition-all"
 title="Click to use this suggested query"
 >
 {q.text}
 </button>
 ))}
 </div>
 </div>

 {/* Input */}
 <div className="flex items-center gap-3">
 <div className="flex-1 relative">
 <input
 type="text"
 value={input}
 onChange={(e) => setInput(e.target.value)}
 onKeyDown={(e) => e.key === 'Enter' && handleSend()}
 placeholder="Ask Atheon anything across your enterprise..."
 className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all"
 />
 </div>
 <Button variant="primary" size="md" className="px-4" onClick={handleSend} disabled={sending} title="Send message">
 <Send size={16} />
 </Button>
 </div>
 </Card>
 </div>
 </div>
 </div>
 );
}
