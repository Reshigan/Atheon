import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayerBadge } from "@/components/ui/layer-badge";
import { api } from "@/lib/api";
import type { MindQueryResult } from "@/lib/api";
import { MessageSquare, Send, Plus, User, Sparkles, Loader2 } from "lucide-react";
import type { AtheonLayer } from "@/types";

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  layer?: AtheonLayer;
  citations?: { id: string; source: string; confidence: number }[];
}

export function ChatPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // 3.11: Load chat conversation history from mind_queries on mount
  useEffect(() => {
    api.mind.history()
      .then((data) => {
        const restored: ChatMessage[] = [];
        for (const item of data.queries) {
          restored.push({ id: `u-${item.id}`, role: 'user', content: item.query });
          restored.push({
            id: item.id,
            role: 'assistant',
            content: item.response,
            citations: item.citations.map((c: string, i: number) => ({ id: `c-${i}`, source: c, confidence: 0.9 })),
          });
        }
        setMessages(restored);
      })
      .catch(() => { /* no history available */ })
      .finally(() => setLoadingHistory(false));
  }, []);

  const suggestedQueries = [
    { text: 'Why is OTIF declining?', layer: 'pulse' as AtheonLayer },
    { text: 'Show me today\'s executive briefing', layer: 'apex' as AtheonLayer },
    { text: 'Which catalysts need approval?', layer: 'catalysts' as AtheonLayer },
    { text: 'What is our current FX exposure?', layer: 'apex' as AtheonLayer },
    { text: 'Show process bottlenecks in P2P', layer: 'pulse' as AtheonLayer },
    { text: 'Deploy a new finance catalyst', layer: 'catalysts' as AtheonLayer },
  ];

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const result: MindQueryResult = await api.mind.query(userMsg.content, 'tier-1');
      const assistantMsg: ChatMessage = {
        id: result.id,
        role: 'assistant',
        content: result.response,
        citations: result.citations.map((c, i) => ({ id: `c-${i}`, source: c, confidence: 0.9 })),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: 'Sorry, I could not process that query. Please try again.' }]);
    }
    setSending(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br        from-cyan-500/20 to-cyan-400/20 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-cyan-400"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Atheon Chat</h1>
          <p className="text-sm text-gray-500">Unified conversational interface across all intelligence layers</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Thread List */}
        <div className="space-y-3">
          <Button variant="primary" size="sm" className="w-full" onClick={() => { setMessages([]); setLoadingHistory(false); }}><Plus size={14} /> New Thread</Button>
          <Card hover className="border-cyan-500/20">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-medium text-white">Current Thread</h3>
                <span className="text-[10px] text-gray-400">{messages.length} messages</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Chat Area */}
        <div className="lg:col-span-3">
          <Card className="flex flex-col" style={{ minHeight: '600px' }}>
            {/* Messages */}
            <div className="flex-1 space-y-4 mb-4 overflow-y-auto">
              {loadingHistory && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading conversation history...</div>
              )}
              {!loadingHistory && messages.length === 0 && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Ask Atheon anything to get started</div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg                  bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                                        <Sparkles className="w-4 h-4 text-white" />
                                      </div>
                                    )}
                                    <div className={`max-w-2xl rounded-xl p-4 ${
                                      msg.role === 'user'
                                        ? 'bg-cyan-500/100/10 border border-cyan-500/20'
                                        : 'bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm'
                  }`}>
                    <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">
                      {msg.content.split('\n').map((line, i) => {
                        if (line.startsWith('**') && line.endsWith('**')) {
                          return <p key={i} className="font-semibold text-white mt-2 mb-1">{line.replace(/\*\*/g, '')}</p>;
                        }
                        if (line.startsWith('- ')) {
                          return <p key={i} className="ml-3 text-gray-400">{line}</p>;
                        }
                        return <p key={i} className={line === '' ? 'h-2' : ''}>{line}</p>;
                      })}
                    </div>

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {msg.citations.map((cit) => (
                          <div key={cit.id}                          className="flex items-center gap-2 p-2 rounded bg-white/[0.04] border border-white/[0.06] text-xs">
                                                      <span className="text-cyan-400">📎</span>
                            <span className="text-gray-400">{cit.source}</span>
                            <Badge variant="info" size="sm">{Math.round(cit.confidence * 100)}%</Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.layer && <LayerBadge layer={msg.layer} className="mt-2" />}
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
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                  </div>
                  <div className="rounded-xl p-4 bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                    <span className="text-sm text-gray-500">Thinking...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Suggested Queries */}
            <div className="mb-3">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider mb-2 block">Suggested</span>
              <div className="flex flex-wrap gap-2">
                {suggestedQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q.text)}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-gray-400 hover:bg-white/[0.04] hover:border-white/[0.08] backdrop-blur-sm transition-all"
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
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder-gray-400 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/30 transition-all"
                />
              </div>
              <Button variant="primary" size="md" className="px-4" onClick={handleSend} disabled={sending}>
                <Send size={16} />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
