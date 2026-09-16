import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../../packages/providers/src/index.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import { SECRET_REF } from '../../../test/helpers/billing.js';
import { buildApp } from '../src/app.js';
import { buildContext } from '../src/context.js';
import { buildOpenApiDocument } from '../src/openapi.js';
import type { FastifyInstance } from 'fastify';

/**
 * The published specification and the running server describe the same API.
 *
 * A specification written by hand drifts the first time either side changes, and the customer
 * finds out at the worst possible moment. This asks the built server which routes it actually
 * registered and compares the two lists, so a route added without a line here fails the merge.
 *
 * It found seven routes missing when it was written, and an error code in the document
 * (`NX-4021`) that the platform has never been able to return.
 */

describe('the specification and the server', () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let context: ReturnType<typeof buildContext>;

  beforeAll(async () => {
    db = await createTestDatabase();
    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 7).toString('base64'),
      registry: new ProviderRegistry().register(new StubProvider({ name: 'stub' })),
      secrets: new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } }),
    });
    app = await buildApp({ context });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await context.pool.end();
    await db.close();
  });

  /** Fastify writes `:id`; OpenAPI writes `{id}`. */
  const asSpecPath = (route: string): string => route.replace(/:([A-Za-z_]+)/g, '{$1}');

  /**
   * The routes the server actually has, read from its own printed tree.
   *
   * The tree nests, so a line's full path is its own segment after every ancestor's: the depth
   * is how many four character rails stand before the branch mark.
   */
  const registered = (): Map<string, Set<string>> => {
    const routes = new Map<string, Set<string>>();
    const prefixes: string[] = [];
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const mark = /[├└]── /.exec(line);
      if (!mark) {
        continue;
      }
      const depth = Math.floor((mark.index ?? 0) / 4);
      const rest = line.slice((mark.index ?? 0) + 4);
      const parsed = /^(\S*)\s+\(([A-Z, ]+)\)\s*$/.exec(rest);
      const segment = parsed ? (parsed[1] as string) : rest.trim();
      prefixes[depth] = segment;
      prefixes.length = depth + 1;
      if (!parsed) {
        continue;
      }
      const path = asSpecPath(prefixes.join('')).replace(/\/$/, '') || '/';
      const methods = (parsed[2] as string)
        .split(',')
        .map((method) => method.trim().toLowerCase())
        .filter((method) => method !== 'head' && method !== 'options');
      if (methods.length > 0) {
        routes.set(path, new Set([...(routes.get(path) ?? []), ...methods]));
      }
    }
    return routes;
  };

  const documented = (): Map<string, Set<string>> => {
    const paths = buildOpenApiDocument()['paths'] as Record<string, Record<string, unknown>>;
    return new Map(
      Object.entries(paths).map(([path, operations]) => [path, new Set(Object.keys(operations))]),
    );
  };

  it('documents every route the server registers', () => {
    const missing: string[] = [];
    for (const [path, methods] of registered()) {
      const described = documented().get(path);
      for (const method of methods) {
        if (!described?.has(method)) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('describes no route the server does not have', () => {
    const live = registered();
    const invented: string[] = [];
    for (const [path, methods] of documented()) {
      for (const method of methods) {
        if (!live.get(path)?.has(method)) {
          invented.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(invented).toEqual([]);
  });

  it('gives an example error code the platform can actually return', () => {
    const document = JSON.stringify(buildOpenApiDocument());
    // Every NX code in the document must be one of the nine in the catalogue.
    const real = new Set([
      'NX-4001',
      'NX-4002',
      'NX-4011',
      'NX-4029',
      'NX-4031',
      'NX-4041',
      'NX-4091',
      'NX-5001',
      'NX-5002',
    ]);
    const quoted = [...document.matchAll(/NX-\d{4}/g)].map((match) => match[0]);
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.filter((code) => !real.has(code))).toEqual([]);
  });

  it('names no data source anywhere in the specification', () => {
    // Rule 5 reaches the published document too: it is the most public surface there is.
    // Whole words only, because «boolean» carries a provider's name inside it by accident.
    const document = JSON.stringify(buildOpenApiDocument()).toLowerCase();
    for (const name of ['lean', 'leantech', 'wathq', 'nafath', 'elm', 'simah']) {
      expect(document).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
