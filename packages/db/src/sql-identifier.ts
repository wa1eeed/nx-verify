/**
 * Escaping for the few statements PostgreSQL will not accept bind parameters for,
 * such as ALTER ROLE ... PASSWORD and CREATE DATABASE.
 *
 * Nothing derived from a request ever reaches these helpers. They exist for operational
 * values that come from the environment.
 */

export function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`refusing to quote an unexpected identifier: ${JSON.stringify(value)}`);
  }
  return `"${value}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    // The value itself is not interpolated into the message. Rule 4: identifiers must not
    // reach logs or error messages, and this helper also guards tenant ids.
    throw new Error(`${label} is not a valid uuid`);
  }
  return value;
}
