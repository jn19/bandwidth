import { readdir, stat, open } from 'fs/promises';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';

// Optional: a folder of markdown notes (e.g. an Obsidian vault). A note whose
// YAML frontmatter has a `tickets: [KEY-1, KEY-2]` line is linked to those Jira
// issues: shown on their cards and listed in "Assign to Claude" briefs.
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
        date: fm.match(DATE_RE)?.[1] ?? null,
        summary: fm.match(SUMMARY_RE)?.[1]?.slice(0, 300) ?? null,
        keys
      };
    }
  }
  cache.set(path, { mtimeMs, note });
  return note;
}

// { [jiraKey]: [{ title, path, date, summary }] }, newest first
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

export async function notePaths() {
  return Object.values(await notesByTicket()).flat().map(n => n.path);
}
