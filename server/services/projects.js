import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// Folders whose subfolders are Claude projects (CLAUDE_PROJECT_DIRS, colon
// separated). A project doesn't have to be a git repo: much work lives in plain
// folders, and Claude Code keys memory and settings off the folder either way.
export function projectBases() {
  return (process.env.CLAUDE_PROJECT_DIRS || '').split(':').filter(Boolean)
    .map(d => resolve(d.replace(/^~/, homedir())));
}

// A list of project names from a file: its "- name" bullets if it has any (so a
// markdown note works), otherwise every non-empty line not starting with '#'
async function readNameList(file) {
  if (!file) return new Set();
  const text = await readFile(file.replace(/^~/, homedir()), 'utf8').catch(() => '');
  const lines = text.split('\n').map(l => l.trim());
  const bullets = lines.filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
  return new Set((bullets.length ? bullets : lines.filter(l => l && !l.startsWith('#'))).map(n => n.replace(/`/g, '')));
}

// PERSONAL_PROJECTS_FILE: projects shown in their own, collapsed section.
// BADGE_PROJECTS_FILE + BADGE_LABEL: projects that get a badge (e.g. compliance scope).
export async function projectFlags() {
  const [personal, badged] = await Promise.all([
    readNameList(process.env.PERSONAL_PROJECTS_FILE),
    readNameList(process.env.BADGE_PROJECTS_FILE)
  ]);
  const label = process.env.BADGE_LABEL || 'Badge';
  return name => ({ personal: personal.has(name), badge: badged.has(name) ? label : null });
}

// Every project folder: [{ name, path, isRepo, personal, badge }], sorted by name. Worktree
// folders ({repo}-worktrees) and hidden folders are left out.
export async function listAllProjects() {
  const flags = await projectFlags();
  const lists = await Promise.all(projectBases().map(async base => {
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('-worktrees'))
      .map(e => {
        const path = join(base, e.name);
        return { name: e.name, path, isRepo: existsSync(join(path, '.git')), ...flags(e.name) };
      });
  }));
  return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function findProject(path) {
  return (await listAllProjects()).find(p => p.path === path) ?? null;
}
