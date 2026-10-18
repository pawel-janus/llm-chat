/**
 * Agent loop: Gemini decides which tools to call, we run them and hand the
 * results back, until the model answers in text or the round limit is hit.
 */

import type { Content, Part } from '@google/genai';
import { ai, modelName } from '../llm/gemini.js';
import { executeTool, toolDeclarations } from './tools.js';

const MAX_ROUNDS = 6;
const PREVIEW_CHARS = 300;

const SYSTEM_INSTRUCTION = `You are a financial data assistant. You answer questions about six US companies using tools that read SEC filing figures and daily stock prices.

Rules:
- Every number in your answer must come from a tool result. Never use figures from memory and never invent or estimate numbers.
- State the period of every SEC figure (period_end, and whether it is a full year or a quarter) and the date of every price (the price_date returned, which can differ from the date asked for).
- The SEC data ends around the end of 2020, while prices run to 2026. Never present figures from different dates as one point in time, and never call old SEC data current.
- Stock prices are adjusted for splits and dividends; say so when you quote a price.
- If a tool returns no data or an error, say what is missing and why. Do not fill the gap. If a company is not covered, say so.
- P/E and other ratios that combine SEC figures with prices are not available. Say why in one sentence: the prices are adjusted for later splits and dividends while EPS is as reported in the filing, and the SEC data ends around 2020, so the ratio would be wrong. Then offer the price and SEC figures you do have, and do not call tools just to attempt the ratio.
- Use the percent change returned by getPriceChange, do not recalculate it.
- Earlier turns of the conversation may be included. Resolve references such as "it", "that company" or "the same year" from them, but fetch figures with tools again when you need them; numbers from earlier answers are not a substitute for a tool result in the current turn.
- Answer in the language of the question, concisely.`;

export interface ToolCallLog {
  name: string;
  args: unknown;
  ok: boolean;
  /** Start of the JSON result, enough to see what came back. */
  result_preview: string;
  duration_ms: number;
}

export interface AgentResult {
  answer: string;
  tool_calls: ToolCallLog[];
  rounds: number;
  model: string;
  /** thinking_tokens are billed as output but reported separately by the API. */
  usage: { prompt_tokens: number; output_tokens: number; thinking_tokens: number };
  /** True when the round limit stopped the loop and the answer was forced. */
  round_limit_hit: boolean;
}

function preview(response: unknown): string {
  const text = JSON.stringify(response);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

/** `history` holds earlier text turns of the conversation (empty for a single question). */
export async function runAgent(query: string, history: HistoryTurn[] = []): Promise<AgentResult> {
  const contents: Content[] = [
    ...history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
    { role: 'user', parts: [{ text: query }] },
  ];
  const toolCalls: ToolCallLog[] = [];
  const usage = { prompt_tokens: 0, output_tokens: 0, thinking_tokens: 0 };

  const addUsage = (m?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }) => {
    usage.prompt_tokens += m?.promptTokenCount ?? 0;
    usage.output_tokens += m?.candidatesTokenCount ?? 0;
    usage.thinking_tokens += m?.thoughtsTokenCount ?? 0;
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: toolDeclarations }],
        temperature: 0,
      },
    });
    addUsage(response.usageMetadata);

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      if (!response.text) throw new Error('No response from Gemini API');
      return { answer: response.text, tool_calls: toolCalls, rounds: round, model: modelName, usage, round_limit_hit: false };
    }

    // Keep the model turn exactly as returned (it can carry thought signatures the API expects back).
    contents.push(response.candidates![0].content!);

    // Calls of one turn are independent: run them in parallel, keep the order.
    const parts: Part[] = await Promise.all(
      calls.map(async (call) => {
        const started = Date.now();
        const outcome = await executeTool(call.name ?? '', call.args);
        toolCalls.push({
          name: call.name ?? '',
          args: call.args,
          ok: outcome.ok,
          result_preview: preview(outcome.response),
          duration_ms: Date.now() - started,
        });
        return { functionResponse: { id: call.id, name: call.name, response: outcome.response } };
      })
    );
    contents.push({ role: 'user', parts });
  }

  // Round limit: no more tools, answer with what the tools already returned.
  contents.push({
    role: 'user',
    parts: [{ text: 'Tool round limit reached. Answer now using only the tool results above, and say clearly what is missing.' }],
  });
  const final = await ai.models.generateContent({
    model: modelName,
    contents,
    config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0 },
  });
  addUsage(final.usageMetadata);
  if (!final.text) throw new Error('No response from Gemini API');
  return { answer: final.text, tool_calls: toolCalls, rounds: MAX_ROUNDS, model: modelName, usage, round_limit_hit: true };
}
