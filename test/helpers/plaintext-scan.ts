import type { TenantTransaction } from '../../packages/db/src/client.js';

/**
 * Searches every column of every table for a literal value.
 *
 * Guard 05 uses this to prove rule 4 across the whole schema rather than against a list
 * of columns someone has to remember to update. Text and JSON columns are compared as
 * text, and binary columns are searched for the UTF-8 bytes of the value, so an
 * identifier written into a bytea column without encryption is caught too.
 */

export interface PlaintextHit {
  table: string;
  column: string;
  dataType: string;
}

export async function scanForPlaintext(
  tx: TenantTransaction,
  needle: string,
): Promise<PlaintextHit[]> {
  const { rows: columns } = await tx.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT c.table_name, c.column_name, c.data_type
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.column_name`,
  );

  const hits: PlaintextHit[] = [];

  for (const column of columns) {
    const table = quote(column.table_name);
    const field = quote(column.column_name);
    const predicate =
      column.data_type === 'bytea'
        ? `position(convert_to($1, 'UTF8') in ${field}) > 0`
        : `${field}::text LIKE '%' || $1 || '%'`;

    const { rows } = await tx.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${table} WHERE ${field} IS NOT NULL AND ${predicate}) AS found`,
      [needle],
    );

    if (rows[0]?.found) {
      hits.push({
        table: column.table_name,
        column: column.column_name,
        dataType: column.data_type,
      });
    }
  }

  return hits;
}

function quote(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`unexpected identifier from the catalog: ${identifier}`);
  }
  return `"${identifier}"`;
}
