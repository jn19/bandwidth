import { useContext, useState } from 'react';
import { ProjectsContext } from '../projectsContext.js';

// Jira cards: which project folder the issue's work lives in. Defaults to your
// earlier choice, else the guess from your notes. "Assign to Claude" starts Claude
// in that folder with the issue loaded, no git worktree needed.
function guessHint({ noteCount, memoryCount }) {
  const parts = [
    noteCount && `${noteCount} note${noteCount !== 1 ? 's' : ''}`,
    memoryCount && `${memoryCount} memory file${memoryCount !== 1 ? 's' : ''}`
  ].filter(Boolean);
  return `guessed from ${parts.join(' and ')}`;
}

export default function ProjectPicker({ item, annotation, onAnnotate, hideAssign = false }) {
  const { all, recent } = useContext(ProjectsContext);
  const [status, setStatus] = useState(null);
  if (all.length === 0) return null;

  const chosenName = annotation?.project || item.projectGuess?.name || '';
  const chosen = all.find(p => p.name === chosenName) || null;
  const guessed = !annotation?.project && !!item.projectGuess;
  const running = !!chosen && recent.some(p => p.path === chosen.path && p.claudeRunning);

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function assign() {
    if (running && !window.confirm(`Claude is already running in ${chosen.name}. Start another session?`)) return;
    setStatus({ busy: true });
    try {
      const data = await post('/api/claude/assign', {
        projectPath: chosen.path,
        item: { source: item.source, key: item.key, title: item.title, url: item.url }
      });
      if (data.error) return setStatus({ error: data.error });
      setStatus({ ok: 'Claude started in a terminal' });
      if (guessed) onAnnotate?.(item, { project: chosen.name });   // a used guess becomes your choice
    } catch (e) {
      setStatus({ error: e.message });
    }
  }

  async function open() {
    setStatus(null);
    try {
      const data = await post('/api/worktrees/open', { path: chosen.path });
      if (data.error) setStatus({ error: data.error });
    } catch (e) {
      setStatus({ error: e.message });
    }
  }

  return (
    <div className="item-project">
      <div className="repo-picker-row">
        <label className="repo-picker-label">Project</label>
        <select
          className="repo-picker-select"
          value={chosenName}
          disabled={!onAnnotate}
          onChange={e => onAnnotate?.(item, { project: e.target.value || null })}
        >
          <option value="">Pick a project…</option>
          {all.map(p => (
            <option key={p.path} value={p.name}>
              {p.name}{p.isRepo ? '  (git)' : ''}{p.badge ? `  · ${p.badge}` : ''}{p.personal ? '  · personal' : ''}
            </option>
          ))}
        </select>
      </div>
      {guessed && <span className="item-project-hint">{guessHint(item.projectGuess)}</span>}
      {chosen && (
        <div className="worktree-actions">
          {!hideAssign && (
            <button className="worktree-btn claude" onClick={assign} disabled={status?.busy}
              title={`Open Claude Code in ${chosen.path} with this issue loaded`}>
              {status?.busy ? '…' : 'Assign to Claude'}
            </button>
          )}
          <button className="worktree-btn open" onClick={open}>Open in Code</button>
          {chosen.badge && <span className="badge badge-priority">{chosen.badge}</span>}
          {running && <span className="signal signal-live">Claude running</span>}
        </div>
      )}
      {status?.ok && <span className="claude-session-ok">{status.ok}</span>}
      {status?.error && <span className="worktree-error">{status.error}</span>}
    </div>
  );
}
