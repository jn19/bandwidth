import { useState } from 'react';
import WorkItem from './WorkItem.jsx';

// Jira issues whose status means the next move is someone else's
// (JIRA_WAITING_STATUSES). A reply on one moves it back to In flight.
export default function WaitingOnOthers({ entries, searching, repos, onAnnotate, onCreateWorktree, onRemoveWorktree }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <section className="orphan-section">
      <button className="snoozed-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <h2 className="orphan-title">
          {open || searching ? '▾' : '▸'} Waiting on others
          <span className="orphan-count">{entries.length}</span>
        </h2>
      </button>
      <p className="orphan-hint">The next move is someone else's. A reply brings one back to In flight; pin one to keep it there.</p>
      {(open || searching) && (
        <div className="in-flight-grid">
          {entries.map(e => (
            <WorkItem
              key={e.item.id}
              item={e.item}
              worktree={e.worktree ?? null}
              signals={e.signals}
              stale={e.stale}
              annotation={e.annotation}
              onAnnotate={onAnnotate}
              repos={repos}
              onCreateWorktree={onCreateWorktree}
              onRemoveWorktree={onRemoveWorktree}
            />
          ))}
        </div>
      )}
    </section>
  );
}
