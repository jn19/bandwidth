import { useContext, useState } from 'react';
import WorkItem from './WorkItem.jsx';
import ClaudeSessions from './ClaudeSessions.jsx';
import PrimaryButton from './PrimaryButton.jsx';
import { ActionsContext } from '../actionsContext.js';
import { GROUP_BY_ID, ESTIMATES, cleanTitle, reasonText, itemLabel } from '../priority.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function toneOf(entry) {
  if (entry.group === 'easy') return 'green';
  return GROUP_BY_ID[entry.group]?.tone ?? 'gray';
}

export function ItemTitle({ item, className }) {
  const key = item.key ?? (item.number != null ? `#${item.number}` : null);
  const text = <>{key && <span className="row-key">{key}</span>} {cleanTitle(item.title)}</>;
  return item.url
    ? <a className={className} href={item.url} target="_blank" rel="noopener noreferrer">{text}</a>
    : <span className={className}>{text}</span>;
}

export function CategoryTag({ id }) {
  const { categories } = useContext(ActionsContext);
  const c = categories.find(x => x.id === id);
  return c ? <span className="cat-tag">{c.icon} {c.label}</span> : null;
}

// Per-item overrides, kept as quiet annotations (they don't count as activity)
function Overrides({ entry }) {
  const { categories, onAnnotate } = useContext(ActionsContext);
  const { item, annotation } = entry;
  const estimate = annotation?.estimate ?? '';
  return <>
    {categories.length > 0 && (
      <select className="item-action" aria-label="Category" value={annotation?.category ?? ''}
        onChange={e => onAnnotate(item, { category: e.target.value || null })}>
        <option value="">Category: {categories.find(c => c.id === entry.category)?.label ?? 'none'} (auto)</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
      </select>
    )}
    <select className="item-action" aria-label="Time estimate" value={String(estimate)}
      onChange={e => {
        const v = e.target.value;
        onAnnotate(item, { estimate: v === '' ? null : v === 'none' ? 'none' : Number(v) });
      }}>
      <option value="">⏱ {entry.estimate && !annotation?.estimate ? `~${entry.estimate} min (auto)` : 'estimate (auto)'}</option>
      {ESTIMATES.map(m => <option key={m} value={m}>⏱ {m} min</option>)}
      <option value="none">⏱ not quick</option>
    </select>
  </>;
}

export function Details({ entry }) {
  const { repos, onAnnotate, onCompleteCommitment, onCreateWorktree, onRemoveWorktree } = useContext(ActionsContext);
  const { item } = entry;
  const facts = [
    item.subtitle && ['Status', item.subtitle],
    item.priority && ['Priority', item.priority],
    item.dueDate && ['Due', item.dueDate],
    item.effort && ['Size', item.effort]
  ].filter(Boolean);

  if (item.source === 'claude-session') {
    return <div className="row-details"><ClaudeSessions sessions={[item.session]} /></div>;
  }
  if (item.source === 'feed') {
    const snooze = ms => onAnnotate(item, { snoozedUntil: new Date(Date.now() + ms).toISOString() });
    return (
      <div className="row-details">
        {item.subtitle && <p className="item-description">{item.subtitle}</p>}
        <div className="item-actions">
          <button className="item-action" onClick={() => snooze(WEEK)}>Snooze a week</button>
          <button className="item-action" onClick={() => snooze(52 * WEEK)}>Hide</button>
        </div>
      </div>
    );
  }
  return (
    <div className="row-details">
      {facts.length > 0 && (
        <div className="row-facts">
          {facts.map(([k, v]) => <span key={k}><span className="row-fact-label">{k}</span> {v}</span>)}
        </div>
      )}
      <WorkItem
        variant="details"
        item={item}
        worktree={entry.worktree ?? null}
        signals={entry.signals}
        stale={entry.stale}
        annotation={entry.annotation}
        onAnnotate={onAnnotate}
        onDone={item.source === 'commitment' ? onCompleteCommitment : undefined}
        repos={repos}
        onCreateWorktree={onCreateWorktree}
        onRemoveWorktree={onRemoveWorktree}
        extraActions={<Overrides entry={entry} />}
      />
    </div>
  );
}

// One compact row: title, why it's here, one primary button, and ▸ for everything else
export default function ActionRow({ entry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`action-row tone-${toneOf(entry)} ${open ? 'open' : ''}`}>
      <div className="row-main">
        <ItemTitle item={entry.item} className="row-title" />
        <div className="row-reason">
          <CategoryTag id={entry.category} />
          {reasonText(entry)}
          {entry.estimate && <span className="est">⚡ ~{entry.estimate} min</span>}
        </div>
      </div>
      <PrimaryButton entry={entry} onNeedDetails={() => setOpen(true)} />
      <button className="row-more" aria-expanded={open} aria-label={`Details: ${itemLabel(entry.item)}`}
        onClick={() => setOpen(o => !o)}>▸</button>
      {open && <Details entry={entry} />}
    </li>
  );
}
