import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { homedir } from 'os';

// CATEGORY_RULES_FILE: a JSON file that sorts work into areas shown as filter chips,
// plus optional quick-win rules. The client applies the rules; this only loads and
// checks them. Shape:
//   {
//     "categories": [
//       { "id": "helpdesk", "label": "Helpdesk", "icon": "🎧",
//         "match": [{ "projects": ["IT"] }, { "title": "printer" }] },
//       { "id": "other", "label": "Everything else", "icon": "📁" }
//     ],
//     "quickWins": [{ "title": "\\[Retroactive\\]", "notStarted": true, "minutes": 15 }]
//   }
// A category matches when any of its `match` clauses does; a clause matches when all
// of its conditions do (projects: Jira project keys; title / description: regexes,
// case-insensitive, title without the "[KEY] " prefix; evidenceAsk: true). The first
// matching category wins; one with no `match` catches everything left. Chips follow
// `order` (optional number), else the list order.
const ID_RE = /^[a-z0-9-]{1,40}$/;
const PROJECT_RE = /^[A-Z][A-Z0-9_]*$/;
const MINUTES = new Set([2, 5, 15, 30]);

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function checkRegex(source, where) {
  if (source === undefined) return undefined;
  if (typeof source !== 'string' || source.length > 500) throw new Error(`${where}: regex must be a string`);
  try {
    new RegExp(source, 'i');
  } catch (err) {
    throw new Error(`${where}: ${err.message}`);
  }
  return source;
}

function checkClause(clause, where) {
  if (!clause || typeof clause !== 'object') throw new Error(`${where}: must be an object`);
  const projects = clause.projects;
  if (projects !== undefined && !(Array.isArray(projects) && projects.every(p => PROJECT_RE.test(p)))) {
    throw new Error(`${where}: projects must be Jira project keys`);
  }
  return {
    ...(projects && { projects }),
    ...(clause.title !== undefined && { title: checkRegex(clause.title, `${where}.title`) }),
    ...(clause.description !== undefined && { description: checkRegex(clause.description, `${where}.description`) }),
    ...(clause.evidenceAsk === true && { evidenceAsk: true }),
    ...(clause.notStarted === true && { notStarted: true })
  };
}

function checkRules(data) {
  const categories = (data.categories ?? []).map((c, i) => {
    const where = `categories[${i}]`;
    if (!ID_RE.test(c?.id ?? '')) throw new Error(`${where}: id must be lowercase letters, digits or dashes`);
    if (typeof c.label !== 'string' || !c.label.trim() || c.label.length > 60) throw new Error(`${where}: label is required`);
    if (c.icon !== undefined && (typeof c.icon !== 'string' || c.icon.length > 8)) throw new Error(`${where}: icon is too long`);
    if (c.match !== undefined && !Array.isArray(c.match)) throw new Error(`${where}: match must be a list`);
    if (c.order !== undefined && !Number.isFinite(c.order)) throw new Error(`${where}: order must be a number`);
    return {
      id: c.id,
      label: c.label.trim(),
      icon: c.icon ?? '',
      order: c.order ?? i,
      match: c.match ? c.match.map((m, j) => checkClause(m, `${where}.match[${j}]`)) : null
    };
  });
  if (new Set(categories.map(c => c.id)).size !== categories.length) throw new Error('category ids must be unique');

  const quickWins = (data.quickWins ?? []).map((q, i) => {
    const where = `quickWins[${i}]`;
    if (!MINUTES.has(q?.minutes)) throw new Error(`${where}: minutes must be 2, 5, 15 or 30`);
    return { ...checkClause(q, where), minutes: q.minutes };
  });
  return { categories, quickWins };
}

let cache = null;

// { categories, quickWins }, both empty when CATEGORY_RULES_FILE isn't set. Cached by mtime.
export async function getCategoryRules() {
  const file = process.env.CATEGORY_RULES_FILE;
  if (!file) return { categories: [], quickWins: [] };
  const path = expandHome(file);
  const { mtimeMs } = await stat(path);
  if (cache?.path === path && cache.mtimeMs === mtimeMs) return cache.rules;
  let data;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`CATEGORY_RULES_FILE: ${err.message}`);
  }
  const rules = checkRules(data);
  cache = { path, mtimeMs, rules };
  return rules;
}
