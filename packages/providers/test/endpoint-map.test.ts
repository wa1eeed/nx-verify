import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import {
  httpMappingsFor,
  listProviderEndpoints,
  openBankingMappingsFor,
  setProviderEndpoint,
} from '../src/endpoint-map.js';
import { registryFor, setProviderConnection } from '../src/connections.js';

/**
 * Unit 73 acceptance: a provider's endpoint map is rows, so connecting one needs no
 * release.
 *
 * Rule 8 made a product rows and it held. Connecting a provider did not: the address a
 * call goes to and the shape it comes back in were in a TypeScript file, so every new
 * provider and every path a supplier moved was a deployment. It also blocked work on a
 * provider whose documentation had not arrived, which is what this was written for.
 */

describe('a provider endpoint map in rows', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('newco', 'مزوّد جديد', 'Newco', '{national_address}')
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the two environments apart', async () => {
    await setProviderEndpoint(db.operatorPool, {
      provider: 'newco',
      environment: 'sandbox',
      endpoint: 'national_address',
      path: '/sandbox/v2/address/{identifications}',
      authority: 'National Address',
      dataPath: 'data',
      fieldMap: { cityName: 'city' },
    });
    await setProviderEndpoint(db.operatorPool, {
      provider: 'newco',
      environment: 'live',
      endpoint: 'national_address',
      path: '/v2/address/{identifications}',
      authority: 'National Address',
      dataPath: 'data',
      fieldMap: { cityName: 'city' },
    });

    const sandbox = await listProviderEndpoints(db.appPool, 'sandbox');
    const live = await listProviderEndpoints(db.appPool, 'live');
    // A sandbox host and a production host disagree about paths more often than anybody
    // expects, and finding that out in production is the expensive way.
    expect(sandbox[0]?.path).toBe('/sandbox/v2/address/{identifications}');
    expect(live[0]?.path).toBe('/v2/address/{identifications}');
  });

  it('renames their field names to ours, so the product definition never moves', () => {
    const stored = [
      {
        provider: 'newco',
        environment: 'live' as const,
        endpoint: 'national_address',
        method: 'GET' as const,
        path: '/v2/address/{identifications}',
        authority: 'National Address',
        dataPath: 'data',
        fieldMap: { cityName: 'city', districtName: 'district' },
        flatten: ['address'],
        bodyMap: null,
      },
    ];

    const http = httpMappingsFor(stored, 'newco');
    expect(http?.['national_address']).toMatchObject({
      path: '/v2/address/{identifications}',
      authority: 'National Address',
      dataPath: 'data',
      fields: { cityName: 'city', districtName: 'district' },
      flatten: ['address'],
    });
    // step_field_map belongs to the product, not to the provider, and it must not move
    // when the provider behind a step changes.
    expect(http?.['national_address']?.fields?.['cityName']).toBe('city');
  });

  it('builds a posted body from the step input for an open banking provider', () => {
    const stored = [
      {
        provider: 'openbank',
        environment: 'live' as const,
        endpoint: 'income_verification',
        method: 'POST' as const,
        path: '/insights/v2/income',
        authority: 'Bank Statements',
        dataPath: 'salary',
        fieldMap: { currency: 'income_currency' },
        flatten: [],
        bodyMap: { entity_id: '$.entity_id', income_type: 'ALL' },
      },
    ];

    const mappings = openBankingMappingsFor(stored, 'openbank');
    const mapping = mappings?.['income_verification'];
    expect(mapping?.path).toBe('/insights/v2/income');
    // A $. reference comes from the step's resolved input; anything else is sent as it
    // is written, which is how a constant like ALL gets there without code.
    expect(mapping?.body({ entity_id: 'e-77' })).toEqual({
      entity_id: 'e-77',
      income_type: 'ALL',
    });
    expect(mapping?.map({ salary: { currency: 'SAR' } }, {})).toEqual({ income_currency: 'SAR' });
  });

  it('gives the adapter the stored map when there is one, and the built in one otherwise', async () => {
    await setProviderConnection(
      db.operatorPool,
      {
        provider: 'newco',
        environment: 'live',
        kind: 'http',
        baseUrl: 'https://api.newco.example',
        credentialRef: 'kms://providers/newco/live',
      },
      'nx-staff:test',
    );

    const registry = await registryFor(db.appPool, 'live');
    // The stored row named one endpoint, so that is what the adapter accepts. Without a
    // row it would carry the map compiled into it instead.
    expect(registry.get('newco').endpoints).toEqual(['national_address']);
  });

  it('is unreadable by a subscriber role, because it names providers', async () => {
    // Rule 5. The map is a provider's private API shape as well as its name.
    await expect(
      db.retentionPool.query('SELECT path FROM provider_endpoints'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
