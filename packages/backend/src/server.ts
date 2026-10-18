// Load environment variables from .env file
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentRequestSchema, AgentResponseSchema, type AgentRequest } from '@llm-chat/shared';
import { runAgent } from './agent/agent.js';
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
