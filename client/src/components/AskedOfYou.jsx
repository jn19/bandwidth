import { ageLabel } from '../inFlight.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;

// FEED_COMMAND items that aren't about a card already on the page: mentions,
// wiki tasks, rows naming you. Snooze or hide each one once handled.
export default function AskedOfYou({ items, onAnnotate }) {
  if (items.length === 0) return null;
  const snooze = (item, ms) => onAnnotate(item, { snoozedUntil: new Date(Date.now() + ms).toISOString() });

  return (
    <section className="orphan-section asked-section">
      <h2 className="orphan-title">
        Asked of you
        <span className="orphan-count">{items.length}</span>
      </h2>
      <p className="orphan-hint">Mentions, tasks and rows that name you, from your feed. Newest first.</p>
      <ul className="orphan-list">
        {items.map(item => (
          <li key={item.id} className="orphan-item">
            <div className="orphan-info">
              <span className="badge badge-source">{item.source}</span>
              {item.url
                ? <a className="item-title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                : <span className="item-title">{item.title}</span>}
              {item.subtitle && <span className="item-description">{item.subtitle}</span>}
              {item.updatedAt && <span className="claude-session-age">{ageLabel(Date.now() - Date.parse(item.updatedAt))}</span>}
            </div>
            <div className="orphan-actions">
              <button className="item-action" onClick={() => snooze(item, WEEK)}>Snooze a week</button>
              <button className="item-action" onClick={() => snooze(item, 365 * 24 * 60 * 60 * 1000)}>Hide</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
