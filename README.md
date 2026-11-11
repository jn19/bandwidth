# bandwidth

A personal dashboard that shows *what needs you*: it pulls your open GitHub PRs, review requests, and Jira tickets into one view, with work you've already started pinned at the top so it doesn't get forgotten.

This was not my original idea and I definitely stole it from [Scott Hanselman](https://github.com/shanselman). This is also 100% vibe coded so use at your own risk.

## Prerequisites

- Node.js 18+
- [gh CLI](https://cli.github.com/) — run `gh auth login` once before starting

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure
cp .env.example .env
# Edit .env with your Jira credentials and paths
```

## Running

```bash
npm run dev     # development: Vite on http://localhost:5173, API on :3001
npm start       # build the page once and serve everything from http://localhost:3001
```

## Security

The API can open terminals, run git and read your Claude Code transcripts, so it only answers the local machine:

- The server listens on `127.0.0.1` only (`HOST` changes that; don't, unless you add authentication).
- Requests must name a loopback host (`localhost`, `127.0.0.1`), which blocks DNS-rebinding attacks.
- Browser requests from other sites are refused: a non-loopback `Origin` or `Sec-Fetch-Site: cross-site` gets a 403. There is no CORS.
- Repo and branch names are validated before they reach git; remove and open only act on worktrees git lists (plus Claude project folders and indexed notes for open).
- Terminals and editors the server starts don't inherit its credentials (any env var named like a token, secret, password or API key is dropped).
- `server/data/` (your notes, pins and the task briefs, which include Jira text) is gitignored.

## Linux and WSL

Everything except the terminal works the same on Linux. "Open in Code" runs `code <path>` (`CODE_COMMAND` overrides it); in WSL that opens Windows VS Code attached to WSL. "Claude running" is detected from `/proc`, so `lsof` isn't needed.

For **Resume** and **Assign to Claude**, set `BANDWIDTH_LAUNCHER` to a program that opens a terminal. It's run without a shell as:

```
<launcher> <cwd> <title> [--prompt-file <file>] [--prefill <text>] -- <claude args...>
```

`scripts/launch-wsl-terminal.sh` does this for WSL + Windows Terminal: it opens a new tab in your distro and runs `claude` in an interactive bash (so a `claude` function in `~/.bashrc` still applies). Set `BANDWIDTH_TMUX=1` to run it inside a new tmux session, named `BANDWIDTH_TMUX_PREFIX` + the folder name. On macOS the built-in Terminal.app path is used unless `BANDWIDTH_LAUNCHER` is set.

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `JIRA_HOST` | Your Jira domain, e.g. `yourco.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEYS` | Comma-separated project keys to include, e.g. `PROJ,API` |
| `LOCAL_REPO_BASE` | Parent directory of your local git repos (default: `~/development`) |
| `GITHUB_INCLUDE_ISSUES` | Set to `false` to hide assigned GitHub issues and only show PRs (default: `true`) |
| `JIRA_API_BASE` | Optional. For a **scoped** API token, which must go through Atlassian's gateway: `https://api.atlassian.com/ex/jira/<cloudId>`. Links still use `JIRA_HOST` |
| `JIRA_READ_ONLY` | `true` hides the New Jira issue form and refuses any Jira write. Use it with a read-only token |
| `CLAUDE_PROJECT_DIRS` | Optional, colon-separated. Folders whose subfolders are Claude Code projects; their sessions are listed under **Claude projects**, even outside git worktrees |
| `CLAUDE_PROJECT_DAYS` | How far back **Claude projects** looks (default: `14`) |
| `NOTES_DIR` | Optional. A folder of markdown notes (e.g. an Obsidian vault). A note whose frontmatter has `tickets: [KEY-1]` is shown on that Jira card and listed in its Claude brief |
| `NOTES_PROJECTS_SUBDIR` | Optional. With it, a note under `NOTES_DIR/<subdir>/<project>/` belongs to that project folder, which drives the project guess (e.g. `Projects` for an Obsidian vault laid out by project) |
| `PROJECT_GUESS_EXCLUDE` | Optional, comma-separated. Projects never guessed, e.g. a weekly-roundup project whose notes mention every issue |
| `CLAUDE_INCLUDE_HEADLESS` | `true` also lists `claude -p` / SDK runs under Claude projects (hidden by default) |
| `JIRA_WAITING_STATUSES` | Optional, comma-separated. Statuses where the next move is someone else's (e.g. `Awaiting Approval,Blocked`); those issues go to **Waiting on others**, or **Follow up** once idle `FOLLOW_UP_DAYS` |
| `FOLLOW_UP_DAYS` | Days without activity before a waiting-on-others issue moves to **Follow up** (default `5`) |
| `JIRA_EVIDENCE_READY_STATUSES` / `EVIDENCE_READY_LABEL` | Optional. Statuses meaning "gathered, not sent yet" (the next move is yours), and the name of their group (default `Evidence ready`) |
| `EVIDENCE_ASK_PATTERN` | Optional regex (case-insensitive). An issue whose description matches is asking you to gather something; open ones go to **To gather** |
| `CATEGORY_RULES_FILE` | Optional JSON file of work areas shown as filter chips, plus quick-win rules (see **Categories** below) |
| `SESSION_STATE_DIR` | Optional. Folder of JSON files written by a Claude Code hook, one per live session: `{ session_id, state: idle\|busy\|waiting, ts, pane? }`. Shows each running session's state and sorts sessions waiting on you first |
| `FOCUS_URL_TEMPLATE` | Optional. Link that brings a running session's terminal to the front, with `{title}` `{project}` (URL-encoded) or `{title64}` `{project64}` (base64url) placeholders |
| `CONTEXT_WARN_TOKENS` | Running sessions at or above this context size are flagged "save & clear" (default `400000`) |
| `FEED_COMMAND` | Optional. Program (run without a shell, 20 s timeout) that prints a JSON array of extra items: `{ id, title, url?, source?, subtitle?, updatedAt?, key?, signal? }`. Items whose `key` matches a Jira card become a signal on it; the rest are listed under **Asked of you** |
| `PERSONAL_PROJECTS_FILE` | Optional. Project names (one per line, or `- name` bullets in a markdown file) shown in a separate, collapsed **Personal projects** section |
| `BADGE_PROJECTS_FILE` / `BADGE_LABEL` | Optional. Project names that get a badge (e.g. compliance scope) and its label |
| `JOURNAL_FILE` | Optional. Daily journal path with a `{date}` placeholder (`YYYY-MM-DD`). Its `- ` bullets show in the **Today** panel, with **Copy for standup** |
| `NEW_SESSION_PREFILL` | Optional. Text typed (not sent) into a session started with **New session**, e.g. a slash command. Needs a launcher that supports `--prefill` |
| `BRIEF_APPENDIX_FILE` | Optional. Markdown added to the end of every "Assign to Claude" brief, for your own conventions |
| `BANDWIDTH_LAUNCHER` | Terminal launcher for Resume / Assign on Linux and WSL (see below) |
| `HOST` | Interface to listen on (default: `127.0.0.1`) |

GitHub auth is handled entirely by the `gh` CLI — no token needed in `.env`.

## How it works

**What to do first** — every item lands in one action group, first match wins, each with one color, icon and word:

1. **Respond** (red ↩): a reply on the ticket (from `FEED_COMMAND`), a PR review requested from you, changes requested or CI failing on your PR, or a Claude session waiting on you.
2. **Evidence ready** (amber 📎, renamed by `EVIDENCE_READY_LABEL`): a `JIRA_EVIDENCE_READY_STATUSES` status — gathered, not sent yet.
3. **To gather** (muted amber 📎): the description matches `EVIDENCE_ASK_PATTERN` and the issue isn't waiting on others.
4. **Due soon** (amber ⏰): a Jira due date or commitment due within 7 days, or past.
5. **Follow up** (blue 🔔): waiting on others with no activity for `FOLLOW_UP_DAYS`.
6. **In progress** (gray ▶): an in-progress status, your open PRs, anything with a worktree, commitments, pinned items.

Then, collapsed: **Waiting on others** (not yet due a nudge) and **Later** (everything else, including anything idle 90+ days). **Do next** at the top shows the three highest scores, each with a "Why now" line and one button. The score is the group (Respond 50, Evidence ready 40, Due 30, To gather 25, Follow up 20, In progress 10) plus overdue 30 + days (up to 15), due today 25, due in 2 days 20, in 7 days 10, Jira priority (Highest 12, High 8, Medium 3), pinned 15, and idle over 7 days 5. **Focus** hides everything but Do next.

Rows are compact: title, why it's there, one button (Open & reply, Send evidence, Assign to Claude, Nudge, Resume), and ▸ for the rest: status, project picker, worktree, notes, Claude sessions, Pin, Snooze, note, category and time estimate. Groups show five rows with "+N more". The header counts what to respond to, evidence ready, overdue, follow-ups and what you've done today (from `JOURNAL_FILE`).

**Easy Wins** (green ⚡, collapsed): quick things, filtered by the time you have (5, 15, 30 min or all): replies ~5, evidence ready ~10, nudges ~2, dormant items to close or snooze ~2, approved PRs to merge ~5, small not-started issues ~30, running Claude sessions to save and clear ~2, feed asks ~5, plus `quickWins` rules. Set a ⏱ estimate on any item to override it, or "not quick" to drop it.

**Categories** — with `CATEGORY_RULES_FILE`, filter chips under the header narrow Do next, the groups and Easy Wins to one work area, and the URL keeps it (`#helpdesk`). A red dot marks an area with something to respond to. Rules are checked in order; the first match wins, and a category with no `match` catches the rest. **Category ▾** on a row overrides the rule for that item.

```json
{
  "categories": [
    { "id": "helpdesk", "label": "Helpdesk", "icon": "🎧", "order": 3,
      "match": [{ "projects": ["IT"] }, { "title": "printer" }] },
    { "id": "audit", "label": "Audit", "icon": "🛡", "order": 1,
      "match": [{ "projects": ["AUD"], "evidenceAsk": true }, { "projects": ["AUD"], "title": "^(Show|Export)\\b" }] },
    { "id": "other", "label": "Everything else", "icon": "🏗", "order": 2 }
  ],
  "quickWins": [{ "title": "\\[Retroactive\\]", "notStarted": true, "minutes": 15 }]
}
```

A `match` entry matches when all its conditions do: `projects` (Jira keys), `title` and `description` (case-insensitive regexes; the title without its `[KEY]` prefix), `evidenceAsk`, `notStarted`. `order` sets the chip order. Quick-win `minutes` is 2, 5, 15 or 30.

**Notes, pins, snoozes and commitments** — every row's details have:
- **Pin**: keeps it in In progress (or its group) and adds to its score. Use it for things you've promised.
- **Snooze**: hides it until tomorrow, next Monday, or two weeks out, then it comes back on its own. Snoozed items are listed in a collapsed section at the bottom so they're never lost.
- **Note**: where you left off, or the next step.

**Add a commitment** adds a promise that has no ticket, with an optional due date; it shows in Due soon or In progress. **Mark done** when it's finished. All of this is stored locally in `server/data/state.json` (gitignored).

**Git worktrees** — GitHub PRs have a "Create worktree" button. Clicking it runs `git worktree add` so you can context-switch between tasks without stashing. The worktree path is shown on the card; "Remove worktree" cleans it up. "Open in Code" launches VS Code on the worktree. Worktrees are created at `{LOCAL_REPO_BASE}/{repo-name}-worktrees/{branch-name}`.

Jira items also get a worktree button. If a local branch already mentions the issue key (e.g. `feature/SOC-123-foo`), the matching repo + branch are auto-detected. Otherwise you pick a repo from a dropdown of everything under `LOCAL_REPO_BASE`, and the worktree is created on a fresh branch named `{KEY}-{slugified-summary}`. The repo you picked is remembered per Jira project, so the next ticket in that project defaults to the same repo.

**Stale worktrees** — when a PR is merged (or a Jira ticket closed) the worktree stays on disk but no longer matches an active item. Any unmatched worktrees show up in a "Stale worktrees" section at the bottom of the page with Open and Remove buttons so you can clean them up.

**Claude Code sessions**: every worktree card lists the Claude Code sessions started in it, showing each session's title, your last prompt, and how long ago it was active. A green dot marks a worktree where `claude` is running right now. **Resume** opens a Terminal.app window running `claude --resume` in that worktree; **Copy command** gives you the same command to paste anywhere. Session activity counts toward "last activity", and a worktree with Claude running shows up in In progress even if it has no matching PR or ticket.

**Assign to Claude**: Jira, PR and issue cards with a worktree get an **Assign to Claude** button (**Review with Claude** for review requests). It opens Claude Code in Terminal, inside that worktree, with the task already loaded: the full Jira issue with its recent comments, or instructions to pull PR feedback and CI status with `gh`. Claude works interactively, asks when something is unclear, and commits locally, but won't push, open PRs, post comments or change the Jira issue without asking you. The Terminal tab is titled after the ticket or session, and stays that way.

**Search**: the box in the header (press `/` to jump to it, `Esc` to clear) filters every section by partial match on title, Jira key, `#number`, repo, branch, worktree path, your note, or Claude session titles. Separate words must all match, so `edge 109` finds EDGE-109. Collapsed sections (Later, Waiting on others, Easy Wins, Snoozed) open while you search so nothing matching is hidden.

**New Jira issue**: pick a board, an issue type and a summary (plus an optional description), and tick **Assign to me** to have it land on your dashboard right away. Boards for the projects in `JIRA_PROJECT_KEYS` are listed first, and your last board is remembered. On a scrum board, the new issue goes to the backlog.

**Claude projects**: with `CLAUDE_PROJECT_DIRS` set, a section lists recent Claude Code sessions grouped by project folder, with the same Resume and Copy command buttons. Projects where Claude is running come first.

**Project folders for Jira issues**: with `CLAUDE_PROJECT_DIRS` set, every Jira card has a **Project** picker, so work that lives in a plain folder (not a git repo) still gets a home. It defaults to your earlier choice for that issue, else a guess: the project with the most notes (`NOTES_PROJECTS_SUBDIR`) and Claude Code memory files (`~/.claude/projects/<folder>/memory/`) naming the issue. **Assign to Claude** then opens Claude in that folder with the issue loaded, no worktree needed (and the brief says not to commit unless asked). Worktree buttons appear only when the issue is code: a local branch names it, or its project is a git repo.

**Your Claude sessions at a glance**: with `SESSION_STATE_DIR`, each running session shows *waiting on you*, *working* or *idle*, sessions waiting on you sort first, and the header counts them. Each session shows its context size; running ones past `CONTEXT_WARN_TOKENS` say "save & clear". **Focus** (with `FOCUS_URL_TEMPLATE`) jumps to the session's terminal, and **New session** starts a fresh one in that project.

**Activity that isn't in Jira**: a ticket's "last activity" also counts notes and Claude memory files naming it, and Claude sessions whose title or last prompt names it, so work done elsewhere keeps it from looking stalled. Jira results are paged, up to 500 issues.

**Related notes**: with `NOTES_DIR` set, Jira cards list the markdown notes whose frontmatter names the issue (`tickets: [KEY-1]`), and "Assign to Claude" tells Claude to read them first.

**"Open in Code" prerequisite** — the server uses `open -a "Visual Studio Code"` on macOS. VS Code must be installed in `/Applications`; the `code` CLI itself is not required. On Linux and WSL it runs `code`.
