import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatResponse, SessionDetail, SessionSummary } from '@llm-chat/shared';
import './App.css';

const EXAMPLES = [
  "What was Apple's revenue in fiscal 2019?",
  "How did Tesla's price change in the 90 days after its latest filing in the data?",
  'Which companies do you have data for?',
];

// Same threshold as the backend (LONG_HISTORY_MESSAGES); used to restore the alert for a loaded session.
const LONG_HISTORY_MESSAGES = 20;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Request failed');
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function ToolLog({ message }: { message: ChatMessage }) {
  const calls = message.tool_calls ?? [];
  if (calls.length === 0) return null;
  return (
    <details className="chat-toollog">
      <summary>Tool calls ({calls.length})</summary>
      <div className="toollog-list">
        {calls.map((call, index) => (
          <details key={index} className="toollog-item">
            <summary>
              <span className={call.ok ? 'toollog-badge ok' : 'toollog-badge err'}>{call.ok ? 'ok' : 'error'}</span>
              <strong>{call.name}</strong>
              <span className="toollog-args">{JSON.stringify(call.args)}</span>
              <span className="toollog-time">{call.duration_ms} ms</span>
            </summary>
            <pre className="toollog-result">{call.result_preview}</pre>
          </details>
        ))}
      </div>
    </details>
  );
}

function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [longHistory, setLongHistory] = useState(false);
  const [roundLimitHit, setRoundLimitHit] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function refreshSessions() {
    try {
      setSessions(await api<SessionSummary[]>('/api/sessions'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sessions');
    }
  }

  useEffect(() => {
    refreshSessions();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function newChat() {
    setSessionId(undefined);
    setMessages([]);
    setLongHistory(false);
    setRoundLimitHit(false);
    setError(null);
  }

  async function openSession(id: string) {
    if (loading || id === sessionId) return;
    setError(null);
    try {
      const session = await api<SessionDetail>(`/api/sessions/${id}`);
      setSessionId(session.id);
      setMessages(session.messages);
      setLongHistory(session.message_count >= LONG_HISTORY_MESSAGES);
      setRoundLimitHit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the session');
    }
  }

  async function removeSession(id: string) {
    if (loading) return;
    try {
      await api<void>(`/api/sessions/${id}`, { method: 'DELETE' });
      if (id === sessionId) newChat();
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the session');
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setError('Message must be at least 3 characters');
      return;
    }

    setError(null);
    setInput('');
    setLoading(true);
    // Show the user message at once; the stored copy replaces it when the session is reloaded.
    setMessages((prev) => [...prev, { role: 'user', text: trimmed, created_at: new Date().toISOString() }]);

    try {
      const res = await api<ChatResponse>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: trimmed }),
      });
      setSessionId(res.sessionId);
      setMessages((prev) => [...prev, res.message]);
      setLongHistory(res.long_history);
      setRoundLimitHit(res.round_limit_hit);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      setInput(trimmed);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app chat-app">
      <header className="header">
        <h1>Financial Assistant</h1>
        <p className="subtitle">Conversation with an agent over SEC filing figures and stock prices (6 companies)</p>
      </header>

      <div className="chat-layout">
        <aside className="sessions">
          <button className="ask-button" onClick={newChat} disabled={loading}>
            New conversation
          </button>
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id} className={s.id === sessionId ? 'session-item active' : 'session-item'}>
                <button className="session-open" onClick={() => openSession(s.id)} title={s.title}>
                  <span className="session-title">{s.title}</span>
                  <span className="session-meta">
                    {s.message_count} messages • {new Date(s.updated_at).toLocaleString()}
                  </span>
                </button>
                <button className="session-delete" onClick={() => removeSession(s.id)} title="Delete conversation">
                  ×
                </button>
              </li>
            ))}
            {sessions.length === 0 && <li className="session-empty">No conversations yet.</li>}
          </ul>
        </aside>

        <main className="main chat-main">
          <div className="chat-messages">
            {messages.length === 0 && !loading && (
              <div className="examples">
                <p className="examples-title">Start a conversation, then ask follow-ups ("and Walmart's?"):</p>
                <div className="examples-list">
                  {EXAMPLES.map((example) => (
                    <div key={example} className="example-item">
                      <span className="example-text">{example}</span>
                      <button className="example-run-button" onClick={() => send(example)}>
                        Run
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, index) => (
              <div key={index} className={m.role === 'user' ? 'bubble user' : 'bubble model'}>
                <p className="answer-text">{m.text}</p>
                {m.role === 'model' && <ToolLog message={m} />}
              </div>
            ))}

            {loading && <div className="bubble model thinking">Thinking...</div>}
            <div ref={endRef} />
          </div>

          {longHistory && (
            <p className="answer-warning">
              This conversation is long. Each answer costs more and may get worse. Consider starting a new conversation.
            </p>
          )}
          {roundLimitHit && (
            <p className="answer-warning">The round limit was reached; the last answer may be incomplete.</p>
          )}
          {error && (
            <div className="error">
              <strong>Error:</strong> {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="chat-form"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading && input.trim().length >= 3) send(input);
                }
              }}
              placeholder="Ask a question or a follow-up... (Enter sends, Shift+Enter adds a line)"
              className="question-input"
              rows={2}
              maxLength={500}
              disabled={loading}
            />
            <button type="submit" disabled={loading || input.trim().length < 3} className="ask-button">
              {loading ? 'Thinking...' : 'Send'}
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}

export default App;
