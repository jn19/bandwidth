// Lower is more urgent. Covers Jira's default scheme plus the common legacy names.
const PRIORITY_RANKS = {
  blocker: 0, highest: 0, critical: 0,
  high: 1, major: 1,
  medium: 2,
  low: 3, minor: 3,
  lowest: 4, trivial: 4
};
const DEFAULT_RANK = PRIORITY_RANKS.medium;

export function priorityRank(item) {
  return PRIORITY_RANKS[item.priority?.toLowerCase()] ?? DEFAULT_RANK;
}

// How long the item has been waiting on you. Uses creation time; GitHub doesn't
// expose when the review was requested without a per-PR timeline call.
export function waitingSince(item) {
  const t = Date.parse(item.createdAt);
  return Number.isNaN(t) ? null : t;
}
