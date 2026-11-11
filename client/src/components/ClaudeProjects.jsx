import { useState } from 'react';
import ClaudeSessions from './ClaudeSessions.jsx';
import { ageLabel } from '../inFlight.js';

const COLLAPSED_COUNT = 6;

// Claude Code sessions grouped by project folder (CLAUDE_PROJECT_DIRS), for work
// that isn't tied to a git worktree
export default function ClaudeProjects({ projects = [], searching = false }) {
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState(null);
  if (projects.length === 0) return null;
  const visible = expanded || searching ? projects : projects.slice(0, COLLAPSED_COUNT);

  async function open(path) {
    setErr(null);
    const res = await fetch('/api/worktrees/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    }).catch(e => ({ json: async () => ({ error: e.message }) }));
    const data = await res.json();
    if (data?.error) setErr(data.error);
  }

  return (
    <section className="orphan-section">
      <h2 className="orphan-title">
        Claude projects
        <span className="orphan-count">{projects.length}</span>
      </h2>
      <p className="orphan-hint">Recent Claude Code sessions by project folder.</p>
      {err && <span className="worktree-error">{err}</span>}
      <ul className="orphan-list">
        {visible.map(p => (
          <li key={p.path} className="orphan-item">
            <div className="orphan-info">
              <span className="orphan-repo">
                {p.claudeRunning && <span className="claude-running-dot" title="Claude is running here" />}
                {p.name}
              </span>
              <span className="orphan-branch">
                {p.claudeRunning ? 'running' : ageLabel(Date.now() - Date.parse(p.lastSessionAt))}
              </span>
              <ClaudeSessions sessions={p.claudeSessions} />
            </div>
            <div className="orphan-actions">
              <button className="worktree-btn open" onClick={() => open(p.path)}>Open in Code</button>
            </div>
          </li>
        ))}
      </ul>
      {!searching && projects.length > COLLAPSED_COUNT && (
        <button className="in-flight-dormant-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : `+${projects.length - COLLAPSED_COUNT} more`}
        </button>
      )}
    </section>
  );
}
