import { describe, isSnoozed, daysUntil, commitmentItem } from './signals.js';

const DAY = 24 * 60 * 60 * 1000;

// Action groups, in priority order: an item lands in the first that fits. `base`
// is its starting score; `tone` is its one color (see App.css).
export const GROUPS = [
  { id: 'respond', label: 'Respond', icon: '↩', tone: 'red', base: 50, purpose: 'Someone is waiting on you.' },
  { id: 'unsent', label: 'Evidence ready', icon: '📎', tone: 'amber', base: 40, purpose: 'Gathered, not sent yet. Send it or post it where it gets collected.' },
  { id: 'gather', label: 'To gather', icon: '📎', tone: 'amber-soft', base: 25, purpose: 'Evidence was asked for and isn’t gathered yet.' },
  { id: 'due', label: 'Due soon', icon: '⏰', tone: 'amber', base: 30, purpose: 'Due within 7 days or already past.' },
  { id: 'follow', label: 'Follow up', icon: '🔔', tone: 'blue', base: 20, purpose: 'Waiting on someone for a while. A nudge is yours.' },
  { id: 'progress', label: 'In progress', icon: '▶', tone: 'gray', base: 10, purpose: 'Started, nothing urgent.' }
];
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));
export const DUE_SOON_DAYS = 7;
export const ESTIMATES = [2, 5, 15, 30];

const PRIORITY_POINTS = { highest: 12, blocker: 12, critical: 12, high: 8, major: 8, medium: 3 };
const FALLBACK_REASONS = { progress: 'in progress', later: 'not started', waiting: 'waiting on others', due: 'due soon' };
const PR_REASONS = { approved: 'approved, merge it', 'awaiting-review': 'awaiting review', draft: 'draft' };

const KEY_PREFIX = /^\[[A-Z][A-Z0-9_]*-\d+\]\s*/;
export function cleanTitle(title) {
  return (title ?? '').replace(KEY_PREFIX, '');
}

// Short name for a row in its buttons' accessible names ("Open & reply: PROJ-1")
export function itemLabel(item) {
  return item.key ?? (item.number != null ? `#${item.number}` : cleanTitle(item.title));
}

function days(ms) {
  return `${Math.max(1, Math.floor(ms / DAY))}d`;
}

// Rules come from /api/config as regex sources; compile each rule set once
const compiled = new WeakMap();
function compileClauses(clauses) {
  return clauses.map(c => ({
    ...c,
    title: c.title ? new RegExp(c.title, 'i') : null,
    description: c.description ? new RegExp(c.description, 'i') : null
  }));
}
function compileRules(rules) {
  if (!compiled.has(rules)) {
    compiled.set(rules, rules.map(r => (r.match ? { ...r, match: compileClauses(r.match) } : r)));
  }
  return compiled.get(rules);
}
function compileQuickWins(quickWins) {
  if (!compiled.has(quickWins)) compiled.set(quickWins, compileClauses(quickWins));
  return compiled.get(quickWins);
}

function clauseMatches(clause, item) {
  if (clause.projects && !clause.projects.includes(item.projectKey)) return false;
  if (clause.title && !clause.title.test(cleanTitle(item.title))) return false;
  if (clause.description && !clause.description.test(item.description ?? '')) return false;
  if (clause.evidenceAsk && !item.evidenceAsk) return false;
  if (clause.notStarted && !item.notStarted) return false;
  return true;
}

// The item's work area: your override if it names a category, else the first rule that matches
export function categorize(item, categories = [], override) {
  if (override && categories.some(c => c.id === override)) return override;
  for (const c of compileRules(categories)) {
    if (!c.match || c.match.some(m => clauseMatches(m, item))) return c.id;
  }
  return null;
}

