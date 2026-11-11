import { readdir } from 'fs/promises';
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

// Every project folder: [{ name, path, isRepo }], sorted by name. Worktree
// folders ({repo}-worktrees) and hidden folders are left out.
export async function listAllProjects() {
  const lists = await Promise.all(projectBases().map(async base => {
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('-worktrees'))
      .map(e => {
        const path = join(base, e.name);
        return { name: e.name, path, isRepo: existsSync(join(path, '.git')) };
      });
  }));
  return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function findProject(path) {
  return (await listAllProjects()).find(p => p.path === path) ?? null;
}
