# Guide: back up and restore

Three things must be backed up, and two of them must never be stored together. A backup nobody
has restored is not a backup.

---

## What there is

| What                | Holds                                                    | Where it lives                              |
| ------------------- | --------------------------------------------------------- | ------------------------------------------- |
| The database        | Everything, with identifiers as hash and ciphertext       | The `db` volume                             |
| The sealed store    | Data source credentials, sealed under the master key      | The `secrets` volume, or a secret manager   |
| The master key      | Opens every identifier and every sealed secret            | A key service. **Never in either backup**   |

The separation is the point. The database without the key yields no identity number. The sealed
store without the key yields no credential. Keeping the key beside either one throws that away.

---

## Backing up

### The database

```bash
docker compose exec -T db pg_dump -U postgres -Fc nx_verify > nx-$(date +%F).dump
```

Custom format, so a restore can be selective. Encrypt it at rest and keep it off the machine that
produced it. Its retention is a decision to write down: it holds personal data, and a backup nobody
deletes is a retention policy nobody keeps.

### The sealed store

```bash
docker compose cp worker:/var/lib/nx-secrets/connections.sealed ./secrets-$(date +%F).sealed
```

Or, with a secret manager, follow its own procedure. **Store this apart from the database dump.**

### The keys

Not with a `cp`. The key service holds them, and its own backup and rotation procedure is what
protects them. What you keep here is the **list of readable versions**, so a restore knows which
versions must still be available:

```sql
SELECT version, status, activated_at, retired_at FROM key_versions ORDER BY version;
```

A restored database whose key version is no longer readable is a database of ciphertext.

---

## Restoring

1. **Stop the writers.**

```bash
docker compose stop api console worker
```

2. **Restore into an empty database**, never over a live one:

```bash
docker compose exec -T db dropdb -U postgres --if-exists nx_verify_restore
docker compose exec -T db createdb -U postgres nx_verify_restore
docker compose exec -T db pg_restore -U postgres -d nx_verify_restore --no-owner < nx-2026-09-16.dump
```

`--no-owner` matters: the roles are created by migration 0001 and own the objects afterwards.

3. **Put the sealed store back** at the path the processes expect.

4. **Confirm the key versions** in the restored database are all still readable by the key
   service. If one is not, identifiers written under it cannot be displayed, and you need that
   version restored before anything else.

5. **Point the connection strings at the restored database**, start one process, and check:

```bash
curl -s http://localhost:3000/ready | jq
```

`{"status":"ready","checks":{"database":true,"keys":true}}` is the only acceptable answer.

6. **Prove a read end to end**: open a customer file in the console and confirm an identifier
   displays. That proves the database, the key service and the sealing all line up. A row count
   proves none of it.

---

## Rehearse it

On staging, on a schedule, and write down how long it took. The number you need in an incident is
not whether a restore is possible but how long it takes, and the only way to know is to have done
it.

A restore that has never been rehearsed is a hope with a cron job attached.

---

## What is not in a backup, deliberately

- **The master key.** See above.
- **An API key, a password, a share link.** Only hashes are stored, so a restore cannot produce
  one. That is the property, not a gap: what a restore cannot yield, a stolen backup cannot
  either.
- **A provider's callback payload.** Only its digest is kept.
