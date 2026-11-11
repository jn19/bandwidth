import { readdir, stat, open, readFile } from 'fs/promises';
import { join, basename, resolve, relative, sep } from 'path';
import { homedir } from 'os';
import { listAllProjects } from './projects.js';

// Optional: a folder of markdown notes (e.g. an Obsidian vault). A note whose
// YAML frontmatter has a `tickets: [KEY-1, KEY-2]` line is linked to those Jira
// issues: shown on their cards and listed in "Assign to Claude" briefs.
//
// With NOTES_PROJECTS_SUBDIR (e.g. "Projects"), a note under
// NOTES_DIR/<subdir>/<name>/ belongs to project <name>, and each issue gets a
// project guess: the project folder (CLAUDE_PROJECT_DIRS) with the most notes
// about it. Claude Code's per-project memory (~/.claude/projects/<folder>/memory)
// counts too, so it also works without notes. PROJECT_GUESS_EXCLUDE (comma
// separated) skips roundup projects that mention every issue.
const HEAD_BYTES = 4 * 1024;
const TICKETS_RE = /^tickets:\s*\[([^\]]*)\]\s*$/m;
const SUMMARY_RE = /^summary:\s*"?(.*?)"?\s*$/m;
const DATE_RE = /^date:\s*(\d{4}-\d{2}-\d{2})\s*$/m;
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

const cache = new Map(); // path -> { mtimeMs, note }

function notesDir() {
  const dir = process.env.NOTES_DIR;
  return dir ? resolve(dir.replace(/^~/, homedir())) : null;
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) await walk(path, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(path);
  }
  return out;
}

async function readNote(path) {
  const { mtimeMs } = await stat(path);
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.note;
  const fh = await open(path, 'r');
  let head;
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    head = buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
  let note = null;
  const end = head.startsWith('---\n') ? head.indexOf('\n---', 4) : -1;
  if (end > 0) {
    const fm = head.slice(4, end);
    const keys = (fm.match(TICKETS_RE)?.[1] ?? '').split(',').map(k => k.trim()).filter(k => KEY_RE.test(k));
    if (keys.length > 0) {
      note = {
        title: basename(path, '.md'),
        path,
        project: projectOf(path),
        modifiedAt: mtimeMs,
        date: fm.match(DATE_RE)?.[1] ?? null,
        summary: fm.match(SUMMARY_RE)?.[1]?.slice(0, 300) ?? null,
        keys
      };
    }
  }
  cache.set(path, { mtimeMs, note });
  return note;
}

function projectOf(path) {
  const dir = notesDir(), sub = process.env.NOTES_PROJECTS_SUBDIR;
  if (!dir || !sub) return null;
  const parts = relative(join(dir, sub), path).split(sep);
  return parts.length >= 2 && parts[0] !== '..' ? parts[0] : null;
}

// { [jiraKey]: [{ title, path, project, date, summary }] }, newest first
export async function notesByTicket() {
  const dir = notesDir();
  if (!dir) return {};
  const notes = await Promise.all((await walk(dir)).map(p => readNote(p).catch(() => null)));
  const byKey = {};
  for (const note of notes.filter(Boolean)) {
    const { keys, ...rest } = note;
    for (const key of keys) (byKey[key] ??= []).push(rest);
  }
  for (const list of Object.values(byKey)) list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return byKey;
}

const MEMORY_ROOT = join(homedir(), '.claude', 'projects');
const KEY_IN_TEXT = /\b[A-Z][A-Z0-9_]*-\d+\b/g;
const memoryCache = new Map(); // file -> { mtimeMs, keys }

