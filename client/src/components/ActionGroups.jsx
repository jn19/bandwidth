import { useState } from 'react';
import ActionRow from './ActionRow.jsx';
import { loadPref, savePref } from '../prefs.js';

const SHOWN = 5;

// role="list": Safari drops list semantics from a flex <ul> with list-style none
function Rows({ entries }) {
  return <ul className="action-rows" role="list">{entries.map(e => <ActionRow key={e.item.id} entry={e} />)}</ul>;
}

// A native <details>, so its rows stay findable with the browser's Find while it's closed
function Disclosure({ className = '', open, onOpenChange, summary, children }) {
  return (
    <details className={`collapsed-group ${className}`} open={open}
      onToggle={e => { if (e.currentTarget.open !== open) onOpenChange(e.currentTarget.open); }}>
      <summary className="collapsed-toggle">
        <span className="group-title"><span className="disclosure-icon" aria-hidden="true">▸</span>{summary}</span>
      </summary>
      {children}
    </details>
  );
}

function MoreToggle({ total, shown, expanded, onToggle }) {
  if (total <= shown) return null;
  return (
    <button className="show-more" onClick={onToggle}>
      {expanded ? 'Show fewer' : `+${total - shown} more`}
    </button>
  );
}

// One action group: heading in its color, five rows, "+N more"
export function ActionGroup({ group, label, purpose, entries, showAll }) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const visible = expanded || showAll ? entries : entries.slice(0, SHOWN);
  return (
    <section className={`action-group tone-${group.tone}`} aria-label={label}>
      <h2 className="group-title">
        <span aria-hidden="true">{group.icon}</span> {label}
        <span className="group-count">{entries.length}</span>
        <span className="group-purpose">{purpose}</span>
      </h2>
      <Rows entries={visible} />
      {!showAll && <MoreToggle total={entries.length} shown={SHOWN} expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
    </section>
  );
}

// Waiting on others / Later: collapsed until opened (open while searching)
export function CollapsedGroup({ title, purpose, entries, open: forceOpen, limit = 25 }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const visible = expanded || forceOpen ? entries : entries.slice(0, limit);
  return (
    <Disclosure open={open || !!forceOpen} onOpenChange={o => !forceOpen && setOpen(o)} summary={<>
      {title}
      <span className="group-count">{entries.length}</span>
      <span className="group-purpose">{purpose}</span>
    </>}>
      <Rows entries={visible} />
      {!forceOpen && <MoreToggle total={entries.length} shown={limit} expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
    </Disclosure>
  );
}

const TIMES = [{ t: 5, label: 'I have 5 min' }, { t: 15, label: '15 min' }, { t: 30, label: '30 min' }, { t: Infinity, label: 'All' }];
const EASY_SHOWN = 10;

// Quick things sorted by time, filtered by how long you have. Collapsed by default.
export function EasyWins({ entries, forceOpen }) {
  const [open, setOpen] = useState(() => loadPref('easyWinsOpen', false));
  const [time, setTime] = useState(() => loadPref('easyWinsTime', 30) ?? Infinity);
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const fitting = entries.filter(e => e.estimate <= time);
  const visible = expanded || forceOpen ? fitting : fitting.slice(0, EASY_SHOWN);

  function setShown(o) {
    setOpen(o);
    savePref('easyWinsOpen', o);
  }
  function pick(t) {
    setTime(t);
    savePref('easyWinsTime', Number.isFinite(t) ? t : null);
  }

  return (
    <Disclosure className="easy-wins tone-green" open={open || !!forceOpen} onOpenChange={o => !forceOpen && setShown(o)}
      summary={<>
        <span aria-hidden="true">⚡</span> Easy Wins
        <span className="group-count">{entries.length}</span>
        <span className="group-purpose">Got a few minutes? Pick one that fits.</span>
      </>}>
      <div className="timebar" role="group" aria-label="Time you have">
        {TIMES.map(({ t, label }) => (
          <button key={label} className={time === t ? 'on' : ''} aria-pressed={time === t} onClick={() => pick(t)}>{label}</button>
        ))}
      </div>
      {fitting.length === 0
        ? <p className="group-purpose">Nothing that short right now.</p>
        : <Rows entries={visible} />}
      {!forceOpen && <MoreToggle total={fitting.length} shown={EASY_SHOWN} expanded={expanded} onToggle={() => setExpanded(v => !v)} />}
    </Disclosure>
  );
}
