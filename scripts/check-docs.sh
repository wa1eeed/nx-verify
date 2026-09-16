#!/usr/bin/env bash
# Documentation that points at a file which is not there is documentation nobody trusts a second
# time. This walks every markdown link in the repository and fails on one that leads nowhere.
#
#   bash scripts/check-docs.sh
set -uo pipefail

cd "$(dirname "$0")/.."

status=0
checked=0
broken=0

# Everything tracked, minus the vendored design handoff and anything installed.
while IFS= read -r file; do
  directory=$(dirname "$file")
  # Markdown links, and only the local ones: an address is somebody else's to keep alive.
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    case "$target" in
      http://*|https://*|mailto:*|'#'*) continue ;;
    esac
    # Drop an anchor and a query; what matters is whether the file exists.
    path="${target%%#*}"
    path="${path%%\?*}"
    [ -z "$path" ] && continue
    checked=$((checked + 1))
    if [ ! -e "$directory/$path" ] && [ ! -e "$path" ]; then
      printf 'broken: %s -> %s\n' "$file" "$target"
      broken=$((broken + 1))
      status=1
    fi
  done < <(grep -o '](\([^)]*\))' "$file" 2>/dev/null | sed 's/^](//; s/)$//' | sed 's/ .*//')
done < <(git ls-files '*.md' | grep -v '^design_handoff_verification_platform/')

if [ "$status" -eq 0 ]; then
  printf 'docs ok: %d local links, none broken\n' "$checked"
else
  printf 'docs: %d of %d local links lead nowhere\n' "$broken" "$checked"
fi
exit "$status"
