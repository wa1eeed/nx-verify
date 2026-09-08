#!/usr/bin/env bash
# Style rules from CLAUDE.md that a linter does not express.
set -uo pipefail

status=0
# Documents count as text. The rule says no em dash in any text, and the documents are
# read at the start of every session, so they are exactly the text it matters in.
paths=(apps packages test scripts .github docs)
root_docs=(README.md CLAUDE.md)

# No em dash in source. Use a comma, a colon, or a full stop.
# Built from bytes so that this file does not trip its own check.
em_dash=$'\xe2\x80\x94'
if grep -RIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
     --include='*.ts' --include='*.tsx' --include='*.js' --include='*.sql' \
     --include='*.json' --include='*.yml' --include='*.yaml' --include='*.sh' \
     --include='*.md' \
     "$em_dash" "${paths[@]}" "${root_docs[@]}" 2>/dev/null; then
  echo "style: em dash found in source. Use a comma, a colon, or a full stop."
  status=1
fi

# Rule 4 and rule 10: an unexplained escape hatch around the any rule is not acceptable.
if grep -RIn --exclude-dir=node_modules --include='*.ts' --include='*.tsx' \
     'eslint-disable.*no-explicit-any' "${paths[@]}" 2>/dev/null | grep -v -- '--'; then
  echo "style: disabling no-explicit-any requires a written justification after --."
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "style ok"
fi
exit "$status"
