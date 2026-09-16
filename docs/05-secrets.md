# Secrets: where each one lives, and how to rotate it

Every secret this platform uses, what it protects, where it is kept, how to make a new one, and
what to do the moment one leaks. Written in English because the people who run a deployment are
not always the people who built it.

Two rules decide everything below. **No credential is stored in the database** (rule 10): a
column holds a reference to a key service or a sealed blob, never the key that opens it. **No
identifier is stored in plain text** (rule 4): an identity number is an HMAC for lookup and
ciphertext for display, and the key for both is derived from the master key.

---

## The list

| Secret | Protects | Where it lives | Rotate |
|---|---|---|---|
| `NX_MASTER_KEY` / `NX_MASTER_KEYS`, or a key service behind `NX_KMS_ENDPOINT` | Every identity number, every IBAN, every panel authenticator secret | A key service in production. The environment is refused there and allowed only on a developer's machine | Every 90 days, by adding a version |
| `NX_OPERATOR_TOKEN` | Makes the first owner of the panel, and seals every panel session | `.env`, mode 600, on the machine that runs the console | On staff departure, on suspicion, otherwise yearly |
| Database role passwords (`NX_POSTGRES_PASSWORD`, `NX_MIGRATOR_PASSWORD`, `NX_APP_PASSWORD`, `NX_RETENTION_PASSWORD`, `NX_OPERATOR_PASSWORD`) | The four roles of rule 12 | `.env`, mode 600 | On suspicion, otherwise yearly |
| Data source credentials, per environment | Calls to the official registries | Written from the panel into the sealed store at `NX_SECRETS_FILE`, never into a column | When the source says so, or on suspicion |
| The data source's webhook secret | Proves an inbound callback is theirs | The same sealed store | On suspicion. It has been exposed once; see below |
| A subscriber's API key | That subscriber's calls to our API | Nowhere. Only a hash and a prefix are kept, and the key itself is shown once | The subscriber issues a new one and revokes the old |
| A member of staff's password and recovery codes | One person's way into the panel | `operator_accounts`, scrypt sealed, one salt each | The person changes it; an owner can set a new one |
| A member of staff's authenticator secret | The second factor of the panel | `operator_accounts`, AES-256-GCM under a key derived from the master key | An owner resets it and the person enrols again |

Nothing in this list is ever written to a log, an error message, an address bar, or a backup of
the database in plain text. Three values the console shows once (an API key, a new account's
temporary password, a share link) come back as the result of the action that made them, never in
a URL (SEC-10).

---

## Making a new secret

Use the machine's own source of randomness. Nothing here should ever be a word, a date, or a
value reused from somewhere else.

```bash
openssl rand -base64 32    # a master key, the operator token: 32 bytes
openssl rand -base64 24    # a database role password
```

A deployment refuses an operator token shorter than 43 characters, which is 32 bytes written in
base64. That is checked at runtime, not only in a document.

---

## Where they are kept

**`.env`, mode 600.** The file holds connection strings and the operator token. It is read by
the compose file and by nothing else, it is never committed, and `.gitignore` refuses it. Check a
machine with:

```bash
bash scripts/check-secrets-hygiene.sh
```

It reads names and lengths, prints no value, and sends nothing anywhere. Run it after writing the
file and after every rotation.

**The sealed store, `NX_SECRETS_FILE`.** Data source credentials are written from the
administration panel into a sealed file on a volume the three processes share
(`/var/lib/nx-secrets/connections.sealed`). The database holds a `credential_ref` pointing at it
and never the credential. Back that volume up separately from the database, and never together
with the master key: either one alone is useless, which is the point.

**A key service in production.** `masterKeySourceFromEnv()` refuses an environment key when
`NODE_ENV=production` and demands `NX_KMS_ENDPOINT`. A deployment that has not connected one
cannot seal an identifier or enrol an authenticator, which is the failure everybody wants: loud,
at the start, rather than a platform that silently keeps keys beside the data they open.

---

## Rotating the master key

The master key is the only one with several versions readable at once, because rotating it
naively would unmatch every identifier: the HMAC is a lookup index, so a new key means a new
index.

1. Add a version rather than replacing one: `NX_MASTER_KEYS=1:<old>,2:<new>`. The highest is what
   new values are written with; every listed version can still be read.
2. Run the rotation job, which walks the rows and rewrites them under the new version.
3. When no row names the old version, drop it from the list.

Ninety days is the interval the blueprint promises. The job exists so that the promise can be
kept without a maintenance window.

---

## Rotating the operator token

Every panel session is sealed with it, so rotating it signs everybody out at once. That is the
feature: it is the fastest way to close the panel to everyone.

1. `openssl rand -base64 32`
2. Put it in `.env` and restart the console.
3. Staff sign in again with their passwords and their authenticators. Nobody needs a new account.

The token does not open a single screen by itself in production: it makes the first owner when
the panel has no account, and after that it only seals sessions.

---

## Rotating a database role password

1. `openssl rand -base64 24`
2. `ALTER ROLE nx_app WITH PASSWORD '<new>';`
3. Update `.env` and restart the processes that use that role.

The migrator and the application are different roles for a reason (rule 12): the application owns
nothing and never bypasses row level security, so its password opens far less than the owner's.

---

## When a secret leaks

**Rotate it first.** A credential that has reached a chat message, a screenshot, a ticket, a
commit or a log is public, and deleting the message does not take it back. Removing it from a
later commit does not take it back either: the blob stays in the history of every clone.

Then, and only then, work out how it got there.

1. Make a new value with the commands above.
2. Put the new value in place: `.env` and a restart, or the panel's technical connection screen
   for a data source credential.
3. Confirm the old one no longer works.
4. Write down what leaked, when, and what was done, and keep it. A regulator asking about a
   disclosure is asking for exactly this.

The scanner `scripts/scan-secrets.sh` runs in CI over the working tree and over the whole
history, so a credential in a pull request stops the merge (SEC-05). It is not a substitute for
the rule: nothing that opens anything goes into a file that git can see.

---

## Known outstanding

- **The data source webhook secret was exposed in a conversation** and has not been rotated yet.
  Rotate it from the source's own dashboard and enter the new value in the panel, for both the
  test and the production environments. Until then, treat inbound callback signatures as
  unproven.
- **The production key service is not connected.** Until it is, production cannot start.
