import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getProviderQuotas } from './quota.mjs';

const server = new McpServer({ name: 'opencodex-quota-mcp-server', version: '1.0.0' });
server.registerTool('get_provider_quotas', {
  title: 'OpenCodex provider quota and balance',
  description: '查询本机 OpenCodex 各提供商的额度、余额、剩余比例、重置时间和数据更新时间。Read provider quotas from the local dashboard. Omit provider to list all. Missing quota means unavailable or unsupported, never zero usage. Uses dashboard caching; does not force refresh or send model completions.',
  inputSchema: { provider: z.string().trim().min(1).max(100).optional().describe('Exact configured provider name or dashboard label, e.g. anthropic, openai, deepseek, kimi, mimo. Omit for all providers.') },
  outputSchema: { dashboardUrl: z.string(), queriedAt: z.string(), generatedAt: z.string().nullable(), note: z.string(), providers: z.array(z.object({ provider: z.string(), label: z.string(), enabled: z.boolean(), status: z.string() }).passthrough()) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ provider }) => {
  try {
    const result = await getProviderQuotas(provider);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
