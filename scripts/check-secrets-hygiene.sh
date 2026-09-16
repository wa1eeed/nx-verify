#!/usr/bin/env bash
# What a deployment must get right about its own secrets before it serves anybody (SEC-06).
#
# Run it on the machine that holds the .env, after writing it and after every rotation:
#
#   bash scripts/check-secrets-hygiene.sh
#
# It reads names and lengths. It never prints a value, and it never sends one anywhere.
set -uo pipefail

cd "$(dirname "$0")/.."
env_file="${1:-.env}"
status=0

say() { printf '%s\n' "$1"; }
fail() {
  printf 'no: %s\n' "$1"
  status=1
}

if [ ! -f "$env_file" ]; then
  fail "$env_file does not exist. Copy .env.example and fill it in."
  exit 1
fi

# Readable by its owner and by nobody else. A file of connection strings and keys that every
# account on the machine can read is the same as one in a repository, only quieter.
mode=$(stat -f '%Lp' "$env_file" 2>/dev/null || stat -c '%a' "$env_file" 2>/dev/null)
if [ "$mode" = "600" ] || [ "$mode" = "400" ]; then
  say "ok: $env_file is $mode, readable by its owner alone"
else
  fail "$env_file is $mode. Run: chmod 600 $env_file"
fi

# The deployment's token makes the first owner and seals every panel session. In production
# it is 32 random bytes, which is 43 characters of base64.
token=$(grep -E '^NX_OPERATOR_TOKEN=' "$env_file" | head -1 | cut -d= -f2-)
if [ -z "$token" ]; then
  fail "NX_OPERATOR_TOKEN is not set. Generate one: openssl rand -base64 32"
elif [ "${#token}" -lt 43 ]; then
  fail "NX_OPERATOR_TOKEN is ${#token} characters. A deployment needs 43 or more: openssl rand -base64 32"
else
  say "ok: NX_OPERATOR_TOKEN is ${#token} characters"
fi

# The master key seals every identifier and every panel authenticator. Either it comes from a
# key service, or it is 32 bytes in the environment, and a deployment refuses the second.
if grep -qE '^NX_KMS_ENDPOINT=.+' "$env_file"; then
  say "ok: the master key comes from a key service"
else
  key=$(grep -E '^NX_MASTER_KEYS?=' "$env_file" | head -1 | cut -d= -f2-)
  if [ -z "$key" ]; then
    fail "no master key: set NX_KMS_ENDPOINT, or NX_MASTER_KEY for a machine that is not production"
  elif [ "${#key}" -lt 44 ]; then
    fail "NX_MASTER_KEY is ${#key} characters. It must decode to 32 bytes: openssl rand -base64 32"
  else
    say "ok: NX_MASTER_KEY is ${#key} characters, and production will still want a key service"
  fi
fi

# Every password the compose file demands, present and not left at a word.
for name in NX_POSTGRES_PASSWORD NX_MIGRATOR_PASSWORD NX_APP_PASSWORD NX_RETENTION_PASSWORD NX_OPERATOR_PASSWORD; do
  value=$(grep -E "^${name}=" "$env_file" | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    fail "$name is empty"
  elif [ "${#value}" -lt 16 ]; then
    fail "$name is ${#value} characters. Give it 16 or more: openssl rand -base64 24"
  fi
done

# A secret that reaches the repository is public, whatever happens next.
if git ls-files --error-unmatch "$env_file" >/dev/null 2>&1; then
  fail "$env_file is tracked by git. Remove it from the index and rotate everything in it."
fi

if [ "$status" -eq 0 ]; then
  say "secrets hygiene ok"
fi
exit "$status"
