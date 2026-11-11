import { readdir, stat, open, mkdir, writeFile, readlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execFile, spawn } from 'child_process';
import { listAllWorktrees } from './git.js';
import { buildTaskBrief, sessionName } from './taskBrief.js';
import { childEnv } from '../security.js';
import { projectBases, findProject, projectFlags } from './projects.js';

// Claude Code writes one JSONL transcript per session under
// ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl. Each entry carries the cwd,
// and the file accumulates title entries ("ai-title", "custom-title") over time.
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
// Transcripts can be many MB — read only the head (for cwd / first prompt) and
// the tail (for latest title / last prompt)
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
// When the tail has no title or prompt (large tool output, images), look further back
const DEEP_STEP = 1024 * 1024;
const DEEP_MAX = 8 * 1024 * 1024;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
// Briefs live next to the personal state file (gitignored), not in the worktree
const BRIEFS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data/briefs');

const cache = new Map(); // file → { mtimeMs, size, session }

async function readRange(file, start, length) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

function parseLines(text, { dropFirst = false, dropLast = false } = {}) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift(); // partial line from reading mid-file
  if (dropLast) lines.pop();
  return lines.flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

// A prompt the user actually typed — not tool results, slash-command wrappers or meta entries
function promptText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  const content = entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(p => p.type === 'text').map(p => p.text).join('\n')
      : '';
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  return trimmed.slice(0, 200);
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function readSession(file) {
  const { mtimeMs, size } = await stat(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.session;

  const headText = await readRange(file, 0, Math.min(size, HEAD_BYTES));
  const tailStart = Math.max(0, size - TAIL_BYTES);
  const tailText = size <= HEAD_BYTES ? headText : await readRange(file, tailStart, size - tailStart);
  const head = parseLines(headText, { dropLast: size > HEAD_BYTES });
  const tail = parseLines(tailText, { dropFirst: tailStart > 0 });

  const cwd = head.find(e => e.cwd)?.cwd ?? tail.find(e => e.cwd)?.cwd ?? null;
  // `claude -p` / SDK runs are scripted, not conversations to resume
  const headless = (head.find(e => e.entrypoint)?.entrypoint ?? '').startsWith('sdk')
    && process.env.CLAUDE_INCLUDE_HEADLESS !== 'true';
  let customTitle = null, aiTitle = null, lastPrompt = null;
  let contextTokens = null;
  for (const entry of tail) {
    if (entry.type === 'custom-title') customTitle = entry.customTitle;
    else if (entry.type === 'ai-title') aiTitle = entry.aiTitle;
    lastPrompt = promptText(entry) ?? lastPrompt;
    // Context size = what the last model call read: fresh + cached input
    const u = entry.type === 'assistant' && !entry.isSidechain ? entry.message?.usage : null;
    if (u) contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  }
  const firstPrompt = head.map(promptText).find(Boolean) ?? null;
  if (!customTitle && !aiTitle && !lastPrompt && size > HEAD_BYTES + TAIL_BYTES) {
    ({ customTitle, aiTitle, lastPrompt } = await searchBack(file, tailStart));
  }
  const talked = [...head, ...tail].some(e => e.type === 'assistant');

  const id = basename(file, '.jsonl');
  // Long sessions can have their title outside the bytes read; the last prompt stands in
  const title = customTitle || aiTitle || firstPrompt || lastPrompt || (talked ? '(untitled session)' : null);
  // Sessions with nothing typed in them (e.g. just /login) aren't worth listing
  const session = cwd && title && !headless ? {
    id,
    cwd,
    title,
    lastPrompt: lastPrompt ?? firstPrompt,
    lastActiveAt: new Date(mtimeMs).toISOString(),
    contextTokens,
    resumeCommand: `cd ${shellQuote(cwd)} && claude --resume ${id}`
  } : null;
  cache.set(file, { mtimeMs, size, session });
  return session;
}

// Reads backwards from `end` in 1 MB steps (up to 8 MB) for the newest title
// entry and the newest typed prompt
async function searchBack(file, end) {
  const found = { customTitle: null, aiTitle: null, lastPrompt: null };
  for (let stop = end, read = 0; stop > HEAD_BYTES && read < DEEP_MAX; read += DEEP_STEP) {
    const start = Math.max(HEAD_BYTES, stop - DEEP_STEP);
    const entries = parseLines(await readRange(file, start, stop - start), { dropFirst: true, dropLast: true });
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'custom-title') found.customTitle ??= e.customTitle;
      else if (e.type === 'ai-title') found.aiTitle ??= e.aiTitle;
      else found.lastPrompt ??= promptText(e);
    }
    if (found.customTitle || found.aiTitle) break;
    stop = start;
  }
  return found;
}

