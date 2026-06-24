import 'server-only';
import { getServerEnv } from '@/lib/env';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// Calls an LLM via OpenRouter (OpenAI-compatible) with a full conversation thread,
// so follow-up questions keep context. Model is configurable (OPENROUTER_MODEL).
export async function askAI(messages: ChatMessage[]): Promise<string> {
  const env = getServerEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('The AI Advisor is not switched on yet. Add your OpenRouter key to enable it.');
  }
  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'IFMS Farm Advisor',
      },
      body: JSON.stringify({ model: env.OPENROUTER_MODEL, messages, max_tokens: 800, temperature: 0.4 }),
    });
  } catch {
    throw new Error("Couldn't reach the AI service. Check the connection and try again.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('The AI key was rejected. Please check your OpenRouter key.');
    if (res.status === 429) throw new Error('The AI is busy right now (rate limited). Try again shortly.');
    throw new Error('The AI service had a problem. Please try again.');
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() || 'I could not generate an answer this time — try rephrasing.';
}
