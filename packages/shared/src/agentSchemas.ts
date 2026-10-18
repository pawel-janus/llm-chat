import { z } from 'zod';

// Agent endpoint request schema
export const AgentRequestSchema = z.object({
  query: z
    .string({ required_error: 'Field "query" is required' })
    .trim().min(3, 'Query must be at least 3 characters').max(500, 'Query must be at most 500 characters'),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;

// One tool call made by the agent (shown as the tool log in the UI)
export const ToolCallLogSchema = z.object({
  name: z.string(),
  args: z.unknown(),
  ok: z.boolean(),
  result_preview: z.string(),
  duration_ms: z.number(),
});

export type ToolCallLog = z.infer<typeof ToolCallLogSchema>;

// Agent endpoint response schema
export const AgentResponseSchema = z.object({
  answer: z.string(),
  tool_calls: z.array(ToolCallLogSchema),
  rounds: z.number(),
  round_limit_hit: z.boolean(),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    output_tokens: z.number(),
    thinking_tokens: z.number(),
  }),
  latency_ms: z.number(),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;
