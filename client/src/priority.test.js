import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPriorities, categorize, primaryAction } from './priority.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-03-10T12:00:00');
const ago = d => new Date(NOW - d * DAY).toISOString();
const ymd = d => {
  const t = new Date(NOW + d * DAY);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const jira = (key, extra = {}) => ({
  id: `jira-${key}`, key, title: `[${key}] Thing ${key}`, source: 'jira', projectKey: key.split('-')[0],
  url: `https://example.test/browse/${key}`, updatedAt: ago(1), ...extra
});
const run = (items, opts = {}) => buildPriorities(items, {}, { now: NOW, ...opts }).entries;
const groupOf = (entries, key) => entries.find(e => e.item.key === key)?.group;

test('first matching group wins, in the approved order', () => {
  const entries = run([
    jira('A-1', { feedSignals: [{ label: 'Reply from Sam' }], evidenceReady: true }),
    jira('A-2', { evidenceReady: true, evidenceAsk: true }),
    jira('A-3', { evidenceAsk: true, dueDate: ymd(1) }),
    jira('A-4', { dueDate: ymd(3), waitingOnOthers: true }),
    jira('A-5', { waitingOnOthers: true, updatedAt: ago(6) }),
    jira('A-6', { waitingOnOthers: true, updatedAt: ago(2) }),
    jira('A-7', { inProgress: true }),
    jira('A-8', {}),
    jira('A-9', { evidenceAsk: true, waitingOnOthers: true, updatedAt: ago(2) })
  ]);
  assert.deepEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8', 'A-9'].map(k => groupOf(entries, k)),
    ['respond', 'unsent', 'gather', 'due', 'follow', 'waiting', 'progress', 'later', 'waiting']);
});

test('follow-up threshold is configurable', () => {
  const items = [jira('B-1', { waitingOnOthers: true, updatedAt: ago(3) })];
  assert.equal(groupOf(run(items), 'B-1'), 'waiting');
  assert.equal(groupOf(run(items, { followUpDays: 2 }), 'B-1'), 'follow');
});

test('score: group base + overdue + priority + pinned + idle', () => {
  const [e] = run([jira('C-1', { dueDate: ymd(-20), priority: 'High', updatedAt: ago(10) })],
    { annotations: { 'jira-C-1': { pinned: true } } });
  // due 30 + overdue (30 + 15 capped) + High 8 + pinned 15 + idle 5
  assert.equal(e.score, 30 + 45 + 8 + 15 + 5);
  assert.deepEqual(e.reasons, ['overdue 20d', 'High priority', 'pinned', 'idle 10d']);
});

test('idle 90+ days is dormant in Later, unless pinned', () => {
  const entries = run([
    jira('D-1', { inProgress: true, updatedAt: ago(120) }),
    jira('D-2', { inProgress: true, updatedAt: ago(120) })
  ], { annotations: { 'jira-D-2': { pinned: true } } });
  const d1 = entries.find(e => e.item.key === 'D-1');
  assert.equal(d1.group, 'later');
  assert.equal(d1.dormant, true);
  assert.equal(d1.estimate, 2);
  assert.equal(groupOf(entries, 'D-2'), 'progress');
});

test('snoozed items are set aside', () => {
  const r = buildPriorities([jira('E-1', { feedSignals: [{ label: 'x' }] })], {}, {
    now: NOW, annotations: { 'jira-E-1': { snoozedUntil: new Date(NOW + DAY).toISOString() } }
  });
  assert.equal(r.entries.length, 0);
  assert.equal(r.snoozed.length, 1);
});

test('estimates: defaults, quick-win rules, and your override', () => {
  const quickWins = [{ title: '\\[Retro\\]', notStarted: true, minutes: 15 }];
  const entries = run([
    jira('F-1', { evidenceReady: true }),
    jira('F-2', { title: '[F-2] [Retro] old change', notStarted: true, effort: 'small' }),
    jira('F-3', { effort: 'small', notStarted: true }),
    jira('F-4', { evidenceReady: true })
  ], { quickWins, annotations: { 'jira-F-4': { estimate: 'none' } } });
  const est = k => entries.find(e => e.item.key === k).estimate;
  assert.equal(est('F-1'), 10);
  assert.equal(est('F-2'), 15);
  assert.equal(est('F-3'), 30);
  assert.equal(est('F-4'), null);
});

test('categories: first matching rule, catch-all, override', () => {
  const categories = [
    { id: 'desk', label: 'Desk', match: [{ projects: ['IT'] }, { title: 'printer' }] },
    { id: 'audit', label: 'Audit', match: [{ projects: ['AU'], evidenceAsk: true }] },
    { id: 'other', label: 'Other', match: null }
  ];
  assert.equal(categorize(jira('IT-1'), categories), 'desk');
  assert.equal(categorize(jira('X-1', { title: '[X-1] Printer jam' }), categories), 'desk');
  assert.equal(categorize(jira('AU-1', { evidenceAsk: true }), categories), 'audit');
  assert.equal(categorize(jira('AU-2'), categories), 'other');
  assert.equal(categorize(jira('AU-2'), categories, 'desk'), 'desk');
  assert.equal(categorize(jira('AU-2'), categories, 'gone'), 'other');
});

test('waiting Claude sessions become Respond rows, once', () => {
  const session = { id: 's1', title: 'Fix it', running: true, state: 'waiting', focusUrl: 'focus:x' };
  const entries = run([], { projects: [{ name: 'proj', path: '/p', claudeSessions: [session] }] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].group, 'respond');
  assert.deepEqual(primaryAction(entries[0]), { kind: 'focus', label: 'Focus', href: 'focus:x' });
});

test('primary action per group', () => {
  const all = [{ name: 'proj', path: '/p' }];
  const entries = run([
    jira('G-1', { evidenceReady: true }),
    jira('G-2', { evidenceAsk: true, projectGuess: { name: 'proj' } }),
    jira('G-3', { evidenceAsk: true }),
    jira('G-4', { waitingOnOthers: true, updatedAt: ago(9) }),
    jira('G-5', { inProgress: true, projectGuess: { name: 'proj' } }),
    jira('G-6', { inProgress: true })
  ], { annotations: { 'jira-G-2': { project: 'proj' }, 'jira-G-6': { project: 'proj' } } });
  const guessed = run([jira('G-7', { evidenceAsk: true, projectGuess: { name: 'proj' } })]);
  const act = k => primaryAction(entries.find(e => e.item.key === k), { all, recent: [] });
  assert.equal(act('G-1').label, 'Send evidence');
  assert.equal(act('G-2').kind, 'assign');
  assert.equal(act('G-2').target.projectPath, '/p');
  assert.equal(act('G-3').kind, 'details');
  assert.equal(act('G-4').label, 'Nudge');
  // A guess is never one click, and a new session is never called Resume
  assert.equal(primaryAction(guessed[0], { all, recent: [] }).kind, 'details');
  assert.equal(act('G-5').kind, 'details');
  assert.deepEqual([act('G-6').kind, act('G-6').label], ['assign', 'Assign to Claude']);
});
