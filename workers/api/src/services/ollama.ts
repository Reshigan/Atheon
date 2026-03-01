/**
 * Ollama Cloud LLM Service
 * Integrates with the Ollama Cloud API (https://ollama.com/api) using the Reshigan/atheon model.
 * Falls back to Cloudflare Workers AI if Ollama is unavailable.
 */

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  model?: string;
  messages: OllamaChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface OllamaChatResponse {
  response: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  provider: 'ollama-cloud' | 'workers-ai';
}

const OLLAMA_API_BASE = 'https://ollama.com/api';
const DEFAULT_MODEL = 'Reshigan/atheon';

/**
 * Call the Ollama Cloud API for chat completions.
 * Uses the OpenAI-compatible /v1/chat/completions endpoint on ollama.com.
 */
export async function ollamaChat(
  apiKey: string,
  options: OllamaChatOptions,
): Promise<OllamaChatResponse> {
  const model = options.model || DEFAULT_MODEL;

  const body = {
    model,
    messages: options.messages,
    stream: false,
    options: {
      num_predict: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.7,
    },
  };

  const res = await fetch(`${OLLAMA_API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Ollama Cloud API error ${res.status}: ${errorText}`);
  }

  const data = await res.json() as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    model?: string;
  };

  const responseText = data.message?.content || '';
  const tokensIn = data.prompt_eval_count || Math.ceil(options.messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
  const tokensOut = data.eval_count || Math.ceil(responseText.length / 4);

  return {
    response: responseText,
    model: data.model || model,
    tokensIn,
    tokensOut,
    provider: 'ollama-cloud',
  };
}

/**
 * Chat with fallback: tries Ollama Cloud first, falls back to Workers AI.
 */
export async function chatWithFallback(
  apiKey: string | undefined,
  ai: Ai,
  options: OllamaChatOptions & { workersAiModel?: string },
): Promise<OllamaChatResponse> {
  // Try Ollama Cloud first if API key is available
  if (apiKey) {
    try {
      return await ollamaChat(apiKey, options);
    } catch (err) {
      console.error('Ollama Cloud failed, falling back to Workers AI:', err);
    }
  }

  // Fallback to Workers AI
  const workersModel = options.workersAiModel || '@cf/meta/llama-3.1-8b-instruct';
  const result = await ai.run(workersModel as Parameters<Ai['run']>[0], {
    messages: options.messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: options.maxTokens || 2048,
    temperature: options.temperature ?? 0.7,
  });

  const aiResult = result as { response?: string };
  const response = aiResult.response || '';

  return {
    response,
    model: workersModel,
    tokensIn: Math.ceil(options.messages.reduce((acc, m) => acc + m.content.length, 0) / 4),
    tokensOut: Math.ceil(response.length / 4),
    provider: 'workers-ai',
  };
}
