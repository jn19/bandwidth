import { useContext, useState } from 'react';
import { ActionsContext, postJson } from '../actionsContext.js';
import { ProjectsContext } from '../projectsContext.js';
import { primaryAction, itemLabel } from '../priority.js';

// The one obvious next step for a row or a Do next card (see primaryAction)
export default function PrimaryButton({ entry, big = false, onNeedDetails }) {
  const projects = useContext(ProjectsContext);
  const { onCompleteCommitment } = useContext(ActionsContext);
  const [status, setStatus] = useState(null);
  const action = primaryAction(entry, projects);
  if (!action) return <span />;
  const className = `primary-btn${big ? ' big' : ''}`;
  const { item } = entry;
  const name = `${action.label}: ${itemLabel(item)}`;  // visible label first, then which row

  if (action.kind === 'open' || action.kind === 'focus') {
    if (!action.href) return <span />;
    return (
      <a className={className} href={action.href} aria-label={name}
        {...(action.kind === 'open' && { target: '_blank', rel: 'noopener noreferrer' })}>
        {action.label}
      </a>
    );
  }

  async function run() {
    setStatus({ busy: true });
    let data = {};
    if (action.kind === 'details') {
      onNeedDetails?.();
      return setStatus(null);
    }
    if (action.kind === 'done') {
      if (!window.confirm(`Mark "${item.title}" done? It's removed from the list.`)) return setStatus(null);
      await onCompleteCommitment(item);
      return setStatus(null);
    }
    if (action.kind === 'resume') data = await postJson('/api/claude/resume', { sessionId: action.sessionId });
    if (action.kind === 'openPath') data = await postJson('/api/worktrees/open', { path: action.path });
    if (action.kind === 'assign') {
      const { target } = action;
      if (target.running && !window.confirm(`Claude is already running in ${target.name}. Start another session?`)) {
        return setStatus(null);
      }
      data = await postJson('/api/claude/assign', target.worktreePath
        ? {
          worktreePath: target.worktreePath,
          item: { source: item.source, key: item.key, repo: item.repo, number: item.number, role: item.role, title: item.title, url: item.url }
        }
        : { projectPath: target.projectPath, item: { source: item.source, key: item.key, title: item.title, url: item.url } });
    }
    setStatus(data.error ? { error: data.error } : { ok: action.kind === 'openPath' ? 'Opened' : 'Started in a terminal' });
  }

  return (
    <span className="primary-wrap">
      <button className={className} onClick={run} disabled={status?.busy} aria-label={name}
        title={action.target ? `Start a new Claude session in ${action.target.name} with this loaded`
          : action.kind === 'details' ? 'Pick or confirm the project first' : undefined}>
        {status?.busy ? '…' : action.label}
      </button>
      {action.target && <span className="primary-target">in {action.target.name}</span>}
      {status?.ok && <span className="claude-session-ok">{status.ok}</span>}
      {status?.error && <span className="worktree-error">{status.error}</span>}
    </span>
  );
}
