/**
 * The explicit denylist rule 10 requires, in the logging layer and the error handler.
 *
 * Two separate concerns, both handled here because both are leaks through the same door:
 *
 *   Credentials must never reach a log sink. Rule 10.
 *   Provider names must never reach a caller. Rule 5.
 *
 * Keys are matched case insensitively and by substring, so `providerApiKey`, `api_key`
 * and `Authorization` are all caught without anyone maintaining an exact list.
 */

const SECRET_KEY_PATTERNS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'credential',
  'cookie',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'signature',
  'session',
];

/** Identifier bearing keys. Rule 4: these must not reach a log line either. */
const IDENTIFIER_KEY_PATTERNS: readonly string[] = [
  'nationalid',
  'national_id',
  'iqama',
  'iban',
  'id_value',
  'idvalue',
  'identifier',
  'identification',
  'cr_number',
  'crnumber',
  'unn',
  'deed',
  'subject',
];

export const REDACTED = '[redacted]';

const MAX_DEPTH = 12;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, '');
  return [...SECRET_KEY_PATTERNS, ...IDENTIFIER_KEY_PATTERNS].some((pattern) =>
    normalized.includes(pattern.replace(/[^a-z_]/g, '')),
  );
}

/**
 * Returns a copy safe to write to a log sink. Never mutates the input, because the
 * caller usually still needs the real values to do its work.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactForLog(entry, depth + 1));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `[buffer ${value.length}]`;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactForLog(entry, depth + 1);
  }
  return result;
}

/**
 * Strips provider names from anything on its way to a caller.
 *
 * Rule 5: the exposed field is `authority`, the official body. `source` is internal.
 * The registered names are passed in rather than hardcoded so that adding a provider
 * cannot forget to update this list.
 */
export function stripProviderNames(text: string, providerNames: readonly string[]): string {
  let result = text;
  for (const name of providerNames) {
    if (name.length === 0) {
      continue;
    }
    result = result.replaceAll(new RegExp(escapeRegExp(name), 'gi'), REDACTED);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Describes a provider request payload without reproducing any of it.
 *
 * A denylist cannot protect this payload. Its keys come from a product's input_binding
 * and are named by the provider, so the next product added by a database row can
 * introduce a key nobody thought to list, carrying a national id under a name like
 * `identifications`. That is not a hypothetical: it is exactly what guard 06 caught.
 *
 * So the rule for provider inputs is not "redact the sensitive keys", it is "log the
 * shape and never the values".
 */
export function describeProviderInput(
  input: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const shape: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    shape[key] = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  }
  return shape;
}
