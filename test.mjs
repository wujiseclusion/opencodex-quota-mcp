import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getProviderQuotas, projectQuota } from './quota.mjs';

const page = '<meta name="opencodex-session-token" content="ocx_session_test_secret"><meta name="opencodex-session-origin" content="http://localhost:10100">';
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const roster = [{ name: 'deepseek', apiKey: 'NEVER_EXPOSE', headers: { secret: 'NEVER_EXPOSE' } }, { name: 'mimo' }];
const snapshot = { generatedAt: 1793206089042, reports: [{ provider: 'deepseek', label: 'DeepSeek', source: 'deepseek:balance', secret: 'NEVER_EXPOSE', quota: { updatedAt: 1793206089042, customWindows: [{ label: 'API balance (¥42.29)', percent: 0 }] } }] };
function mock(overrides = {}) {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname;
    if (overrides[path]) return overrides[path](requests);
    if (path === '/') return response(page);
    assert.equal(options.headers.Authorization, 'Bearer ocx_session_test_secret');
    assert.equal(options.headers['x-opencodex-gui-origin'], 'http://localhost:10100');
    if (path === '/api/providers') return response(roster);
    if (path === '/api/provider-quotas') return response(snapshot);
    assert.fail(`Unexpected endpoint: ${path}`);
  };
  return { fetcher, requests };
}

test('balance, missing data, filtering and credential exclusion', async () => {
  const { fetcher, requests } = mock();
  const result = await getProviderQuotas(undefined, fetcher);
  assert.equal(result.providers[1].status, 'unavailable_or_unsupported');
  const balance = result.providers[0].quota.windows[0];
  assert.equal(balance.balanceDisplay, 'API balance (¥42.29)');
  assert.equal(balance.usedPercent, undefined);
  assert.equal(balance.remainingPercent, undefined);
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE|ocx_session_test_secret|Authorization/);
  assert.equal(requests.length, 3);
  assert.equal((await getProviderQuotas('DeepSeek', mock().fetcher)).providers.length, 1);
  await assert.rejects(getProviderQuotas('nonexistent', mock().fetcher), /Unknown provider/);
});

test('used versus remaining and seconds versus milliseconds', () => {
  const result = projectQuota({ fiveHourPercent: 87, weeklyPercent: 0, fiveHourResetAt: 1793206089, weeklyResetAt: 1793206089000, updatedAt: 1793206089000 }, 1793206099000);
  assert.equal(result.windows[0].remainingPercent, 13);
  assert.equal(result.windows[1].remainingPercent, 100);
  assert.equal(result.windows[0].resetsAt, result.windows[1].resetsAt);
  assert.equal(result.ageSeconds, 10);
  assert.equal(projectQuota({}).windows.length, 0);
});

test('expired authentication retries once, persistent denial fails safely', async () => {
  let calls = 0;
  const { fetcher, requests } = mock({ '/api/providers': () => ++calls === 1 ? response('denied', 401) : response(roster) });
  await getProviderQuotas(undefined, fetcher);
  assert.equal(calls, 2);
  assert.equal(requests.filter(row => new URL(row.url).pathname === '/').length, 2);
  const denied = mock({ '/api/providers': () => response('secret upstream body', 403) });
  await assert.rejects(getProviderQuotas(undefined, denied.fetcher), /HTTP 403/);
  assert.equal(denied.requests.filter(row => new URL(row.url).pathname === '/api/providers').length, 2);
});

test('offline, absent session, invalid JSON, invalid schema', async () => {
  await assert.rejects(getProviderQuotas(undefined, async () => { throw new Error('private network details'); }), /unreachable or timed out/);
  await assert.rejects(getProviderQuotas(undefined, mock({ '/': () => response('<html/>') }).fetcher), /did not issue/);
  await assert.rejects(getProviderQuotas(undefined, mock({ '/api/provider-quotas': () => response('not JSON') }).fetcher), /invalid JSON/);
  await assert.rejects(getProviderQuotas(undefined, mock({ '/api/provider-quotas': () => response({ reports: null }) }).fetcher), /unexpected structure/);
});

test('MCP handshake and tool discovery without OpenCodex', async () => {
  const client = new Client({ name: 'quota-discovery-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(row => row.name), ['get_provider_quotas']);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    const invalid = await client.callTool({ name: 'get_provider_quotas', arguments: { provider: '' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});

test('live MCP handshake, discovery, query and invalid input', { skip: process.env.OPENCODEX_LIVE_TEST !== '1', timeout: 180000 }, async () => {
  const client = new Client({ name: 'quota-verification', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(row => row.name), ['get_provider_quotas']);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    const result = await client.callTool({ name: 'get_provider_quotas', arguments: {} });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent.providers.length > 0);
    assert.doesNotMatch(JSON.stringify(result), /ocx_session_|csrf|Bearer /);
    const filtered = await client.callTool({ name: 'get_provider_quotas', arguments: { provider: result.structuredContent.providers[0].provider } });
    assert.equal(filtered.structuredContent.providers.length, 1);
    const missing = await client.callTool({ name: 'get_provider_quotas', arguments: { provider: 'nonexistent' } });
    assert.equal(missing.isError, true);
    console.log('Live provider statuses:', result.structuredContent.providers.map(row => `${row.provider}=${row.status}`).join(', '));
  } finally { await client.close(); }
});
