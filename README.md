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
<launcher> <cwd> <title> [--prompt-file <file>] -- <claude args...>
```

`scripts/launch-wsl-terminal.sh` does this for WSL + Windows Terminal: it opens a new tab in your distro and runs `claude` in an interactive bash (so a `claude` function in `~/.bashrc` still applies). Set `BANDWIDTH_TMUX=1` to run it inside a new tmux session, named `BANDWIDTH_TMUX_PREFIX` + the folder name. On macOS the built-in Terminal.app path is used unless `BANDWIDTH_LAUNCHER` is set.

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `JIRA_HOST` | Your Jira domain, e.g. `yourco.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEYS` | Comma-separated project keys to include, e.g. `PROJ,API` |
| `JIRA_SPOTLIGHT_PROJECT` | A project key that gets its own dedicated column, e.g. `SOC` |
| `LOCAL_REPO_BASE` | Parent directory of your local git repos (default: `~/development`) |
| `GITHUB_INCLUDE_ISSUES` | Set to `false` to hide assigned GitHub issues and only show PRs (default: `true`) |
| `JIRA_API_BASE` | Optional. For a **scoped** API token, which must go through Atlassian's gateway: `https://api.atlassian.com/ex/jira/<cloudId>`. Links still use `JIRA_HOST` |
| `JIRA_READ_ONLY` | `true` hides the New Jira issue form and refuses any Jira write. Use it with a read-only token |
| `CLAUDE_PROJECT_DIRS` | Optional, colon-separated. Folders whose subfolders are Claude Code projects; their sessions are listed under **Claude projects**, even outside git worktrees |
| `CLAUDE_PROJECT_DAYS` | How far back **Claude projects** looks (default: `14`) |
| `NOTES_DIR` | Optional. A folder of markdown notes (e.g. an Obsidian vault). A note whose frontmatter has `tickets: [KEY-1]` is shown on that Jira card and listed in its Claude brief |
| `BRIEF_APPENDIX_FILE` | Optional. Markdown added to the end of every "Assign to Claude" brief, for your own conventions |
| `BANDWIDTH_LAUNCHER` | Terminal launcher for Resume / Assign on Linux and WSL (see below) |
| `HOST` | Interface to listen on (default: `127.0.0.1`) |

GitHub auth is handled entirely by the `gh` CLI — no token needed in `.env`.

## How it works

**In flight** — work you've already started sits in its own lane at the top: your open PRs, Jira tickets in an "In Progress" status, anything with a worktree, and local worktrees with uncommitted changes. Each card shows PR state, CI failures, merge conflicts, uncommitted files, and time since last activity. Actionable items (conflicts, failing CI, requested changes, approved-and-ready-to-merge) sort first, then the most neglected. Anything idle over 7 days is flagged as stalled, and anything idle over 90 days is collapsed under "dormant".

**Notes, pins, snoozes and commitments** — every card has:
- **Pin**: moves it into In flight, at the top. Use it for things you've promised.
- **Snooze**: hides it until tomorrow, next Monday, or two weeks out, then it comes back on its own. Snoozed items are listed in a collapsed section at the bottom so they're never lost.
- **Note**: where you left off, or the next step. Shown on the card.

The **"I said I'd…"** box in In flight adds a commitment that has no ticket, with an optional due date. Overdue commitments sort to the top. Click **Done** when it's finished. All of this is stored locally in `server/data/state.json` (gitignored).

**Categories** — everything else is sorted by urgency (review requests first since someone is blocked on you, then Jira priority, then oldest first) and bucketed into Code Review, Bugs, Tasks, and Docs based on PR labels and Jira issue types. If `JIRA_SPOTLIGHT_PROJECT` is set, that project gets its own column.

**Git worktrees** — GitHub PRs have a "Create worktree" button. Clicking it runs `git worktree add` so you can context-switch between tasks without stashing. The worktree path is shown on the card; "Remove worktree" cleans it up. "Open in Code" launches VS Code on the worktree. Worktrees are created at `{LOCAL_REPO_BASE}/{repo-name}-worktrees/{branch-name}`.

Jira items also get a worktree button. If a local branch already mentions the issue key (e.g. `feature/SOC-123-foo`), the matching repo + branch are auto-detected. Otherwise you pick a repo from a dropdown of everything under `LOCAL_REPO_BASE`, and the worktree is created on a fresh branch named `{KEY}-{slugified-summary}`. The repo you picked is remembered per Jira project, so the next ticket in that project defaults to the same repo.

**Stale worktrees** — when a PR is merged (or a Jira ticket closed) the worktree stays on disk but no longer matches an active item. Any unmatched worktrees show up in a "Stale worktrees" section at the bottom of the page with Open and Remove buttons so you can clean them up.

**Claude Code sessions**: every worktree card lists the Claude Code sessions started in it, showing each session's title, your last prompt, and how long ago it was active. A green dot marks a worktree where `claude` is running right now. **Resume** opens a Terminal.app window running `claude --resume` in that worktree; **Copy command** gives you the same command to paste anywhere. Session activity counts toward "last activity", and a worktree with Claude running shows up in In flight even if it has no matching PR or ticket.

**Assign to Claude**: Jira, PR and issue cards with a worktree get an **Assign to Claude** button (**Review with Claude** for review requests). It opens Claude Code in Terminal, inside that worktree, with the task already loaded: the full Jira issue with its recent comments, or instructions to pull PR feedback and CI status with `gh`. Claude works interactively, asks when something is unclear, and commits locally, but won't push, open PRs, post comments or change the Jira issue without asking you. The Terminal tab is titled after the ticket or session, and stays that way.

**Search**: the box in the header (press `/` to jump to it, `Esc` to clear) filters every section by partial match on title, Jira key, `#number`, repo, branch, worktree path, your note, or Claude session titles. Separate words must all match, so `edge 109` finds EDGE-109. Collapsed sections (dormant, snoozed) open while you search so nothing matching is hidden.

**New Jira issue**: pick a board, an issue type and a summary (plus an optional description), and tick **Assign to me** to have it land on your dashboard right away. Boards for the projects in `JIRA_PROJECT_KEYS` are listed first, and your last board is remembered. On a scrum board, the new issue goes to the backlog.

**Claude projects**: with `CLAUDE_PROJECT_DIRS` set, a section lists recent Claude Code sessions grouped by project folder, with the same Resume and Copy command buttons. Projects where Claude is running come first.

**Related notes**: with `NOTES_DIR` set, Jira cards list the markdown notes whose frontmatter names the issue (`tickets: [KEY-1]`), and "Assign to Claude" tells Claude to read them first.

**"Open in Code" prerequisite** — the server uses `open -a "Visual Studio Code"` on macOS. VS Code must be installed in `/Applications`; the `code` CLI itself is not required. On Linux and WSL it runs `code`.
