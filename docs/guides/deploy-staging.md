# Guide: build staging as a copy of production

Staging exists to answer one question: **would this change have broken production?** It can only
answer it if it is the same shape.

Build it after production, from the same description, and change only what must differ.

---

## What must be identical

| Thing                     | Why                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| The image                 | The same tag, not a rebuild. A rebuild tests a different artefact                |
| The migrations            | The same ledger, applied the same way                                          |
| `NODE_ENV=production`     | Development shortcuts change the platform's behaviour: the console's session fallback, the environment key path, the panel's token header, HSTS and cookie flags |
| The key service           | Production refuses an environment key, so staging must too, or staging does not test that path |
| The four database roles   | Isolation proved anywhere else is not proved                                    |
| TLS in front              | Secure cookies and HSTS behave differently without it                           |

## What must differ

| Thing                          | To what                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| The database                   | Its own instance and its own volume. Never a shared one                 |
| Every secret                   | Its own. A shared secret means rotating staging breaks production       |
| The key service keys           | Its own key versions. A shared master key means staging can read production's identifiers |
| `NX_PROVIDERS`, and the connections | The sandbox side of each source                                    |
| `NX_CONSOLE_BASE_URL`, `NX_PUBLIC_BASE_URL`, `NX_API_URL` | Its own domains                              |
| `NX_MAIL_ENDPOINT`             | A sink that does not reach a real person, or nothing at all             |
| The bank details on the billing screen | Empty. The screen says so rather than printing an address that takes money |

---

## Build it

```bash
cp .env.example .env
chmod 600 .env
# generate every secret with: openssl rand -base64 32
bash scripts/check-secrets-hygiene.sh

docker compose up -d db
docker compose run --rm migrate
docker compose up -d api console worker
docker compose run --rm --no-deps api pnpm provision products:seed
```

Then connect the **sandbox** side of each source
([connect a data source](connect-a-data-source.md)), make the first panel owner, and create a
subscriber with a sandbox workspace and a `nx_test_` key.

---

## Data

**Never copy production data into staging.** It carries identity numbers and IBANs, and a
restored copy has none of production's access control around it.

Use the stub provider instead: it answers exactly like a real source from published test data,
so every edge case can be summoned on demand rather than waited for.

```bash
bash scripts/demo.sh
```

If a production defect can only be reproduced with real data, reproduce it in production with a
read-only query and a request id, not by moving the data.

---

## What staging is for

| Question                                      | Answer it here                                                     |
| --------------------------------------------- | ------------------------------------------------------------------- |
| Does the migration apply to a real schema?    | Run it, then `pnpm run migrate:verify`                              |
| Does the production build work?               | A real build behaves differently from a development server           |
| Does the content policy break a screen?       | Walk every screen. Development allows things production does not     |
| Does the deployment start clean?              | Stop everything, start it, and read the first lines of each log      |
| Does a restore work?                          | Rehearse it here. A backup nobody has restored is a hope             |

That third row is not hypothetical: a page prerendered at build time carried scripts with no
nonce and arrived with no code at all, and only a real production build showed it.

---

## Promoting

Promote **the same image tag**. Do not rebuild for production: a rebuild is a different artefact,
and the one thing staging proved was about the artefact.

Run the migrations first, then move the tag, then read the logs.
