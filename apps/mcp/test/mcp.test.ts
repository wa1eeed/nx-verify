import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey } from '../../../packages/core/src/auth/api-keys.js';
import { getWallet } from '../../../packages/core/src/billing/wallet.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { SECRET_REF, preparePricedTenant } from '../../../test/helpers/billing.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../../packages/providers/src/index.js';
import { buildApp } from '../../api/src/app.js';
import { buildContext } from '../../api/src/context.js';
import { createTools, ToolRefusal } from '../src/tools.js';
import { createMcpServer } from '../src/mcp-server.js';
import { idempotencyKeyFor, type ApiResponse, type NxApiClient } from '../src/client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FastifyInstance } from 'fastify';

/**
 * Unit 26 acceptance: an agent can use the platform through MCP, and cannot use it to do
 * anything the API would not let a person do with the same key.
 *
 * The client here injects into the real API, which runs against the real database. There
 * is no seam between the tool and the platform that a test could fake past.
 */

const PROVIDER_NAME = 'wathq-example-connector';

class InjectClient implements NxApiClient {
  constructor(
    private readonly app: FastifyInstance,
    private readonly key: string,
  ) {}

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<ApiResponse> {
    const response = await this.app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${this.key}`,
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
    return { status: response.statusCode, body: response.json() };
  }
}

describe('the MCP server', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let app: FastifyInstance;
  let context: ReturnType<typeof buildContext>;
  let client: NxApiClient;
  let readOnlyClient: NxApiClient;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'MCP Tenant');
    await preparePricedTenant(db, tenant.tenantId, { providerName: PROVIDER_NAME });

    const full = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, {
        name: 'mcp',
        scopes: [
          'verifications:write',
          'verifications:read',
          'products:read',
          'entities:read',
          'wallet:read',
        ],
      }),
    );
    const readOnly = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'mcp read only', scopes: ['products:read', 'wallet:read'] }),
    );

    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 7).toString('base64'),
      registry: new ProviderRegistry().register(new StubProvider({ name: PROVIDER_NAME })),
      secrets: new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } }),
    });
    app = await buildApp({ context });
    client = new InjectClient(app, full.secret);
    readOnlyClient = new InjectClient(app, readOnly.secret);
  });

  afterAll(async () => {
    await app.close();
    await context.pool.end();
    await db.close();
  });

  const toolsOf = (options?: { spendCeiling?: number }) =>
    createTools(client, options ?? {});

  const call = async (
    tools: ReturnType<typeof createTools>,
    name: string,
    input: Record<string, unknown> = {},
  ) => {
    const tool = tools.tools.find((entry) => entry.name === name);
    if (!tool) {
      throw new Error(`no tool named ${name}`);
    }
    return tool.handler(input);
  };

  const balance = () => withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

  it('offers reading and one paid action, and nothing that configures the platform', () => {
    const names = toolsOf().tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'check_evidence',
      'get_entity_profile',
      'get_verification',
      'get_wallet_balance',
      'list_products',
      'quote_verification',
      'run_verification',
    ]);

    // A model must not be able to approve a review case: the four eyes rule wants two
    // identified people. Nor to change a binding, a price or a policy.
    for (const forbidden of ['approve', 'decide', 'binding', 'price', 'policy', 'rule']) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }

    // Rule 2 as a shape rather than a check: no tool takes a tenant.
    for (const tool of toolsOf().tools) {
      expect(Object.keys(tool.inputSchema)).not.toContain('tenant_id');
      expect(Object.keys(tool.inputSchema)).not.toContain('tenant');
    }

    // Exactly one tool spends.
    expect(toolsOf().tools.filter((tool) => tool.writes).map((tool) => tool.name)).toEqual([
      'run_verification',
    ]);
  });

  it('quotes a product before anything is spent', async () => {
    const quote = (await call(toolsOf(), 'quote_verification', {
      product: 'KYB_COMPLETE',
    })) as Record<string, unknown>;

    expect(quote['cost']).toBe(44);
    expect(quote['currency']).toBe('SAR');
    expect(quote['input_schema']).toBeTruthy();
    expect(quote['session_remaining']).toBe(500);
  });

  it('refuses to run without the quoted figure, and charges nothing', async () => {
    const before = await balance();
    const tools = toolsOf();

    await expect(
      call(tools, 'run_verification', {
        product: 'KYB_COMPLETE',
        subject: { unn: '7001272184' },
        reference: 'MCP-NOQUOTE',
        confirm_cost: 1,
      }),
    ).rejects.toBeInstanceOf(ToolRefusal);

    const after = await balance();
    expect(after.balance).toBe(before.balance);
    expect(tools.limit.spent).toBe(0);
  });

  it('runs a verification once the price is confirmed, and returns our own schema', async () => {
    const tools = toolsOf();
    const before = await balance();

    const result = (await call(tools, 'run_verification', {
      product: 'KYB_COMPLETE',
      subject: { unn: '7001272184' },
      reference: 'MCP-1',
      confirm_cost: 44,
    })) as Record<string, unknown>;

    expect(result['status']).toBeTruthy();
    expect(result['verification_id']).toBeTruthy();
    expect(result['evidence_url']).toMatch(/^\/v1\/evidence\//);
    expect(result['session_remaining']).toBe(456);
    expect(tools.limit.spent).toBe(4400);

    const after = await balance();
    expect(after.balance).toBeLessThan(before.balance);

    // Rule 5. The server has never been told a provider name, because the API does not
    // say one, so there is nothing here to leak.
    expect(JSON.stringify(result)).not.toContain(PROVIDER_NAME);
  });

  it('charges once when the model retries the same request', async () => {
    const tools = toolsOf();
    const first = (await call(tools, 'run_verification', {
      product: 'ADDRESS_ONLY',
      subject: { unn: '7001272184' },
      reference: 'MCP-RETRY',
      confirm_cost: 8,
    })) as Record<string, unknown>;

    const middle = await balance();

    // The same call again, as a model that believed the first one timed out would make it.
    const second = (await call(tools, 'run_verification', {
      product: 'ADDRESS_ONLY',
      subject: { unn: '7001272184' },
      reference: 'MCP-RETRY',
      confirm_cost: 8,
    })) as Record<string, unknown>;

    expect(second['verification_id']).toBe(first['verification_id']);
    expect(second['replayed']).toBe(true);
    expect((await balance()).balance).toBe(middle.balance);
    // A replay costs nothing, so it does not eat into the ceiling either.
    expect(tools.limit.spent).toBe(800);
  });

  it('derives the same idempotency key for the same request and a different one otherwise', () => {
    const subject = { unn: '7001272184' };
    expect(idempotencyKeyFor('KYB_COMPLETE', 'A', subject)).toBe(
      idempotencyKeyFor('KYB_COMPLETE', 'A', subject),
    );
    expect(idempotencyKeyFor('KYB_COMPLETE', 'A', subject)).not.toBe(
      idempotencyKeyFor('KYB_COMPLETE', 'B', subject),
    );
    // Rule 4: the identifier is hashed into the key, never carried in it.
    expect(idempotencyKeyFor('KYB_COMPLETE', 'A', subject)).not.toContain('7001272184');
  });

  it('stops at the spend ceiling set by whoever started the server', async () => {
    const tools = toolsOf({ spendCeiling: 1_000 });

    await expect(
      call(tools, 'run_verification', {
        product: 'KYB_COMPLETE',
        subject: { unn: '7001272184' },
        reference: 'MCP-CEILING',
        confirm_cost: 44,
      }),
    ).rejects.toThrow(/ceiling/i);
    expect(tools.limit.spent).toBe(0);
  });

  it('passes our error through without echoing the subject back', async () => {
    const tools = toolsOf();
    await expect(call(tools, 'quote_verification', { product: 'NOT_A_PRODUCT' })).rejects.toThrow(
      /list_products/,
    );

    try {
      await call(tools, 'get_verification', {
        verification_id: '00000000-0000-4000-8000-000000000000',
      });
      expect.unreachable('the run does not exist');
    } catch (error) {
      const refusal = error as ToolRefusal;
      expect(refusal.message).toContain('NX-4041');
      expect(refusal.messageAr).toContain('NX-4041');
      expect(refusal.message).not.toContain('7001272184');
    }
  });

  it('cannot exceed the scopes of the key it was started with', async () => {
    const tools = createTools(readOnlyClient);
    // The key can read the catalogue.
    await expect(call(tools, 'list_products')).resolves.toBeTruthy();
    // And cannot spend, because the key cannot, not because the tool declined.
    await expect(
      call(tools, 'run_verification', {
        product: 'KYB_COMPLETE',
        subject: { unn: '7001272184' },
        reference: 'MCP-SCOPE',
        confirm_cost: 44,
      }),
    ).rejects.toThrow(/NX-403/);
  });

  it('reads a profile where every field carries its authority and freshness', async () => {
    const tools = toolsOf();
    const run = (await call(tools, 'run_verification', {
      product: 'KYB_COMPLETE',
      subject: { unn: '7001272184' },
      reference: 'MCP-PROFILE',
      confirm_cost: 44,
    })) as Record<string, unknown>;

    const profile = (await call(tools, 'get_entity_profile', {
      entity_id: String(run['entity_id']),
    })) as { fields: { authority: string; observed_at: string; freshness: string }[] };

    expect(profile.fields.length).toBeGreaterThan(0);
    for (const field of profile.fields) {
      expect(field.authority).toBeTruthy();
      expect(field.observed_at).toBeTruthy();
      expect(field.freshness).toBeTruthy();
    }
    expect(JSON.stringify(profile)).not.toContain(PROVIDER_NAME);
  });

  it('speaks the protocol, and reports a refusal as an error rather than a result', async () => {
    const server = createMcpServer(client, { spendCeiling: 1_00 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const listed = await mcpClient.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('quote_verification');
    // The host is told which tool spends, so it can ask before one does.
    const paid = listed.tools.find((tool) => tool.name === 'run_verification');
    expect(paid?.annotations?.readOnlyHint).toBe(false);
    expect(paid?.annotations?.destructiveHint).toBe(true);

    const quote = await mcpClient.callTool({
      name: 'quote_verification',
      arguments: { product: 'KYB_COMPLETE' },
    });
    const quoteText = (quote.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(JSON.parse(quoteText).cost).toBe(44);

    const refused = await mcpClient.callTool({
      name: 'run_verification',
      arguments: {
        product: 'KYB_COMPLETE',
        subject: { unn: '7001272184' },
        reference: 'MCP-PROTO',
        confirm_cost: 44,
      },
    });
    expect(refused.isError).toBe(true);
    const refusedText = (refused.content as { type: string; text: string }[])[0]?.text ?? '';
    const payload = JSON.parse(refusedText);
    // Bilingual, and carrying nothing of the subject.
    expect(payload.message_ar).toBeTruthy();
    expect(payload.message_en).toMatch(/ceiling/i);
    expect(refusedText).not.toContain('7001272184');

    await mcpClient.close();
    await server.close();
  });
});
