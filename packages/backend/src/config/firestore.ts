/**
 * Firestore configuration - database ID and collection names.
 *
 * Collection naming convention: {poc-name}-{source}-{type}
 */

/** Database shared by all LLM POCs (europe-central2), separate from other project databases. */
export const DATABASE_ID = 'llm-pocs';

export const COLLECTIONS = {
  /** POC #5: one document per conversation, messages in the subcollection `messages`. */
  LLM_CHAT_SESSIONS: 'llm-chat-sessions',
} as const;

export const MESSAGES_SUBCOLLECTION = 'messages';
