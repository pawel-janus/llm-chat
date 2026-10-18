/**
 * Conversation storage in Firestore: `llm-chat-sessions/{id}` holds the session
 * summary, its subcollection `messages` holds the turns (text only, plus the
 * tool log and token usage of model turns for the UI).
 */

import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import type { ChatMessage, SessionDetail, SessionSummary } from '@llm-chat/shared';
import { COLLECTIONS, DATABASE_ID, MESSAGES_SUBCOLLECTION } from '../config/firestore.js';

let client: Firestore | undefined;

function sessions() {
  client ??= new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT, databaseId: DATABASE_ID });
  return client.collection(COLLECTIONS.LLM_CHAT_SESSIONS);
}

const TITLE_CHARS = 60;

function toSummary(id: string, data: FirebaseFirestore.DocumentData): SessionSummary {
  return {
    id,
    title: data.title,
    created_at: (data.created_at as Timestamp).toDate().toISOString(),
    updated_at: (data.updated_at as Timestamp).toDate().toISOString(),
    message_count: data.message_count,
  };
}

function toMessage(data: FirebaseFirestore.DocumentData): ChatMessage {
  return {
    role: data.role,
    text: data.text,
    created_at: (data.created_at as Timestamp).toDate().toISOString(),
    // Firestore rejects undefined, so optional fields are simply absent when unset.
    ...(data.tool_calls ? { tool_calls: data.tool_calls } : {}),
    ...(data.usage ? { usage: data.usage } : {}),
  };
}

export async function sessionExists(id: string): Promise<boolean> {
  return (await sessions().doc(id).get()).exists;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const snapshot = await sessions().orderBy('updated_at', 'desc').limit(50).get();
  return snapshot.docs.map((doc) => toSummary(doc.id, doc.data()));
}

export async function getSession(id: string): Promise<SessionDetail | undefined> {
  const doc = await sessions().doc(id).get();
  if (!doc.exists) return undefined;
  const messages = await doc.ref.collection(MESSAGES_SUBCOLLECTION).orderBy('seq').get();
  return { ...toSummary(doc.id, doc.data()!), messages: messages.docs.map((m) => toMessage(m.data())) };
}

/** Text turns of a session in the order Gemini expects them. */
export async function loadHistory(id: string): Promise<{ role: 'user' | 'model'; text: string }[]> {
  const messages = await sessions().doc(id).collection(MESSAGES_SUBCOLLECTION).orderBy('seq').get();
  return messages.docs.map((m) => ({ role: m.data().role, text: m.data().text }));
}

/** Append one user turn and the model answer, creating the session when `existingCount` is 0. */
export async function appendTurn(
  id: string | undefined,
  userText: string,
  modelMessage: Omit<ChatMessage, 'created_at'>,
  existingCount: number
): Promise<{ id: string; message_count: number }> {
  const ref = id ? sessions().doc(id) : sessions().doc();
  const now = Timestamp.now();
  const batch = client!.batch();

  if (existingCount === 0) {
    batch.set(ref, {
      title: userText.slice(0, TITLE_CHARS),
      created_at: now,
      updated_at: now,
      message_count: 2,
    });
  } else {
    batch.update(ref, { updated_at: now, message_count: FieldValue.increment(2) });
  }

  const messages = ref.collection(MESSAGES_SUBCOLLECTION);
  batch.set(messages.doc(), { role: 'user', text: userText, seq: existingCount, created_at: now });
  batch.set(messages.doc(), { ...modelMessage, seq: existingCount + 1, created_at: now });
  await batch.commit();

  return { id: ref.id, message_count: existingCount + 2 };
}

export async function deleteSession(id: string): Promise<boolean> {
  const ref = sessions().doc(id);
  if (!(await ref.get()).exists) return false;
  // Subcollection documents are not removed with the parent.
  await client!.recursiveDelete(ref);
  return true;
}
