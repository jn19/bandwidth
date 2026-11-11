import { readFile, writeFile, rename, mkdir, readdir } from 'fs/promises';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { homedir, hostname } from 'os';

// Personal state that GitHub/Jira don't hold: per-item notes, pins and snoozes,
// plus free-text commitments. By default one gitignored JSON file next to the server.
//
// STATE_DIR shares it between machines through a synced folder (Syncthing, a cloud
// drive): each machine writes only its own `state-<machine>.json`, so a sync tool never
// sees two writers on one file, and reads merge every machine's file. Each record
// carries `changedAt`; per item the newest change wins. Clearing an annotation or
// finishing a commitment leaves a `{ deleted: true }` record so an older copy on
// another machine can't bring it back.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(__dirname, '../data/state.json');
const MACHINE_FILE_RE = /^state-[A-Za-z0-9._-]+\.json$/;

const ANNOTATION_FIELDS = ['note', 'pinned', 'snoozedUntil', 'project', 'category', 'estimate'];
// Remembered settings, not work: changing them doesn't count as activity
const QUIET_FIELDS = new Set(['project', 'category', 'estimate']);
// category: a CATEGORY_RULES_FILE id; estimate: minutes, or 'none' for "not a quick one"
const VALID = {
  category: v => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v),
  estimate: v => [2, 5, 15, 30, 'none'].includes(v)
};

export class InvalidAnnotation extends Error {}

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : resolve(p);
}

// Read per call, so tests (and a changed environment) take effect without a restart
function machineName() {
  return (process.env.STATE_MACHINE || hostname()).replace(/[^A-Za-z0-9._-]/g, '-') || 'machine';
}
function stateDir() {
  return process.env.STATE_DIR ? expandHome(process.env.STATE_DIR) : null;
}
function ownFile() {
  const dir = stateDir();
  return dir ? join(dir, `state-${machineName()}.json`) : DEFAULT_FILE;
}

// Files written before STATE_DIR existed hold commitments as a list and have no
// changedAt; they read as changed at their last activity (or never)
function normalize(raw) {
  const commitments = Array.isArray(raw.commitments)
    ? Object.fromEntries(raw.commitments.map(c => [c.id, { ...c, changedAt: c.changedAt ?? c.createdAt ?? '' }]))
    : raw.commitments ?? {};
  const annotations = Object.fromEntries(Object.entries(raw.annotations ?? {})
    .map(([id, a]) => [id, { ...a, changedAt: a.changedAt ?? a.updatedAt ?? '' }]));
  return { annotations, commitments };
}

async function readState(file) {
  try {
    return normalize(JSON.parse(await readFile(file, 'utf8')));
  } catch (err) {
    // A corrupt file throws rather than being silently replaced with empty state
    if (err.code === 'ENOENT') return { annotations: {}, commitments: {} };
    throw err;
  }
}

// Newest change per id across machines; ties go to the later machine name, so every
// machine settles on the same answer
function pickNewest(target, records, machine) {
  for (const [id, rec] of Object.entries(records)) {
    const cur = target[id];
    if (!cur || rec.changedAt > cur.rec.changedAt || (rec.changedAt === cur.rec.changedAt && machine > cur.machine)) {
      target[id] = { rec, machine };
    }
  }
}

async function loadMerged() {
  const own = await readState(ownFile());
  const dir = stateDir();
  if (!dir) return own;
  const me = `state-${machineName()}.json`;
  const annotations = {};
  const commitments = {};
  pickNewest(annotations, own.annotations, machineName());
  pickNewest(commitments, own.commitments, machineName());
  let names = [];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const name of names) {
    if (name === me || !MACHINE_FILE_RE.test(name)) continue;
    let other;
    try {
      other = await readState(join(dir, name));
    } catch (err) {
      // Another machine's file mid-sync or damaged: skip it this time; nothing here writes to it
      console.warn(`state: skipping ${name}: ${err.message}`);
      continue;
    }
    const machine = name.slice('state-'.length, -'.json'.length);
    pickNewest(annotations, other.annotations, machine);
    pickNewest(commitments, other.commitments, machine);
  }
  const unwrap = m => Object.fromEntries(Object.entries(m).map(([id, { rec }]) => [id, rec]));
  return { annotations: unwrap(annotations), commitments: unwrap(commitments) };
}

// What the API returns: live records only, without the sync bookkeeping
function publicState({ annotations, commitments }) {
  const strip = ({ changedAt, deleted, ...rest }) => rest;
  return {
    annotations: Object.fromEntries(Object.entries(annotations).filter(([, a]) => !a.deleted).map(([id, a]) => [id, strip(a)])),
    commitments: Object.values(commitments).filter(c => !c.deleted).map(strip)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  };
}

// Serialize read-modify-write cycles so concurrent requests can't clobber each other.
// fn gets the merged state (to build on) and returns { annotations, commitments }
// records to store in this machine's file, plus the value to return.
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const file = ownFile();
    const [merged, own] = await Promise.all([loadMerged(), readState(file)]);
    const { annotations = {}, commitments = {}, result } = fn(merged);
    // A change is stamped after the version it replaced, even when this machine's clock
    // runs behind (WSL after sleep), so an edit you made always beats what you saw;
    // clocks only decide between edits that hadn't seen each other
    const stamp = seen => {
      const now = Date.now();
      const after = seen ? Date.parse(seen) + 1 : 0;
      return new Date(Number.isNaN(after) ? now : Math.max(now, after)).toISOString();
    };
    for (const [id, rec] of Object.entries(annotations)) {
      own.annotations[id] = { ...rec, changedAt: stamp(merged.annotations[id]?.changedAt) };
    }
    for (const [id, rec] of Object.entries(commitments)) {
      own.commitments[id] = { ...rec, changedAt: stamp(merged.commitments[id]?.changedAt) };
    }
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 2, ...own }, null, 2));
    await rename(tmp, file);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export async function getState() {
  return publicState(await loadMerged());
}

// Merges `patch` into the item's annotation. null / '' / false clear a field;
// an annotation with no fields left is deleted. Returns the annotation or null.
export function annotate(id, patch) {
  for (const [field, valid] of Object.entries(VALID)) {
    const value = patch[field];
    if (value !== undefined && value !== null && value !== '' && !valid(value)) {
      return Promise.reject(new InvalidAnnotation(`Invalid ${field}`));
    }
  }
  return mutate(state => {
    const current = state.annotations[id];
    const { changedAt, deleted, ...next } = current?.deleted ? {} : current ?? {};
    for (const field of ANNOTATION_FIELDS) {
      if (!(field in patch)) continue;
      const value = patch[field];
      if (value === null || value === '' || value === false) delete next[field];
      else next[field] = value;
    }
    if (!ANNOTATION_FIELDS.some(f => f in next)) {
      return { annotations: { [id]: { deleted: true } }, result: null };
    }
    if (Object.keys(patch).some(f => ANNOTATION_FIELDS.includes(f) && !QUIET_FIELDS.has(f))) {
      next.updatedAt = new Date().toISOString();
    }
    return { annotations: { [id]: next }, result: next };
  });
}

export function addCommitment({ title, dueDate }) {
  return mutate(() => {
    const commitment = {
      id: `commitment-${randomUUID()}`,
      title,
      dueDate: dueDate || null,
      createdAt: new Date().toISOString()
    };
    return { commitments: { [commitment.id]: commitment }, result: commitment };
  });
}

export function removeCommitment(id) {
  return mutate(() => ({
    commitments: { [id]: { id, deleted: true } },
    annotations: { [id]: { deleted: true } }
  }));
}