// { counts: { [jiraKey]: Map(projectName -> memory files naming it) },
//   latest: { [jiraKey]: newest mtime (ms) of those files } }. Claude Code names
// each project's folder after its path with every non-alphanumeric turned into '-'.
async function memoryMentions(all) {
  const byFolder = new Map(all.map(p => [p.path.replace(/[^A-Za-z0-9]/g, '-'), p.name]));
  const out = {}, latest = {};
  for (const [folder, name] of byFolder) {
    const dir = join(MEMORY_ROOT, folder, 'memory');
    const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    for (const f of files) {
      const path = join(dir, f);
      try {
        const { mtimeMs, size } = await stat(path);
        if (size > 256 * 1024) continue;
        let cached = memoryCache.get(path);
        if (!cached || cached.mtimeMs !== mtimeMs) {
          cached = { mtimeMs, keys: new Set((await readFile(path, 'utf8')).match(KEY_IN_TEXT) ?? []) };
          memoryCache.set(path, cached);
        }
        for (const key of cached.keys) {
          const m = (out[key] ??= new Map());
          m.set(name, (m.get(name) ?? 0) + 1);
          latest[key] = Math.max(latest[key] ?? 0, mtimeMs);
        }
      } catch {}
    }
  }
  return { counts: out, latest };
}

// The project with the most notes plus memory files about the issue (ties: the
// newest note wins), counting only existing project folders that aren't excluded
function guessProject(notes, memory, projects, excluded) {
  const tally = new Map();
  const ok = name => name && !excluded.has(name) && projects.has(name);
  for (const n of notes) {                       // newest first, so first seen = newest
    if (!ok(n.project)) continue;
    const t = tally.get(n.project) ?? { notes: 0, memory: 0 };
    t.notes++;
    tally.set(n.project, t);
  }
  for (const [name, count] of memory ?? []) {
    if (!ok(name)) continue;
    const t = tally.get(name) ?? { notes: 0, memory: 0 };
    t.memory += count;
    tally.set(name, t);
  }
  let best = null;
  for (const [name, t] of tally) {
    if (!best || t.notes + t.memory > best.noteCount + best.memoryCount) {
      best = { name, noteCount: t.notes, memoryCount: t.memory };
    }
  }
  return best ? { ...best, ...projects.get(best.name) } : null;
}

// The project's own notes first, roundup (excluded) projects' notes last;
// newest first within each group
export function orderNotes(notes, projectName, excluded = new Set(
  (process.env.PROJECT_GUESS_EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean))) {
  const rank = n => (n.project && n.project === projectName ? 0 : excluded.has(n.project) ? 2 : 1);
  return [...notes].sort((a, b) => rank(a) - rank(b) || (b.date ?? '').localeCompare(a.date ?? ''));
}


// { [jiraKey]: { notes: [...], project: { name, path, isRepo, noteCount, memoryCount } | null,
//   localActivityAt: ISO | null } }. Local activity = the newest note or memory
// file naming the issue, or (with `sessions`) a Claude session whose title or
// last prompt names it, so work done outside Jira keeps a ticket from going stale.
export async function ticketContext({ sessions = [] } = {}) {
  const all = await listAllProjects();
  const [byKey, mem] = await Promise.all([notesByTicket(), memoryMentions(all)]);
  const memory = mem.counts;
  const activity = { ...mem.latest };
  const bump = (key, t) => { if (t) activity[key] = Math.max(activity[key] ?? 0, Math.min(t, Date.now())); };
  // A note's file time is when it was last written, which a frontmatter date isn't
  for (const [key, notes] of Object.entries(byKey)) for (const n of notes) bump(key, n.modifiedAt);
  for (const s of sessions) {
    for (const key of new Set(`${s.title ?? ''}\n${s.lastPrompt ?? ''}`.match(KEY_IN_TEXT) ?? [])) {
      bump(key, Date.parse(s.lastActiveAt));
    }
  }
  const projects = new Map(all.map(p => [p.name, { path: p.path, isRepo: p.isRepo }]));
  const excluded = new Set((process.env.PROJECT_GUESS_EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean));
  const out = {};
  for (const key of new Set([...Object.keys(byKey), ...Object.keys(memory), ...Object.keys(activity)])) {
    const notes = byKey[key] ?? [];
    const project = guessProject(notes, memory[key], projects, excluded);
    out[key] = {
      notes: orderNotes(notes, project?.name, excluded),
      project,
      localActivityAt: activity[key] ? new Date(activity[key]).toISOString() : null
    };
  }
  return out;
}

export async function notePaths() {
  return Object.values(await notesByTicket()).flat().map(n => n.path);
}
