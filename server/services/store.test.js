import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getState, annotate, addCommitment, removeCommitment } from './store.js';

let dir;
const as = machine => { process.env.STATE_MACHINE = machine; };
const fileOf = machine => join(dir, `state-${machine}.json`);
const write = (machine, data) => writeFile(fileOf(machine), JSON.stringify(data));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bandwidth-state-'));
  process.env.STATE_DIR = dir;
  as('alpha');
});

test('each machine writes only its own file; reads merge them', async () => {
  await annotate('jira-A-1', { pinned: true });
  as('beta');
  await annotate('jira-A-1', { note: 'next: ask Sam' });
  assert.deepEqual((await readdir(dir)).sort(), ['state-alpha.json', 'state-beta.json']);
  const a = (await getState()).annotations['jira-A-1'];
  assert.equal(a.pinned, true);            // beta built on alpha's pin
  assert.equal(a.note, 'next: ask Sam');
  assert.equal(a.changedAt, undefined);    // bookkeeping stays out of the API
  const alpha = JSON.parse(await readFile(fileOf('alpha'), 'utf8'));
  assert.equal(alpha.annotations['jira-A-1'].note, undefined);
});

test('per item, the newest change wins', async () => {
  await write('beta', { annotations: { 'jira-B-1': { pinned: true, changedAt: '2000-01-01T00:00:00.000Z' } } });
  await annotate('jira-B-1', { note: 'mine' });
  as('beta');
  const merged = (await getState()).annotations['jira-B-1'];
  assert.equal(merged.pinned, true);
  assert.equal(merged.note, 'mine');
  await write('gamma', { annotations: { 'jira-B-1': { note: 'future', changedAt: '2999-01-01T00:00:00.000Z' } } });
  assert.deepEqual((await getState()).annotations['jira-B-1'], { note: 'future' });
});

test('clearing on one machine is not undone by an older copy on another', async () => {
  await write('beta', { annotations: { 'jira-C-1': { pinned: true, changedAt: '2000-01-01T00:00:00.000Z' } } });
  assert.equal((await getState()).annotations['jira-C-1'].pinned, true);
  assert.equal(await annotate('jira-C-1', { pinned: false }), null);
  assert.equal((await getState()).annotations['jira-C-1'], undefined);
  // and it can come back later
  await annotate('jira-C-1', { pinned: true });
  assert.equal((await getState()).annotations['jira-C-1'].pinned, true);
});

test('a commitment added on one machine and finished on another is gone everywhere', async () => {
  const c = await addCommitment({ title: 'Send the report', dueDate: '2030-01-02' });
  await annotate(c.id, { note: 'draft is in Drive' });
  as('beta');
  assert.equal((await getState()).commitments[0].title, 'Send the report');
  await removeCommitment(c.id);
  as('alpha');
  const s = await getState();
  assert.equal(s.commitments.length, 0);
  assert.equal(s.annotations[c.id], undefined);
});

test('a file in the old single-machine format still reads', async () => {
  await write('legacy', {
    annotations: { 'jira-D-1': { category: 'audit' } },
    commitments: [{ id: 'commitment-1', title: 'Old promise', dueDate: null, createdAt: '2026-01-01T00:00:00.000Z' }]
  });
  const s = await getState();
  assert.deepEqual(s.annotations['jira-D-1'], { category: 'audit' });
  assert.equal(s.commitments[0].title, 'Old promise');
});

test('another machine\'s damaged file is skipped; this machine\'s own throws', async () => {
  await annotate('jira-E-1', { pinned: true });
  await writeFile(fileOf('beta'), '{ half a fi');
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await getState()).annotations['jira-E-1'].pinned, true);
  } finally {
    console.warn = warn;
  }
  as('beta');
  await assert.rejects(getState());
});

test('quiet fields do not count as activity', async () => {
  const a = await annotate('jira-F-1', { category: 'audit', estimate: 5 });
  assert.equal(a.updatedAt, undefined);
  await assert.rejects(annotate('jira-F-1', { estimate: 7 }), /Invalid estimate/);
});