function respondReasons(item, worktree) {
  const reasons = (item.feedSignals ?? []).map(f => f.label);
  if (item.role === 'reviewer') reasons.push('review requested');
  if (item.role === 'author' && item.prState === 'changes-requested') reasons.push('changes requested');
  if (item.role === 'author' && item.checks === 'failing') reasons.push('CI failing');
  if (item.source === 'claude-session' || worktree?.claudeSessions?.some(s => s.running && s.state === 'waiting')) {
    reasons.push('Claude is waiting on you');
  }
  return reasons;
}

function dueReason(dueDays) {
  if (dueDays === null) return null;
  if (dueDays < 0) return { text: `overdue ${-dueDays}d`, points: 30 + Math.min(-dueDays, 15) };
  if (dueDays === 0) return { text: 'due today', points: 25 };
  if (dueDays <= 2) return { text: `due in ${dueDays}d`, points: 20 };
  if (dueDays <= DUE_SOON_DAYS) return { text: `due in ${dueDays}d`, points: 10 };
  return null;
}

// Minutes for Easy Wins, or null when it isn't a quick one. Your ⏱ choice wins.
function estimateFor({ item, group, dormant, annotation }, quickWins) {
  if (annotation?.estimate === 'none') return null;
  if (typeof annotation?.estimate === 'number') return annotation.estimate;
  const options = [];
  if (group === 'respond') {
    if (item.role === 'reviewer') options.push(item.effort === 'small' ? 10 : null);
    else if (item.feedSignals?.length || item.source === 'claude-session') options.push(5);
  }
  if (group === 'unsent') options.push(10);
  if (group === 'follow') options.push(2);
  if (group === 'later' && dormant) options.push(2);
  if (item.role === 'author' && item.prState === 'approved') options.push(5);
  for (const q of compileQuickWins(quickWins)) {
    if (clauseMatches(q, item)) options.push(q.minutes);
  }
  if (item.effort === 'small' && item.notStarted) options.push(30);
  const valid = options.filter(Boolean);
  return valid.length ? Math.min(...valid) : null;
}

function classify(item, worktree, annotation, { followUpMs, categories, quickWins, now }) {
  const d = describe(item, worktree, annotation, now);
  const dueDays = item.dueDate ? daysUntil(item.dueDate, now) : null;
  const due = dueReason(dueDays);
  const idleMs = d.idleMs;
  const started = item.source === 'commitment' || item.source === 'worktree' || item.inProgress ||
    item.role === 'author' || !!worktree;
  const reasons = [];

  const respond = respondReasons(item, worktree);
  let group;
  if (respond.length) {
    group = 'respond';
    reasons.push(...respond);
  } else if (item.evidenceReady) {
    group = 'unsent';
    reasons.push('gathered, not yet sent');
  } else if (item.evidenceAsk && !item.waitingOnOthers) {
    group = 'gather';
    reasons.push('evidence asked for');
  } else if (due) {
    group = 'due';
  } else if (item.waitingOnOthers && !d.pinned) {
    group = idleMs !== null && idleMs > followUpMs ? 'follow' : 'waiting';
    if (group === 'follow') reasons.push(`no reply in ${days(idleMs)}`);
  } else if ((started || d.pinned) && !d.dormant) {
    group = 'progress';
  } else {
    group = 'later';
  }

  let score = GROUP_BY_ID[group]?.base ?? 0;
  if (due) {
    reasons.push(due.text);
    score += due.points;
  }
  const priorityPoints = PRIORITY_POINTS[item.priority?.toLowerCase()] ?? 0;
  score += priorityPoints;
  if (priorityPoints >= 8) reasons.push(`${item.priority} priority`);
  if (d.pinned) {
    reasons.push('pinned');
    score += 15;
  }
  if (group === 'progress') {
    if (PR_REASONS[item.prState] && item.role === 'author') reasons.push(PR_REASONS[item.prState]);
    if (worktree?.dirtyCount) reasons.push(`${worktree.dirtyCount} uncommitted`);
  }
  if (idleMs !== null && idleMs > 7 * DAY && group !== 'later' && group !== 'waiting' && group !== 'follow') {
    reasons.push(`idle ${days(idleMs)}`);
    score += 5;
  }
  if (group === 'later' && d.dormant) reasons.push(`idle ${days(idleMs)}: close or snooze`);
  if (!reasons.length && FALLBACK_REASONS[group]) reasons.push(FALLBACK_REASONS[group]);

  const entry = {
    item, worktree, annotation, group, score, reasons, idleMs, dueDays,
    signals: d.signals, pinned: d.pinned, stale: d.stale,
    dormant: group === 'later' && d.dormant,
    category: item.source === 'claude-session' || item.source === 'feed'
      ? null
      : categorize(item, categories, annotation?.category)
  };
  entry.estimate = estimateFor(entry, quickWins);
  return entry;
}

