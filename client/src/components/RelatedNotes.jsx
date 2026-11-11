import { useState } from 'react';

// Notes from NOTES_DIR whose frontmatter lists this Jira issue
export default function RelatedNotes({ notes = [] }) {
  const [err, setErr] = useState(null);
  if (notes.length === 0) return null;

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
        {notes.slice(0, 5).map(n => (
          <li key={n.path}>
            <button className="related-note" onClick={() => open(n.path)} title={n.summary || n.path}>
              {n.title}
            </button>
            {n.date && <span className="claude-session-age">{n.date}</span>}
          </li>
        ))}
      </ul>
      {err && <span className="worktree-error">{err}</span>}
    </div>
  );
}
