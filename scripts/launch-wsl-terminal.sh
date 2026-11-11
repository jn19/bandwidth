#!/usr/bin/env bash
# Terminal launcher for bandwidth on WSL: opens a new Windows Terminal tab in this
# distro and runs Claude Code there. Point BANDWIDTH_LAUNCHER at this file.
#
#   launch-wsl-terminal.sh <cwd> <title> [--prompt-file <file>] [--prefill <text>] -- <claude args...>
#
# --prefill types <text> into Claude's input box once it's ready, without pressing Enter (tmux only).
#
# Options (environment):
#   BANDWIDTH_TMUX=1            run Claude inside a new tmux session (detached tab = session ends)
#   BANDWIDTH_TMUX_PREFIX=...   tmux session name prefix (default "claude-"); the folder name is appended
#   BANDWIDTH_CLAUDE_CMD=...    command to run instead of `claude` (default: claude)
#   BANDWIDTH_PROMPT_MARKER=... text that shows Claude's input box is drawn (default: ❯), for --prefill
#
# Only a short file path crosses the Windows command line. The real command is
# written, shell-quoted, to private run files that delete themselves when they start.
set -euo pipefail

cwd=${1:?cwd}; title=${2:?title}; shift 2
prompt_file= prefill=
if [ "${1:-}" = --prompt-file ]; then prompt_file=$2; shift 2; fi
if [ "${1:-}" = --prefill ]; then prefill=$2; shift 2; fi
[ "${1:-}" = -- ] && shift

[ -d "$cwd" ] || { echo "no such directory: $cwd" >&2; exit 1; }
[ -n "${WSL_DISTRO_NAME:-}" ] || { echo "not running under WSL" >&2; exit 1; }
command -v wt.exe >/dev/null || { echo "wt.exe (Windows Terminal) not found" >&2; exit 1; }

dir="${XDG_RUNTIME_DIR:-/tmp}/bandwidth-$(id -u)"
mkdir -p -m 700 "$dir"
run=$(mktemp "$dir/run.XXXXXX")

# The run file is sourced by an interactive bash, so a `claude` shell function
# from ~/.bashrc applies, as it would when typed.
{
  echo 'rm -f "${BASH_SOURCE[0]}"'
  printf 'cd %q || exit 1\n' "$cwd"
  if [ -n "$prefill" ]; then
    # In the background: wait up to 30 s for the input box, then type without Enter
    printf '[ -n "$TMUX_PANE" ] && ( for _ in $(seq 60); do sleep 0.5; tmux capture-pane -p -t "$TMUX_PANE" | grep -qF %q && { sleep 0.7; tmux send-keys -t "$TMUX_PANE" -l -- %q; break; }; done ) >/dev/null 2>&1 &\n' \
      "${BANDWIDTH_PROMPT_MARKER:-❯}" "$prefill"
  fi
  printf '%s' "${BANDWIDTH_CLAUDE_CMD:-claude}"
  for a in "$@"; do printf ' %q' "$a"; done
  [ -n "$prompt_file" ] && printf ' "$(cat %q)"' "$prompt_file"
  echo
} > "$run"

start=$run
if [ "${BANDWIDTH_TMUX:-0}" = 1 ]; then
  base="${BANDWIDTH_TMUX_PREFIX:-claude-}$(printf '%s' "${cwd##*/}" | tr -c 'A-Za-z0-9_-' '_')"
  s=$base n=1
  while tmux has-session -t "=$s" 2>/dev/null; do n=$((n+1)); s="$base-$n"; done
  start=$(mktemp "$dir/start.XXXXXX")
  {
    echo 'rm -f "${BASH_SOURCE[0]}"'
    printf 'exec tmux new-session -s %q -c %q %q \\; set-option destroy-unattached on\n' \
      "$s" "$cwd" "bash -ic 'source $run'"
  } > "$start"
fi

# wt.exe splits its command line on ';', so keep it out of the title
safe_title=$(printf '%s' "$title" | tr -d ';"' | cut -c1-80)
# Only the start file's path crosses the Windows command line (no ';' in it)
wt.exe -w 0 new-tab --title "$safe_title" wsl.exe -d "$WSL_DISTRO_NAME" --cd "$cwd" -- bash -ic "source $start" >/dev/null 2>&1 &
disown
