import { useState } from 'react';
import ClaudeSessions from './ClaudeSessions.jsx';
import { ageLabel } from '../signals.js';

const COLLAPSED_COUNT = 6;

// Claude Code sessions grouped by project folder (CLAUDE_PROJECT_DIRS), for work
// that isn't tied to a git worktree. Sessions waiting on you sort first.
export default function ClaudeProjects({
  projects = [], searching = false, title = 'Claude projects',
  hint = 'Recent Claude Code sessions by project folder. Waiting on you first, then running.',
  startCollapsed = false
}) {
  const [expanded, setExpanded] = useState(false);
  const [shown, setShown] = useState(!startCollapsed);
  const [err, setErr] = useState(null);
  const [started, setStarted] = useState(null);
  if (projects.length === 0) return null;
  const visible = expanded || searching ? projects : projects.slice(0, COLLAPSED_COUNT);
  const waitingCount = projects.filter(p => p.waiting).length;

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(e => ({ json: async () => ({ error: e.message }) }));
    return res.json();
  }

  async function open(path) {
    setErr(null);
    const data = await post('/api/worktrees/open', { path });
    if (data?.error) setErr(data.error);
  }

  async function startNew(p) {
    setErr(null);
    const data = await post('/api/claude/new', { projectPath: p.path });
    if (data?.error) setErr(data.error);
    else setStarted(p.path);
  }

  return (
    <section className="orphan-section" id={startCollapsed ? undefined : 'claude-projects'}>
      <button className="snoozed-toggle" onClick={() => setShown(v => !v)} aria-expanded={shown}>
        <h2 className="orphan-title">
          {shown || searching ? '▾' : '▸'} {title}
          <span className="orphan-count">{projects.length}</span>
          {waitingCount > 0 && <span className="in-flight-stale">{waitingCount} waiting on you</span>}
        </h2>
      </button>
      <p className="orphan-hint">{hint}</p>
      {err && <span className="worktree-error">{err}</span>}
      {(shown || searching) && <>
      <ul className="orphan-list">
        {visible.map(p => (
          <li key={p.path} className="orphan-item">
            <div className="orphan-info">
              <span className="orphan-repo">
                {p.claudeRunning && <span className="claude-running-dot" title="Claude is running here" />}
                {p.name}
              </span>
              {p.badge && <span className="badge badge-priority">{p.badge}</span>}
              <span className="orphan-branch">
                {p.claudeRunning ? 'running' : ageLabel(Date.now() - Date.parse(p.lastSessionAt))}
              </span>
              <ClaudeSessions sessions={p.claudeSessions} />
            </div>
            <div className="orphan-actions">
              <button className="worktree-btn claude" onClick={() => startNew(p)} title="Start a new Claude session in this folder">
                New session
              </button>
              <button className="worktree-btn open" onClick={() => open(p.path)}>Open in Code</button>
              {started === p.path && <span className="claude-session-ok">Started</span>}
            </div>
          </li>
        ))}
      </ul>
      {!searching && projects.length > COLLAPSED_COUNT && (
        <button className="in-flight-dormant-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : `+${projects.length - COLLAPSED_COUNT} more`}
        </button>
      )}
      </>}
    </section>
  );
}
