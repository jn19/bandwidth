const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const STALE_AFTER_DAYS = 7;
// Idle this long and it's probably abandoned — collapsed rather than mixed in with live work
export const DORMANT_AFTER_DAYS = 90;

const PR_STATE_SIGNALS = {
  'changes-requested': { label: 'Changes requested', tone: 'alert' },
  'approved':          { label: 'Approved — merge it', tone: 'good' },
  'awaiting-review':   { label: 'Awaiting review', tone: 'muted' },
  'draft':             { label: 'Draft', tone: 'muted' }
};

export function ageLabel(ms) {
  if (ms >= 365 * DAY) return `${Math.floor(ms / (365 * DAY))}y ago`;
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d ago`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h ago`;
  return 'just now';
}

export function isSnoozed(annotation, now = Date.now()) {
  const until = Date.parse(annotation?.snoozedUntil);
  return !Number.isNaN(until) && until > now;
}

// Whole days from today to a local calendar date ("YYYY-MM-DD"); negative when past
export function daysUntil(dueDate, now = Date.now()) {
  const due = new Date(`${dueDate}T00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / DAY);
}

function dueSignal(dueDate, now) {
  const days = daysUntil(dueDate, now);
  if (days === null) return null;
  if (days < 0) return { label: `Overdue by ${-days}d`, tone: 'alert' };
  if (days === 0) return { label: 'Due today', tone: 'warn' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'warn' };
  return { label: `Due in ${days}d`, tone: 'muted' };
}

export function commitmentItem(c) {
  return {
    id: c.id,
    title: c.title,
    source: 'commitment',
    dueDate: c.dueDate,
    createdAt: c.createdAt,
    updatedAt: c.createdAt
  };
}

function latestTimestamp(...isoStrings) {
  const times = isoStrings.map(s => Date.parse(s)).filter(t => !Number.isNaN(t));
  return times.length ? Math.max(...times) : null;
}

// Signals (due date, PR state, CI, uncommitted files, last activity) and idle time
// for one item, used for its details and for priority
export function describe(item, worktree, annotation, now = Date.now()) {
  const signals = [];

  const due = item.dueDate && dueSignal(item.dueDate, now);
  if (due) signals.push(due);

  // From FEED_COMMAND: e.g. someone replied on the ticket. Always actionable.
  for (const f of item.feedSignals ?? []) signals.push({ label: f.label, tone: 'alert' });

  const prSignal = PR_STATE_SIGNALS[item.prState];
  if (prSignal) signals.push(prSignal);
  if (item.checks === 'failing') signals.push({ label: 'CI failing', tone: 'alert' });
  else if (item.checks === 'pending') signals.push({ label: 'CI running', tone: 'muted' });
  if (item.conflicts) signals.push({ label: 'Merge conflicts', tone: 'alert' });
  if (item.inProgress && item.subtitle) signals.push({ label: item.subtitle, tone: 'muted' });
  if (worktree?.claudeRunning) signals.push({ label: 'Claude running', tone: 'live' });
  if (worktree?.dirtyCount) {
    const n = worktree.dirtyCount;
    signals.push({ label: `${n} uncommitted file${n !== 1 ? 's' : ''}`, tone: 'warn' });
  }

  const lastTouched = latestTimestamp(
    item.updatedAt, worktree?.lastCommitAt, worktree?.lastEditAt, worktree?.lastSessionAt,
    annotation?.updatedAt, item.localActivityAt
  );
  const idleMs = lastTouched ? now - lastTouched : null;
  const stale = idleMs !== null && idleMs > STALE_AFTER_DAYS * DAY;
  if (idleMs !== null) {
    signals.push({ label: `Last activity ${ageLabel(idleMs)}`, tone: stale ? 'warn' : 'muted' });
  }

  // Something you can act on right now: fix feedback/CI/conflicts, overdue, or merge
  const needsAction = signals.some(s => s.tone === 'alert' || s.tone === 'good');
  const pinned = !!annotation?.pinned;
  // Things you've explicitly committed to never drift into the dormant pile
  const dormant = !pinned && item.source !== 'commitment' &&
    idleMs !== null && idleMs > DORMANT_AFTER_DAYS * DAY;
  return { item, worktree, annotation, signals, needsAction, pinned, stale, dormant, idleMs };
}
