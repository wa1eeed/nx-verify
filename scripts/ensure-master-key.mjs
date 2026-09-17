#!/usr/bin/env node
/* eslint-disable no-console -- this is a startup script, and its whole job is to say what it did */
/* global console, process -- node provides both, and this file runs under node */
/**
 * Makes the root key on a deployment's first start, if it has none (ADR-151).
 *
 *   NX_MASTER_KEY_FILE=/var/lib/nx-keys/master node scripts/ensure-master-key.mjs
 *
 * Run once, before the migrations, by the same one-shot container. It exists because the
 * alternative is asking a person to generate 32 random bytes, paste them into a deployment
 * tool, and hope they used a good source. A key typed into a form is a key in that form's
 * database, its backups, and its browser history.
 *
 * **It never overwrites.** A second key would not be a rotation, it would be every sealed
 * credential and every stored identifier becoming unreadable at once, and the file is the
 * only copy. Rotation is a version added to this file and a job that moves the rows.
 *
 * It does nothing at all where a key service is configured: `NX_KMS_ENDPOINT` is the better
 * answer and is tried first everywhere in the platform.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const say = (level, message) => {
  console.log(JSON.stringify({ level, message }));
};

const path = process.env['NX_MASTER_KEY_FILE'];

if (process.env['NX_KMS_ENDPOINT']) {
  say('info', 'a key service is configured; no key file is needed');
  process.exit(0);
}

if (!path) {
  say('info', 'NX_MASTER_KEY_FILE is not set; nothing to make');
  process.exit(0);
}

if (existsSync(path)) {
  // Said every start, quietly, because the one thing an operator must know about this file
  // is that it exists and that nothing else can replace it.
  say('info', 'the root key file is in place');
  process.exit(0);
}

mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
// 32 bytes, from the same source the platform's own tokens come from. Written 0600 before
// anything is in it, so the key is never briefly world readable.
writeFileSync(path, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });

say('warn', 'a new root key was made on this deployment');
say(
  'warn',
  'back up the volume holding it, separately from the database and from the sealed secrets: ' +
    'lose this file and every provider credential and every stored identifier is unreadable, ' +
    'and no backup of the other two brings them back',
);
