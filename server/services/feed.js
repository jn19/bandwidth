import { execFile } from 'child_process';
import { childEnv } from '../security.js';

// FEED_COMMAND: optional program (run without a shell) that prints a JSON array
// of extra items, for sources bandwidth doesn't know: mentions, tasks from a wiki,
// a cache another tool keeps. Each item:
//   { id, title, url?, source?, subtitle?, updatedAt?, key?, signal? }
// An item whose `key` matches a Jira card adds `signal` (or its title) to that
// card as something to act on; the rest are listed under "Asked of you".
const TIMEOUT_MS = 20_000;
const CACHE_MS = 60_000;
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
let cached = { at: 0, items: [] };

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 200), title = str(raw.title, 300);
  if (!id || !title) return null;
  let url = null;
  try {
    const u = new URL(raw.url);
    if (u.protocol === 'https:' || u.protocol === 'http:') url = u.href;   // never javascript: or file:
  } catch {}
  const updatedAt = Number.isNaN(Date.parse(raw.updatedAt)) ? null : new Date(raw.updatedAt).toISOString();
  return {
    id: `feed-${id}`,
    title,
    url,
    source: str(raw.source, 40) ?? 'Feed',
    subtitle: str(raw.subtitle, 300),
    updatedAt,
    key: KEY_RE.test(raw.key ?? '') ? raw.key : null,
    signal: str(raw.signal, 120)
  };
}

export function getFeed({ fresh = false } = {}) {
  const cmd = process.env.FEED_COMMAND;
  if (!cmd) return Promise.resolve([]);
  if (!fresh && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.items);
  return new Promise((resolve, reject) => {
    execFile(cmd, [], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: childEnv() }, (err, stdout) => {
      if (err) return reject(new Error(`FEED_COMMAND failed: ${err.killed ? 'timed out' : err.message.split('\n')[0]}`));
      let data;
      try { data = JSON.parse(stdout); } catch { return reject(new Error('FEED_COMMAND did not print JSON')); }
      const items = (Array.isArray(data) ? data : []).map(clean).filter(Boolean).slice(0, 500);
      cached = { at: Date.now(), items };
      resolve(items);
    });
  });
}
