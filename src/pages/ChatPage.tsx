import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayerBadge } from "@/components/ui/layer-badge";
import { chatThreads } from "@/data/mockData";
import { MessageSquare, Send, Bookmark, Plus, User, Sparkles } from "lucide-react";
import type { AtheonLayer } from "@/types";

export function ChatPage() {
  const [input, setInput] = useState('');
  const [activeThread] = useState(chatThreads[0]);

  const suggestedQueries = [
    { text: 'Why is OTIF declining?', layer: 'pulse' as AtheonLayer },
    { text: 'Show me today\'s executive briefing', layer: 'apex' as AtheonLayer },
    { text: 'Which catalysts need approval?', layer: 'catalysts' as AtheonLayer },
    { text: 'What is our current FX exposure?', layer: 'apex' as AtheonLayer },
    { text: 'Show process bottlenecks in P2P', layer: 'pulse' as AtheonLayer },
    { text: 'Deploy a new finance catalyst', layer: 'catalysts' as AtheonLayer },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Atheon Chat</h1>
          <p className="text-sm text-neutral-400">Unified conversational interface across all intelligence layers</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Thread List */}
        <div className="space-y-3">
          <Button variant="primary" size="sm" className="w-full"><Plus size={14} /> New Thread</Button>
          {chatThreads.map((thread) => (
            <Card key={thread.id} hover className={thread.id === activeThread?.id ? 'border-indigo-500/30' : ''}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-white">{thread.title}</h3>
                  <span className="text-[10px] text-neutral-500">{new Date(thread.updatedAt).toLocaleString()}</span>
                </div>
                {thread.bookmarked && <Bookmark size={12} className="text-amber-400 fill-amber-400" />}
              </div>
              {thread.layer && <LayerBadge layer={thread.layer} className="mt-1.5" />}
            </Card>
          ))}
        </div>

        {/* Chat Area */}
        <div className="lg:col-span-3">
          <Card className="flex flex-col" style={{ minHeight: '600px' }}>
            {/* Messages */}
            <div className="flex-1 space-y-4 mb-4 overflow-y-auto">
              {activeThread?.messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-2xl rounded-xl p-4 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600/20 border border-indigo-500/20'
                      : 'bg-neutral-800/40 border border-neutral-800/50'
                  }`}>
                    <div className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
                      {msg.content.split('\n').map((line, i) => {
                        if (line.startsWith('**') && line.endsWith('**')) {
                          return <p key={i} className="font-semibold text-white mt-2 mb-1">{line.replace(/\*\*/g, '')}</p>;
                        }
                        if (line.startsWith('- ')) {
                          return <p key={i} className="ml-3 text-neutral-300">{line}</p>;
                        }
                        return <p key={i} className={line === '' ? 'h-2' : ''}>{line}</p>;
                      })}
                    </div>

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {msg.citations.map((cit) => (
                          <div key={cit.id} className="flex items-center gap-2 p-2 rounded bg-neutral-800/60 text-xs">
                            <span className="text-indigo-400">📎</span>
                            <span className="text-neutral-300">{cit.source}</span>
                            <Badge variant="info" size="sm">{Math.round(cit.confidence * 100)}%</Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.layer && <LayerBadge layer={msg.layer} className="mt-2" />}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-lg bg-neutral-700 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-neutral-300" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Suggested Queries */}
            <div className="mb-3">
              <span className="text-[10px] text-neutral-600 uppercase tracking-wider mb-2 block">Suggested</span>
              <div className="flex flex-wrap gap-2">
                {suggestedQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q.text)}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800/40 border border-neutral-800/50 text-xs text-neutral-300 hover:bg-neutral-800/60 hover:border-neutral-700/50 transition-all"
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
                  placeholder="Ask Atheon anything across your enterprise..."
                  className="w-full px-4 py-3 rounded-xl bg-neutral-800/60 border border-neutral-700/50 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                />
              </div>
              <Button variant="primary" size="md" className="px-4">
                <Send size={16} />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
