#!/usr/bin/env bash
# Generates the environment block for a Coolify deployment.
#
#   ./scripts/coolify-env.sh app.example.sa api.example.sa you@example.sa
#
# Run it on your own machine and paste the output into Coolify's «Environment Variables»
# using «Developer view». Every secret is made here, by openssl, and appears nowhere else:
# not in this repository, not in a chat, not in a ticket. That is the point of a generator
# rather than a list of values somebody copies from a document.
#
# The two SERVICE_FQDN lines at the end are the domains, and they are variables rather than
# something typed into Coolify's domain field on purpose: the compose file declares those
# names, so Coolify treats itself as their owner and regenerates the field's value every time
# it re-reads the file. A variable is not regenerated, so the domain stays what you set.
set -euo pipefail

CONSOLE_DOMAIN="${1:?usage: coolify-env.sh <console-domain> <api-domain> <owner-email>}"
API_DOMAIN="${2:?usage: coolify-env.sh <console-domain> <api-domain> <owner-email>}"
OWNER_EMAIL="${3:?usage: coolify-env.sh <console-domain> <api-domain> <owner-email>}"

# base64 can contain / + =, which are fine in a password but not in a URL. A URL safe
# alphabet keeps the connection strings below readable and avoids an escaping mistake that
# shows up as «password authentication failed» an hour later.
secret() { openssl rand -base64 33 | tr -d '\n' | tr '+/' '-_'; }

POSTGRES_PASSWORD="$(secret)"
MIGRATOR_PASSWORD="$(secret)"
APP_PASSWORD="$(secret)"
RETENTION_PASSWORD="$(secret)"
OPERATOR_ROLE_PASSWORD="$(secret)"
OPERATOR_TOKEN="$(secret)"
PANEL_OWNER_PASSWORD="$(secret)"

cat <<VARS
NX_POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
NX_MIGRATOR_PASSWORD=${MIGRATOR_PASSWORD}
NX_APP_PASSWORD=${APP_PASSWORD}
NX_RETENTION_PASSWORD=${RETENTION_PASSWORD}
NX_OPERATOR_PASSWORD=${OPERATOR_ROLE_PASSWORD}

NX_ADMIN_DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@db:5432/nx_verify
NX_APP_DATABASE_URL=postgres://nx_app:${APP_PASSWORD}@db:5432/nx_verify
NX_RETENTION_DATABASE_URL=postgres://nx_retention:${RETENTION_PASSWORD}@db:5432/nx_verify
NX_OPERATOR_DATABASE_URL=postgres://nx_operator:${OPERATOR_ROLE_PASSWORD}@db:5432/nx_verify

NX_OPERATOR_TOKEN=${OPERATOR_TOKEN}
NX_PANEL_OWNER_EMAIL=${OWNER_EMAIL}
NX_PANEL_OWNER_PASSWORD=${PANEL_OWNER_PASSWORD}
NX_PANEL_OWNER_NAME=مالك المنصة

NX_PROVIDERS=stub
NX_PUBLIC_BASE_URL=https://${API_DOMAIN}
NX_CONSOLE_URL=https://${CONSOLE_DOMAIN}
NX_CONSOLE_BASE_URL=https://${CONSOLE_DOMAIN}
NX_SUPPORT_EMAIL=${OWNER_EMAIL}

SERVICE_FQDN_CONSOLE_3000=https://${CONSOLE_DOMAIN}
SERVICE_FQDN_API_3000=https://${API_DOMAIN}
VARS

cat >&2 <<NOTE

──────────────────────────────────────────────────────────────────────────────
Your sign in to the panel, which is the only one of these you have to remember:

  https://${CONSOLE_DOMAIN}/operator/login
  ${OWNER_EMAIL}
  ${PANEL_OWNER_PASSWORD}

Put it in a password manager now. It is also in the variables above, so you can
always read it back from Coolify, and changing it there and redeploying changes
the password.
──────────────────────────────────────────────────────────────────────────────
NOTE
