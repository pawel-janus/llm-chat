/**
 * Gemini client (via Vertex AI). The agent loop is added in a later phase.
 */

import { GoogleGenAI } from '@google/genai';

export const modelName = process.env.GEMINI_MODEL!;

export const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT!,
  location: process.env.GEMINI_LOCATION!,
});
