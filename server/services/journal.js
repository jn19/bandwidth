import { readFile } from 'fs/promises';
import { basename } from 'path';
import { homedir } from 'os';

// JOURNAL_FILE: optional daily-journal path with a {date} placeholder
// (YYYY-MM-DD, local time), e.g. ~/notes/Daily/{date}.md. Its top-level "- "
// bullets show in the Today panel; wiki links are reduced to their labels.
function localDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function plain(line) {
  return line
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => basename(target))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

async function bullets(template, date) {
  const text = await readFile(template.replace(/^~/, homedir()).replaceAll('{date}', date), 'utf8').catch(() => null);
  if (text === null) return null;
  return text.split('\n').filter(l => l.startsWith('- ')).map(l => plain(l.slice(2))).filter(Boolean);
}

// Today plus the most recent earlier day with entries (within a week), newest first
export async function getJournal() {
  const template = process.env.JOURNAL_FILE;
  if (!template) return { enabled: false, days: [] };
  const today = new Date();
  const days = [{ date: localDate(today), bullets: (await bullets(template, localDate(today))) ?? [] }];
  for (let back = 1; back <= 7; back++) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const b = await bullets(template, localDate(d));
    if (b?.length) { days.push({ date: localDate(d), bullets: b }); break; }
  }
  return { enabled: true, days };
}
