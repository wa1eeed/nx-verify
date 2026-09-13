import type { Queryable } from '@nx-verify/db';
import type { EndpointMapping } from './http/response-mapping.js';
import type { LeanEndpointMapping } from './lean/lean-provider.js';

/**
 * A provider's endpoint map, read from rows.
 *
 * Rule 8 made a verification product rows rather than code, and it held. Connecting a
 * provider did not: the address a call goes to, the envelope it comes back in and the
 * names inside it lived in a TypeScript file, so every new provider and every path a
 * supplier moved was a release.
 *
 * That is the wrong shape for the same reason the addresses were, and it also blocks work
 * on a provider whose documentation has not arrived, which is the situation this was
 * written in.
 *
 * What stays in code is what belongs to us: our field names, the adapter that walks an
 * envelope, and the built in maps for providers we have already integrated. Rows win over
 * those, because somebody entered them on purpose.
 */

export interface StoredEndpoint {
  provider: string;
  environment: 'sandbox' | 'live';
  endpoint: string;
  method: 'GET' | 'POST';
  path: string;
  authority: string;
  dataPath: string | null;
  fieldMap: Record<string, string>;
  flatten: string[];
  bodyMap: Record<string, string> | null;
}

export async function listProviderEndpoints(
  db: Queryable,
  environment: 'sandbox' | 'live',
): Promise<StoredEndpoint[]> {
  const { rows } = await db.query<{
    provider: string;
    environment: 'sandbox' | 'live';
    endpoint: string;
    method: 'GET' | 'POST';
    path: string;
    authority: string;
    data_path: string | null;
    field_map: Record<string, string>;
    flatten: string[];
    body_map: Record<string, string> | null;
  }>(
    `SELECT provider, environment, endpoint, method, path, authority, data_path,
            field_map, flatten, body_map
     FROM provider_endpoints
     WHERE environment = $1 AND status = 'active'
     ORDER BY provider, endpoint`,
    [environment],
  );

  return rows.map((row) => ({
    provider: row.provider,
    environment: row.environment,
    endpoint: row.endpoint,
    method: row.method,
    path: row.path,
    authority: row.authority,
    dataPath: row.data_path,
    fieldMap: row.field_map ?? {},
    flatten: row.flatten ?? [],
    bodyMap: row.body_map,
  }));
}

export interface SetEndpointInput {
  provider: string;
  environment: 'sandbox' | 'live';
  endpoint: string;
  method?: 'GET' | 'POST';
  path: string;
  authority: string;
  dataPath?: string | null;
  fieldMap?: Record<string, string>;
  flatten?: string[];
  bodyMap?: Record<string, string> | null;
  status?: 'active' | 'disabled';
}

export async function setProviderEndpoint(
  operator: Queryable,
  input: SetEndpointInput,
): Promise<void> {
  await operator.query(
    `INSERT INTO provider_endpoints (provider, environment, endpoint, method, path, authority,
                                     data_path, field_map, flatten, body_map, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, now())
     ON CONFLICT (provider, environment, endpoint) DO UPDATE SET
       method = EXCLUDED.method,
       path = EXCLUDED.path,
       authority = EXCLUDED.authority,
       data_path = EXCLUDED.data_path,
       field_map = EXCLUDED.field_map,
       flatten = EXCLUDED.flatten,
       body_map = EXCLUDED.body_map,
       status = EXCLUDED.status,
       updated_at = now()`,
    [
      input.provider,
      input.environment,
      input.endpoint,
      input.method ?? 'GET',
      input.path,
      input.authority,
      input.dataPath ?? null,
      JSON.stringify(input.fieldMap ?? {}),
      input.flatten ?? [],
      input.bodyMap === undefined || input.bodyMap === null ? null : JSON.stringify(input.bodyMap),
      input.status ?? 'active',
    ],
  );
}

/** The stored rows for one provider, in the shape the HTTP adapter takes. */
export function httpMappingsFor(
  stored: readonly StoredEndpoint[],
  provider: string,
): Record<string, EndpointMapping> | null {
  const mine = stored.filter((row) => row.provider === provider);
  if (mine.length === 0) {
    return null;
  }

  const mappings: Record<string, EndpointMapping> = {};
  for (const row of mine) {
    mappings[row.endpoint] = {
      path: row.path,
      method: row.method,
      authority: row.authority,
      ...(row.dataPath === null ? {} : { dataPath: row.dataPath }),
      ...(Object.keys(row.fieldMap).length === 0 ? {} : { fields: row.fieldMap }),
      ...(row.flatten.length === 0 ? {} : { flatten: row.flatten }),
    };
  }
  return mappings;
}

/**
 * The same rows in the shape the open banking adapter takes.
 *
 * That adapter posts a body built from the step's input, so a stored row carries a body
 * template: the values are `$.name` references resolved against the input, and anything
 * else is sent as written.
 */
export function openBankingMappingsFor(
  stored: readonly StoredEndpoint[],
  provider: string,
): Record<string, LeanEndpointMapping> | null {
  const mine = stored.filter((row) => row.provider === provider);
  if (mine.length === 0) {
    return null;
  }

  const mappings: Record<string, LeanEndpointMapping> = {};
  for (const row of mine) {
    const bodyTemplate = row.bodyMap ?? {};
    const fieldMap = row.fieldMap;
    const dataPath = row.dataPath;

    mappings[row.endpoint] = {
      path: row.path,
      authority: row.authority,
      body: (input) => {
        const body: Record<string, unknown> = {};
        for (const [key, reference] of Object.entries(bodyTemplate)) {
          body[key] = reference.startsWith('$.') ? (input[reference.slice(2)] ?? null) : reference;
        }
        return body;
      },
      map: (payload) => {
        const source = dataPath === null ? payload : asRecord(payload[dataPath]);
        const flat: Record<string, unknown> = {};
        for (const [theirs, ours] of Object.entries(fieldMap)) {
          flat[ours] = source[theirs] ?? null;
        }
        return flat;
      },
    };
  }
  return mappings;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
