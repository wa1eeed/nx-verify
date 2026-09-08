import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpApiClient } from './client.js';
import { createMcpServer } from './mcp-server.js';

/**
 * Entry point.
 *
 * One process is one subscriber, because the key it is started with fixes the tenant and
 * no tool takes a tenant argument. The spend ceiling is read here, from the environment
 * of whoever started the process, and nothing the model sends can raise it.
 */

async function main(): Promise<void> {
  const baseUrl = process.env['NX_API_URL'];
  const apiKey = process.env['NX_API_KEY'];

  if (!baseUrl || !apiKey) {
    console.error('NX_API_URL and NX_API_KEY are required');
    process.exit(1);
  }

  const ceiling = Number(process.env['NX_MCP_SPEND_CEILING_HALALAS'] ?? 50_000);
  const server = createMcpServer(new HttpApiClient(baseUrl, apiKey), { spendCeiling: ceiling });

  // stdio, so the transport carries no key of its own and the process is reachable only
  // by whoever started it.
  await server.connect(new StdioServerTransport());
}

void main();
