#!/usr/bin/env bash
# A credential that reaches a commit is public, and rewriting history does not take it back:
# it must be rotated. So the only useful moment to catch one is before the merge (SEC-05).
#
# Scans the working tree, including files not yet added, and unless --worktree is passed
# every blob the repository has ever held: a secret deleted in a later commit is still in the
# history and still readable by anybody who clones.
#
# Written here rather than pulled from an action: a scanner runs over every line of this
# repository, including the ones that are not meant to leave it, and that is a dependency
# worth not having (the reasoning of SEC-01).
#
#   scripts/scan-secrets.sh            what is tracked, then the whole history
#   scripts/scan-secrets.sh --worktree what is tracked only, for a fast local check
set -uo pipefail

cd "$(dirname "$0")/.."

# Shapes that are a credential and nothing else. Each is a Perl regular expression.
patterns=(
  '-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[0-9A-Za-z]{30,}'
  'xox[baprs]-[0-9A-Za-z-]{20,}'
  'sk_(live|test)_[0-9A-Za-z]{20,}'
  'eyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}'
  # A long opaque value assigned to a name that says what it is. Two things keep a fixture
  # out: a space ends the value, so a passphrase written as words is not one of these, and
  # the value must carry a digit, which a name like «the-shared-webhook-secret» does not and
  # a key of any real entropy always does.
  '(?i)\b(api[_-]?key|client[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|webhook[_-]?secret|private[_-]?key|passwd|password)\b["'"'"']?\s*[:=]\s*["'"'"'](?=[A-Za-z0-9/+_.=-]*[0-9])[A-Za-z0-9/+_.=-]{20,}["'"'"']'
  # The deployment's own variables, with a value rather than a reference.
  '(?i)\bNX_(MASTER_KEY|MASTER_KEYS|OPERATOR_TOKEN|[A-Z_]*SECRET)\s*=\s*(?=[A-Za-z0-9/+_.=-]*[0-9])[A-Za-z0-9/+_.=-]{16,}'
)

# Lines that match a shape above and are not a credential. Kept short on purpose: every
# entry is a hole, and a long list is a scanner nobody trusts.
allowed=(
  # The template says what to set, never what it is set to.
  '^\.env\.example:'
  # Documentation quoting the shape of a variable, not its value.
  '^docs/'
  # This file: the shapes themselves.
  '^scripts/scan-secrets\.sh'
  # Test vectors published in the standard they come from.
  'RFC 6238'
  # A placeholder that says it is one.
  '(example|placeholder|changeme|your[_-]|xxxx|redacted|<[a-z-]+>|base64)'
)

filter_allowed() {
  local line="$1"
  for exception in "${allowed[@]}"; do
    if printf '%s' "$line" | grep -qiE "$exception"; then
      return 1
    fi
  done
  return 0
}

status=0
found=()

scan_worktree() {
  local pattern
  for pattern in "${patterns[@]}"; do
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      if filter_allowed "$line"; then
        found+=("$line")
      fi
    done < <(git grep -I -n -P --untracked -- "$pattern" -- . ':(exclude)pnpm-lock.yaml' 2>/dev/null)
  done
}

scan_history() {
  local pattern revisions
  # Every commit reachable from any ref, oldest first. A repository this size is scanned in
  # seconds; if that ever stops being true, scan the range a pull request adds instead.
  revisions=$(git rev-list --all)
  [ -z "$revisions" ] && return
  for pattern in "${patterns[@]}"; do
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # git grep over revisions prefixes each hit with the commit; keep the path for the
      # exceptions to read.
      local without_commit="${line#*:}"
      if filter_allowed "$without_commit"; then
        found+=("$line")
      fi
    done < <(git grep -I -n -P -- "$pattern" $revisions -- . ':(exclude)pnpm-lock.yaml' 2>/dev/null)
  done
}

scan_worktree
if [ "${1:-}" != "--worktree" ]; then
  scan_history
fi

if [ ${#found[@]} -gt 0 ]; then
  echo "secret scan: something shaped like a credential is in the repository."
  echo "Rotate it first. Removing it from a later commit does not take it back."
  printf '%s\n' "${found[@]}" | sort -u | head -40
  status=1
else
  echo "secret scan: nothing shaped like a credential, in the tree or in the history."
fi

exit "$status"
