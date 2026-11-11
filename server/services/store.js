import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// Personal state that GitHub/Jira don't hold: per-item notes, pins and snoozes,
// plus free-text commitments. Kept in a gitignored JSON file next to the server.
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dirname, '../data/state.json');

const ANNOTATION_FIELDS = ['note', 'pinned', 'snoozedUntil', 'project', 'category', 'estimate'];
// Remembered settings, not work: changing them doesn't count as activity
const QUIET_FIELDS = new Set(['project', 'category', 'estimate']);
// category: a CATEGORY_RULES_FILE id; estimate: minutes, or 'none' for "not a quick one"
const VALID = {
  category: v => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v),
  estimate: v => [2, 5, 15, 30, 'none'].includes(v)
};

export class InvalidAnnotation extends Error {}

function emptyState() {
  return { annotations: {}, commitments: [] };
}

async function load() {
  try {
    return { ...emptyState(), ...JSON.parse(await readFile(STATE_FILE, 'utf8')) };
  } catch (err) {
    // A corrupt file throws rather than being silently replaced with empty state
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
}

// Serialize read-modify-write cycles so concurrent requests can't clobber each other
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const state = await load();
    const result = fn(state);
    await mkdir(dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, STATE_FILE);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export function getState() {
  return load();
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
    const next = { ...state.annotations[id] };
    for (const field of ANNOTATION_FIELDS) {
      if (!(field in patch)) continue;
      const value = patch[field];
      if (value === null || value === '' || value === false) delete next[field];
      else next[field] = value;
    }
    if (!ANNOTATION_FIELDS.some(f => f in next)) {
      delete state.annotations[id];
      return null;
    }
    if (Object.keys(patch).some(f => ANNOTATION_FIELDS.includes(f) && !QUIET_FIELDS.has(f))) {
      next.updatedAt = new Date().toISOString();
    }
    state.annotations[id] = next;
    return next;
  });
}

export function addCommitment({ title, dueDate }) {
  return mutate(state => {
    const commitment = {
      id: `commitment-${randomUUID()}`,
      title,
      dueDate: dueDate || null,
      createdAt: new Date().toISOString()
    };
    state.commitments.push(commitment);
    return commitment;
  });
}

export function removeCommitment(id) {
  return mutate(state => {
    state.commitments = state.commitments.filter(c => c.id !== id);
    delete state.annotations[id];
  });
}