function sessionItem(project, session) {
  return {
    id: `session-${session.id}`,
    title: session.title,
    source: 'claude-session',
    subtitle: project.name,
    session,
    projectPath: project.path,
    updatedAt: session.stateSince ?? session.lastActiveAt
  };
}

// Sorts every item, commitment, live worktree and waiting Claude session into an
// action group (or `waiting` / `later`), with a score, reasons and a quick-win estimate.
// Snoozed things are set aside. Highest score first; ties go to the longest idle.
export function buildPriorities(items, worktrees, {
  annotations = {}, commitments = [], projects = [], categories = [], quickWins = [],
  followUpDays = 5, now = Date.now()
} = {}) {
  const opts = { followUpMs: followUpDays * DAY, categories, quickWins, now };
  const entries = [];
  const snoozed = [];
  const worktreeKeys = new Set(); // claimed worktrees — kept out of "stale worktrees"
  const sessionIds = new Set();   // sessions already shown through an item's worktree

  function consider(item, worktree) {
    for (const s of worktree?.claudeSessions ?? []) sessionIds.add(s.id);
    const annotation = annotations[item.id];
    if (isSnoozed(annotation, now)) snoozed.push({ item, worktree, annotation });
    else entries.push(classify(item, worktree, annotation, opts));
  }

  for (const c of commitments) consider(commitmentItem(c), null);
  for (const item of items) {
    const key = item.repoName && item.branch ? `${item.repoName}/${item.branch}` : null;
    const worktree = key ? worktrees[key] : null;
    if (worktree) worktreeKeys.add(key);
    consider(item, worktree);
  }
  for (const [key, wt] of Object.entries(worktrees)) {
    if (worktreeKeys.has(key) || !(wt.dirtyCount || wt.claudeRunning)) continue;
    worktreeKeys.add(key);
    consider({
      id: `worktree-${key}`,
      title: wt.branch,
      source: 'worktree',
      repo: wt.repoName,
      repoName: wt.repoName,
      branch: wt.branch,
      subtitle: 'Local work with no matching PR or ticket'
    }, wt);
  }
  for (const p of projects) {
    for (const s of p.claudeSessions ?? []) {
      if (s.running && s.state === 'waiting' && !sessionIds.has(s.id)) consider(sessionItem(p, s), null);
    }
  }

  entries.sort((a, b) => (b.score - a.score) || ((b.idleMs ?? 0) - (a.idleMs ?? 0)));
  snoozed.sort((a, b) => Date.parse(a.annotation.snoozedUntil) - Date.parse(b.annotation.snoozedUntil));
  return { entries, snoozed, worktreeKeys };
}

// Running sessions with a big context ("save & clear") and feed asks, as Easy Wins
export function easyExtras(projects = [], asked = [], contextWarnTokens = 400000) {
  const extras = [];
  for (const p of projects) {
    for (const s of p.claudeSessions ?? []) {
      if (!s.running || (s.contextTokens ?? 0) < contextWarnTokens) continue;
      extras.push({
        item: { ...sessionItem(p, s), id: `clear-${s.id}`, title: `Save & clear: ${s.title}` },
        group: 'easy', category: null, estimate: 2, score: 0,
        reasons: [`${p.name}`, `${Math.round(s.contextTokens / 1000)}k context`]
      });
    }
  }
  for (const f of asked.slice(0, 6)) {
    extras.push({
      item: { id: f.id, title: f.title, url: f.url, source: 'feed', feedSource: f.source, subtitle: f.subtitle },
      group: 'easy', category: null, estimate: 5, score: 0,
      reasons: [f.source, f.subtitle].filter(Boolean)
    });
  }
  return extras;
}

