function dayName(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (date === ymd(yesterday)) return 'yesterday';
  return new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

// Counts at a glance, each in its group's color with an icon and a word
export default function HeaderStats({ respond, unsent, unsentLabel, overdue, follow, journal, waitingSessions }) {
  const [today, previous] = journal?.enabled ? journal.days : [];
  const done = today?.bullets.length
    ? `✓ ${today.bullets.length} done today`
    : previous?.bullets.length ? `✓ ${previous.bullets.length} done ${dayName(previous.date)}` : null;
  return (
    <div className="stats">
      <span className="stat tone-red">↩ {respond} to respond</span>
      <span className="stat tone-amber">📎 {unsent} {unsentLabel.toLowerCase()}</span>
      <span className="stat tone-amber">⏰ {overdue} overdue</span>
      <span className="stat tone-blue">🔔 {follow} follow-up{follow !== 1 ? 's' : ''}</span>
      {done && <span className="stat tone-green">{done}</span>}
      {waitingSessions > 0 && (
        <a className="stat tone-red solid" href="#claude-projects">
          ⚠ {waitingSessions} Claude session{waitingSessions !== 1 ? 's' : ''} waiting
        </a>
      )}
    </div>
  );
}
