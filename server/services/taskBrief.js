import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { getJiraIssueDetail } from './jira.js';
import { basename } from 'path';
import { notesByTicket, orderNotes } from './notes.js';

// The opening prompt for a Claude session assigned to a work item. Jira details
// are fetched here with the server's credentials; for GitHub, Claude runs `gh`
// itself (already authenticated) so it sees the latest comments and CI state.

const WORKING_AGREEMENT = `## How to work
1. Read the task and explore the relevant code before changing anything.
2. If the requirements are ambiguous, or a decision has real tradeoffs, stop and ask me. Don't guess on product decisions.
3. Make the change following the repo's existing conventions, and run its tests, linters or build if it has them.
4. Commit your work to this branch when it's in a good state.
5. Don't push, open or update a PR, post GitHub comments, or change the Jira issue without asking me first.
6. Finish with a short summary: what you changed, how you verified it, and anything still open.`;

// Notes (NOTES_DIR) whose frontmatter lists this issue, so Claude can read them first
function relatedNotes(notes) {
  if (!notes?.length) return '';
  return `\n\n### Related notes\n\nRead these before starting; they hold earlier findings on this issue.\n\n${
    notes.map(n => `- \`${n.path}\`${n.summary ? `: ${n.summary}` : ''}`).join('\n')}`;
}

// Where the session runs: a git worktree for this item, or the project folder
function whereText(location) {
  if (location.kind === 'project') {
    return `You're in my project folder for this work, \`${location.path}\`. It isn't a git worktree for this issue${
      location.isRepo ? ' (the folder is a git repo, on whatever branch it has checked out)' : ''}.`;
  }
  return `You're in a git worktree for this issue at \`${location.path}\`, on branch \`${location.branch}\`.`;
}

function agreement(location, key) {
  if (location.kind === 'project') {
    return WORKING_AGREEMENT.replace(
      "4. Commit your work to this branch when it's in a good state.",
      "4. Don't commit, push or open PRs unless I ask.");
  }
  return key
    ? WORKING_AGREEMENT.replace("when it's in a good state.", `when it's in a good state, with a message that references ${key}.`)
    : WORKING_AGREEMENT;
}

function jiraBrief(issue, worktree, notes) {
  const meta = [
    issue.type && `Type: ${issue.type}`,
    issue.status && `Status: ${issue.status}`,
    issue.priority && `Priority: ${issue.priority}`,
    issue.labels.length > 0 && `Labels: ${issue.labels.join(', ')}`,
    issue.parent && `Parent: ${issue.parent}`
  ].filter(Boolean).join('\n');

  const comments = issue.comments.length > 0
    ? `\n\n### Recent comments\n\n${issue.comments.map(c =>
        `**${c.author}** (${c.created.slice(0, 10)}):\n${c.body}`).join('\n\n')}`
    : '';

  return `You've been assigned Jira issue ${issue.key}: ${issue.summary}
${issue.url}

${whereText(worktree)}

## Issue

${meta}

### Description

${issue.description || '_No description provided._'}${comments}${relatedNotes(notes)}

${agreement(worktree, issue.key)}`;
}

function githubIssueBrief(item, worktree) {
  return `You've been assigned GitHub issue ${item.repo}#${item.number}: ${item.title}
${item.url}

You're in a git worktree at \`${worktree.path}\`, on branch \`${worktree.branch}\`.

Start by reading the full issue and its discussion:
\`gh issue view ${item.number} --repo ${item.repo} --comments\`

${WORKING_AGREEMENT}`;
}

function authoredPrBrief(item, worktree) {
  return `Pick up my pull request ${item.repo}#${item.number}: ${item.title}
${item.url}

You're in a git worktree checked out on the PR branch \`${worktree.branch}\` at \`${worktree.path}\`.

Find out what's blocking it and fix it:
- Review feedback: \`gh pr view ${item.number} --repo ${item.repo} --comments\`, plus inline comments via \`gh api repos/${item.repo}/pulls/${item.number}/comments\`
- CI: \`gh pr checks ${item.number} --repo ${item.repo}\`
- Merge conflicts with the base branch: ask me before rebasing or merging.

Work through the feedback one item at a time. If you disagree with a comment, tell me why rather than silently skipping it.

${WORKING_AGREEMENT}`;
}

function reviewPrBrief(item, worktree) {
  return `I've been asked to review pull request ${item.repo}#${item.number}: ${item.title}
${item.url}

You're in a git worktree checked out on the PR branch \`${worktree.branch}\` at \`${worktree.path}\`.

Help me review it:
1. Read the description and discussion: \`gh pr view ${item.number} --repo ${item.repo} --comments\`
2. Read the diff: \`gh pr diff ${item.number} --repo ${item.repo}\`, and the surrounding code it touches.
3. Run the tests or build if that's practical.
4. Give me your findings, most important first: correctness bugs, risky changes, missing tests, then smaller suggestions. Point to file and line.

Don't modify code, and don't post a review or comments on GitHub. I'll decide what to send.`;
}

function buildBrief(item, worktree, notes) {
  switch (item.source) {
    case 'jira':
      return getJiraIssueDetail(item.key).then(issue => jiraBrief(issue, worktree, notes));
    case 'github-issue':
      return githubIssueBrief(item, worktree);
    case 'github-pr':
      return item.role === 'reviewer' ? reviewPrBrief(item, worktree) : authoredPrBrief(item, worktree);
    default:
      throw new Error(`Can't assign a ${item.source} item to Claude`);
  }
}

// BRIEF_APPENDIX_FILE: optional markdown added to the end of every brief, for
// your own conventions (which commands to use, where findings go, ...)
async function appendix() {
  const file = process.env.BRIEF_APPENDIX_FILE;
  if (!file) return '';
  const text = (await readFile(file.replace(/^~/, homedir()), 'utf8')).trim();
  return text ? `\n\n${text}\n` : '';
}

export async function buildTaskBrief(item, worktree) {
  // Notes from the folder Claude starts in come first; at most 8 are listed
  const all = item.source === 'jira' ? (await notesByTicket().catch(() => ({})))[item.key] : null;
  const notes = all && orderNotes(all, basename(worktree.path)).slice(0, 8);
  return (await buildBrief(item, worktree, notes)) + await appendix();
}

export function sessionName(item) {
  const label = item.source === 'jira' ? item.title : `${item.repo}#${item.number} ${item.title}`;
  // Single line, no control characters, short enough for a terminal title
  return label.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
}