export function reasonText(entry) {
  return entry.reasons.filter(Boolean).slice(0, 4).join(' · ');
}

// Where Assign to Claude would start: the item's worktree, else (Jira) its chosen or guessed project
function assignTarget({ item, worktree, annotation }, all, recent) {
  if (worktree?.path && ['jira', 'github-pr', 'github-issue'].includes(item.source)) {
    return { worktreePath: worktree.path, running: !!worktree.claudeRunning, name: worktree.branch };
  }
  if (item.source !== 'jira') return null;
  const name = annotation?.project || item.projectGuess?.name;
  const project = name && all.find(p => p.name === name);
  if (!project) return null;
  return {
    projectPath: project.path,
    name: project.name,
    guessed: !annotation?.project,
    running: recent.some(p => p.path === project.path && p.claudeRunning)
  };
}

// The one button a row offers. kind: open (href) | focus (href) | resume (sessionId) |
// assign (target) | openPath (path) | done | details (open the row's details instead).
export function primaryAction(entry, { all = [], recent = [] } = {}) {
  const { item, group, worktree, annotation } = entry;
  if (item.source === 'claude-session') {
    const s = item.session;
    if (s.running) return s.focusUrl ? { kind: 'focus', label: 'Focus', href: s.focusUrl } : null;
    return { kind: 'resume', label: 'Resume', sessionId: s.id };
  }
  if (item.source === 'feed') return item.url ? { kind: 'open', label: 'Open', href: item.url } : null;
  if (item.source === 'commitment') return { kind: 'done', label: 'Mark done' };

  const open = label => (item.url ? { kind: 'open', label, href: item.url } : null);
  // A guessed project is never one click: the row opens its details so you see the picker first
  const target = assignTarget(entry, all, recent);
  const oneClick = target && !target.guessed ? target : null;
  // A session already started on this item: one in its worktree, else one titled with its key
  const sessions = worktree?.claudeSessions?.length
    ? worktree.claudeSessions
    : item.key ? recent.flatMap(p => p.claudeSessions ?? []).filter(s => s.title?.includes(item.key)) : [];
  const session = sessions.find(s => s.running) ?? sessions[0];

  switch (group) {
    case 'respond': {
      const waiting = sessions.find(s => s.running && s.state === 'waiting');
      if (waiting?.focusUrl && !item.feedSignals?.length && item.role !== 'reviewer') {
        return { kind: 'focus', label: 'Focus', href: waiting.focusUrl };
      }
      return { kind: 'open', label: 'Open & reply', href: item.feedSignals?.find(f => f.url)?.url || item.url };
    }
    case 'unsent':
      return open('Send evidence');
    case 'gather':
    case 'due':
      return oneClick ? { kind: 'assign', label: 'Assign to Claude', target: oneClick } : { kind: 'details', label: 'Assign to Claude…' };
    case 'follow':
      return open('Nudge');
    case 'progress':
      if (session?.running) return session.focusUrl ? { kind: 'focus', label: 'Focus', href: session.focusUrl } : open('Open');
      if (session) return { kind: 'resume', label: 'Resume', sessionId: session.id };
      if (oneClick) return { kind: 'assign', label: 'Assign to Claude', target: oneClick };
      if (target) return { kind: 'details', label: 'Assign to Claude…' };
      if (worktree?.path) return { kind: 'openPath', label: 'Open in Code', path: worktree.path };
      return open('Open');
    default:
      return open('Open');
  }
}
