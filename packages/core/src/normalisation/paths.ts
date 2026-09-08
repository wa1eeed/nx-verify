import { NxError } from '../errors.js';

/**
 * Path reading for step_field_map.
 *
 * The same three reference forms as input_binding, plus one wildcard:
 *
 *   $.a.b        absolute in the step payload
 *   @.a.b        relative to the current array element
 *   literal:x    a constant
 *   $.a[*].b     walks an array, producing one result per element
 *
 * There is no expression language here either. A mapping is a lookup.
 */

export interface PathMatch {
  value: unknown;
  /** The array element this value came from, when the path used a wildcard. */
  element: Record<string, unknown> | null;
}

export function readMatches(payload: Readonly<Record<string, unknown>>, path: string): PathMatch[] {
  if (!path.startsWith('$.')) {
    throw new NxError('NX-5001', { detail: `source_path must start with $. but was ${path}` });
  }

  const wildcard = path.indexOf('[*]');
  if (wildcard === -1) {
    const value = readPath(payload, path.slice(2));
    return value === undefined ? [] : [{ value, element: null }];
  }

  const before = path.slice(2, wildcard);
  const after = path.slice(wildcard + 3).replace(/^\./, '');
  const collection = readPath(payload, before);

  if (!Array.isArray(collection)) {
    return [];
  }

  const matches: PathMatch[] = [];
  for (const entry of collection) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const element = entry as Record<string, unknown>;
    const value = after === '' ? element : readPath(element, after);
    if (value !== undefined) {
      matches.push({ value, element });
    }
  }
  return matches;
}

/** Resolves a reference that may be absolute, element relative, or a literal. */
export function resolveReference(
  reference: string,
  payload: Readonly<Record<string, unknown>>,
  element: Record<string, unknown> | null,
): unknown {
  if (reference.startsWith('literal:')) {
    return reference.slice('literal:'.length);
  }
  if (reference.startsWith('@.')) {
    return element === null ? undefined : readPath(element, reference.slice(2));
  }
  if (reference.startsWith('$.')) {
    return readPath(payload, reference.slice(2));
  }
  throw new NxError('NX-5001', { detail: `unsupported reference: ${reference}` });
}

function readPath(source: unknown, path: string): unknown {
  if (path === '') {
    return source;
  }
  let current = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
