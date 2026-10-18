import { z } from 'zod';
import { ToolCallLogSchema } from './agentSchemas.js';

// Chat endpoint request: a new conversation when sessionId is missing
export const ChatRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(64).optional(),
  message: z
    .string({ required_error: 'Field "message" is required' })
    .trim().min(3, 'Message must be at least 3 characters').max(500, 'Message must be at most 500 characters'),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// One stored turn of a conversation (text only; tool log kept for the UI)
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string(),
  created_at: z.string(),
  tool_calls: z.array(ToolCallLogSchema).optional(),
  usage: z
    .object({
      prompt_tokens: z.number(),
      output_tokens: z.number(),
      thinking_tokens: z.number(),
    })
    .optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  message_count: z.number(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionDetailSchema = SessionSummarySchema.extend({
  messages: z.array(ChatMessageSchema),
});

export type SessionDetail = z.infer<typeof SessionDetailSchema>;

// Chat endpoint response: the new model message plus session info
export const ChatResponseSchema = z.object({
  sessionId: z.string(),
  message: ChatMessageSchema,
  message_count: z.number(),
  /** True when the history is long enough that the UI should suggest a new conversation. */
  long_history: z.boolean(),
  rounds: z.number(),
  round_limit_hit: z.boolean(),
  model: z.string(),
  latency_ms: z.number(),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;
