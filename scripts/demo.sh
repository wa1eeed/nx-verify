#!/usr/bin/env bash
#
# The whole platform, running, with something in it to look at.
#
# The smoke test proves the deployment works. This one exists so a person can see it: it
# brings up every process, provisions a workspace, runs a handful of verifications so the
# screens have real data rather than empty tables, and prints where to go and how to sign
# in.
#
# The data is real in the only sense that matters here: it came through the domain layer,
# the normalisation, the pricing and the sealing, from the stub provider. Nothing is
# inserted into a table to make a screen look full.
#
# Signing in is a real sign in. The development session fallback in lib/session.ts cannot
# rescue anyone here: Next replaces NODE_ENV at build time, so a built console always takes
# the production branch whatever the container's environment says. That is stronger than
# the code intended and it is left that way on purpose.
#
#   bash scripts/demo.sh

set -euo pipefail

API="${NX_DEMO_API:-http://localhost:3000}"
CONSOLE="${NX_DEMO_CONSOLE:-http://localhost:3001}"
COMPOSE="docker compose"

step() { printf '\n=== %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

[ -f .env ] || fail "no .env. Copy .env.example, fill it in, and run again."

step "bringing up every process"
$COMPOSE up -d --build db migrate api console worker

step "waiting for the API"
for attempt in $(seq 1 60); do
  curl -fsS "$API/ready" >/dev/null 2>&1 && break
  [ "$attempt" = "60" ] && fail "the API never became ready"
  sleep 2
done

step "provisioning a workspace"
SLUG="demo"
EMAIL="admin@demo.sa"
$COMPOSE run --rm --no-deps api pnpm provision products:seed --provider stub >/dev/null

CREATED=$($COMPOSE run --rm --no-deps api pnpm provision tenant:create \
  --name "شركة العميل التجريبية" --slug "$SLUG" --admin-email "$EMAIL" --admin-name "مسؤول المساحة")
TENANT=$(echo "$CREATED" | grep '^tenant:' | awk '{print $2}' | tr -d '\r')
PASSWORD=$(echo "$CREATED" | grep '^temporary password:' | awk '{print $3}' | tr -d '\r')
[ -n "$TENANT" ] || fail "no tenant was created"

for product in KYB_COMPLETE:44.00 ADDRESS_ONLY:8.00 IBAN_OWNERSHIP:12.00; do
  $COMPOSE run --rm --no-deps api pnpm provision price:set \
    --tenant "$TENANT" --product "${product%%:*}" --amount "${product##*:}" >/dev/null
done
$COMPOSE run --rm --no-deps api pnpm provision wallet:topup \
  --tenant "$TENANT" --amount 5000 --invoice INV-DEMO-1 >/dev/null
$COMPOSE run --rm --no-deps api pnpm provision provider:bind \
  --tenant "$TENANT" --provider stub --ref "kms://demo/stub" >/dev/null
KEY=$($COMPOSE run --rm --no-deps api pnpm provision key:issue \
  --tenant "$TENANT" --name demo | grep '^api key:' | awk '{print $3}' | tr -d '\r')

step "running verifications, so the screens have something real on them"
# The product decides what a subject looks like, and the schema is in the database
# (rule 8), so the caller sends what that product asks for and nothing else.
run_one() {
  local product="$1" name="$2" subject="$3"
  local response
  response=$(curl -sS -o /tmp/nx-demo-response -w '%{http_code}' -X POST "$API/v1/verifications" \
    -H "authorization: Bearer $KEY" \
    -H 'content-type: application/json' \
    -H "idempotency-key: demo-$(echo "$subject" | cksum | cut -d' ' -f1)" \
    -d "{\"product\":\"$product\",\"subject\":$subject,\"display_name\":\"$name\",\"reference\":\"DEMO\"}")
  case "$response" in
    2*) : ;;
    *) fail "$product answered $response: $(cat /tmp/nx-demo-response)" ;;
  esac
}

run_one KYB_COMPLETE "مؤسسة نماء للمقاولات" \
  '{"unn":"7001272184","manager":{"id":"1098765432","id_type":"NATIONAL_ID"}}'
run_one KYB_COMPLETE "شركة الأفق للتجارة" \
  '{"unn":"7001272185","manager":{"id":"1098765433","id_type":"NATIONAL_ID"}}'
run_one ADDRESS_ONLY "مصنع الرياض للبلاستيك" '{"unn":"7001272186"}'
run_one IBAN_OWNERSHIP "مؤسسة البيان" \
  '{"iban":"SA4420000001234567891234","identifier":{"type":"CR","value":"1010101010"}}'

cat <<SUMMARY

=== ready

الكونسول:      $CONSOLE/login
مساحة العمل:   $SLUG
البريد:        $EMAIL
كلمة المرور:   $PASSWORD   (مؤقتة، وستُطلب منك واحدة جديدة عند أول دخول)

الـAPI:        $API
مفتاح الـAPI:  $KEY

للإيقاف:       docker compose down -v
SUMMARY