export async function listSessions() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const projects = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const files = (await Promise.all(projects.filter(p => p.isDirectory()).map(async p => {
    const dir = join(PROJECTS_DIR, p.name);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => join(dir, e.name));
  }))).flat();
  const sessions = await Promise.all(files.map(f => readSession(f).catch(() => null)));
  return sessions.filter(Boolean);
}

function execOutput(cmd, args) {
  // lsof exits 1 when any pid has vanished but still prints the rest, so keep stdout on failure
  return new Promise(resolve => {
    execFile(cmd, args, (_err, stdout) => resolve(stdout || ''));
  });
}

// Working directories of every running `claude` process
async function runningClaudeCwds() {
  if (process.platform === 'linux') return runningClaudeCwdsProc();
  const ps = await execOutput('ps', ['-axo', 'pid=,comm=']);
  const pids = ps.split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(m => m && basename(m[2]) === 'claude')
    .map(m => m[1]);
  if (pids.length === 0) return [];
  const out = await execOutput('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn']);
  return out.split('\n').filter(l => l.startsWith('n')).map(l => l.slice(1));
}

// Linux has /proc, so no lsof needed. Claude Code's process name is `claude`;
// a `node .../claude` install shows up as node with claude in its argv.
async function runningClaudeCwdsProc() {
  const pids = (await readdir('/proc').catch(() => [])).filter(p => /^\d+$/.test(p));
  const cwds = await Promise.all(pids.map(async pid => {
    try {
      const comm = (await readFile(`/proc/${pid}/comm`, 'utf8')).trim();
      if (comm !== 'claude') {
        if (comm !== 'node') return null;
        const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
        if (!argv.slice(1, 3).some(a => basename(a) === 'claude' || a.endsWith('/claude-code/cli.js'))) return null;
      }
      return await readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }));
  return [...new Set(cwds.filter(Boolean))];
}

export async function attachClaudeSessions(worktrees) {
  const [sessions, running] = await Promise.all([
    listSessions().catch(() => []),
    runningClaudeCwds().catch(() => [])
  ]);
  return worktrees.map(wt => {
    const inside = p => p === wt.path || p.startsWith(wt.path + '/');
    const claudeSessions = sessions
      .filter(s => inside(s.cwd))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    const claudeRunning = running.some(inside);
    // The process can't be tied to a session id, but the live one is the most recently written
    if (claudeRunning && claudeSessions[0]) claudeSessions[0] = { ...claudeSessions[0], running: true };
    return {
      ...wt,
      claudeSessions,
      claudeRunning,
      lastSessionAt: claudeSessions[0]?.lastActiveAt ?? null
    };
  });
}

function appleScriptString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Single line, no control characters, short enough for a tab title
function terminalTitle(s) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
}

