import { useState } from 'react';

function dayLabel(date) {
  const d = new Date(`${date}T00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// JOURNAL_FILE bullets: today, and the last earlier day with entries. "Copy for
// standup" puts both on the clipboard as plain text.
export default function TodayPanel({ journal }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  if (!journal?.enabled) return null;
  const [today, previous] = journal.days;

  async function copy() {
    const block = (title, d) => d ? `${title} (${dayLabel(d.date)}):\n${d.bullets.map(b => `- ${b}`).join('\n') || '- (nothing logged)'}` : '';
    const text = [block('Yesterday', previous), block('Today', today)].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      setCopied('Clipboard unavailable');
    }
  }

  return (
    <section className="orphan-section today-section">
      <div className="today-head">
        <button className="snoozed-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <h2 className="orphan-title">
            {open ? '▾' : '▸'} Today
            <span className="orphan-count">{today.bullets.length}</span>
          </h2>
        </button>
        <button className="item-action" onClick={copy}>Copy for standup</button>
        {copied && <span className="claude-session-ok">{copied}</span>}
      </div>
      {open && journal.days.map(d => (
        <div key={d.date} className="today-day">
          <div className="claude-sessions-label">{dayLabel(d.date)}</div>
          {d.bullets.length === 0
            ? <p className="orphan-hint">Nothing logged yet.</p>
            : <ul className="today-list">{d.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        </div>
      ))}
    </section>
  );
}
