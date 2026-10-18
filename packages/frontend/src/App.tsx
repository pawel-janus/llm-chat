import { useState } from 'react';
import type { AgentResponse } from '@llm-chat/shared';
import './App.css';

const EXAMPLES = [
  'Which companies do you have data for?',
  "Compare Apple's and Walmart's net income in 2019.",
  "How did Tesla's price change in the 90 days after its latest filing in the data?",
  "Compare Apple's and JPMorgan's net income in 2019.",
  "What was Microsoft's revenue in 2019?",
  "What is Apple's P/E ratio?",
];

function App() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setError('Question must be at least 3 characters');
      return;
    }

    setQuery(trimmed);
    setError(null);
    setResponse(null);
    setLoading(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Request failed');
      }

      setResponse((await res.json()) as AgentResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Financial Assistant</h1>
        <p className="subtitle">Agent over SEC filing figures and stock prices (6 companies)</p>
      </header>

      <main className="main">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(query);
          }}
          className="question-form"
        >
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question... (e.g., 'What was Apple's net income in 2019?')"
            className="question-input"
            rows={3}
            maxLength={500}
            disabled={loading}
          />
          <button type="submit" disabled={loading || query.trim().length < 3} className="ask-button">
            {loading ? 'Thinking...' : 'Ask'}
          </button>
        </form>

        {error && (
          <div className="error">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!response && !loading && !error && (
          <div className="examples">
            <p className="examples-title">Example questions:</p>
            <div className="examples-list">
              {EXAMPLES.map((example) => (
                <div key={example} className="example-item">
                  <span className="example-text">{example}</span>
                  <button className="example-run-button" onClick={() => ask(example)}>
                    Run
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {response && (
          <div className="answer-section">
            <div className="answer-box">
              <h2>Answer</h2>
              <p className="answer-text">{response.answer}</p>
              {response.round_limit_hit && (
                <p className="answer-warning">The round limit was reached; the answer may be incomplete.</p>
              )}
              <div className="answer-meta">
                Model: {response.model} • {(response.latency_ms / 1000).toFixed(1)} s • {response.rounds}{' '}
                {response.rounds === 1 ? 'round' : 'rounds'} • tokens: {response.usage.prompt_tokens} in /{' '}
                {response.usage.output_tokens + response.usage.thinking_tokens} out
              </div>
            </div>

            <div className="toollog-box">
              <h3>Tool calls ({response.tool_calls.length})</h3>
              {response.tool_calls.length === 0 ? (
                <p className="toollog-empty">The agent answered without calling any tool.</p>
              ) : (
                <div className="toollog-list">
                  {response.tool_calls.map((call, index) => (
                    <details key={index} className="toollog-item">
                      <summary>
                        <span className={call.ok ? 'toollog-badge ok' : 'toollog-badge err'}>
                          {call.ok ? 'ok' : 'error'}
                        </span>
                        <strong>{call.name}</strong>
                        <span className="toollog-args">{JSON.stringify(call.args)}</span>
                        <span className="toollog-time">{call.duration_ms} ms</span>
                      </summary>
                      <pre className="toollog-result">{call.result_preview}</pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
