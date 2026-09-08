import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolRefusal, createTools, type ToolOptions } from './tools.js';
import type { NxApiClient } from './client.js';

/**
 * The MCP server.
 *
 * A channel, not a capability. Everything it can do, the API could already do, and this
 * exists so an assistant can do it without a person pasting JSON. Which is also why it
 * was left until last: built before the API settled, it would have been built twice.
 */

export interface McpServerOptions extends ToolOptions {
  version?: string;
}

export function createMcpServer(client: NxApiClient, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'nx-verify', version: options.version ?? '1.0.0' });
  const { tools } = createTools(client, options);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: !tool.writes,
          // One tool spends money, and a host that shows a confirmation before a
          // destructive call should show one before this too.
          destructiveHint: tool.writes,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input: Record<string, unknown>) => {
        try {
          const result = await tool.handler(input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const refusal =
            error instanceof ToolRefusal
              ? { message_ar: error.messageAr, message_en: error.message }
              : {
                  message_ar: 'تعذّر تنفيذ الطلب.',
                  message_en: 'The request could not be completed.',
                };
          // Bilingual, because the person reading the transcript may be either, and
          // carrying nothing of the subject in it (rule 4).
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(refusal, null, 2) }],
          };
        }
      },
    );
  }

  return server;
}
