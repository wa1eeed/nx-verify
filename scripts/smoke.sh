#!/usr/bin/env bash
#
# The deployment, proved rather than claimed.
#
# Brings the stack up with docker compose, provisions a workspace the way a first customer
# would be provisioned, runs a verification over HTTP, and checks the two things that must
# be true of every response that leaves this platform: no provider name (rule 5) and no
# identifier of the subject (rule 4).
#
# It is not a substitute for the test suite. It proves the parts a test suite cannot: the
# image, the compose file, the migration on a real volume, the environment template, and
# the provisioning path a human actually walks on day one.
#
#   bash scripts/smoke.sh          bring the stack up, run, and leave it running
#   bash scripts/smoke.sh --down   the same, then tear it down
#
# What it does not prove: the key service and the secret manager paths. Those refuse to
# fall back to the environment when NODE_ENV is production, which is the point of them, so
# a local run sets NODE_ENV=development in .env and the adapters are covered by their own
# tests instead. A staging run against a real key service proves the rest.

set -euo pipefail

API="${NX_SMOKE_API:-http://localhost:3000}"
COMPOSE="docker compose"
SUBJECT_ID="7001272184"

step() { printf '\n=== %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

if [ ! -f .env ]; then
  fail "no .env. Copy .env.example, fill it in, and run again."
fi

step "bringing up the database, the migration and the API"
$COMPOSE up -d --build db migrate api

step "waiting for readiness"
for attempt in $(seq 1 60); do
  if curl -fsS "$API/ready" >/dev/null 2>&1; then break; fi
  if [ "$attempt" = "60" ]; then fail "the API never became ready"; fi
  sleep 2
done
curl -fsS "$API/ready" | grep -q '"status":"ready"' || fail "readiness answered, but not ready"

step "provisioning a workspace"
$COMPOSE run --rm --no-deps api pnpm provision products:seed --provider stub >/dev/null
TENANT=$($COMPOSE run --rm --no-deps api pnpm provision tenant:create \
  --name "شركة الفحص" --slug "smoke-$(date +%s)" | grep '^tenant:' | awk '{print $2}' | tr -d '\r')
[ -n "$TENANT" ] || fail "no tenant was created"

$COMPOSE run --rm --no-deps api pnpm provision price:set \
  --tenant "$TENANT" --product KYB_COMPLETE --amount 44.00 >/dev/null
$COMPOSE run --rm --no-deps api pnpm provision wallet:topup \
  --tenant "$TENANT" --amount 1000 --invoice INV-SMOKE-1 >/dev/null
$COMPOSE run --rm --no-deps api pnpm provision provider:bind \
  --tenant "$TENANT" --provider stub --ref "kms://smoke/stub" >/dev/null

KEY=$($COMPOSE run --rm --no-deps api pnpm provision key:issue \
  --tenant "$TENANT" --name smoke | grep '^api key:' | awk '{print $3}' | tr -d '\r')
[ -n "$KEY" ] || fail "no api key was issued"

step "running a verification over HTTP"
RUN=$(curl -fsS -X POST "$API/v1/verifications" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -H "idempotency-key: smoke-$TENANT" \
  -d "{\"product\":\"KYB_COMPLETE\",\"subject\":{\"unn\":\"$SUBJECT_ID\"},\"reference\":\"SMOKE-1\"}")

echo "$RUN" | grep -q '"verification_id"' || fail "the verification returned no id: $RUN"
RUN_ID=$(echo "$RUN" | sed -n 's/.*"verification_id":"\([^"]*\)".*/\1/p')
TOKEN=$(echo "$RUN" | sed -n 's#.*"evidence_url":"/v1/evidence/\([^"]*\)".*#\1#p')
[ -n "$TOKEN" ] || fail "the run sealed no evidence"

step "checking what leaves the platform"
echo "$RUN" | grep -qi 'stub' && fail "a provider name reached the response (rule 5)"
echo "$RUN" | grep -q "$SUBJECT_ID" && fail "an identifier reached the response (rule 4)"

PUBLIC=$(curl -fsS "$API/v1/evidence/$TOKEN")
echo "$PUBLIC" | grep -q '"content_hash"' || fail "the public evidence page carries no seal"
echo "$PUBLIC" | grep -q "$SUBJECT_ID" && fail "the public page carries an identifier"

DOC=$(curl -fsS "$API/v1/verifications/$RUN_ID/document" -H "authorization: Bearer $KEY")
echo "$DOC" | grep -q '<html lang="ar" dir="rtl">' || fail "the document is not the Arabic document"
echo "$DOC" | grep -q "$SUBJECT_ID" && fail "the document carries an identifier"
echo "$DOC" | grep -qi 'provider' && fail "the document names a provider"

step "replaying the same request"
AGAIN=$(curl -fsS -X POST "$API/v1/verifications" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -H "idempotency-key: smoke-$TENANT" \
  -d "{\"product\":\"KYB_COMPLETE\",\"subject\":{\"unn\":\"$SUBJECT_ID\"},\"reference\":\"SMOKE-1\"}")
echo "$AGAIN" | grep -q '"replayed":true' || fail "the same idempotency key ran a second time (rule 7)"

if [ "${1:-}" = "--down" ]; then
  step "tearing down"
  $COMPOSE down -v
fi

printf '\nPASS: the stack came up, provisioned, verified, sealed and replayed.\n'
