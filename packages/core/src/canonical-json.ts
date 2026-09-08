/**
 * Deterministic JSON for hashing.
 *
 * `value_hash` exists so that change detection is a cheap byte comparison instead of a
 * full JSONB comparison. That only works if the same logical value always serialises to
 * the same bytes, so object keys are sorted and undefined is dropped.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry !== undefined) {
      result[key] = canonicalize(entry);
    }
  }
  return result;
}