// Opens a Terminal.app tab titled `title`, showing only that title. Claude
// Code's own title updates are turned off so they don't replace it.
function openInTerminalApp(command, title) {
  const child = spawn('osascript', [
    '-e', 'tell application "Terminal"',
    '-e', 'activate',
    '-e', `set newTab to do script ${appleScriptString(`export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1; ${command}`)}`,
    '-e', `set custom title of newTab to ${appleScriptString(terminalTitle(title))}`,
    '-e', 'set title displays custom title of newTab to true',
    '-e', 'set title displays shell path of newTab to false',
    '-e', 'set title displays device name of newTab to false',
    '-e', 'set title displays window size of newTab to false',
    '-e', 'set title displays file name of newTab to false',
    '-e', 'end tell'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
}

// Starts `claude <args>` in `cwd` in a new terminal. With `promptFile`, the
// file's contents are passed as the opening prompt (read by the shell, so they
// never pass through quoting). macOS uses Terminal.app; elsewhere the program
// named by BANDWIDTH_LAUNCHER is run, without a shell, as:
//   <launcher> <cwd> <title> [--prompt-file <file>] [--prefill <text>] -- <claude args...>
// scripts/launch-wsl-terminal.sh is one for WSL + Windows Terminal.
function openClaude({ cwd, title, args, promptFile, prefill }) {
  const name = terminalTitle(title);
  if (process.platform === 'darwin' && !process.env.BANDWIDTH_LAUNCHER) {
    const prompt = promptFile ? ` "$(cat ${shellQuote(promptFile)})"` : '';
    openInTerminalApp(`cd ${shellQuote(cwd)} && claude ${args.map(shellQuote).join(' ')}${prompt}`, name);
    return;
  }
  const launcher = process.env.BANDWIDTH_LAUNCHER;
  if (!launcher) throw new Error('Set BANDWIDTH_LAUNCHER to a terminal launcher script (see README)');
  const child = spawn(launcher, [
    cwd, name, ...(promptFile ? ['--prompt-file', promptFile] : []),
    ...(prefill ? ['--prefill', prefill] : []), '--', ...args
  ], { detached: true, stdio: 'ignore', env: childEnv() });
  child.on('error', err => console.error('launcher failed:', err.message));
  child.unref();
}

// A fresh Claude session in a project folder. NEW_SESSION_PREFILL (e.g. a slash
// command) is typed into its input box but not sent; launchers that can't type
// into the terminal ignore it.
export async function newSession(projectPath) {
  const project = await findProject(projectPath);
  if (!project) throw new Error('Project not found');
  openClaude({ cwd: project.path, title: project.name, args: [], prefill: process.env.NEW_SESSION_PREFILL || null });
}

// Opens a new terminal resuming the session in its original directory
export async function resumeSession(sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('Invalid session id');
  const session = (await listSessions()).find(s => s.id === sessionId);
  if (!session) throw new Error('Session not found');
  if (!existsSync(session.cwd)) throw new Error(`Directory no longer exists: ${session.cwd}`);
  openClaude({ cwd: session.cwd, title: session.title, args: ['--resume', session.id] });
}

// SESSION_STATE_DIR: optional folder of JSON files, one per live session, written
// by a Claude Code hook: { session_id, state: 'idle' | 'busy' | 'waiting', ts, pane? }.
// A file whose tmux pane no longer exists is ignored. -> Map(session_id -> state)
async function liveSessionStates() {
  const dir = process.env.SESSION_STATE_DIR;
  if (!dir) return new Map();
  const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'));
  const states = (await Promise.all(files.map(f =>
    readFile(join(dir, f), 'utf8').then(JSON.parse).catch(() => null)))).filter(s => s?.session_id);
  let panes = null;
  if (states.some(s => s.pane)) {
    panes = new Set((await execOutput('tmux', ['list-panes', '-a', '-F', '#{pane_id}'])).split('\n').filter(Boolean));
  }
  const out = new Map();
  for (const s of states) {
    if (s.pane && panes && !panes.has(s.pane)) continue;
    out.set(s.session_id, { state: s.state, since: s.ts ? new Date(s.ts * 1000).toISOString() : null });
  }
  return out;
}

// FOCUS_URL_TEMPLATE: a link that brings a running session's terminal to the
// front, e.g. a custom protocol handler. Placeholders: {title} {project} (URL
// encoded) and {title64} {project64} (base64url).
function focusUrl(title, project) {
  const t = process.env.FOCUS_URL_TEMPLATE;
  if (!t) return null;
  const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
  return t.replaceAll('{title64}', b64(title)).replaceAll('{project64}', b64(project))
    .replaceAll('{title}', encodeURIComponent(title)).replaceAll('{project}', encodeURIComponent(project));
}

// Recent sessions grouped by project folder (see projects.js). Sessions started
// anywhere inside a project count, so work outside git worktrees shows up too.
export async function listClaudeProjects() {
  const bases = projectBases();
  if (bases.length === 0) return [];
  const days = Number(process.env.CLAUDE_PROJECT_DAYS) || 14;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const [sessions, running, live, flags] = await Promise.all([
    listSessions().catch(() => []),
    runningClaudeCwds().catch(() => []),
    liveSessionStates().catch(() => new Map()),
    projectFlags()
  ]);
  const projectOf = p => {
    for (const base of bases) {
      if (p.startsWith(base + '/')) return join(base, p.slice(base.length + 1).split('/')[0]);
    }
    return null;
  };
  const byPath = new Map();
  for (const s of sessions) {
    const path = projectOf(s.cwd);
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(s);
  }
  const runningPaths = new Set(running.map(projectOf).filter(Boolean));
  return [...byPath].map(([path, rawList]) => {
    const name = basename(path);
    // Live state files name their sessions exactly; without one, the newest
    // session in a folder where `claude` runs is assumed to be the live one
    let list = rawList
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .map(s => (live.has(s.id) ? { ...s, running: true, state: live.get(s.id).state, stateSince: live.get(s.id).since } : s));
    const isRunning = runningPaths.has(path) || list.some(s => s.running);
    if (isRunning && !list.some(s => s.running)) list[0] = { ...list[0], running: true };
    list = list.map(s => (s.running ? { ...s, focusUrl: focusUrl(s.title, name) } : s));
    return {
      name,
      path,
      ...flags(name),
      claudeSessions: list,
      claudeRunning: isRunning,
      waiting: list.some(s => s.state === 'waiting'),
      lastSessionAt: list[0].lastActiveAt
    };
  })
    .filter(p => p.claudeRunning || Date.parse(p.lastSessionAt) >= since)
    .sort((a, b) => (b.waiting - a.waiting) || (b.claudeRunning - a.claudeRunning) ||
      b.lastSessionAt.localeCompare(a.lastSessionAt));
}

function validateItem(item) {
  if (item?.source === 'jira') {
    if (!JIRA_KEY_RE.test(item.key ?? '')) throw new Error('Invalid Jira key');
  } else if (item?.source === 'github-pr' || item?.source === 'github-issue') {
    if (!GITHUB_REPO_RE.test(item.repo ?? '') || !Number.isInteger(item.number)) {
      throw new Error('Invalid GitHub repo or number');
    }
  } else {
    throw new Error(`Can't assign a ${item?.source ?? 'unknown'} item to Claude`);
  }
}

// Starts an interactive Claude session seeded with a task brief, either in the
// item's git worktree or (Jira only) in a project folder from CLAUDE_PROJECT_DIRS.
// Interactive so Claude can ask questions; the user's default permission mode applies.
export async function assignToClaude(item, { worktreePath, projectPath } = {}) {
  validateItem(item);
  let location;
  if (worktreePath) {
    const worktree = (await listAllWorktrees()).find(wt => wt.path === worktreePath);
    if (!worktree) throw new Error('Worktree not found');
    location = { kind: 'worktree', path: worktree.path, branch: worktree.branch };
  } else if (projectPath) {
    if (item.source !== 'jira') throw new Error('Only Jira issues can be assigned to a project folder');
    const project = await findProject(projectPath);
    if (!project) throw new Error('Project not found');
    location = { kind: 'project', path: project.path, isRepo: project.isRepo };
  } else {
    throw new Error('A worktree or project is required');
  }

  const brief = await buildTaskBrief(item, location);
  await mkdir(BRIEFS_DIR, { recursive: true });
  const slug = (item.key || `${item.repo}-${item.number}`).replace(/[^\w.-]+/g, '-');
  const briefPath = join(BRIEFS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}.md`);
  await writeFile(briefPath, brief);

  const name = sessionName(item);
  openClaude({ cwd: location.path, title: name, args: ['-n', name], promptFile: briefPath });
  return { briefPath };
}
