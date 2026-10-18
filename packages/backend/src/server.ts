// Load environment variables from .env file
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AgentRequestSchema,
  AgentResponseSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  type AgentRequest,
  type ChatRequest,
} from '@llm-chat/shared';
import { runAgent } from './agent/agent.js';
import { appendTurn, deleteSession, getSession, listSessions, loadHistory, sessionExists } from './db/sessions.js';

// Above this many stored messages the UI is told to suggest a new conversation.
const LONG_HISTORY_MESSAGES = 20;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: {
    level: 'info',
  },
});

// CORS for frontend
await app.register(cors, {
  origin: true,
});

// Health check
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Agent endpoint - Gemini function calling over SEC facts and prices
app.post<{ Body: AgentRequest }>('/api/agent', async (request, reply) => {
  const startTime = Date.now();

  const parseResult = AgentRequestSchema.safeParse(request.body);

  if (!parseResult.success) {
    return reply.code(400).send({
      error: parseResult.error.errors[0].message,
      statusCode: 400,
    });
  }

  try {
    const result = await runAgent(parseResult.data.query);

    return AgentResponseSchema.parse({
      ...result,
      latency_ms: Date.now() - startTime,
    });
  } catch (error) {
    // Details stay in the log; the client gets a generic message.
    app.log.error(error, 'Agent failed');
    return reply.code(500).send({
      error: 'Agent failed. Please try again.',
      statusCode: 500,
    });
  }
});

// Chat endpoint - the agent with the history of a Firestore session (new session when sessionId is missing)
app.post<{ Body: ChatRequest }>('/api/chat', async (request, reply) => {
  const startTime = Date.now();

  const parseResult = ChatRequestSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.code(400).send({ error: parseResult.error.errors[0].message, statusCode: 400 });
  }
  const { sessionId, message } = parseResult.data;

  try {
    if (sessionId && !(await sessionExists(sessionId))) {
      return reply.code(404).send({ error: 'Session not found', statusCode: 404 });
    }

    const history = sessionId ? await loadHistory(sessionId) : [];
    const result = await runAgent(message, history);

    const modelMessage = { role: 'model' as const, text: result.answer, tool_calls: result.tool_calls, usage: result.usage };
    const saved = await appendTurn(sessionId, message, modelMessage, history.length);

    return ChatResponseSchema.parse({
      sessionId: saved.id,
      message: { ...modelMessage, created_at: new Date().toISOString() },
      message_count: saved.message_count,
      long_history: saved.message_count >= LONG_HISTORY_MESSAGES,
      rounds: result.rounds,
      round_limit_hit: result.round_limit_hit,
      model: result.model,
      latency_ms: Date.now() - startTime,
    });
  } catch (error) {
    app.log.error(error, 'Chat failed');
    return reply.code(500).send({ error: 'Chat failed. Please try again.', statusCode: 500 });
  }
});

app.get('/api/sessions', async (_request, reply) => {
  try {
    return await listSessions();
  } catch (error) {
    app.log.error(error, 'Listing sessions failed');
    return reply.code(500).send({ error: 'Could not load sessions.', statusCode: 500 });
  }
});

app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
  try {
    const session = await getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found', statusCode: 404 });
    return session;
  } catch (error) {
    app.log.error(error, 'Loading session failed');
    return reply.code(500).send({ error: 'Could not load the session.', statusCode: 500 });
  }
});

app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
  try {
    if (!(await deleteSession(request.params.id))) {
      return reply.code(404).send({ error: 'Session not found', statusCode: 404 });
    }
    return reply.code(204).send();
  } catch (error) {
    app.log.error(error, 'Deleting session failed');
    return reply.code(500).send({ error: 'Could not delete the session.', statusCode: 500 });
  }
});

// Serve frontend static files (production only, dev uses Vite dev server)
const frontendDistPath = path.join(__dirname, '../../frontend/dist');

await app.register(fastifyStatic, {
  root: frontendDistPath,
  prefix: '/',
  // Wildcard route - serve index.html for all non-API routes (SPA routing)
  wildcard: false,
});

// SPA fallback - serve index.html for all non-API routes
app.setNotFoundHandler(async (request, reply) => {
  // If request is for API, return 404 JSON
  if (request.url.startsWith('/api') || request.url.startsWith('/health')) {
    return reply.code(404).send({ error: 'Not found', statusCode: 404 });
  }

  // Otherwise serve index.html (SPA routing)
  return reply.sendFile('index.html');
});

// Start server
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`Server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
