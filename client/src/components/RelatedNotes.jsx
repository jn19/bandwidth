import { useState } from 'react';

const COLLAPSED_COUNT = 3;

// Notes from NOTES_DIR whose frontmatter lists this Jira issue (the server puts
// the issue's project's own notes first)
export default function RelatedNotes({ notes = [] }) {
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(false);
  if (notes.length === 0) return null;
  const visible = expanded ? notes : notes.slice(0, COLLAPSED_COUNT);

  async function open(path) {
    setErr(null);
    try {
      const res = await fetch('/api/worktrees/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await res.json();
      if (data?.error) setErr(data.error);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="related-notes">
      <div className="claude-sessions-label">Notes</div>
      <ul className="related-note-list">
        {visible.map(n => (
          <li key={n.path}>
            <button className="related-note" onClick={() => open(n.path)} title={n.summary || n.path}>
              {n.title}
            </button>
            {n.date && <span className="claude-session-age">{n.date}</span>}
          </li>
        ))}
      </ul>
      {notes.length > COLLAPSED_COUNT && (
        <button className="in-flight-dormant-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : `+${notes.length - COLLAPSED_COUNT} more`}
        </button>
      )}
      {err && <span className="worktree-error">{err}</span>}
    </div>
  );
}
