import type { ReactElement } from 'react';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkReadiness } from '@nx-verify/core';
import { secretStoreFromEnv } from '@nx-verify/providers';
import { PageHeader } from '../../../../components/page-header';
import { OperatorReadiness } from '../../../../components/operator-readiness';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

/**
 * How many migrations the image carries.
 *
 * Counted here rather than through the db package's migrator, because exporting that from
 * the package index pulls a module that reads a directory at runtime into the bundle
 * graph of every page in this app, and the bundler cannot resolve a directory read.
 */
function definedMigrations(): number {
  // Resolved from the working directory rather than from import.meta.url, because the
  // bundler tries to resolve a URL built from the latter at build time and cannot resolve
  // a directory. This path is computed at request time and it leaves it alone.
  const dir = process.env['NX_MIGRATIONS_DIR'] ?? resolve(process.cwd(), '../../packages/db/migrations');
  try {
    return readdirSync(dir).filter((file) => file.endsWith('.up.sql')).length;
  } catch {
    // An image that does not ship the SQL cannot answer this, and says so by counting
    // nothing rather than by claiming everything is applied.
    return 0;
  }
}

export default async function OperatorReadinessPage(): Promise<ReactElement> {
  await requireOperator();

  const defined = definedMigrations();
  const report = await operatorQuery(async (db) => {
    const { rows } = await db.query<{ applied: string }>(
      // Counted from what the ledger in nx_meta records, through a function the operator
      // role may call: the ledger itself belongs to the role that runs migrations.
      `SELECT count(*)::text AS applied FROM nx_meta.schema_migrations`,
    );
    return checkReadiness(db, {
      env: process.env,
      secretsWritable: secretStoreFromEnv().writable,
      migrations: { defined, applied: Number(rows[0]?.applied ?? 0) },
    });
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="جاهزية النشر"
        subtitle="دليل التركيب مسؤولاً عنه النظام نفسه: ما هو مضبوط، وما ينقص، وماذا يُكتب لضبطه."
      />
      <OperatorReadiness checks={report.checks} canServeLive={report.canServeLive} />
    </div>
  );
}
